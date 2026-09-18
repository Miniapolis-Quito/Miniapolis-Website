import './env-recuperacion.js';
import './env.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios, crearCliente } from './helpers.js';
import * as sessions from '../src/services/sessions.js';
import * as users from '../src/services/users.js';
import * as packsService from '../src/services/packs.js';

before(levantarServidor);
after(bajarServidor);
beforeEach(() => {
  limpiarBase();
});

test('revocación granular de sesiones: el usuario puede cerrar una sesión específica', async () => {
  const { cCliente, cliente } = await sembrarUsuarios();

  // Iniciar segunda sesión con otro User-Agent
  const cCliente2 = crearCliente();
  await cCliente2.post(
    '/api/auth/login',
    {
      email: 'cliente@pista.ec',
      password: 'Diferencial-Rojo-91',
    },
    {
      headers: { 'User-Agent': 'MiniapolisMobile/1.0' },
    },
  );

  const rLista = await cCliente.get('/api/auth/sessions');
  assert.equal(rLista.status, 200);
  assert.equal(rLista.datos.items.length, 2);

  const otraSesion = rLista.datos.items.find((s) => !s.current);
  assert.ok(otraSesion, 'debe existir una sesión no actual');

  // Revocar la otra sesión
  const rRevocar = await cCliente.delete(`/api/auth/sessions/${otraSesion.id}`);
  assert.equal(rRevocar.status, 200);
  assert.equal(rRevocar.datos.ok, true);

  // Verificar que la otra sesión quedó marcada como revocada
  const rListaDespues = await cCliente.get('/api/auth/sessions');
  const sesionRevocada = rListaDespues.datos.items.find((s) => s.id === otraSesion.id);
  assert.ok(sesionRevocada.revokedAt, 'la sesión revocada debe tener marca de tiempo');
  assert.equal(sesionRevocada.revokeReason, 'revocada_por_usuario');

  // La segunda sesión ya no debe poder operar
  const rAccesoInvalido = await cCliente2.get('/api/auth/sessions');
  assert.equal(rAccesoInvalido.status, 401);
});

test('revocación granular: no se puede revocar la sesión de otro usuario', async () => {
  const { cCliente, cStaff } = await sembrarUsuarios();

  const rStaffSesiones = await cStaff.get('/api/auth/sessions');
  const sesionStaff = rStaffSesiones.datos.items[0];

  const rRevocarAjena = await cCliente.delete(`/api/auth/sessions/${sesionStaff.id}`);
  assert.equal(rRevocarAjena.status, 404);
});

test('administración de sesiones: máster puede revocar sesión de cualquier usuario', async () => {
  const { cMaster, cCliente, cStaff, cliente } = await sembrarUsuarios();

  const rLista = await cCliente.get('/api/auth/sessions');
  const sesionCliente = rLista.datos.items[0];

  // Personal de pista no tiene permiso
  const rStaffIntento = await cStaff.delete(`/api/admin/users/${cliente.id}/sessions/${sesionCliente.id}`);
  assert.equal(rStaffIntento.status, 403);

  // Máster revoca la sesión
  const rMasterRevoca = await cMaster.delete(`/api/admin/users/${cliente.id}/sessions/${sesionCliente.id}`);
  assert.equal(rMasterRevoca.status, 200);
  assert.equal(rMasterRevoca.datos.ok, true);

  // Cliente pierde acceso
  const rIntentoCliente = await cCliente.get('/api/auth/sessions');
  assert.equal(rIntentoCliente.status, 401);
});

