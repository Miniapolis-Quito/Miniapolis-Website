/**
 * Canal de tiempo real.
 *
 * Es la pieza que hace que el cliente vea bajar su saldo sin recargar, así que
 * conviene comprobarla de verdad: abriendo el flujo y leyendo lo que llega.
 */
import './env.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios } from './helpers.js';
import { buildQrPayload } from '../src/lib/qr.js';
import * as packsService from '../src/services/packs.js';
import { abrirCanal, fijarBase } from './canal.js';

let base;
before(async () => {
  base = await levantarServidor();
  fijarBase(base);
});
after(bajarServidor);
beforeEach(limpiarBase);

test('al conectarse, el canal entrega el saldo actual del cliente', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 10 });

  const canal = await abrirCanal(cCliente.token);
  try {
    const conectado = await canal.esperar('conectado');
    assert.equal(conectado.datos.user.id, cliente.id);
    assert.equal(conectado.datos.summary.availableTickets, 10);
  } finally {
    canal.cerrar();
  }
});

test('el cliente recibe el consumo en el momento en que el personal escanea', async () => {
  const { cMaster, cStaff, cCliente, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const pack = packsService.findById(emitido.datos.pack.id);

  const canal = await abrirCanal(cCliente.token);
  try {
    await canal.esperar('conectado');
    await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });

    const evento = await canal.esperar('entrada.consumida');
    assert.equal(evento.datos.remaining, 4);
    assert.equal(evento.datos.pack.code, pack.code);
    assert.equal(evento.datos.scannedBy.fullName, 'Beto Pista');
  } finally {
    canal.cerrar();
  }
});

test('el evento en vivo dice cómo y desde qué puesto se consumió la entrada', async () => {
  const { cMaster, cStaff, cCliente, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const pack = packsService.findById(emitido.datos.pack.id);

  const canal = await abrirCanal(cCliente.token);
  try {
    await canal.esperar('conectado');
    // Consumo manual: si el evento no llevara el método, la actividad en vivo
    // del escáner lo mostraría como si hubiera entrado por QR.
    await cStaff.post('/api/scan/manual', { code: pack.code, deviceLabel: 'Mostrador' });

    const evento = await canal.esperar('entrada.consumida');
    assert.equal(evento.datos.method, 'manual_code');
    assert.equal(evento.datos.deviceLabel, 'Mostrador');
  } finally {
    canal.cerrar();
  }
});

test('un cliente no recibe los eventos de otro cliente', async () => {
  const { cMaster, cStaff, cCliente, cliente } = await sembrarUsuarios();
  const otro = await cMaster.post('/api/admin/users', {
    email: 'ajeno@pista.ec', fullName: 'Piloto Ajeno', role: 'customer', password: 'Palanca-Cambios-55',
  });
  const ajeno = await cMaster.post('/api/admin/packs', { userId: otro.datos.user.id, size: 5 });
  await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });

  const canal = await abrirCanal(cCliente.token);
  try {
    await canal.esperar('conectado');
    await cStaff.post('/api/scan', { payload: buildQrPayload(packsService.findById(ajeno.datos.pack.id)) });
    await new Promise((r) => setTimeout(r, 300));

    const consumos = canal.recibidos.filter((e) => e.tipo === 'entrada.consumida');
    assert.equal(consumos.length, 0, 'no debe filtrarse la actividad de otro cliente');
  } finally {
    canal.cerrar();
  }
});

test('suspender una cuenta cierra su canal en vivo de inmediato', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();

  const canal = await abrirCanal(cCliente.token);
  try {
    await canal.esperar('conectado');
    await cMaster.patch(`/api/admin/users/${cliente.id}`, { status: 'suspended' });

    const aviso = await canal.esperar('sesion.invalida');
    assert.equal(aviso.datos.motivo, 'cuenta_modificada');
  } finally {
    canal.cerrar();
  }
});

