/**
 * Pruebas del consumo de entradas: la parte del sistema donde un error cuesta
 * dinero o discusiones en el mostrador.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios } from './helpers.js';
import { getDb } from '../src/db/index.js';
import { buildQrPayload } from '../src/lib/qr.js';
import { normalizePackCode } from '../src/lib/ids.js';
import * as packsService from '../src/services/packs.js';
import * as redemptions from '../src/services/redemptions.js';

before(levantarServidor);
after(bajarServidor);
beforeEach(limpiarBase);

/** Emite un pack y devuelve la fila completa (incluye el secreto, para firmar QR). */
async function emitirPack(cMaster, userId, size = 5, extras = {}) {
  const r = await cMaster.post('/api/admin/packs', { userId, size, ...extras });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  return packsService.findById(r.datos.pack.id);
}

test('escanear un QR válido descuenta exactamente una entrada', async () => {
  const { cMaster, cStaff, cCliente, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 10);

  const r = await cStaff.post('/api/scan', { payload: buildQrPayload(pack), deviceLabel: 'Puerta 1' });

  assert.equal(r.status, 200);
  assert.equal(r.datos.ok, true);
  assert.equal(r.datos.remaining, 9);
  assert.equal(r.datos.remainingBefore, 10);
  assert.equal(r.datos.method, 'qr_dynamic');
  assert.equal(r.datos.customer.fullName, 'Carlos Piloto');

  const saldo = await cCliente.get('/api/packs/mine/summary');
  assert.equal(saldo.datos.summary.availableTickets, 9);
});

test('el mismo QR no se puede usar dos veces (protección anti-repetición)', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  const qr = buildQrPayload(pack);

  assert.equal((await cStaff.post('/api/scan', { payload: qr })).status, 200);

  const segundo = await cStaff.post('/api/scan', { payload: qr });
  assert.equal(segundo.status, 409);
  assert.equal(segundo.datos.error.code, 'qr_ya_usado');

  assert.equal(packsService.findById(pack.id).remaining, 4);
});

test('un QR caducado se rechaza', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  // QR firmado con una marca de tiempo de hace diez minutos.
  const viejo = buildQrPayload(pack, { at: Date.now() - 600_000 });

  const r = await cStaff.post('/api/scan', { payload: viejo });
  assert.equal(r.status, 400);
  assert.equal(r.datos.error.code, 'qr_expirado');
  assert.equal(packsService.findById(pack.id).remaining, 5);
});

test('un QR con firma falsificada se rechaza', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  const valido = buildQrPayload(pack);
  const partes = valido.split('|');
  const falsificado = [...partes.slice(0, 4), 'AAAAAAAAAAAAAAAAAAAAAAAAAAA'].join('|');

  const r = await cStaff.post('/api/scan', { payload: falsificado });
  assert.equal(r.status, 400);
  assert.equal(r.datos.error.code, 'qr_firma');
  assert.equal(packsService.findById(pack.id).remaining, 5);
});

test('un QR firmado con el secreto de otro pack no sirve', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const packA = await emitirPack(cMaster, cliente.id, 5);
  const packB = await emitirPack(cMaster, cliente.id, 5);

  // Se toma el código de A pero se firma con el secreto de B.
  const impostor = buildQrPayload({ code: packA.code, secret: packB.secret });

  const r = await cStaff.post('/api/scan', { payload: impostor });
  assert.equal(r.status, 400);
  assert.equal(r.datos.error.code, 'qr_firma');
});

test('el QR impreso solo funciona si el pack lo permite', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  const denegado = await cStaff.post('/api/scan', { payload: buildQrPayload(pack, { static: true }) });
  assert.equal(denegado.status, 400);
  assert.equal(denegado.datos.error.code, 'qr_estatico_no_permitido');

  await cMaster.patch(`/api/admin/packs/${pack.id}`, { allowStaticQr: true });
  const conPermiso = packsService.findById(pack.id);
  const aceptado = await cStaff.post('/api/scan', { payload: buildQrPayload(conPermiso, { static: true }) });
  assert.equal(aceptado.status, 200);
  assert.equal(aceptado.datos.method, 'qr_static');
});

