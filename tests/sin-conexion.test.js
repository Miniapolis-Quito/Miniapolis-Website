/**
 * Lecturas hechas sin conexión y enviadas más tarde.
 *
 * Cuando se cae Internet en la pista, el escáner guarda cada lectura con su
 * hora y la manda al volver la señal. El servidor tiene que cobrarla con las
 * mismas reglas que si hubiera llegado en su momento: ni más permisivo (una
 * captura de pantalla vieja no puede colarse) ni más estricto (quien entró con
 * un QR válido no puede perder la entrada porque la señal tardó en volver).
 */
import './env-sin-conexion.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios } from './helpers.js';
import { getDb } from '../src/db/index.js';
import { config } from '../src/config.js';
import { buildQrPayload } from '../src/lib/qr.js';
import * as packsService from '../src/services/packs.js';
import * as redemptions from '../src/services/redemptions.js';
import * as audit from '../src/services/audit.js';
import * as panel from '../src/services/panel.js';

before(levantarServidor);
after(bajarServidor);
beforeEach(limpiarBase);

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

async function emitirPack(cMaster, userId, size = 5, extras = {}) {
  const r = await cMaster.post('/api/admin/packs', { userId, size, ...extras });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  return packsService.findById(r.datos.pack.id);
}

/**
 * Cuerpo de una lectura diferida: se leyó hace `hace` milisegundos. `desfase`
 * simula un teléfono con la hora mal puesta, que lee y envía con el mismo error.
 */
function diferida(campos, { hace, desfase = 0, ahora = Date.now() }) {
  return {
    ...campos,
    capturedAt: new Date(ahora - hace + desfase).toISOString(),
    sentAt: new Date(ahora + desfase).toISOString(),
  };
}

/** Un QR tal como se veía en la pantalla del cliente hace `hace` milisegundos. */
function qrDeHace(pack, hace) {
  return buildQrPayload(pack, { at: Date.now() - hace });
}

function rechazos() {
  return audit.list({ action: 'escaneo_sin_conexion.rechazado' }).items;
}

const cercaDe = (iso, esperado, margen = 5000) =>
  assert.ok(Math.abs(Date.parse(iso) - esperado) < margen, `${iso} debería rondar ${new Date(esperado).toISOString()}`);

test('una lectura hecha sin conexión se cobra al llegar, con la hora en que se leyó', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 10);
  const leidaEn = Date.now() - HORA;

  const r = await cStaff.post(
    '/api/scan',
    diferida({ payload: qrDeHace(pack, HORA + 5000), deviceLabel: 'Puerta 1' }, { hace: HORA }),
    { cabeceras: { 'Idempotency-Key': 'lectura-sin-senal-0001' } },
  );

  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.remaining, 9);
  assert.equal(r.datos.method, 'qr_dynamic');
  cercaDe(r.datos.at, leidaEn);
  cercaDe(r.datos.syncedAt, Date.now());

  const db = getDb();
  const consumo = db.prepare('SELECT * FROM redemptions WHERE id = ?').get(r.datos.redemptionId);
  cercaDe(consumo.created_at, leidaEn);
  cercaDe(consumo.synced_at, Date.now());
  assert.equal(consumo.device_label, 'Puerta 1');

  // El libro mayor registra cuándo cambió el saldo, que es ahora.
  const movimiento = db.prepare('SELECT * FROM pack_movements WHERE redemption_id = ?').get(consumo.id);
  cercaDe(movimiento.created_at, Date.now());
  assert.equal(packsService.checkIntegrity().ok, true);

  // Administración ve que llegó tarde y por qué.
  const listado = await cMaster.get('/api/admin/redemptions?limit=5');
  cercaDe(listado.datos.items[0].syncedAt, Date.now());
  cercaDe(listado.datos.items[0].createdAt, leidaEn);

  // Y el cierre de caja también: la fecha es la de la visita y al final va cuándo se cobró.
  const csv = await cMaster.get('/api/admin/export/consumos.csv');
  const [cabecera, fila] = csv.datos.replace(/^\uFEFF/, '').split('\r\n');
  assert.equal(cabecera.split(',').at(-1), 'sincronizado');
  cercaDe(fila.split(',').at(-1), Date.now());
  cercaDe(fila.split(',')[0], leidaEn);
});

test('un consumo en línea no lleva hora de sincronización', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  const r = await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });
  assert.equal(r.status, 200);
  assert.equal(r.datos.syncedAt, null);
  assert.equal(getDb().prepare('SELECT synced_at FROM redemptions').get().synced_at, null);
});

