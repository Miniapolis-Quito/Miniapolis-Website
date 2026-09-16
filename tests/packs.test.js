import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios, crearCliente } from './helpers.js';
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

test('tampoco se puede actualizar un vencimiento a una fecha pasada', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const r = await cMaster.patch(`/api/admin/packs/${emitido.datos.pack.id}`, {
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  assert.equal(r.status, 400);
  assert.equal(r.datos.error.code, 'solicitud_invalida');
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

test('reactivar un pack vencido pide antes cambiar la fecha', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', {
    userId: cliente.id,
    size: 5,
    expiresAt: new Date(Date.now() + 1500).toISOString(),
  });
  const packId = emitido.datos.pack.id;
  await new Promise((listo) => setTimeout(listo, 1700));

  // El barrido lo marca como vencido en la siguiente lectura.
  assert.equal((await cMaster.get(`/api/admin/packs?limit=200`)).datos.items.find((p) => p.id === packId).status, 'expired');

  // Ponerlo "activo" a secas no serviría: volvería a vencer en el acto.
  const fallido = await cMaster.patch(`/api/admin/packs/${packId}`, { status: 'active' });
  assert.equal(fallido.status, 409);
  assert.equal(fallido.datos.error.code, 'pack_expirado');

  // Con una fecha nueva, sí: es lo que hace el panel en un solo movimiento.
  const nuevaFecha = new Date(Date.now() + 86400000).toISOString();
  const ok = await cMaster.patch(`/api/admin/packs/${packId}`, { status: 'active', expiresAt: nuevaFecha });
  assert.equal(ok.status, 200, JSON.stringify(ok.datos));
  assert.equal(ok.datos.pack.status, 'active');
  assert.equal(ok.datos.pack.usable, true);

  // Y quitarle la fecha del todo también lo deja en servicio.
  const sinFecha = await cMaster.patch(`/api/admin/packs/${packId}`, { status: 'active', expiresAt: null });
  assert.equal(sinFecha.status, 200, JSON.stringify(sinFecha.datos));
  assert.equal(sinFecha.datos.pack.expiresAt, null);
  assert.equal(sinFecha.datos.pack.usable, true);
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

test('el cliente pide el contenido de su QR y el historial de su pack', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const packId = emitido.datos.pack.id;

  // Contenido del QR en texto, para un cliente que no es un navegador (un tótem
  // en la pista, por ejemplo) y dibuja el código por su cuenta.
  const qr = await cCliente.get(`/api/packs/${packId}/qr`);
  assert.equal(qr.status, 200);
  assert.match(qr.datos.payload, /^RHE1\|RHE-/);
  assert.equal(qr.datos.code, emitido.datos.pack.code);
  assert.equal(qr.datos.remaining, 5);
  assert.equal(qr.datos.ttlSeconds > 0, true);
  assert.equal(qr.headers.get('cache-control'), 'no-store', 'un QR no se guarda en caché');

  // Libro mayor del pack: de momento, solo su emisión.
  const movimientos = await cCliente.get(`/api/packs/${packId}/movements`);
  assert.equal(movimientos.status, 200);
  assert.equal(movimientos.datos.items.length, 1);
  assert.equal(movimientos.datos.items[0].reason, 'issue');
  assert.equal(movimientos.datos.items[0].delta, 5);
  assert.equal(movimientos.datos.items[0].balanceAfter, 5);
});

test('ni el QR ni el historial de un pack ajeno se entregan a otro cliente', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const otro = await cMaster.post('/api/admin/users', {
    email: 'ajeno@pista.ec', fullName: 'Piloto Ajeno', role: 'customer', password: 'Palanca-Cambios-55',
  });
  const ajeno = await cMaster.post('/api/admin/packs', { userId: otro.datos.user.id, size: 5 });
  const propio = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });

  for (const ruta of ['qr', 'qr.svg', 'movements']) {
    const r = await cCliente.get(`/api/packs/${ajeno.datos.pack.id}/${ruta}`);
    assert.equal(r.status, 403, `${ruta} debería negarse`);
    assert.equal(r.datos.error.code, 'sin_permiso');
  }

  // Y el máster sí puede consultarlos, que es lo que necesita para dar soporte.
  assert.equal((await cMaster.get(`/api/packs/${ajeno.datos.pack.id}/movements`)).status, 200);
  // Con los propios, el cliente no encuentra ninguna puerta cerrada.
  assert.equal((await cCliente.get(`/api/packs/${propio.datos.pack.id}/movements`)).status, 200);
});

