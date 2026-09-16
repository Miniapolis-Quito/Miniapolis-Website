import './env-recuperacion.js';
import './env.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios } from './helpers.js';
import * as packsService from '../src/services/packs.js';
import { buzonDePrueba, vaciarBuzon } from '../src/lib/correo.js';

before(levantarServidor);
after(bajarServidor);
beforeEach(() => {
  limpiarBase();
  vaciarBuzon();
});

test('transferir entradas envía un correo formateado y con nota escapada al destinatario', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const otro = await cMaster.post('/api/admin/users', {
    email: 'amigo.notif@pista.ec',
    fullName: 'Amigo Notificado',
    role: 'customer',
    password: 'Neumatico-Slick-2026',
  });
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });

  const r = await cCliente.post(`/api/packs/${emitido.datos.pack.id}/transfer`, {
    quantity: 2,
    recipient: 'amigo.notif@pista.ec',
    note: 'Entradas para la carrera <VIP> & amigos',
  });

  assert.equal(r.status, 200);
  assert.equal(r.datos.ok, true);
  assert.equal(r.datos.transferred, 2);

  // Dejar que el callback asíncrono envíe el correo
  await new Promise((resolve) => setTimeout(resolve, 50));

  const buzon = buzonDePrueba();
  const correo = buzon.find((m) => m.para === 'amigo.notif@pista.ec');
  assert.ok(correo, 'el destinatario debe recibir el correo de notificación');
  assert.match(correo.asunto, /2 entradas/);
  assert.ok(correo.html.includes('&lt;VIP&gt; &amp; amigos'), 'la nota debe estar escapada en el HTML');
  assert.ok(correo.texto.includes('Entradas para la carrera <VIP> & amigos'), 'el texto plano contiene la nota');
  assert.ok(correo.html.includes(r.datos.destinationPack.code), 'el HTML contiene el código del nuevo pack');
  assert.ok(correo.html.includes('Ver mis entradas'), 'el HTML contiene el botón de ver entradas');
});

test('la transferencia se audita y registra en la tabla transfers y en el libro mayor', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const otro = await cMaster.post('/api/admin/users', {
    email: 'amigo.auditoria@pista.ec',
    fullName: 'Amigo Auditoria',
    role: 'customer',
    password: 'Neumatico-Slick-2026',
  });
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 4 });

  const r = await cCliente.post(`/api/packs/${emitido.datos.pack.id}/transfer`, {
    quantity: 1,
    recipient: 'amigo.auditoria@pista.ec',
    note: 'Regalo de cumpleaños',
  });

  assert.equal(r.status, 200);

  const { getDb } = await import('../src/db/index.js');
  const transfer = getDb().prepare('SELECT * FROM transfers WHERE source_pack_id = ?').get(emitido.datos.pack.id);
  assert.ok(transfer, 'debe existir registro en la tabla transfers');
  assert.equal(transfer.quantity, 1);
  assert.equal(transfer.note, 'Regalo de cumpleaños');
  assert.equal(transfer.sender_id, cliente.id);
  assert.equal(transfer.recipient_id, otro.datos.user.id);

  // Verificamos libro mayor
  const movimientosOrigen = packsService.movements(emitido.datos.pack.id);
  const transfOut = movimientosOrigen.find((m) => m.reason === 'transfer_out');
  assert.ok(transfOut);
  assert.equal(transfOut.delta, -1);
  assert.equal(transfOut.balanceAfter, 3);

  const movimientosDestino = packsService.movements(r.datos.destinationPack.id);
  const transfIn = movimientosDestino.find((m) => m.reason === 'transfer_in');
  assert.ok(transfIn);
  assert.equal(transfIn.delta, 1);
  assert.equal(transfIn.balanceAfter, 1);

  assert.ok(packsService.checkIntegrity().ok);
});

test('transferir a un usuario que no tiene correo electrónico no falla y actualiza los saldos', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const otro = await cMaster.post('/api/admin/users', {
    email: 'sin.correo.dest@pista.ec',
    fullName: 'Piloto Sin Correo',
    phone: '+593988776655',
    role: 'customer',
    password: 'Neumatico-Slick-2026',
  });
  // Dejamos al usuario sin correo real para probar caso sin correo
  const { getDb } = await import('../src/db/index.js');
  getDb().prepare("UPDATE users SET email = '', email_normalized = '' WHERE id = ?").run(otro.datos.user.id);

  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });

  const r = await cCliente.post(`/api/packs/${emitido.datos.pack.id}/transfer`, {
    quantity: 1,
    recipient: '+593988776655',
  });

  assert.equal(r.status, 200);
  assert.equal(r.datos.transferred, 1);
  assert.equal(r.datos.destinationPack.userId, otro.datos.user.id);

  await new Promise((resolve) => setTimeout(resolve, 50));
  const buzon = buzonDePrueba();
  assert.equal(buzon.length, 0, 'no se debe intentar mandar correo si el destinatario no tiene correo');
});

test('la transferencia emite los eventos en tiempo real para emisor y receptor', async () => {
  const { hub, channels } = await import('../src/lib/events.js');
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const otro = await cMaster.post('/api/admin/users', {
    email: 'amigo.eventos@pista.ec',
    fullName: 'Amigo Eventos',
    role: 'customer',
    password: 'Neumatico-Slick-2026',
  });
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 4 });

  const eventosEmisor = [];
  const eventosReceptor = [];
  const subEmisor = hub.subscribe([channels.user(cliente.id)], (ev) => eventosEmisor.push(ev));
  const subReceptor = hub.subscribe([channels.user(otro.datos.user.id)], (ev) => eventosReceptor.push(ev));

  try {
    const r = await cCliente.post(`/api/packs/${emitido.datos.pack.id}/transfer`, {
      quantity: 2,
      recipient: 'amigo.eventos@pista.ec',
    });
    assert.equal(r.status, 200);

    assert.ok(eventosEmisor.some((e) => e.type === 'pack.actualizado' && e.data.reason === 'transferencia_saliente'));
    assert.ok(eventosReceptor.some((e) => e.type === 'pack.recibido' && e.data.quantity === 2));
  } finally {
    subEmisor();
    subReceptor();
  }
});