test('eliminación segura de usuario sin historial comercial', async () => {
  const { cMaster } = await sembrarUsuarios();

  // Crear usuario limpio sin packs ni consumos
  const nuevo = await cMaster.post('/api/admin/users', {
    email: 'sin.historial@pista.ec',
    fullName: 'Usuario Sin Historial',
    role: 'customer',
    password: 'Neumatico-Slick-2026',
  });
  assert.equal(nuevo.status, 201);
  const nuevoId = nuevo.datos.user.id;

  // Eliminar usuario
  const rEliminar = await cMaster.delete(`/api/admin/users/${nuevoId}`);
  assert.equal(rEliminar.status, 200);
  assert.equal(rEliminar.datos.ok, true);

  // Ya no existe
  const rBuscar = await cMaster.get(`/api/admin/users/${nuevoId}`);
  assert.equal(rBuscar.status, 404);
});

test('eliminación protegida: cuenta con historial no se puede eliminar', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();

  // Emitir pack al cliente
  await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });

  // Intentar eliminar cuenta con historial
  const rEliminar = await cMaster.delete(`/api/admin/users/${cliente.id}`);
  assert.equal(rEliminar.status, 409);
  assert.equal(rEliminar.datos.error.code, 'cuenta_con_historial');
  assert.match(rEliminar.datos.error.message, /Esta cuenta tiene packs emitidos y no se puede eliminar/);
});

test('eliminación protegida: no se puede eliminar un usuario máster', async () => {
  const { cMaster, master } = await sembrarUsuarios();

  // Autoeliminación denegada con 403
  const rEliminar = await cMaster.delete(`/api/admin/users/${master.id}`);
  assert.equal(rEliminar.status, 403);
  assert.match(rEliminar.datos.error.message, /No puedes eliminar tu propia cuenta/);
});

test('historial de transferencias: cliente y máster consultan movimientos', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();

  const amigo = await cMaster.post('/api/admin/users', {
    email: 'amigo.lista@pista.ec',
    fullName: 'Amigo Lista',
    role: 'customer',
    password: 'Neumatico-Slick-2026',
  });
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 10 });

  // Transferir
  await cCliente.post(`/api/packs/${emitido.datos.pack.id}/transfer`, {
    quantity: 3,
    recipient: 'amigo.lista@pista.ec',
    note: 'Regalo de cumpleaños',
  });

  // Cliente consulta su historial
  const rClienteTransfers = await cCliente.get('/api/packs/transfers');
  assert.equal(rClienteTransfers.status, 200);
  assert.equal(rClienteTransfers.datos.items.length, 1);
  const itemCliente = rClienteTransfers.datos.items[0];
  assert.equal(itemCliente.direction, 'sent');
  assert.equal(itemCliente.quantity, 3);
  assert.equal(itemCliente.counterparty.email, 'amigo.lista@pista.ec');
  assert.equal(itemCliente.note, 'Regalo de cumpleaños');

  // Máster consulta historial global
  const rAdminTransfers = await cMaster.get('/api/admin/transfers');
  assert.equal(rAdminTransfers.status, 200);
  assert.equal(rAdminTransfers.datos.items.length, 1);
  const itemAdmin = rAdminTransfers.datos.items[0];
  assert.equal(itemAdmin.quantity, 3);
  assert.equal(itemAdmin.sender.id, cliente.id);
  assert.equal(itemAdmin.recipient.id, amigo.datos.user.id);
});

