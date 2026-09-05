import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios } from './helpers.js';
import * as packs from '../src/services/packs.js';
import { getDb } from '../src/db/index.js';

before(levantarServidor);
after(bajarServidor);
beforeEach(limpiarBase);

test('el máster emite un pack de 5 y de 10 con el precio de catálogo', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();

  const cinco = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  assert.equal(cinco.status, 201);
  assert.equal(cinco.datos.pack.size, 5);
  assert.equal(cinco.datos.pack.remaining, 5);
  assert.equal(cinco.datos.pack.priceCents, 2500);
  assert.match(cinco.datos.pack.code, /^RHE-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  const diez = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 10, paymentMethod: 'efectivo' });
  assert.equal(diez.status, 201);
  assert.equal(diez.datos.pack.priceCents, 4500);
  assert.notEqual(diez.datos.pack.code, cinco.datos.pack.code);
});

test('el secreto del pack nunca sale en las respuestas de la API', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });

  const comoCliente = await cCliente.get('/api/packs/mine');
  const comoMaster = await cMaster.get(`/api/admin/packs/${emitido.datos.pack.id}`);

  assert.ok(!JSON.stringify(comoCliente.datos).includes('secret'));
  assert.ok(!JSON.stringify(comoMaster.datos).includes('"secret"'));
});

test('el resumen del cliente suma todos sus packs activos', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 10 });

  const r = await cCliente.get('/api/packs/mine');
  assert.equal(r.status, 200);
  assert.equal(r.datos.summary.availableTickets, 15);
  assert.equal(r.datos.summary.activePacks, 2);
  assert.equal(r.datos.summary.purchasedTickets, 15);
  assert.equal(r.datos.packs.length, 2);
  // Cada pack usable trae su QR listo para mostrar.
  assert.ok(r.datos.packs.every((p) => p.qr?.payload));
});

test('un cliente no puede ver los packs de otro', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const otro = await cMaster.post('/api/admin/users', {
    email: 'otro@pista.ec', fullName: 'Otro Piloto', role: 'customer', password: 'Neumatico-Slick-2026',
  });
  const packAjeno = await cMaster.post('/api/admin/packs', { userId: otro.datos.user.id, size: 5 });
  await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });

  const propios = await cCliente.get('/api/packs/mine');
  assert.equal(propios.datos.packs.length, 1);

  const ajeno = await cCliente.get(`/api/packs/${packAjeno.datos.pack.id}/qr`);
  assert.equal(ajeno.status, 403);
});

test('un pack vencido deja de ser usable automáticamente', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const futuro = new Date(Date.now() + 60_000).toISOString();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5, expiresAt: futuro });

  // Se mueve la fecha de vencimiento al pasado, como si hubiera transcurrido el tiempo.
  getDb().prepare('UPDATE packs SET expires_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 1000).toISOString(), emitido.datos.pack.id);

  const r = await cCliente.get('/api/packs/mine');
  assert.equal(r.datos.summary.availableTickets, 0);
  assert.equal(r.datos.packs[0].status, 'expired');
  assert.equal(r.datos.packs[0].usable, false);
});

test('no se admite una fecha de vencimiento en el pasado', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const r = await cMaster.post('/api/admin/packs', {
    userId: cliente.id, size: 5, expiresAt: new Date(Date.now() - 86400000).toISOString(),
  });
  assert.equal(r.status, 400);
});

test('el ajuste manual acredita y descuenta entradas dejando asiento contable', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const packId = emitido.datos.pack.id;

  const acredita = await cMaster.post(`/api/admin/packs/${packId}/adjust`, { delta: 2, reason: 'Cortesía por lluvia' });
  assert.equal(acredita.status, 200);
  assert.equal(acredita.datos.pack.remaining, 7);

  const descuenta = await cMaster.post(`/api/admin/packs/${packId}/adjust`, { delta: -3, reason: 'Corrección de venta' });
  assert.equal(descuenta.datos.pack.remaining, 4);

  const detalle = await cMaster.get(`/api/admin/packs/${packId}`);
  const razones = detalle.datos.movements.map((m) => m.reason);
  assert.deepEqual(razones.sort(), ['adjust', 'adjust', 'issue']);
  assert.ok(packs.checkIntegrity().ok);
});

