/**
 * Expediente del cliente: lo que alimenta la ficha del panel máster.
 */
import './env.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios, CLAVES } from './helpers.js';
import { buildQrPayload } from '../src/lib/qr.js';
import { getDb } from '../src/db/index.js';
import * as packsService from '../src/services/packs.js';

before(levantarServidor);
after(bajarServidor);
beforeEach(limpiarBase);

/** Deja un cliente con historia: un pack, un consumo, un ajuste y una anulación. */
async function clienteConHistoria(cMaster, cStaff, cliente) {
  const emitido = await cMaster.post('/api/admin/packs', {
    userId: cliente.id, size: 10, paymentMethod: 'efectivo', note: 'Compra en recepción',
  });
  const pack = packsService.findById(emitido.datos.pack.id);
  const consumo = await cStaff.post('/api/scan', { payload: buildQrPayload(pack), deviceLabel: 'Puerta 1' });
  await cMaster.post(`/api/admin/packs/${pack.id}/adjust`, { delta: 2, reason: 'Cortesía por lluvia' });
  return { pack, redemptionId: consumo.datos.redemptionId };
}

test('el expediente reúne todo lo que se sabe del cliente', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const { pack } = await clienteConHistoria(cMaster, cStaff, cliente);

  const r = await cMaster.get(`/api/admin/users/${cliente.id}`);
  assert.equal(r.status, 200);
  const d = r.datos;

  assert.equal(d.user.fullName, 'Carlos Piloto');
  assert.equal(d.summary.availableTickets, 11);
  assert.equal(d.stats.gastadoCents, 4500);
  assert.equal(d.stats.packsComprados, 1);
  assert.equal(d.stats.visitas, 1);
  assert.equal(d.packs.length, 1);
  assert.equal(d.packs[0].code, pack.code);
  assert.equal(d.redemptions.total, 1);
  assert.ok(d.sessions.length >= 1, 'debe listar la sesión con la que entró');
  assert.equal(d.currency, 'USD');

  // Doce semanas de serie y siete días, siempre, aunque estén a cero.
  assert.equal(d.stats.porSemana.length, 12);
  assert.equal(d.stats.porDiaSemana.length, 7);
  assert.equal(d.stats.porDiaSemana.reduce((n, x) => n + x.visitas, 0), 1);
});

test('la línea de tiempo ordena movimientos y eventos de cuenta juntos', async () => {
  const { cMaster, cStaff, cCliente, cliente } = await sembrarUsuarios();
  await clienteConHistoria(cMaster, cStaff, cliente);
  await cCliente.patch('/api/auth/me', { fullName: 'Carlos A. Piloto' });

  const { datos } = await cMaster.get(`/api/admin/users/${cliente.id}`);
  const linea = datos.timeline.items;

  const claves = linea.map((e) => e.clave);
  assert.ok(claves.includes('issue'), 'debe estar la emisión del pack');
  assert.ok(claves.includes('redeem'), 'debe estar el consumo');
  assert.ok(claves.includes('adjust'), 'debe estar el ajuste');
  assert.ok(claves.includes('perfil.actualizado'), 'deben estar los cambios de la cuenta');

  // Del más reciente al más antiguo.
  const fechas = linea.map((e) => e.createdAt);
  assert.deepEqual(fechas, [...fechas].sort().reverse());

  // El consumo trae el contexto de la puerta.
  const consumo = linea.find((e) => e.clave === 'redeem');
  assert.equal(consumo.puesto, 'Puerta 1');
  assert.equal(consumo.metodo, 'qr_dynamic');
  assert.equal(consumo.actorName, 'Beto Pista');
  assert.equal(consumo.delta, -1);
  assert.equal(consumo.balanceAfter, 9);

  // Y se distingue lo que hizo el cliente de lo que hizo el personal.
  assert.equal(linea.find((e) => e.clave === 'perfil.actualizado').porElCliente, true);
  assert.equal(consumo.porElCliente, false);
});

