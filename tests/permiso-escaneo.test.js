/**
 * Pruebas del permiso para usar el escáner de la puerta.
 *
 * La regla que se comprueba aquí es una sola: descontar una entrada exige una
 * cuenta autorizada nominalmente por el máster. El rol de personal abre la
 * pantalla; el permiso es lo que deja tocar el saldo de un cliente.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios, crearCliente, CLAVES } from './helpers.js';
import { abrirCanal, fijarBase } from './canal.js';
import { getDb } from '../src/db/index.js';
import { buildQrPayload } from '../src/lib/qr.js';
import * as packsService from '../src/services/packs.js';
import * as users from '../src/services/users.js';

let base;
before(async () => {
  base = await levantarServidor();
  fijarBase(base);
});
after(bajarServidor);
beforeEach(limpiarBase);

async function emitirPack(cMaster, userId, size = 5, extras = {}) {
  const r = await cMaster.post('/api/admin/packs', { userId, size, ...extras });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  return packsService.findById(r.datos.pack.id);
}

/** Crea una cuenta de personal SIN permiso de escaneo y la deja autenticada. */
async function operadorSinPermiso(email = 'nuevo@pista.ec') {
  const usuario = await users.createUser({
    email, password: CLAVES.staff, fullName: 'Elena Boxes', role: 'staff',
  });
  const cliente = crearCliente();
  await cliente.entrar(email, CLAVES.staff);
  return { usuario, cliente };
}

// ---------------------------------------------------------------------------
// El permiso hace falta, y hace falta siempre
// ---------------------------------------------------------------------------

test('una cuenta de personal recién creada no puede escanear', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  const { cliente: cNuevo } = await operadorSinPermiso();

  const r = await cNuevo.post('/api/scan', { payload: buildQrPayload(pack) });

  assert.equal(r.status, 403);
  assert.equal(r.datos.error.code, 'escaneo_no_autorizado');
  // Y lo importante: el saldo del cliente no se movió.
  assert.equal(packsService.findById(pack.id).remaining, 5);
});

test('sin permiso no funciona ninguna ruta del puesto, ni siquiera las de solo lectura', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  const { cliente: cNuevo } = await operadorSinPermiso();

  const intentos = [
    await cNuevo.post('/api/scan', { payload: buildQrPayload(pack) }),
    await cNuevo.post('/api/scan/verify', { payload: buildQrPayload(pack) }),
    await cNuevo.post('/api/scan/manual', { code: pack.code }),
    await cNuevo.get(`/api/scan/lookup/${pack.code}`),
    await cNuevo.get('/api/scan/history'),
  ];

  for (const intento of intentos) {
    assert.equal(intento.status, 403, JSON.stringify(intento.datos));
    assert.equal(intento.datos.error.code, 'escaneo_no_autorizado');
  }
});

test('el máster tampoco escanea si no está autorizado: el permiso es de la cuenta, no del rango', async () => {
  const { cMaster, master, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  const quitado = await cMaster.patch(`/api/admin/users/${master.id}`, { scanEnabled: false });
  assert.equal(quitado.status, 200);
  assert.equal(quitado.datos.user.scanEnabled, false);

  // Quitarse el permiso cierra la sesión: hay que volver a entrar.
  const cDeNuevo = crearCliente();
  await cDeNuevo.entrar('master@pista.ec', CLAVES.master);

  const r = await cDeNuevo.post('/api/scan', { payload: buildQrPayload(pack) });
  assert.equal(r.status, 403);
  assert.equal(r.datos.error.code, 'escaneo_no_autorizado');

  // Sigue siendo máster: puede volver a autorizarse a sí mismo.
  const devuelto = await cDeNuevo.patch(`/api/admin/users/${master.id}`, { scanEnabled: true });
  assert.equal(devuelto.status, 200);
  assert.equal(devuelto.datos.user.scanEnabled, true);
});

test('un cliente no llega al escáner ni aunque alguien le pase la dirección', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  const r = await cCliente.post('/api/scan', { payload: buildQrPayload(pack) });
  assert.equal(r.status, 403);
  // Ni siquiera se le nombra el permiso: para un cliente la puerta no existe.
  assert.equal(r.datos.error.code, 'sin_permiso');
});

// ---------------------------------------------------------------------------
// Conceder y retirar
// ---------------------------------------------------------------------------