test('un QR que ya había caducado cuando se leyó no se cobra', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  // Se leyó hace una hora un QR generado 200 s antes de la lectura (vale 120).
  const r = await cStaff.post(
    '/api/scan',
    diferida({ payload: qrDeHace(pack, HORA + 200_000) }, { hace: HORA }),
    { cabeceras: { 'Idempotency-Key': 'lectura-caducada-0001' } },
  );

  assert.equal(r.status, 400);
  assert.equal(r.datos.error.code, 'qr_expirado');
  assert.equal(packsService.findById(pack.id).remaining, 5);
});

test('una lectura más vieja que la ventana configurada se rechaza', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  const hace = 25 * HORA;

  const r = await cStaff.post('/api/scan', diferida({ payload: qrDeHace(pack, hace) }, { hace }));

  assert.equal(r.status, 409);
  assert.equal(r.datos.error.code, 'lectura_vencida');
  assert.equal(packsService.findById(pack.id).remaining, 5);
});

test('una lectura con hora posterior a su envío no es creíble', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  const r = await cStaff.post('/api/scan', diferida({ payload: buildQrPayload(pack) }, { hace: -MINUTO }));
  assert.equal(r.status, 400);
  assert.equal(r.datos.error.code, 'lectura_hora_invalida');

  // Unos segundos de más son redondeos de reloj, no un intento de engaño.
  const tolerada = await cStaff.post('/api/scan', diferida({ payload: buildQrPayload(pack) }, { hace: -2000 }));
  assert.equal(tolerada.status, 200, JSON.stringify(tolerada.datos));
  assert.equal(packsService.findById(pack.id).remaining, 4);
});

test('la hora de lectura y la de envío van juntas y con formato de fecha', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  const solo = await cStaff.post('/api/scan', { payload: buildQrPayload(pack), capturedAt: new Date().toISOString() });
  assert.equal(solo.status, 400);

  const basura = await cStaff.post('/api/scan', { payload: buildQrPayload(pack), capturedAt: 'ayer', sentAt: 'hoy' });
  assert.equal(basura.status, 400);

  assert.equal(packsService.findById(pack.id).remaining, 5);
});

test('un teléfono con la hora mal puesta no descoloca la hora de lectura', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  const hace = 10 * MINUTO;

  // El reloj del teléfono va tres horas adelantado: si el servidor se fiara de
  // él, la lectura parecería del futuro y el QR, recién generado.
  const r = await cStaff.post(
    '/api/scan',
    diferida({ payload: qrDeHace(pack, hace + 3000) }, { hace, desfase: 3 * HORA }),
  );

  assert.equal(r.status, 200, JSON.stringify(r.datos));
  cercaDe(r.datos.at, Date.now() - hace);
});

test('dos lecturas del mismo pack casi a la vez siguen siendo un doble disparo, lleguen cuando lleguen', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  const primera = await cStaff.post('/api/scan', diferida({ payload: qrDeHace(pack, HORA + 1000) }, { hace: HORA }));
  assert.equal(primera.status, 200, JSON.stringify(primera.datos));

  const cincoSegundosDespues = HORA - 5000;
  const segunda = await cStaff.post(
    '/api/scan',
    diferida({ payload: qrDeHace(pack, cincoSegundosDespues + 1000) }, { hace: cincoSegundosDespues }),
  );
  assert.equal(segunda.status, 409);
  assert.equal(segunda.datos.error.code, 'espera_activa');
  assert.equal(packsService.findById(pack.id).remaining, 4);
});

test('el tiempo de espera cuenta hacia los dos lados de la hora de lectura', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  // Llega primero la lectura más reciente y después la anterior: el orden de
  // llegada no puede decidir si hubo un doble disparo.
  const reciente = HORA - 10_000;
  assert.equal((await cStaff.post('/api/scan', diferida({ payload: qrDeHace(pack, reciente + 1000) }, { hace: reciente }))).status, 200);

  const anterior = await cStaff.post('/api/scan', diferida({ payload: qrDeHace(pack, HORA + 1000) }, { hace: HORA }));
  assert.equal(anterior.status, 409);
  assert.equal(anterior.datos.error.code, 'espera_activa');
  assert.equal(packsService.findById(pack.id).remaining, 4);
});

test('lecturas del mismo pack separadas más que la espera se cobran todas, aunque lleguen juntas', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  for (const hace of [HORA, HORA - 40_000, HORA - 80_000]) {
    const r = await cStaff.post('/api/scan', diferida({ payload: qrDeHace(pack, hace + 1000) }, { hace }));
    assert.equal(r.status, 200, JSON.stringify(r.datos));
  }
  assert.equal(packsService.findById(pack.id).remaining, 2);
  assert.equal(packsService.checkIntegrity().ok, true);
});