test('la línea de tiempo no repite lo que ya es un movimiento', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  await clienteConHistoria(cMaster, cStaff, cliente);

  const { datos } = await cMaster.get(`/api/admin/users/${cliente.id}`);
  const consumos = datos.timeline.items.filter((e) => e.clave === 'redeem' || e.clave === 'entrada.consumida');
  assert.equal(consumos.length, 1, 'el consumo aparece una sola vez, como movimiento');
});

test('la auditoría del cliente incluye lo suyo y nada ajeno', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  await clienteConHistoria(cMaster, cStaff, cliente);

  // Otro cliente con actividad propia, que no debe aparecer.
  const otro = await cMaster.post('/api/admin/users', {
    email: 'otro@pista.ec', fullName: 'Otro Piloto', role: 'customer', password: 'Palanca-Cambios-55',
  });
  const ajeno = await cMaster.post('/api/admin/packs', { userId: otro.datos.user.id, size: 5 });
  await cStaff.post('/api/scan', { payload: buildQrPayload(packsService.findById(ajeno.datos.pack.id)) });

  const r = await cMaster.get(`/api/admin/users/${cliente.id}/audit?limit=100`);
  assert.equal(r.status, 200);

  const acciones = r.datos.items.map((a) => a.action);
  assert.ok(acciones.includes('pack.emitido'));
  assert.ok(acciones.includes('entrada.consumida'));
  assert.ok(acciones.includes('pack.ajustado'));
  assert.ok(acciones.includes('login.exitoso'), 'sus propios accesos también cuentan');

  const codigos = r.datos.items.map((a) => a.metadata?.code).filter(Boolean);
  assert.ok(!codigos.includes(ajeno.datos.pack.code), 'no debe filtrarse actividad de otro cliente');
});

test('la anulación de un consumo queda en la ficha del cliente', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const { redemptionId } = await clienteConHistoria(cMaster, cStaff, cliente);

  await cMaster.post(`/api/admin/redemptions/${redemptionId}/void`, { reason: 'Se escaneó a la persona equivocada' });

  const { datos } = await cMaster.get(`/api/admin/users/${cliente.id}`);
  const devolucion = datos.timeline.items.find((e) => e.clave === 'void');
  assert.ok(devolucion, 'la devolución debe verse en la línea de tiempo');
  assert.equal(devolucion.delta, 1);
  assert.equal(devolucion.nota, 'Se escaneó a la persona equivocada');
  assert.equal(datos.summary.availableTickets, 12);

  const anulado = datos.redemptions.items.find((r) => r.id === redemptionId);
  assert.equal(anulado.status, 'voided');
});

test('las páginas de la línea de tiempo no repiten ni saltan elementos', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 10 });
  const pack = packsService.findById(emitido.datos.pack.id);
  for (let i = 0; i < 5; i += 1) {
    await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });
  }

  const completa = await cMaster.get(`/api/admin/users/${cliente.id}/timeline?limit=100`);
  const primera = await cMaster.get(`/api/admin/users/${cliente.id}/timeline?limit=3&offset=0`);
  const segunda = await cMaster.get(`/api/admin/users/${cliente.id}/timeline?limit=3&offset=3`);

  assert.equal(primera.datos.total, completa.datos.total);
  const paginado = [...primera.datos.items, ...segunda.datos.items].map((e) => e.id);
  assert.deepEqual(paginado, completa.datos.items.slice(0, paginado.length).map((e) => e.id));
  assert.equal(new Set(paginado).size, paginado.length, 'no puede repetirse ningún elemento');
});

