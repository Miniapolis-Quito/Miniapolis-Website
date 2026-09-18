/**
 * Pruebas del sistema de solicitudes de recarga y compra de packs en línea.
 *
 * Cubre:
 * - Creación de solicitudes con validación y asignación de precios del catálogo.
 * - Rechazo a usuarios suspendidos o con solicitudes pendientes en exceso.
 * - Cancelación por el propio cliente.
 * - Aprobación atómica por el usuario máster con emisión contable del pack.
 * - Concurrencia: dos aprobaciones simultáneas de la misma solicitud solo emiten un pack.
 * - Rechazo con motivo por el máster.
 * - Restricciones de permisos (personal y clientes no pueden aprobar ni rechazar).
 * - Trazabilidad en auditoría y en el expediente del cliente.
 */
import './env.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios, crearCliente, CLAVES } from './helpers.js';
import { getDb } from '../src/db/index.js';
import * as users from '../src/services/users.js';
import * as packRequests from '../src/services/packRequests.js';
import * as packsService from '../src/services/packs.js';
import * as expediente from '../src/services/expediente.js';

before(levantarServidor);
after(bajarServidor);
beforeEach(limpiarBase);

test('un cliente solicita la compra de un pack con su comprobante de pago', async () => {
  const { cCliente, cliente } = await sembrarUsuarios();

  const r = await cCliente.post('/api/packs/requests', {
    size: 5,
    paymentMethod: 'deuna',
    paymentReference: 'DEUNA-89421',
    note: 'Pago desde teléfono 0991234567',
  });

  assert.equal(r.status, 201);
  assert.equal(r.datos.ok, true);
  assert.equal(r.datos.request.userId, cliente.id);
  assert.equal(r.datos.request.size, 5);
  assert.equal(r.datos.request.priceCents, 2500, 'precio de lista del catálogo para pack de 5');
  assert.equal(r.datos.request.paymentMethod, 'deuna');
  assert.equal(r.datos.request.paymentReference, 'DEUNA-89421');
  assert.equal(r.datos.request.status, 'pending');

  // El cliente consulta sus solicitudes
  const misSolicitudes = await cCliente.get('/api/packs/requests/mine');
  assert.equal(misSolicitudes.status, 200);
  assert.equal(misSolicitudes.datos.items.length, 1);
  assert.equal(misSolicitudes.datos.items[0].id, r.datos.request.id);
});

test('no se puede solicitar un pack con tamaño fuera del catálogo', async () => {
  const { cCliente } = await sembrarUsuarios();

  const r = await cCliente.post('/api/packs/requests', {
    size: 7,
    paymentMethod: 'transferencia',
    paymentReference: 'TRANSF-001',
  });

  assert.equal(r.status, 400);
  assert.match(r.datos.error.message, /no está disponible en el catálogo/i);
});

test('un cliente suspendido no puede solicitar recargas', async () => {
  const { cCliente, cMaster, cliente } = await sembrarUsuarios();

  // Suspender al cliente: cierra inmediatamente sus sesiones activas
  await cMaster.patch(`/api/admin/users/${cliente.id}`, { status: 'suspended' });

  const r = await cCliente.post('/api/packs/requests', {
    size: 5,
    paymentMethod: 'efectivo',
    paymentReference: 'PAGO-PUERTA',
  });

  assert.equal(r.status, 401, 'la sesión se revoca al suspender al usuario');
});

test('un cliente no puede acumular más de tres solicitudes pendientes', async () => {
  const { cCliente } = await sembrarUsuarios();

  for (let i = 1; i <= 3; i++) {
    const res = await cCliente.post('/api/packs/requests', {
      size: 5,
      paymentMethod: 'transferencia',
      paymentReference: `REF-${i}`,
    });
    assert.equal(res.status, 201);
  }

  // La cuarta debe rechazarse
  const extra = await cCliente.post('/api/packs/requests', {
    size: 5,
    paymentMethod: 'transferencia',
    paymentReference: 'REF-EXTRA',
  });

  assert.equal(extra.status, 400);
  assert.match(extra.datos.error.message, /pendientes de revisión/i);
});

test('el cliente puede cancelar una solicitud propia pendiente', async () => {
  const { cCliente, cMaster, cliente } = await sembrarUsuarios();

  const r = await cCliente.post('/api/packs/requests', {
    size: 10,
    paymentMethod: 'transferencia',
    paymentReference: 'ERROR-REF',
  });
  const id = r.datos.request.id;

  const cancel = await cCliente.post(`/api/packs/requests/${id}/cancel`);
  assert.equal(cancel.status, 200);
  assert.equal(cancel.datos.request.status, 'cancelled');

  // Ya no se puede cancelar una solicitud cancelada
  const repetir = await cCliente.post(`/api/packs/requests/${id}/cancel`);
  assert.equal(repetir.status, 400);
  assert.match(repetir.datos.error.message, /ya fue procesada/i);

  // La administración ve que ya no está pendiente
  const pendientes = await cMaster.get('/api/admin/pack-requests?status=pending');
  assert.equal(pendientes.datos.items.length, 0);
});