test('un ajuste no puede dejar el saldo en negativo', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });

  const r = await cMaster.post(`/api/admin/packs/${emitido.datos.pack.id}/adjust`, { delta: -9, reason: 'Prueba' });
  assert.equal(r.status, 400);
  assert.equal(r.datos.error.code, 'saldo_insuficiente');
  assert.ok(packs.checkIntegrity().ok);
});

test('un pack anulado no se puede reactivar ni ajustar', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const packId = emitido.datos.pack.id;

  assert.equal((await cMaster.patch(`/api/admin/packs/${packId}`, { status: 'cancelled' })).status, 200);

  const reactivar = await cMaster.patch(`/api/admin/packs/${packId}`, { status: 'active' });
  assert.equal(reactivar.status, 409);
  assert.equal(reactivar.datos.error.code, 'pack_anulado');

  const ajustar = await cMaster.post(`/api/admin/packs/${packId}/adjust`, { delta: 1, reason: 'Prueba' });
  assert.equal(ajustar.status, 409);
});

test('el QR se entrega como imagen SVG lista para mostrar', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });

  const r = await cCliente.get(`/api/packs/${emitido.datos.pack.id}/qr.svg`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /image\/svg\+xml/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(r.datos, /^<svg /);
});

test('el QR impreso solo se entrega si el pack lo tiene habilitado', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const packId = emitido.datos.pack.id;

  assert.equal((await cCliente.get(`/api/packs/${packId}/qr.svg?mode=static`)).status, 403);

  await cMaster.patch(`/api/admin/packs/${packId}`, { allowStaticQr: true });
  assert.equal((await cCliente.get(`/api/packs/${packId}/qr.svg?mode=static`)).status, 200);
});

test('el listado de administración filtra por estado y por búsqueda', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const uno = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 10 });
  await cMaster.patch(`/api/admin/packs/${uno.datos.pack.id}`, { status: 'suspended' });

  const usables = await cMaster.get('/api/admin/packs?status=usable');
  assert.equal(usables.datos.items.length, 1);

  const suspendidos = await cMaster.get('/api/admin/packs?status=suspended');
  assert.equal(suspendidos.datos.items.length, 1);

  const porCodigo = await cMaster.get(`/api/admin/packs?search=${encodeURIComponent(uno.datos.pack.code)}`);
  assert.equal(porCodigo.datos.items.length, 1);

  const porCliente = await cMaster.get('/api/admin/packs?search=carlos');
  assert.equal(porCliente.datos.items.length, 2);
});

test('la exportación a CSV incluye cabeceras y marca de codificación', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });

  const r = await cMaster.get('/api/admin/export/packs.csv');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="packs-/);
  assert.ok(r.datos.includes('codigo,cliente'));
  assert.ok(r.datos.includes(String(cliente.full_name ?? 'Carlos Piloto')));

  // La marca de orden de bytes hay que mirarla en los bytes crudos: `text()`
  // la elimina al decodificar, aunque el archivo sí la lleve.
  const crudo = await fetch(`${await levantarServidor()}/api/admin/export/packs.csv`, {
    headers: { Authorization: `Bearer ${cMaster.token}` },
  });
  const bytes = new Uint8Array(await crudo.arrayBuffer());
  assert.deepEqual([bytes[0], bytes[1], bytes[2]], [0xef, 0xbb, 0xbf], 'Excel necesita la marca de orden de bytes');
});

test('la verificación de integridad detecta un saldo alterado a mano', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });

  assert.ok((await cMaster.get('/api/admin/integrity')).datos.ok);

  // Simula una manipulación directa de la base, sin pasar por el libro mayor.
  getDb().prepare('UPDATE packs SET remaining = 99, size = 99 WHERE id = ?').run(emitido.datos.pack.id);

  const despues = await cMaster.get('/api/admin/integrity');
  assert.equal(despues.datos.ok, false);
  assert.equal(despues.datos.mismatches.length, 1);
});