test('el máster autoriza a una cuenta y a partir de ahí sí escanea', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  const { usuario, cliente: cNuevo } = await operadorSinPermiso();

  const autorizado = await cMaster.patch(`/api/admin/users/${usuario.id}`, { scanEnabled: true });
  assert.equal(autorizado.status, 200);
  assert.equal(autorizado.datos.user.scanEnabled, true);

  // Autorizar no cierra sesiones: el operador sigue con la suya.
  const r = await cNuevo.post('/api/scan', { payload: buildQrPayload(pack), deviceLabel: 'Puerta 1' });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.remaining, 4);
});

test('retirar el permiso corta en seco: la sesión abierta en la puerta deja de servir', async () => {
  const { cMaster, cStaff, staff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  // Con permiso, escanea sin problema.
  assert.equal((await cStaff.post('/api/scan', { payload: buildQrPayload(pack) })).status, 200);

  await cMaster.patch(`/api/admin/users/${staff.id}`, { scanEnabled: false });

  // El mismo token, que hasta hace un segundo servía, ya no vale.
  const r = await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });
  assert.equal(r.status, 401);
  assert.equal(packsService.findById(pack.id).remaining, 4);
});

test('bajar a alguien a cliente le quita el escáner en la misma operación', async () => {
  const { cMaster, staff } = await sembrarUsuarios();

  const r = await cMaster.patch(`/api/admin/users/${staff.id}`, { role: 'customer' });

  assert.equal(r.status, 200);
  assert.equal(r.datos.user.role, 'customer');
  assert.equal(r.datos.user.scanEnabled, false);
  assert.equal(users.findById(staff.id).scan_enabled, 0);
});

test('no se puede dar el escáner a un cliente, ni al crearlo ni al editarlo', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();

  const alEditar = await cMaster.patch(`/api/admin/users/${cliente.id}`, { scanEnabled: true });
  assert.equal(alEditar.status, 400);
  assert.equal(alEditar.datos.error.code, 'escaneo_rol_invalido');
  assert.equal(users.findById(cliente.id).scan_enabled, 0);

  const alCrear = await cMaster.post('/api/admin/users', {
    email: 'otro@pista.ec', fullName: 'Fabián Chasis', role: 'customer', scanEnabled: true,
  });
  assert.equal(alCrear.status, 400);
  assert.equal(alCrear.datos.error.code, 'escaneo_rol_invalido');
});

test('se puede crear personal ya autorizado de una vez', async () => {
  const { cMaster } = await sembrarUsuarios();

  const r = await cMaster.post('/api/admin/users', {
    email: 'puerta2@pista.ec', fullName: 'Gabriela Neumático', role: 'staff', scanEnabled: true,
  });

  assert.equal(r.status, 201, JSON.stringify(r.datos));
  assert.equal(r.datos.user.scanEnabled, true);
});

test('el alta de personal sin decir nada deja la cuenta sin escáner', async () => {
  const { cMaster } = await sembrarUsuarios();

  const r = await cMaster.post('/api/admin/users', {
    email: 'puerta3@pista.ec', fullName: 'Hugo Bujía', role: 'staff',
  });

  assert.equal(r.status, 201);
  assert.equal(r.datos.user.scanEnabled, false);
});

test('conceder y retirar el escáner queda en la bitácora con su propio nombre', async () => {
  const { cMaster, staff } = await sembrarUsuarios();
  const acciones = () =>
    getDb()
      // `created_at` va en milisegundos y estos dos apuntes se escriben casi a
      // la vez: sin el desempate por `rowid` el orden es el que quiera SQLite.
      // Es el mismo criterio que usa la consulta de la bitácora en producción.
      .prepare(
        "SELECT action FROM audit_log WHERE entity_id = ? AND action LIKE 'usuario.escaneo%' ORDER BY created_at, rowid",
      )
      .all(staff.id)
      .map((f) => f.action);

  await cMaster.patch(`/api/admin/users/${staff.id}`, { scanEnabled: false });
  await cMaster.patch(`/api/admin/users/${staff.id}`, { scanEnabled: true });

  assert.deepEqual(acciones(), ['usuario.escaneo_revocado', 'usuario.escaneo_autorizado']);
});