test('una lectura diferida choca con un consumo en línea hecho justo después', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  // Otro puesto, con señal, cobró el pack hace un momento.
  assert.equal((await cStaff.post('/api/scan', { payload: buildQrPayload(pack) })).status, 200);

  // Este puesto lo había leído sin conexión diez segundos antes.
  const r = await cStaff.post('/api/scan', diferida({ payload: qrDeHace(pack, 11_000) }, { hace: 10_000 }));
  assert.equal(r.status, 409);
  assert.equal(r.datos.error.code, 'espera_activa');
  assert.equal(packsService.findById(pack.id).remaining, 4);
});

test('un mismo QR leído por un puesto con señal y otro sin ella se cobra una sola vez', async () => {
  const { cMaster, staff, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  const generadoEn = Date.now() - 2 * HORA;
  const qr = buildQrPayload(pack, { at: generadoEn });

  // El puesto con señal lo cobró en su momento, cinco segundos después de generarse.
  const operador = { id: staff.id, email: staff.email, fullName: staff.full_name };
  redemptions.redeemByQr({ payload: qr, scanner: operador, now: generadoEn + 5000 });

  const db = getDb();
  const nonce = db.prepare('SELECT expires_at FROM used_nonces').get();
  const ventana = config.qr.ttlSeconds * 1000 + config.offlineScan.maxAgeSeconds * 1000;
  assert.ok(Date.parse(nonce.expires_at) >= generadoEn + ventana, 'el nonce debe durar mientras pueda llegar una lectura diferida');

  // Pasa la limpieza periódica de nonces caducados como si fuera dentro de dos horas.
  db.prepare('DELETE FROM used_nonces WHERE expires_at <= ?').run(new Date(Date.now() + 2 * HORA).toISOString());

  // El otro puesto lo leyó sin conexión un minuto y medio después y lo envía ahora.
  const r = await cStaff.post('/api/scan', diferida({ payload: qr }, { hace: 2 * HORA - 90_000 }));
  assert.equal(r.status, 409);
  assert.equal(r.datos.error.code, 'qr_ya_usado');
  assert.equal(packsService.findById(pack.id).remaining, 4);
});

test('si el cobro llegó al servidor antes del corte, reenviarlo devuelve la respuesta original', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  const qr = buildQrPayload(pack);
  const clave = 'lectura-cobrada-antes-del-corte';

  // El intento en línea se cobró, pero la respuesta nunca volvió al teléfono.
  const enLinea = await cStaff.post('/api/scan', { payload: qr, deviceLabel: 'Puerta 2' }, { cabeceras: { 'Idempotency-Key': clave } });
  assert.equal(enLinea.status, 200);

  // El teléfono la guardó con esa misma clave y la envía al volver la señal.
  const reenvio = await cStaff.post(
    '/api/scan',
    diferida({ payload: qr, deviceLabel: 'Puerta 2' }, { hace: 30_000 }),
    { cabeceras: { 'Idempotency-Key': clave } },
  );
  assert.equal(reenvio.status, 200, JSON.stringify(reenvio.datos));
  assert.equal(reenvio.headers.get('idempotent-replay'), 'true');
  assert.equal(reenvio.datos.redemptionId, enLinea.datos.redemptionId);

  // La respuesta se recuerda más tiempo del que puede tardar en llegar una
  // lectura guardada: si caducara antes, un código tecleado se cobraría dos
  // veces (no tiene nonce que lo frene).
  const guardada = getDb().prepare('SELECT created_at, expires_at FROM idempotency_keys WHERE key = ?').get(clave);
  const duracion = Date.parse(guardada.expires_at) - Date.parse(guardada.created_at);
  assert.ok(duracion > config.offlineScan.maxAgeSeconds * 1000, 'la clave debe durar más que la ventana sin conexión');
  assert.equal(packsService.findById(pack.id).remaining, 4);
  assert.deepEqual(rechazos(), []);
});

test('un pack que venció después de la lectura no le quita la entrada a quien llegó a tiempo', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  const db = getDb();
  db.prepare("UPDATE packs SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 30 * MINUTO).toISOString(), pack.id);
  packsService.expireDuePacks(db);
  assert.equal(packsService.findById(pack.id).status, 'expired');

  const aTiempo = await cStaff.post('/api/scan', diferida({ payload: qrDeHace(pack, HORA + 1000) }, { hace: HORA }));
  assert.equal(aTiempo.status, 200, JSON.stringify(aTiempo.datos));
  assert.equal(packsService.findById(pack.id).remaining, 4);
  assert.equal(packsService.findById(pack.id).status, 'expired', 'cobrar la lectura no reactiva el pack');

  const tarde = await cStaff.post('/api/scan', diferida({ payload: qrDeHace(pack, 10 * MINUTO + 1000) }, { hace: 10 * MINUTO }));
  assert.equal(tarde.status, 409);
  assert.equal(tarde.datos.error.code, 'pack_expirado');
  assert.equal(packsService.findById(pack.id).remaining, 4);
});