test('la clave de idempotencia evita el doble descuento en un reintento', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  const qr = buildQrPayload(pack);
  const clave = 'reintento-de-red-0001';

  const primero = await cStaff.post('/api/scan', { payload: qr }, { cabeceras: { 'Idempotency-Key': clave } });
  const segundo = await cStaff.post('/api/scan', { payload: qr }, { cabeceras: { 'Idempotency-Key': clave } });

  assert.equal(primero.status, 200);
  assert.equal(segundo.status, 200);
  assert.equal(segundo.headers.get('idempotent-replay'), 'true');
  assert.equal(primero.datos.redemptionId, segundo.datos.redemptionId);
  assert.equal(packsService.findById(pack.id).remaining, 4, 'solo debe descontarse una entrada');
});

test('reusar una clave de idempotencia con otros datos es un conflicto', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const packA = await emitirPack(cMaster, cliente.id, 5);
  const packB = await emitirPack(cMaster, cliente.id, 5);
  const clave = 'clave-reutilizada-0001';

  await cStaff.post('/api/scan', { payload: buildQrPayload(packA) }, { cabeceras: { 'Idempotency-Key': clave } });
  const otro = await cStaff.post('/api/scan', { payload: buildQrPayload(packB) }, { cabeceras: { 'Idempotency-Key': clave } });

  assert.equal(otro.status, 409);
  assert.equal(otro.datos.error.code, 'idempotencia_conflicto');
  assert.equal(packsService.findById(packB.id).remaining, 5);
});

test('dos operadores pueden usar la misma clave sin interferirse', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const packA = await emitirPack(cMaster, cliente.id, 5);
  const packB = await emitirPack(cMaster, cliente.id, 5);
  const clave = 'clave-local-al-operador';

  const primero = await cStaff.post(
    '/api/scan',
    { payload: buildQrPayload(packA) },
    { cabeceras: { 'Idempotency-Key': clave } },
  );
  const segundo = await cMaster.post(
    '/api/scan',
    { payload: buildQrPayload(packB) },
    { cabeceras: { 'Idempotency-Key': clave } },
  );

  assert.equal(primero.status, 200);
  assert.equal(segundo.status, 200);
  assert.equal(packsService.findById(packA.id).remaining, 4);
  assert.equal(packsService.findById(packB.id).remaining, 4);
});

test('no se aceptan claves de idempotencia contradictorias', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  const r = await cStaff.post(
    '/api/scan/manual',
    { code: pack.code, idempotencyKey: 'clave-en-cuerpo-0001' },
    { cabeceras: { 'Idempotency-Key': 'clave-en-cabecera-01' } },
  );

  assert.equal(r.status, 400);
  assert.equal(r.datos.error.code, 'idempotencia_invalida');
  assert.equal(packsService.findById(pack.id).remaining, 5);
});

test('un reintento tiene que repetir la misma petición, puesto incluido', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  const clave = 'reintento-tras-corte-01';
  const cuerpo = { code: pack.code, deviceLabel: 'Puerta 1' };

  const primero = await cStaff.post('/api/scan/manual', cuerpo, { cabeceras: { 'Idempotency-Key': clave } });
  assert.equal(primero.status, 200);
  assert.equal(primero.datos.remaining, 4);

  // Repetir el intento tal cual devuelve la misma respuesta sin descontar más:
  // es lo que hace el botón "Reintentar" del escáner tras un corte de red.
  const reintento = await cStaff.post('/api/scan/manual', cuerpo, { cabeceras: { 'Idempotency-Key': clave } });
  assert.equal(reintento.status, 200);
  assert.equal(reintento.datos.remaining, 4);
  assert.equal(reintento.headers.get('idempotent-replay'), 'true');

  // Cambiar el puesto y reutilizar la clave ya no es el mismo intento, y el
  // servidor lo dice en vez de dejarlo pasar: por eso el escáner guarda el
  // puesto junto con la clave y reintenta con él.
  const otroPuesto = await cStaff.post(
    '/api/scan/manual',
    { code: pack.code, deviceLabel: 'Mostrador' },
    { cabeceras: { 'Idempotency-Key': clave } },
  );
  assert.equal(otroPuesto.status, 409);
  assert.equal(otroPuesto.datos.error.code, 'idempotencia_conflicto');
  assert.equal(packsService.findById(pack.id).remaining, 4);
});