test('repetir el permiso que ya estaba puesto no ensucia la bitácora', async () => {
  const { cMaster, staff } = await sembrarUsuarios();

  await cMaster.patch(`/api/admin/users/${staff.id}`, { scanEnabled: true });

  const n = getDb()
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ? AND action LIKE 'usuario.escaneo%'")
    .get(staff.id).n;
  assert.equal(n, 0);
});

// ---------------------------------------------------------------------------
// Lo que ve el personal desde la puerta
// ---------------------------------------------------------------------------

test('el personal ve de quién es el pack, pero no su correo', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  const r = await cStaff.get(`/api/scan/lookup/${pack.code}`);

  assert.equal(r.status, 200);
  assert.equal(r.datos.customer.fullName, 'Carlos Piloto');
  assert.equal(r.datos.customer.email, undefined);

  // El máster sí lo ve: es quien da soporte.
  const rMaster = await cMaster.get(`/api/scan/lookup/${pack.code}`);
  assert.equal(rMaster.datos.customer.email, 'cliente@pista.ec');
});

test('un operador solo ve sus propios escaneos, no los de todo el personal', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });

  const propio = await cStaff.get('/api/scan/history');
  assert.equal(propio.status, 200);
  assert.equal(propio.datos.items.length, 1);

  const todos = await cStaff.get('/api/scan/history?scope=todos');
  assert.equal(todos.status, 403);
  assert.equal(todos.datos.error.code, 'alcance_no_permitido');

  // El máster sí puede mirar el conjunto.
  assert.equal((await cMaster.get('/api/scan/history?scope=todos')).status, 200);
});

test('el canal en vivo del personal no llega a una cuenta sin permiso', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  const { cliente: cNuevo } = await operadorSinPermiso();

  const canal = await abrirCanal(cNuevo.token);
  try {
    await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });
    // Se da tiempo de sobra: el evento viaja en el mismo proceso, así que si
    // fuera a llegar, ya habría llegado.
    await new Promise((seguir) => setTimeout(seguir, 300));

    const tipos = canal.recibidos.map((e) => e.tipo);
    assert.deepEqual(tipos, ['conectado'], `no debería recibir nada más: ${tipos.join(', ')}`);
  } finally {
    canal.cerrar();
  }
});

// ---------------------------------------------------------------------------
// Cada cliente, en lo suyo
// ---------------------------------------------------------------------------

test('un cliente no alcanza el pack de otro por ninguna de sus rutas', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const ajeno = await users.createUser({
    email: 'otra@pista.ec', password: CLAVES.cliente, fullName: 'Irene Alerón', role: 'customer',
  });
  const packAjeno = await emitirPack(cMaster, ajeno.id, 5);
  const packPropio = await emitirPack(cMaster, cliente.id, 5);

  for (const ruta of [
    `/api/packs/${packAjeno.id}/qr`,
    `/api/packs/${packAjeno.id}/qr.svg`,
    `/api/packs/${packAjeno.id}/movements`,
    `/api/wallet/apple/ticket/${packAjeno.id}`,
    `/api/wallet/google/pass/${packAjeno.id}`,
  ]) {
    const r = await cCliente.get(ruta);
    assert.ok([403, 404].includes(r.status), `${ruta} respondió ${r.status}`);
  }

  // Y lo suyo sigue funcionando.
  assert.equal((await cCliente.get(`/api/packs/${packPropio.id}/qr`)).status, 200);
});

test('el listado y el historial de un cliente solo traen lo suyo', async () => {
  const { cMaster, cStaff, cCliente, cliente } = await sembrarUsuarios();
  const ajeno = await users.createUser({
    email: 'otro2@pista.ec', password: CLAVES.cliente, fullName: 'Julio Pistón', role: 'customer',
  });
  const packAjeno = await emitirPack(cMaster, ajeno.id, 5);
  const packPropio = await emitirPack(cMaster, cliente.id, 5);
  await cStaff.post('/api/scan', { payload: buildQrPayload(packAjeno) });
  await cStaff.post('/api/scan', { payload: buildQrPayload(packPropio) });

  const mios = await cCliente.get('/api/packs/mine');
  assert.deepEqual(mios.datos.packs.map((p) => p.id), [packPropio.id]);

  const historial = await cCliente.get('/api/packs/mine/history');
  assert.equal(historial.datos.items.length, 1);
  assert.ok(historial.datos.items.every((c) => c.packCode === packPropio.code));
});