test('el catálogo y el historial del cliente responden lo que la app muestra', async () => {
  const { cMaster, cStaff, cCliente, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });

  const catalogo = await cCliente.get('/api/packs/catalog');
  assert.equal(catalogo.status, 200);
  assert.equal(catalogo.datos.currency, 'USD');
  assert.deepEqual(catalogo.datos.items.map((p) => p.size), [5, 10]);
  assert.equal(
    catalogo.datos.items.every((p) => typeof p.priceCents === 'number' && p.label),
    true,
  );

  const vacio = await cCliente.get('/api/packs/mine/history');
  assert.equal(vacio.status, 200);
  assert.equal(vacio.datos.total, 0);

  await cStaff.post('/api/scan/manual', { code: emitido.datos.pack.code, deviceLabel: 'Puerta 1' });

  const conUso = await cCliente.get('/api/packs/mine/history?limit=10');
  assert.equal(conUso.datos.total, 1);
  assert.equal(conUso.datos.items[0].packCode, emitido.datos.pack.code);
  assert.equal(conUso.datos.items[0].method, 'manual_code');
  assert.equal(conUso.datos.items[0].remainingAfter, 4);
  assert.equal(conUso.datos.items[0].scannerName, 'Beto Pista');
});

test('los reportes solo los descarga el máster, y uno inventado no existe', async () => {
  const { cMaster, cStaff } = await sembrarUsuarios();
  const anonimo = crearCliente();

  for (const entidad of ['packs', 'consumos', 'clientes']) {
    assert.equal((await anonimo.get(`/api/admin/export/${entidad}.csv`)).status, 401);
    assert.equal((await cStaff.get(`/api/admin/export/${entidad}.csv`)).status, 403);

    const r = await cMaster.get(`/api/admin/export/${entidad}.csv`);
    assert.equal(r.status, 200, `${entidad} debería exportarse`);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    assert.match(r.headers.get('content-disposition'), /attachment; filename=/);
  }

  // Un reporte que no existe se dice, en vez de entregar un archivo vacío.
  assert.equal((await cMaster.get('/api/admin/export/inventado.csv')).status, 404);
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

test('el pase impreso es estable entre reimpresiones y sirve en la puerta', async () => {
  const { cMaster, cStaff, cCliente, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const packId = emitido.datos.pack.id;

  await cMaster.patch(`/api/admin/packs/${packId}`, { allowStaticQr: true });

  // Un cartón físico no puede cambiar cada vez que se imprime.
  const primera = await cCliente.get(`/api/packs/${packId}/qr.svg?mode=static`);
  const segunda = await cCliente.get(`/api/packs/${packId}/qr.svg?mode=static`);
  assert.equal(primera.status, 200);
  assert.equal(primera.datos, segunda.datos, 'dos impresiones del mismo pase deben dar el mismo código');

  // Y el código dinámico sí cambia en cada consulta.
  const dinamicoA = await cCliente.get(`/api/packs/${packId}/qr`);
  const dinamicoB = await cCliente.get(`/api/packs/${packId}/qr`);
  assert.notEqual(dinamicoA.datos.payload, dinamicoB.datos.payload);

  // El pase impreso se puede canjear en la puerta.
  const pack = packs.findById(packId);
  const canje = await cStaff.post('/api/scan', {
    payload: (await import('../src/lib/qr.js')).buildQrPayload(pack, { static: true }),
  });
  assert.equal(canje.status, 200);
  assert.equal(canje.datos.method, 'qr_static');
  assert.equal(canje.datos.remaining, 4);
});

test('desactivar el QR impreso invalida los pases ya entregados', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const { buildQrPayload } = await import('../src/lib/qr.js');
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const packId = emitido.datos.pack.id;

  await cMaster.patch(`/api/admin/packs/${packId}`, { allowStaticQr: true });
  const pase = buildQrPayload(packs.findById(packId), { static: true });
  assert.equal((await cStaff.post('/api/scan', { payload: pase })).status, 200);

  await cMaster.patch(`/api/admin/packs/${packId}`, { allowStaticQr: false });
  const despues = await cStaff.post('/api/scan', { payload: pase });
  assert.equal(despues.status, 400);
  assert.equal(despues.datos.error.code, 'qr_estatico_no_permitido');
});

test('un cliente puede transferir entradas a otro usuario registrado', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const otro = await cMaster.post('/api/admin/users', {
    email: 'amigo@pista.ec', fullName: 'Amigo Piloto', role: 'customer', password: 'Neumatico-Slick-2026',
  });
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const packId = emitido.datos.pack.id;

  const r = await cCliente.post(`/api/packs/${packId}/transfer`, {
    quantity: 2,
    recipient: 'amigo@pista.ec',
    note: 'Para la carrera del sábado',
  });

  assert.equal(r.status, 200);
  assert.equal(r.datos.ok, true);
  assert.equal(r.datos.transferred, 2);
  assert.equal(r.datos.sourcePack.remaining, 3);
  assert.equal(r.datos.destinationPack.size, 2);
  assert.equal(r.datos.destinationPack.remaining, 2);
  assert.equal(r.datos.destinationPack.userId, otro.datos.user.id);

  // Verificamos libro mayor e integridad
  const movimientos = packs.movements(packId);
  const transfOut = movimientos.find((m) => m.reason === 'transfer_out');
  assert.ok(transfOut);
  assert.equal(transfOut.delta, -2);

  const movimientosDestino = packs.movements(r.datos.destinationPack.id);
  const transfIn = movimientosDestino.find((m) => m.reason === 'transfer_in');
  assert.ok(transfIn);
  assert.equal(transfIn.delta, 2);

  assert.ok(packs.checkIntegrity().ok, 'la contabilidad debe cuadrar tras la transferencia');
});

test('no se puede transferir más entradas de las disponibles en el pack', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  await cMaster.post('/api/admin/users', {
    email: 'amigo2@pista.ec', fullName: 'Amigo Piloto 2', role: 'customer', password: 'Neumatico-Slick-2026',
  });
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 3 });

  const r = await cCliente.post(`/api/packs/${emitido.datos.pack.id}/transfer`, {
    quantity: 5,
    recipient: 'amigo2@pista.ec',
  });

  assert.equal(r.status, 409);
  assert.equal(r.datos.error.code, 'saldo_insuficiente');
});