test('un consumo sin operador también respeta su clave de idempotencia', async () => {
  // Los consumos que no vienen de una persona —una carga de datos de ejemplo,
  // una tarea interna— no tienen operador. La clave tiene que guardarse y
  // encontrarse igual, sin dejar la fila a medias.
  const { cMaster, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  const clave = 'tarea-interna-0001';

  const primero = redemptions.redeemByCode({ code: pack.code, scanner: null, idempotencyKey: clave });
  assert.equal(primero.body.remaining, 4);

  const repetido = redemptions.redeemByCode({ code: pack.code, scanner: null, idempotencyKey: clave });
  assert.equal(repetido.idempotentReplay, true, 'el segundo intento debe repetir la respuesta');
  assert.equal(repetido.body.remaining, 4);
  assert.equal(packsService.findById(pack.id).remaining, 4, 'y no descontar de nuevo');
});

test('un pack agotado no permite más consumos y queda marcado como tal', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 2);

  assert.equal((await cStaff.post('/api/scan', { payload: buildQrPayload(pack) })).status, 200);
  const ultima = await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });
  assert.equal(ultima.status, 200);
  assert.equal(ultima.datos.remaining, 0);
  assert.equal(ultima.datos.pack.status, 'depleted');

  const sobrante = await cStaff.post('/api/scan', { payload: buildQrPayload(packsService.findById(pack.id)) });
  assert.equal(sobrante.status, 409);
  assert.equal(sobrante.datos.error.code, 'pack_sin_entradas');
});

test('un pack suspendido, anulado o vencido no se puede consumir', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const db = getDb();

  const suspendido = await emitirPack(cMaster, cliente.id, 5);
  await cMaster.patch(`/api/admin/packs/${suspendido.id}`, { status: 'suspended' });
  const rSuspendido = await cStaff.post('/api/scan', { payload: buildQrPayload(suspendido) });
  assert.equal(rSuspendido.datos.error.code, 'pack_suspendido');

  const anulado = await emitirPack(cMaster, cliente.id, 5);
  await cMaster.patch(`/api/admin/packs/${anulado.id}`, { status: 'cancelled' });
  const rAnulado = await cStaff.post('/api/scan', { payload: buildQrPayload(anulado) });
  assert.equal(rAnulado.datos.error.code, 'pack_cancelado');

  const vencido = await emitirPack(cMaster, cliente.id, 5);
  db.prepare('UPDATE packs SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), vencido.id);
  const rVencido = await cStaff.post('/api/scan', { payload: buildQrPayload(vencido) });
  assert.equal(rVencido.datos.error.code, 'pack_expirado');
});

test('el consumo manual por código funciona y tolera erratas al teclear', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  // Escrito en minúsculas, con espacios y sin guiones.
  const desprolijo = pack.code.toLowerCase().replace(/-/g, ' ');
  const r = await cStaff.post('/api/scan/manual', { code: desprolijo, deviceLabel: 'Mostrador' });

  assert.equal(r.status, 200);
  assert.equal(r.datos.method, 'manual_code');
  assert.equal(r.datos.remaining, 4);
});