test('cerrar las sesiones de un usuario avisa por su canal', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();

  const canal = await abrirCanal(cCliente.token);
  try {
    await canal.esperar('conectado');
    await cMaster.post(`/api/admin/users/${cliente.id}/revoke-sessions`, {});
    const aviso = await canal.esperar('sesion.invalida');
    assert.ok(aviso.datos.motivo);
  } finally {
    canal.cerrar();
  }
});

test('el personal ve la actividad de la pista, el cliente solo la suya', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const pack = packsService.findById(emitido.datos.pack.id);

  const canalStaff = await abrirCanal(cStaff.token);
  try {
    await canalStaff.esperar('conectado');
    await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });
    const evento = await canalStaff.esperar('entrada.consumida');
    assert.equal(evento.datos.owner.fullName, 'Carlos Piloto');
  } finally {
    canalStaff.cerrar();
  }
});

test('al reconectar, el canal reenvía lo que el cliente se perdió', async () => {
  const { cMaster, cStaff, cCliente, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const pack = packsService.findById(emitido.datos.pack.id);

  // Primer tramo: se recibe un consumo y se anota su id.
  const primero = await abrirCanal(cCliente.token);
  let ultimoId;
  try {
    await primero.esperar('conectado');
    await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });
    const evento = await primero.esperar('entrada.consumida');
    ultimoId = evento.id;
    assert.equal(Number.isInteger(ultimoId), true, 'cada evento viaja con su id');
  } finally {
    primero.cerrar();
  }

  // Se cae la conexión (un túnel, el ascensor de la pista) y mientras tanto
  // pasan cosas: otro consumo y un pack nuevo.
  await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });
  await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 10 });

  // Al volver, indicando el último id recibido, llega lo perdido sin recargar.
  const segundo = await abrirCanal(cCliente.token, { desdeEvento: ultimoId });
  try {
    const reenviado = await segundo.esperar('entrada.consumida');
    assert.equal(reenviado.id > ultimoId, true, 'no se repite lo ya recibido');
    assert.equal(reenviado.datos.remaining, 3);
    const nuevoPack = await segundo.esperar('pack.emitido');
    assert.equal(nuevoPack.datos.pack.size, 10);
  } finally {
    segundo.cerrar();
  }
});

test('una misma persona no puede acumular conexiones sin fin', async () => {
  const { cCliente, cliente } = await sembrarUsuarios();
  const { hub } = await import('../src/lib/events.js');
  const cuantasSuyas = () => [...hub.clients].filter((c) => c.userId === cliente.id).length;

  // Nueve pestañas: una más del tope. La primera tiene que caerse sola.
  const canales = [];
  for (let i = 0; i < 9; i += 1) {
    const canal = await abrirCanal(cCliente.token);
    await canal.esperar('conectado');
    canales.push(canal);
  }

  try {
    assert.equal(cuantasSuyas(), 8, 'debería quedarse en el tope de ocho');

    // La que se cierra recibe el aviso antes de que le corten: sin él se
    // pondría a reconectar y, con más pestañas que cupo, se turnarían echándose
    // unas a otras sin parar.
    const aviso = await canales[0].esperar('canal.reemplazado');
    assert.equal(aviso.datos.motivo, 'reemplazado', 'la desalojada debe saber por qué se cerró');

    // Y la última en abrirse, que es la que la persona está mirando, sigue viva
    // y recibiendo: no se sacrifica la buena por respetar el tope.
    const ultima = canales[canales.length - 1];
    hub.publish(`user:${cliente.id}`, 'prueba.tope', { ok: true });
    const evento = await ultima.esperar('prueba.tope');
    assert.equal(evento.datos.ok, true);
  } finally {
    for (const canal of canales) canal.cerrar();
  }
});

test('sin token no se puede abrir el canal', async () => {
  const respuesta = await fetch(`${base}/api/events`, { headers: { Accept: 'text/event-stream' } });
  assert.equal(respuesta.status, 401);
  await respuesta.body?.cancel();
});