test('no se puede transferir a uno mismo', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });

  const r = await cCliente.post(`/api/packs/${emitido.datos.pack.id}/transfer`, {
    quantity: 1,
    recipient: cliente.email,
  });

  assert.equal(r.status, 400);
  assert.equal(r.datos.error.code, 'auto_transferencia');
});

test('no se puede transferir a un usuario que no existe', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });

  const r = await cCliente.post(`/api/packs/${emitido.datos.pack.id}/transfer`, {
    quantity: 1,
    recipient: 'fantasma@inexistente.com',
  });

  assert.equal(r.status, 404);
  assert.equal(r.datos.error.code, 'destinatario_no_encontrado');
});

test('un cliente no puede transferir desde un pack ajeno', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const otro = await cMaster.post('/api/admin/users', {
    email: 'otro3@pista.ec', fullName: 'Otro Piloto 3', role: 'customer', password: 'Neumatico-Slick-2026',
  });
  const packAjeno = await cMaster.post('/api/admin/packs', { userId: otro.datos.user.id, size: 5 });

  const r = await cCliente.post(`/api/packs/${packAjeno.datos.pack.id}/transfer`, {
    quantity: 1,
    recipient: cliente.email,
  });

  assert.equal(r.status, 403);
});

test('un cliente puede transferir buscando al destinatario por teléfono', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const otro = await cMaster.post('/api/admin/users', {
    email: 'piloto.telefono@pista.ec', fullName: 'Piloto Telefono', phone: '+593991234567', role: 'customer', password: 'Neumatico-Slick-2026',
  });
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });

  const r = await cCliente.post(`/api/packs/${emitido.datos.pack.id}/transfer`, {
    quantity: 3,
    recipient: '+593991234567',
  });

  assert.equal(r.status, 200);
  assert.equal(r.datos.transferred, 3);
  assert.equal(r.datos.sourcePack.remaining, 2);
  assert.equal(r.datos.destinationPack.userId, otro.datos.user.id);
  assert.equal(r.datos.destinationPack.remaining, 3);
});

test('no se puede transferir a una cuenta suspendida', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const otro = await cMaster.post('/api/admin/users', {
    email: 'suspendido@pista.ec', fullName: 'Piloto Suspendido', role: 'customer', password: 'Neumatico-Slick-2026',
  });
  await cMaster.patch(`/api/admin/users/${otro.datos.user.id}`, { status: 'suspended' });
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });

  const r = await cCliente.post(`/api/packs/${emitido.datos.pack.id}/transfer`, {
    quantity: 1,
    recipient: 'suspendido@pista.ec',
  });

  assert.equal(r.status, 400);
  assert.equal(r.datos.error.code, 'destinatario_suspendido');
});

test('transferir todas las entradas restantes marca el pack emisor como agotado (depleted)', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const otro = await cMaster.post('/api/admin/users', {
    email: 'amigo.total@pista.ec', fullName: 'Amigo Total', role: 'customer', password: 'Neumatico-Slick-2026',
  });
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 2 });

  const r = await cCliente.post(`/api/packs/${emitido.datos.pack.id}/transfer`, {
    quantity: 2,
    recipient: 'amigo.total@pista.ec',
  });

  assert.equal(r.status, 200);
  assert.equal(r.datos.sourcePack.remaining, 0);
  assert.equal(r.datos.sourcePack.status, 'depleted');
});

test('las transferencias no aparecen como entradas usadas ni emitidas dos veces', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const receptor = await cMaster.post('/api/admin/users', {
    email: 'receptor-transferencia@pista.ec',
    fullName: 'Receptor Transferencia',
    role: 'customer',
    password: 'Palanca-Cambios-55',
  });
  const pack = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const transfer = await cCliente.post(`/api/packs/${pack.datos.pack.id}/transfer`, {
    quantity: 2,
    recipient: receptor.datos.user.email,
  });

  assert.equal(transfer.status, 200);
  assert.equal(transfer.datos.sourcePack.used, 0);
  assert.equal(transfer.datos.destinationPack.used, 0);

  const detalle = await cMaster.get(`/api/admin/packs/${pack.datos.pack.id}`);
  assert.equal(detalle.datos.pack.used, 0);

  const dashboard = await cMaster.get('/api/admin/dashboard');
  assert.equal(dashboard.datos.totals.issuedTickets, 5);
  assert.equal(dashboard.datos.totals.usedTickets, 0);
});