test('el código se normaliza aunque el cuerpo empiece por las letras del prefijo', () => {
  // El alfabeto de los códigos incluye R, H y E, así que un cuerpo puede
  // empezar por "RHE". Recortar el prefijo a ciegas lo dejaba inservible.
  assert.equal(normalizePackCode('RHEABCDE'), 'RHE-RHEA-BCDE');
  assert.equal(normalizePackCode('RHE-RHEA-BCDE'), 'RHE-RHEA-BCDE');
  assert.equal(normalizePackCode('RHERHEABCDE'), 'RHE-RHEA-BCDE');
  // Separadores de cualquier tipo, y confusiones típicas al teclear.
  assert.equal(normalizePackCode('rhe.abcd/efgh'), 'RHE-ABCD-EFGH');
  assert.equal(normalizePackCode('RHE-0OIL-UVWX'), 'RHE-QQ77-VVWX');
  // Lo que no puede ser un código sigue sin serlo.
  assert.equal(normalizePackCode('ABC'), '');
  assert.equal(normalizePackCode(null), '');
});

test('un código dictado sin el prefijo se consume igual', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  const cuerpo = pack.code.slice(4); // "XXXX-XXXX", sin "RHE-"

  const r = await cStaff.post('/api/scan/manual', { code: cuerpo });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.remaining, 4);
});

test('consultar un pack no descuenta entradas', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  const porQr = await cStaff.post('/api/scan/verify', { payload: buildQrPayload(pack) });
  assert.equal(porQr.status, 200);
  assert.equal(porQr.datos.valid, true);

  const porCodigo = await cStaff.get(`/api/scan/lookup/${pack.code}`);
  assert.equal(porCodigo.status, 200);
  assert.equal(porCodigo.datos.usable, true);
  assert.equal(porCodigo.datos.customer.fullName, 'Carlos Piloto');

  assert.equal(packsService.findById(pack.id).remaining, 5);
});

test('varios escaneos simultáneos del mismo pack nunca dejan el saldo en negativo', async () => {
  const { cMaster, staff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 3);

  // Diez intentos a la vez sobre un pack de 3: solo 3 pueden prosperar.
  const intentos = Array.from({ length: 10 }, () => {
    try {
      return redemptions.redeemByCode({
        code: pack.code,
        scanner: { id: staff.id, email: staff.email },
        deviceLabel: 'Carrera',
      });
    } catch (error) {
      return { error };
    }
  });

  const exitosos = intentos.filter((r) => r.body?.ok).length;
  assert.equal(exitosos, 3);
  const final = packsService.findById(pack.id);
  assert.equal(final.remaining, 0);
  assert.equal(final.status, 'depleted');
  assert.ok(packsService.checkIntegrity().ok);
});

test('suspender a un cliente también inutiliza sus entradas', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5, { allowStaticQr: true });

  await cMaster.patch(`/api/admin/users/${cliente.id}`, { status: 'suspended' });

  // Al suspender, el panel promete que esa persona no podrá entrar ni usar sus
  // entradas. Entrar ya estaba cubierto; usarlas depende de estos tres caminos,
  // y dos de ellos no necesitan que el cliente inicie sesión.
  for (const [nombre, peticion] of [
    ['código manual', () => cStaff.post('/api/scan/manual', { code: pack.code })],
    ['QR impreso', () => cStaff.post('/api/scan', { payload: buildQrPayload(pack, { static: true }) })],
    ['QR de la app', () => cStaff.post('/api/scan', { payload: buildQrPayload(pack) })],
  ]) {
    const r = await peticion();
    assert.equal(r.status, 409, `${nombre} debería rechazarse`);
    assert.equal(r.datos.error.code, 'cliente_suspendido', nombre);
    assert.match(r.datos.error.message, /suspendida/i);
  }

  // Y el personal lo ve antes de intentarlo, no después.
  const consulta = await cStaff.get(`/api/scan/lookup/${pack.code}`);
  assert.equal(consulta.datos.usable, false);
  assert.equal(consulta.datos.reason, 'cliente_suspendido');

  const verificacion = await cStaff.post('/api/scan/verify', { payload: buildQrPayload(pack) });
  assert.equal(verificacion.datos.valid, false);
  assert.equal(verificacion.datos.signatureOk, true, 'el código es auténtico; lo que falla es la cuenta');
  assert.equal(verificacion.datos.reason, 'cliente_suspendido');

  // El saldo sigue intacto: suspender no gasta ni devuelve nada.
  assert.equal(packsService.findById(pack.id).remaining, 5);

  // Al reactivar la cuenta, las entradas vuelven a servir.
  await cMaster.patch(`/api/admin/users/${cliente.id}`, { status: 'active' });
  const tras = await cStaff.post('/api/scan/manual', { code: pack.code });
  assert.equal(tras.status, 200, JSON.stringify(tras.datos));
  assert.equal(tras.datos.remaining, 4);
});