test('el código tecleado sin conexión se cobra igual, con su hora', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  const hace = 20 * MINUTO;

  const r = await cStaff.post(
    '/api/scan/manual',
    diferida({ code: pack.code.toLowerCase(), deviceLabel: 'Mostrador' }, { hace }),
    { cabeceras: { 'Idempotency-Key': 'codigo-sin-senal-0001' } },
  );

  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.method, 'manual_code');
  cercaDe(r.datos.at, Date.now() - hace);
  assert.equal(packsService.findById(pack.id).remaining, 4);
});

test('cada lectura sin conexión que no se pudo cobrar queda registrada para administración', async () => {
  const { cMaster, cStaff, staff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 1);
  const db = getDb();

  // El cliente gastó su última entrada en otro puesto, con señal.
  assert.equal((await cStaff.post('/api/scan', { payload: buildQrPayload(pack) })).status, 200);

  // Este puesto lo dejó pasar sin conexión media hora antes.
  const hace = 30 * MINUTO;
  const r = await cStaff.post(
    '/api/scan',
    diferida({ payload: qrDeHace(pack, hace + 1000), deviceLabel: 'Puerta 3' }, { hace }),
    { cabeceras: { 'Idempotency-Key': 'lectura-sin-saldo-0001' } },
  );
  assert.equal(r.status, 409);
  assert.equal(r.datos.error.code, 'pack_sin_entradas');

  const [registro] = rechazos();
  assert.ok(registro, 'el rechazo debe quedar en la auditoría');
  assert.equal(registro.actorId, staff.id);
  // Lo que hay que resolver es con una persona: el registro va a su ficha.
  assert.equal(registro.entityType, 'user');
  assert.equal(registro.entityId, cliente.id);
  assert.equal(registro.metadata.packCode, pack.code);
  assert.equal(registro.metadata.customerId, cliente.id);
  assert.equal(registro.metadata.customerName, 'Carlos Piloto');
  assert.equal(registro.metadata.reason, 'pack_sin_entradas');
  assert.equal(registro.metadata.deviceLabel, 'Puerta 3');
  assert.equal(registro.metadata.lecturaId, 'lectura-sin-saldo-0001');
  cercaDe(registro.metadata.capturedAt, Date.now() - hace);

  // Si el teléfono la reenvía (se cerró antes de apuntar el rechazo), no se duplica.
  await cStaff.post(
    '/api/scan',
    diferida({ payload: qrDeHace(pack, hace + 1000), deviceLabel: 'Puerta 3' }, { hace }),
    { cabeceras: { 'Idempotency-Key': 'lectura-sin-saldo-0001' } },
  );
  assert.equal(rechazos().length, 1);

  // Y aparece en el resumen del máster, que es donde alguien lo va a ver.
  const resumen = await cMaster.get('/api/admin/dashboard');
  assert.equal(resumen.status, 200);
  assert.equal(resumen.datos.offlineRejections.count, 1);
  const [pendiente] = resumen.datos.offlineRejections.items;
  assert.equal(pendiente.customerName, 'Carlos Piloto');
  assert.equal(pendiente.customerId, cliente.id);
  assert.equal(pendiente.packCode, pack.code);
  assert.equal(pendiente.reason, 'pack_sin_entradas');
  assert.equal(pendiente.scannerName, 'Beto Pista');
  assert.equal(pendiente.deviceLabel, 'Puerta 3');
  assert.ok(pendiente.message.length > 0);
  cercaDe(pendiente.capturedAt, Date.now() - hace);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM redemptions').get().n, 1);
});

test('los rechazos de lecturas en línea no se mezclan con los de lecturas sin conexión', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  const r = await cStaff.post('/api/scan', { payload: buildQrPayload(pack, { at: Date.now() - 600_000 }) });
  assert.equal(r.status, 400);
  assert.deepEqual(rechazos(), []);
  assert.equal(panel.resumen().offlineRejections.count, 0);
});

test('una lectura sin conexión de un código que no existe también queda registrada', async () => {
  const { cStaff } = await sembrarUsuarios();

  const r = await cStaff.post('/api/scan/manual', diferida({ code: 'RHE-ZZZZ-ZZZZ' }, { hace: 5 * MINUTO }));
  assert.equal(r.status, 404);

  const [registro] = rechazos();
  assert.equal(registro.metadata.packCode, 'RHE-ZZZZ-ZZZZ');
  assert.equal(registro.metadata.reason, 'pack_no_encontrado');
  assert.equal(registro.metadata.customerName, null);
});