test('el expediente de un cliente sin historia no se rompe', async () => {
  const { cMaster } = await sembrarUsuarios();
  const nuevo = await cMaster.post('/api/admin/users', {
    email: 'recien@pista.ec', fullName: 'Recién Llegado', role: 'customer', password: 'Palanca-Cambios-55',
  });

  const r = await cMaster.get(`/api/admin/users/${nuevo.datos.user.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.datos.summary.availableTickets, 0);
  assert.equal(r.datos.stats.visitas, 0);
  assert.equal(r.datos.stats.primeraVisita, null);
  assert.equal(r.datos.stats.cadenciaDias, null);
  assert.equal(r.datos.packs.length, 0);
  assert.equal(r.datos.sessions.length, 0);
  assert.equal(r.datos.stats.porSemana.length, 12);
});

test('la cadencia de visitas se calcula sobre los consumos reales', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 10 });
  const pack = packsService.findById(emitido.datos.pack.id);
  for (let i = 0; i < 3; i += 1) await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });

  // Tres visitas repartidas en veinte días: una cada diez.
  const ids = getDb().prepare("SELECT id FROM redemptions WHERE user_id = ? ORDER BY rowid").all(cliente.id);
  const actualizar = getDb().prepare('UPDATE redemptions SET created_at = ? WHERE id = ?');
  [20, 10, 0].forEach((diasAtras, i) => {
    actualizar.run(new Date(Date.now() - diasAtras * 86400000).toISOString(), ids[i].id);
  });

  const { datos } = await cMaster.get(`/api/admin/users/${cliente.id}`);
  assert.equal(datos.stats.visitas, 3);
  assert.equal(datos.stats.cadenciaDias, 10);
  assert.equal(datos.stats.diasDesdeUltimaVisita, 0);
});

test('solo el máster puede abrir el expediente de otra persona', async () => {
  const { cStaff, cCliente, cliente } = await sembrarUsuarios();
  assert.equal((await cCliente.get(`/api/admin/users/${cliente.id}`)).status, 403);
  assert.equal((await cStaff.get(`/api/admin/users/${cliente.id}`)).status, 403);
  assert.equal((await cStaff.get(`/api/admin/users/${cliente.id}/timeline`)).status, 403);
  assert.equal((await cStaff.get(`/api/admin/users/${cliente.id}/audit`)).status, 403);
});

test('un identificador inexistente responde 404 y no 500', async () => {
  const { cMaster } = await sembrarUsuarios();
  for (const ruta of ['', '/timeline', '/audit', '/redemptions']) {
    const r = await cMaster.get(`/api/admin/users/no-existe${ruta}`);
    assert.equal(r.status, 404, `ruta ${ruta || '(base)'}`);
  }
});

test('las entradas usadas y compradas no las distorsiona una cortesía', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 10 });
  const pack = packsService.findById(emitido.datos.pack.id);
  await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });

  const antes = await cMaster.get(`/api/admin/users/${cliente.id}`);
  assert.equal(antes.datos.summary.usedTickets, 1);
  assert.equal(antes.datos.summary.purchasedTickets, 10);
  assert.equal(antes.datos.summary.availableTickets, 9);

  // Una cortesía llena el pack por encima de su tamaño original. La resta
  // "tamaño menos saldo" daría cero usadas, que sería mentira: entró una vez.
  await cMaster.post(`/api/admin/packs/${pack.id}/adjust`, { delta: 3, reason: 'Cortesía por lluvia' });

  const despues = await cMaster.get(`/api/admin/users/${cliente.id}`);
  assert.equal(despues.datos.summary.usedTickets, 1, 'sigue habiendo una sola visita');
  assert.equal(despues.datos.summary.purchasedTickets, 10, 'una cortesía no es una compra');
  assert.equal(despues.datos.summary.availableTickets, 12);
  assert.equal(despues.datos.stats.gastadoCents, 4500, 'tampoco cambia lo que pagó');
});

test('anular un consumo lo descuenta de las entradas usadas', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const pack = packsService.findById(emitido.datos.pack.id);
  const consumo = await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });

  assert.equal((await cMaster.get(`/api/admin/users/${cliente.id}`)).datos.summary.usedTickets, 1);

  await cMaster.post(`/api/admin/redemptions/${consumo.datos.redemptionId}/void`, { reason: 'Cobrada por error' });

  const despues = await cMaster.get(`/api/admin/users/${cliente.id}`);
  assert.equal(despues.datos.summary.usedTickets, 0, 'una entrada devuelta no cuenta como usada');
  assert.equal(despues.datos.summary.availableTickets, 5);
  assert.equal(despues.datos.stats.visitas, 0);
});