test('el máster puede anular un consumo y la entrada vuelve al cliente', async () => {
  const { cMaster, cStaff, cCliente, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  const consumo = await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });
  assert.equal(consumo.datos.remaining, 4);

  const anulacion = await cMaster.post(`/api/admin/redemptions/${consumo.datos.redemptionId}/void`, {
    reason: 'Se escaneó por error a la persona equivocada',
  });
  assert.equal(anulacion.status, 200);
  assert.equal(anulacion.datos.remaining, 5);

  const saldo = await cCliente.get('/api/packs/mine/summary');
  assert.equal(saldo.datos.summary.availableTickets, 5);

  // No se puede anular dos veces.
  const repetida = await cMaster.post(`/api/admin/redemptions/${consumo.datos.redemptionId}/void`, { reason: 'otra vez' });
  assert.equal(repetida.status, 409);
  assert.ok(packsService.checkIntegrity().ok);
});

test('anular un consumo reactiva un pack que había quedado agotado', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 1);
  const consumo = await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });
  assert.equal(packsService.findById(pack.id).status, 'depleted');

  await cMaster.post(`/api/admin/redemptions/${consumo.datos.redemptionId}/void`, { reason: 'Error del operador' });

  const reactivado = packsService.findById(pack.id);
  assert.equal(reactivado.status, 'active');
  assert.equal(reactivado.remaining, 1);
});

test('cada consumo deja rastro en el libro mayor y en la auditoría', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  await cStaff.post('/api/scan', { payload: buildQrPayload(pack), deviceLabel: 'Puerta 2' });

  const detalle = await cMaster.get(`/api/admin/packs/${pack.id}`);
  const consumo = detalle.datos.movements.find((m) => m.reason === 'redeem');
  assert.ok(consumo);
  assert.equal(consumo.delta, -1);
  assert.equal(consumo.balanceAfter, 4);
  assert.equal(consumo.actorName, 'Beto Pista');

  const auditoria = await cMaster.get('/api/admin/audit?action=entrada.consumida');
  assert.equal(auditoria.datos.items.length, 1);
  assert.equal(auditoria.datos.items[0].metadata.deviceLabel, 'Puerta 2');
});

test('un código inventado o basura no rompe nada', async () => {
  const { cStaff } = await sembrarUsuarios();

  const basura = await cStaff.post('/api/scan', { payload: 'hola soy un texto cualquiera' });
  assert.equal(basura.status, 400);
  assert.equal(basura.datos.error.code, 'qr_invalido');

  const inexistente = await cStaff.post('/api/scan/manual', { code: 'RHE-2222-3333' });
  assert.equal(inexistente.status, 404);

  const vacio = await cStaff.post('/api/scan', { payload: '' });
  assert.equal(vacio.status, 400);
});