test('idempotencia en transferencias de entradas: reintentar no descuenta doble', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();

  await cMaster.post('/api/admin/users', {
    email: 'amigo.idempotente@pista.ec',
    fullName: 'Amigo Idempotente',
    role: 'customer',
    password: 'Neumatico-Slick-2026',
  });
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 10 });

  const claveIdempotencia = 'tx-key-prueba-12345';

  // Primera petición con Idempotency-Key en cabecera
  const r1 = await cCliente.post(
    `/api/packs/${emitido.datos.pack.id}/transfer`,
    {
      quantity: 4,
      recipient: 'amigo.idempotente@pista.ec',
      note: 'Prueba idempotencia',
    },
    {
      headers: { 'Idempotency-Key': claveIdempotencia },
    },
  );

  assert.equal(r1.status, 200);
  assert.equal(r1.datos.ok, true);
  assert.equal(r1.datos.transferred, 4);
  assert.equal(r1.datos.sourcePack.remaining, 6);

  // Segunda petición repetida con la misma clave
  const r2 = await cCliente.post(
    `/api/packs/${emitido.datos.pack.id}/transfer`,
    {
      quantity: 4,
      recipient: 'amigo.idempotente@pista.ec',
      note: 'Prueba idempotencia',
    },
    {
      headers: { 'Idempotency-Key': claveIdempotencia },
    },
  );

  assert.equal(r2.status, 200);
  assert.equal(r2.datos.ok, true);
  assert.equal(r2.datos.transferred, 4);
  // El saldo restante sigue siendo 6 (no descontó doble)
  assert.equal(r2.datos.sourcePack.remaining, 6);

  // Verificar en base de datos que el pack solo transfirió 4 entradas en total
  const packDb = packsService.findById(emitido.datos.pack.id);
  assert.equal(packDb.remaining, 6);
  assert.equal(packDb.size - packDb.remaining, 4);
});

test('idempotencia en solicitudes de recarga', async () => {
  const { cCliente } = await sembrarUsuarios();

  const claveIdempotencia = 'solicitud-key-prueba-999';

  const r1 = await cCliente.post(
    '/api/packs/requests',
    {
      size: 10,
      paymentMethod: 'transferencia',
      paymentReference: 'TRANSF-00112233',
    },
    {
      headers: { 'Idempotency-Key': claveIdempotencia },
    },
  );

  assert.equal(r1.status, 201);
  const idSolicitud = r1.datos.request.id;

  // Reintento idéntico
  const r2 = await cCliente.post(
    '/api/packs/requests',
    {
      size: 10,
      paymentMethod: 'transferencia',
      paymentReference: 'TRANSF-00112233',
    },
    {
      headers: { 'Idempotency-Key': claveIdempotencia },
    },
  );

  assert.equal(r2.status, 200);
  assert.equal(r2.datos.request.id, idSolicitud);
});

test('exportaciones CSV ampliadas: transferencias, solicitudes y auditoría', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();

  // Generar datos para exportaciones
  await cMaster.post('/api/admin/users', {
    email: 'amigo.csv@pista.ec',
    fullName: 'Amigo CSV',
    role: 'customer',
    password: 'Neumatico-Slick-2026',
  });
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });

  await cCliente.post(`/api/packs/${emitido.datos.pack.id}/transfer`, {
    quantity: 2,
    recipient: 'amigo.csv@pista.ec',
    note: 'CSV test',
  });

  await cCliente.post('/api/packs/requests', {
    size: 5,
    paymentMethod: 'efectivo',
    paymentReference: 'CAJA-REC-001',
  });

  // Exportar transferencias
  const rTransfersCsv = await cMaster.get('/api/admin/export/transferencias.csv');
  assert.equal(rTransfersCsv.status, 200);
  assert.match(rTransfersCsv.headers.get('content-type'), /text\/csv/);
  assert.ok(rTransfersCsv.datos.includes('emisor_correo'));
  assert.ok(rTransfersCsv.datos.includes('amigo.csv@pista.ec'));

  // Exportar solicitudes
  const rSolicitudesCsv = await cMaster.get('/api/admin/export/solicitudes.csv');
  assert.equal(rSolicitudesCsv.status, 200);
  assert.match(rSolicitudesCsv.headers.get('content-type'), /text\/csv/);
  assert.ok(rSolicitudesCsv.datos.includes('metodo_pago'));
  assert.ok(rSolicitudesCsv.datos.includes('efectivo'));

  // Exportar auditoría
  const rAuditoriaCsv = await cMaster.get('/api/admin/export/auditoria.csv');
  assert.equal(rAuditoriaCsv.status, 200);
  assert.match(rAuditoriaCsv.headers.get('content-type'), /text\/csv/);
  assert.ok(rAuditoriaCsv.datos.includes('accion'));
  assert.ok(rAuditoriaCsv.datos.includes('actor_correo'));
});
