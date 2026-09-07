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

let base;
before(async () => {
  base = await levantarServidor();
});
after(bajarServidor);
beforeEach(limpiarBase);

/**
 * Abre una conexión de eventos y devuelve un lector con `esperar(tipo)`.
 * Se usa fetch en streaming, igual que la interfaz real.
 */
async function abrirCanal(token, { desdeEvento = null } = {}) {
  const control = new AbortController();
  const respuesta = await fetch(`${base}/api/events`, {
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${token}`,
      ...(desdeEvento ? { 'Last-Event-ID': String(desdeEvento) } : {}),
    },
    signal: control.signal,
  });
  assert.equal(respuesta.status, 200);

  const recibidos = [];
  const enEspera = [];
  let pendiente = '';

  const lector = respuesta.body.pipeThrough(new TextDecoderStream()).getReader();
  (async () => {
    try {
      while (true) {
        const { value, done } = await lector.read();
        if (done) break;
        pendiente += value;
        let corte;
        while ((corte = pendiente.indexOf('\n\n')) !== -1) {
          const bloque = pendiente.slice(0, corte);
          pendiente = pendiente.slice(corte + 2);
          let tipo = 'message';
          let datos = '';
          let id = null;
          for (const linea of bloque.split('\n')) {
            if (linea.startsWith('event:')) tipo = linea.slice(6).trim();
            else if (linea.startsWith('data:')) datos += linea.slice(5).trim();
            else if (linea.startsWith('id:')) id = Number.parseInt(linea.slice(3).trim(), 10);
          }
          if (!datos) continue;
          const evento = { tipo, id, datos: JSON.parse(datos) };
          recibidos.push(evento);
          for (let i = enEspera.length - 1; i >= 0; i -= 1) {
            if (enEspera[i].tipo === tipo) enEspera.splice(i, 1)[0].resolver(evento);
          }
        }
      }
    } catch {
      /* la conexión se cerró */
    }
  })();

  return {
    recibidos,
    cerrar: () => control.abort(),
    esperar(tipo, ms = 5000) {
      const ya = recibidos.find((e) => e.tipo === tipo);
      if (ya) return Promise.resolve(ya);
      return new Promise((resolver, rechazar) => {
        const espera = { tipo, resolver };
        enEspera.push(espera);
        setTimeout(() => {
          const i = enEspera.indexOf(espera);
          if (i !== -1) enEspera.splice(i, 1);
          rechazar(new Error(`No llegó ningún evento "${tipo}" en ${ms} ms. Recibidos: ${recibidos.map((e) => e.tipo).join(', ') || 'ninguno'}`));
        }, ms).unref?.();
      });
    },
  };
}

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

test('sin token no se puede abrir el canal', async () => {
  const respuesta = await fetch(`${base}/api/events`, { headers: { Accept: 'text/event-stream' } });
  assert.equal(respuesta.status, 401);
  await respuesta.body?.cancel();
});