test('la misma clave de idempotencia en otra operación se rechaza sin romper nada', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  const clave = 'clave-compartida-0001';

  const porQr = await cStaff.post(
    '/api/scan',
    { payload: buildQrPayload(pack) },
    { cabeceras: { 'Idempotency-Key': clave } },
  );
  assert.equal(porQr.status, 200);

  // Reutilizar la clave en el canje manual choca con el índice único de
  // consumos; el sistema debe responder un conflicto entendible, no un error
  // interno, y sobre todo no descontar otra entrada.
  const porCodigo = await cStaff.post(
    '/api/scan/manual',
    { code: pack.code },
    { cabeceras: { 'Idempotency-Key': clave } },
  );
  assert.equal(porCodigo.status, 409);
  assert.equal(porCodigo.datos.error.code, 'idempotencia_conflicto');
  assert.equal(packsService.findById(pack.id).remaining, 4);
});

test('un reintento manual escrito distinto cuenta como el mismo intento', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  const clave = 'reintento-tecleado-0001';

  const primero = await cStaff.post(
    '/api/scan/manual',
    { code: pack.code },
    { cabeceras: { 'Idempotency-Key': clave } },
  );
  // El operador reintenta y esta vez teclea el código sin guiones y en minúsculas.
  const segundo = await cStaff.post(
    '/api/scan/manual',
    { code: pack.code.toLowerCase().replace(/-/g, ' ') },
    { cabeceras: { 'Idempotency-Key': clave } },
  );

  assert.equal(segundo.status, 200);
  assert.equal(segundo.headers.get('idempotent-replay'), 'true');
  assert.equal(primero.datos.redemptionId, segundo.datos.redemptionId);
  assert.equal(packsService.findById(pack.id).remaining, 4);
});

test('escaneos simultáneos por HTTP desde varios puestos no descuentan de más', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 4);

  // Ocho peticiones HTTP a la vez, cada una con su propio QR válido: es el caso
  // de varios puestos escaneando al mismo cliente en el mismo instante.
  const respuestas = await Promise.all(
    Array.from({ length: 8 }, () => cStaff.post('/api/scan', { payload: buildQrPayload(pack) })),
  );

  const aceptadas = respuestas.filter((r) => r.status === 200);
  assert.equal(aceptadas.length, 4, 'solo pueden prosperar tantas como entradas hubiera');

  // Cada aceptada informa un saldo distinto y consecutivo: 3, 2, 1 y 0.
  const saldos = aceptadas.map((r) => r.datos.remaining).sort((a, b) => b - a);
  assert.deepEqual(saldos, [3, 2, 1, 0]);

  const final = packsService.findById(pack.id);
  assert.equal(final.remaining, 0);
  assert.equal(final.status, 'depleted');
  assert.ok(packsService.checkIntegrity().ok, 'la contabilidad debe cuadrar');

  const historial = await cMaster.get(`/api/admin/redemptions?packId=${pack.id}`);
  assert.equal(historial.datos.total, 4, 'no debe quedar ningún consumo huérfano');
});

test('se puede anular un consumo aunque el pack haya recibido entradas de cortesía', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  const consumo = await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });
  assert.equal(consumo.datos.remaining, 4);

  // La cortesía llena el pack hasta arriba: quedan 5 de 5 otra vez.
  await cMaster.post(`/api/admin/packs/${pack.id}/adjust`, { delta: 1, reason: 'Cortesía por lluvia' });
  assert.equal(packsService.findById(pack.id).remaining, 5);

  // Anular el consumo anterior sigue siendo posible: el pack crece, como con
  // cualquier acreditación. Negarse dejaría la corrección sin salida.
  const anulacion = await cMaster.post(`/api/admin/redemptions/${consumo.datos.redemptionId}/void`, {
    reason: 'Se escaneó a la persona equivocada',
  });
  assert.equal(anulacion.status, 200);
  assert.equal(anulacion.datos.remaining, 6);

  const final = packsService.findById(pack.id);
  assert.equal(final.remaining, 6);
  assert.equal(final.size, 6, 'el tamaño acompaña al saldo, como en un ajuste');
  assert.ok(packsService.checkIntegrity().ok);
});