test('el máster aprueba la solicitud: emite el pack y acredita el saldo contable', async () => {
  const { cMaster } = await sembrarUsuarios();

  // Crear un cliente con teléfono para verificar el enlace de WhatsApp
  const clienteConTel = await users.createUser({
    email: 'piloto-whatsapp@pista.ec',
    password: CLAVES.cliente,
    fullName: 'David Chasís',
    phone: '+593991234567',
    role: 'customer',
  });
  const cPiloto = crearCliente();
  await cPiloto.entrar('piloto-whatsapp@pista.ec', CLAVES.cliente);

  const r = await cPiloto.post('/api/packs/requests', {
    size: 10,
    paymentMethod: 'transferencia',
    paymentReference: 'PICHINCHA-98214',
    note: 'Transferencia comprobada',
  });
  const requestId = r.datos.request.id;

  // El máster ve la solicitud pendiente con su enlace de WhatsApp
  const lista = await cMaster.get('/api/admin/pack-requests?status=pending');
  assert.equal(lista.status, 200);
  const encontrada = lista.datos.items.find((it) => it.id === requestId);
  assert.ok(encontrada);
  assert.equal(encontrada.userName, 'David Chasís');
  assert.match(encontrada.whatsappUrl, /wa\.me\/593991234567/);

  // El máster aprueba la solicitud
  const aprobacion = await cMaster.post(`/api/admin/pack-requests/${requestId}/approve`);
  assert.equal(aprobacion.status, 200);
  assert.equal(aprobacion.datos.ok, true);
  assert.equal(aprobacion.datos.request.status, 'approved');
  assert.ok(aprobacion.datos.pack.id, 'devuelve el pack emitido');
  assert.equal(aprobacion.datos.pack.size, 10);
  assert.equal(aprobacion.datos.pack.remaining, 10);
  assert.equal(aprobacion.datos.pack.paymentMethod, 'transferencia');
  assert.equal(aprobacion.datos.pack.paymentReference, 'PICHINCHA-98214');

  // El saldo del cliente ahora refleja las 10 entradas disponibles
  const saldo = await cPiloto.get('/api/packs/mine/summary');
  assert.equal(saldo.datos.summary.availableTickets, 10);

  // Intentar aprobarla otra vez da conflicto 409
  const reintento = await cMaster.post(`/api/admin/pack-requests/${requestId}/approve`);
  assert.equal(reintento.status, 409);
  assert.match(reintento.datos.error.message, /ya fue procesada/i);
});

test('dos aprobaciones concurrentes por HTTP solo emiten un pack', async () => {
  const { cCliente, cMaster } = await sembrarUsuarios();

  const r = await cCliente.post('/api/packs/requests', {
    size: 5,
    paymentMethod: 'deuna',
    paymentReference: 'DEUNA-CARRERA',
  });
  const requestId = r.datos.request.id;

  // Dos peticiones de aprobación disparadas simultáneamente
  const [res1, res2] = await Promise.all([
    cMaster.post(`/api/admin/pack-requests/${requestId}/approve`),
    cMaster.post(`/api/admin/pack-requests/${requestId}/approve`),
  ]);

  const estados = [res1.status, res2.status].sort();
  assert.deepEqual(estados, [200, 409], 'exactamente una petición gana y la otra recibe conflicto 409');

  // El saldo total del cliente debe ser exactamente 5 entradas, nunca 10
  const saldo = await cCliente.get('/api/packs/mine/summary');
  assert.equal(saldo.datos.summary.availableTickets, 5);
});

test('el máster rechaza la solicitud indicando el motivo', async () => {
  const { cCliente, cMaster } = await sembrarUsuarios();

  const r = await cCliente.post('/api/packs/requests', {
    size: 5,
    paymentMethod: 'transferencia',
    paymentReference: 'FALSA-1234',
  });
  const requestId = r.datos.request.id;

  const rechazo = await cMaster.post(`/api/admin/pack-requests/${requestId}/reject`, {
    reason: 'Comprobante no coincide con el extracto bancario',
  });

  assert.equal(rechazo.status, 200);
  assert.equal(rechazo.datos.request.status, 'rejected');
  assert.equal(rechazo.datos.request.rejectionReason, 'Comprobante no coincide con el extracto bancario');

  // El cliente no tiene entradas acreditadas
  const saldo = await cCliente.get('/api/packs/mine/summary');
  assert.equal(saldo.datos.summary.availableTickets, 0);

  // El cliente ve el rechazo y el motivo en su historial
  const misReqs = await cCliente.get('/api/packs/requests/mine');
  assert.equal(misReqs.datos.items[0].status, 'rejected');
  assert.equal(misReqs.datos.items[0].rejectionReason, 'Comprobante no coincide con el extracto bancario');
});

test('el personal de pista y otros clientes no pueden aprobar solicitudes', async () => {
  const { cCliente, cStaff, cMaster } = await sembrarUsuarios();

  const r = await cCliente.post('/api/packs/requests', {
    size: 5,
    paymentMethod: 'transferencia',
    paymentReference: 'REF-PERMISOS',
  });
  const requestId = r.datos.request.id;

  // Un operador de pista no tiene rol máster
  const rStaff = await cStaff.post(`/api/admin/pack-requests/${requestId}/approve`);
  assert.equal(rStaff.status, 403);

  // Un cliente tampoco
  const rCliente = await cCliente.post(`/api/admin/pack-requests/${requestId}/approve`);
  assert.equal(rCliente.status, 403);
});

test('el expediente del cliente incluye sus solicitudes de recarga y trazabilidad', async () => {
  const { cCliente, cMaster, cliente } = await sembrarUsuarios();

  await cCliente.post('/api/packs/requests', {
    size: 5,
    paymentMethod: 'deuna',
    paymentReference: 'HISTORIAL-001',
  });

  const exp = expediente.expediente(cliente.id);
  assert.ok(exp.packRequests, 'el expediente debe contener solicitudes de recarga');
  assert.equal(exp.packRequests.items.length, 1);
  assert.equal(exp.packRequests.items[0].paymentReference, 'HISTORIAL-001');

  // Comprobar que en la bitácora quedó registrada la acción
  const db = getDb();
  const log = db.prepare("SELECT * FROM audit_log WHERE action = 'pack_request.creada'").all();
  assert.equal(log.length, 1);
  assert.equal(log[0].entity_type, 'pack_request');
});