test('la cuenta suspendida después de la lectura sigue bloqueando el cobro', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  await cMaster.patch(`/api/admin/users/${cliente.id}`, { status: 'suspended' });

  const r = await cStaff.post('/api/scan', diferida({ payload: qrDeHace(pack, 5 * MINUTO + 1000) }, { hace: 5 * MINUTO }));
  assert.equal(r.status, 409);
  assert.equal(r.datos.error.code, 'cliente_suspendido');
  assert.equal(rechazos()[0].metadata.reason, 'cliente_suspendido');
  assert.equal(packsService.findById(pack.id).remaining, 5);
});

test('la configuración pública le dice al escáner cómo trabajar sin conexión', async () => {
  const { cStaff } = await sembrarUsuarios();
  const r = await cStaff.get('/api/config');
  assert.deepEqual(r.datos.offlineScan, { enabled: true, maxAgeSeconds: 24 * 3600, cooldownSeconds: 30 });
});

test('administración marca una lectura no cobrada como resuelta y deja de verla pendiente', async () => {
  const { cMaster, cStaff, master, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  await cMaster.patch(`/api/admin/packs/${pack.id}`, { status: 'suspended' });

  const r = await cStaff.post('/api/scan/manual', diferida({ code: pack.code }, { hace: 15 * MINUTO }), {
    cabeceras: { 'Idempotency-Key': 'lectura-pack-suspendido-01' },
  });
  assert.equal(r.status, 409);

  const pendientes = await cMaster.get('/api/admin/offline-rejections');
  assert.equal(pendientes.status, 200);
  assert.equal(pendientes.datos.count, 1);
  const [lectura] = pendientes.datos.items;

  // El personal no resuelve: es una decisión de caja.
  assert.equal((await cStaff.post(`/api/admin/offline-rejections/${lectura.id}/resolve`, { note: 'Cobrado' })).status, 403);

  const sinMotivo = await cMaster.post(`/api/admin/offline-rejections/${lectura.id}/resolve`, { note: '' });
  assert.equal(sinMotivo.status, 400);

  const resuelta = await cMaster.post(`/api/admin/offline-rejections/${lectura.id}/resolve`, {
    note: 'Pagó la entrada en efectivo en recepción',
  });
  assert.equal(resuelta.status, 200, JSON.stringify(resuelta.datos));

  assert.equal((await cMaster.get('/api/admin/dashboard')).datos.offlineRejections.count, 0);

  const otraVez = await cMaster.post(`/api/admin/offline-rejections/${lectura.id}/resolve`, { note: 'Otra vez' });
  assert.equal(otraVez.status, 409);
  assert.equal(otraVez.datos.error.code, 'lectura_ya_resuelta');

  const inexistente = await cMaster.post('/api/admin/offline-rejections/no-existe/resolve', { note: 'Nada que ver' });
  assert.equal(inexistente.status, 404);

  // Las dos cosas quedan en la ficha del cliente, quién y cómo.
  const actividad = await cMaster.get(`/api/admin/users/${cliente.id}/timeline`);
  assert.equal(actividad.status, 200, JSON.stringify(actividad.datos));
  const claves = actividad.datos.items.map((e) => e.clave);
  assert.ok(claves.includes('escaneo_sin_conexion.rechazado'));
  assert.ok(claves.includes('escaneo_sin_conexion.resuelto'));
  const resolucion = actividad.datos.items.find((e) => e.clave === 'escaneo_sin_conexion.resuelto');
  assert.equal(resolucion.actorId, master.id);
  assert.equal(resolucion.metadata.note, 'Pagó la entrada en efectivo en recepción');
});

test('una lectura hecha sin conexión con cantidad múltiple descuenta todas las entradas indicadas', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  const lectura = diferida({ payload: qrDeHace(pack, 30_000), quantity: 3, deviceLabel: 'Puesto 1' }, { hace: 30_000 });
  const cobro = await cStaff.post('/api/scan', lectura);

  assert.equal(cobro.status, 200, JSON.stringify(cobro.datos));
  assert.equal(cobro.datos.quantity, 3);
  assert.equal(cobro.datos.remaining, 2);
  assert.equal(cobro.datos.remainingBefore, 5);

  const final = packsService.findById(pack.id);
  assert.equal(final.remaining, 2);
  assert.ok(packsService.checkIntegrity().ok);
});

