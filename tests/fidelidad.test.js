/**
 * Programa de fidelidad: «la casa invita».
 *
 * Lo que se comprueba aquí es que el regalo salga cuando toca, salga una sola
 * vez y no salga nunca de más: es dinero de la pista. El tiempo se controla
 * pasando `now`, nunca esperando.
 */
import './env-recuperacion.js';
import './env.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios } from './helpers.js';
import { getDb } from '../src/db/index.js';
import { buildQrPayload } from '../src/lib/qr.js';
import { buzonDePrueba, vaciarBuzon } from '../src/lib/correo.js';
import * as fidelidad from '../src/services/fidelidad.js';
import * as avisos from '../src/services/avisos.js';
import * as packsService from '../src/services/packs.js';
import * as redemptions from '../src/services/redemptions.js';
import * as expediente from '../src/services/expediente.js';
import * as users from '../src/services/users.js';

const DIA = 24 * 60 * 60 * 1000;
const iso = (instante) => new Date(instante).toISOString();

let u;

before(levantarServidor);
after(bajarServidor);
beforeEach(async () => {
  limpiarBase();
  vaciarBuzon();
  u = await sembrarUsuarios();
});

/** Enciende el programa con el umbral indicado. */
function encender(cambios = {}, now = Date.now()) {
  return fidelidad.guardarAjustes(
    { enabled: true, entriesPerReward: 5, rewardTickets: 1, ...cambios },
    { actor: u.master, now },
  );
}

function vender(size = 10, extra = {}) {
  return packsService.issuePack({ userId: u.cliente.id, size, priceCents: 4500, actor: u.master, ...extra });
}

/** Usa `veces` entradas del pack, como lo haría el personal en la puerta. */
function usar(pack, veces = 1, extra = {}) {
  for (let i = 0; i < veces; i += 1) {
    redemptions.redeemByCode({
      code: pack.code,
      scanner: { id: u.staff.id, email: u.staff.email },
      ...extra,
    });
  }
}

/** Hora de la última visita registrada, para fechar el encendido con precisión. */
const ultimaVisita = (userId = u.cliente.id) =>
  getDb()
    .prepare("SELECT created_at FROM redemptions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(userId).created_at;

const premios = (userId = u.cliente.id) =>
  getDb().prepare('SELECT * FROM loyalty_rewards WHERE user_id = ? ORDER BY sequence').all(userId);

const packsDeCortesia = (userId = u.cliente.id) =>
  getDb().prepare("SELECT * FROM packs WHERE user_id = ? AND origin = 'loyalty' ORDER BY created_at").all(userId);

// ---------------------------------------------------------------------------
// Encendido
// ---------------------------------------------------------------------------

test('viene apagado: usar entradas no regala nada', () => {
  const pack = vender(20);
  usar(pack, 12);

  assert.deepEqual(premios(), []);
  const progreso = fidelidad.progreso(u.cliente.id);
  assert.equal(progreso.enabled, false);
  assert.equal(progreso.progress, 0);
  assert.equal(progreso.rewardsCount, 0);
});

test('encenderlo no premia por el pasado: el contador arranca al encender', () => {
  const pack = vender(20);
  const antes = Date.now() - 5000;
  usar(pack, 12, { now: antes });

  // El encendido se fecha justo después de la última visita, para que la
  // prueba no dependa de que el reloj avance entre dos instrucciones.
  const estado = encender({ entriesPerReward: 5 }, antes + 1);
  assert.equal(estado.enabled, true);
  assert.ok(estado.countingSince, 'tiene que quedar claro desde cuándo se cuenta');

  assert.deepEqual(premios(), [], 'lo usado antes de encender no cuenta');
  const progreso = fidelidad.progreso(u.cliente.id);
  assert.equal(progreso.counted, 0);
  assert.equal(progreso.remaining, 5);

  // Y a partir de ahora sí cuenta.
  usar(pack, 5);
  assert.equal(premios().length, 1);
});

test('una entrada del mismo milisegundo del encendido se cuenta a favor del cliente', () => {
  // El caso límite del contador: las marcas tienen milisegundos y dos cosas
  // pueden caer en el mismo. La duda se resuelve a favor de quien usó la
  // entrada, como cualquier otra duda sobre su saldo.
  const pack = vender(10);
  usar(pack, 1);

  encender({ entriesPerReward: 2 }, Date.parse(ultimaVisita()));

  assert.equal(fidelidad.progreso(u.cliente.id).counted, 1);
  assert.equal(fidelidad.progreso(u.cliente.id).remaining, 1);
});

test('apagar y volver a encender reinicia el contador, y los premios dados se conservan', () => {
  const antes = Date.now() - 10000;
  encender({ entriesPerReward: 5 }, antes);
  const pack = vender(20);
  usar(pack, 7, { now: antes + 100 }); // un premio y dos entradas de avance

  assert.equal(premios().length, 1);
  assert.equal(fidelidad.progreso(u.cliente.id).progress, 2);

  // Fuerza la frontera difícil: las lecturas de la etapa anterior caen en el
  // mismo milisegundo en que se vuelve a encender el programa.
  const reinicio = antes + 500;
  getDb().prepare('UPDATE redemptions SET created_at = ?').run(iso(reinicio));
  fidelidad.guardarAjustes({ enabled: false }, { actor: u.master, now: reinicio });
  assert.equal(fidelidad.progreso(u.cliente.id).enabled, false);
  assert.equal(fidelidad.progreso(u.cliente.id).rewardsCount, 1, 'el premio ya dado no se borra');

  encender({ entriesPerReward: 5 }, reinicio);
  const progreso = fidelidad.progreso(u.cliente.id);
  assert.equal(progreso.progress, 0, 'el avance de antes de la pausa no se arrastra');
  assert.equal(progreso.rewardsCount, 1);

  usar(pack, 4);
  assert.equal(premios().length, 1, 'con cuatro entradas todavía no hay premio nuevo');
  usar(pack, 1);
  assert.equal(premios().length, 2);
});

// ---------------------------------------------------------------------------
// Otorgar el premio
// ---------------------------------------------------------------------------

test('al llegar al umbral se emite un pack de cortesía con todo su rastro', () => {
  encender({ entriesPerReward: 5, rewardTickets: 2, rewardExpiryDays: 30 });
  const pack = vender(10);
  const antes = Date.now();
  usar(pack, 5);

  const [premio] = premios();
  assert.ok(premio, 'tenía que salir el premio');
  assert.equal(premio.sequence, 1);
  assert.equal(premio.tickets, 2);
  assert.equal(premio.threshold, 5);
  assert.equal(premio.counted, 5);

  const [cortesia] = packsDeCortesia();
  assert.equal(cortesia.id, premio.pack_id);
  assert.equal(cortesia.origin, 'loyalty');
  assert.equal(cortesia.size, 2);
  assert.equal(cortesia.remaining, 2);
  assert.equal(cortesia.price_cents, 0);
  assert.equal(cortesia.payment_method, 'cortesia');
  assert.equal(cortesia.allow_static_qr, 0, 'un regalo no habilita el QR imprimible');
  assert.ok(Date.parse(cortesia.expires_at) > antes + 29 * DIA, 'el pack de cortesía vence según los ajustes');

  // El libro mayor y la contabilidad siguen cuadrando.
  const movimientos = packsService.movements(cortesia.id);
  assert.equal(movimientos.length, 1);
  assert.equal(movimientos[0].reason, 'issue');
  assert.equal(movimientos[0].delta, 2);
  assert.ok(packsService.checkIntegrity().ok);

  // Y queda en la bitácora con su propio nombre.
  const bitacora = getDb()
    .prepare("SELECT * FROM audit_log WHERE action = 'fidelidad.recompensa_otorgada'")
    .all();
  assert.equal(bitacora.length, 1);
  assert.equal(bitacora[0].entity_id, u.cliente.id);
  assert.equal(JSON.parse(bitacora[0].metadata).packCode, cortesia.code);
});

test('sin vencimiento configurado, el pack de cortesía no vence', () => {
  encender({ entriesPerReward: 2, rewardExpiryDays: 0 });
  const pack = vender(5);
  usar(pack, 2);

  assert.equal(packsDeCortesia()[0].expires_at, null);
});

test('el premio se otorga una sola vez por umbral alcanzado', () => {
  encender({ entriesPerReward: 5 });
  const pack = vender(20);
  usar(pack, 5);

  // Aunque se evalúe muchas veces más, no aparecen premios de la nada.
  for (let i = 0; i < 5; i += 1) fidelidad.evaluar(u.cliente.id);
  fidelidad.evaluarPendientes();
  assert.equal(premios().length, 1);

  usar(pack, 4);
  assert.equal(premios().length, 1);
  usar(pack, 1);
  assert.equal(premios().length, 2);
  assert.deepEqual(premios().map((p) => p.sequence), [1, 2]);
});

test('escaneos simultáneos por HTTP no regalan ni una entrada de más', async () => {
  encender({ entriesPerReward: 2 });
  const r = await u.cMaster.post('/api/admin/packs', { userId: u.cliente.id, size: 9 });
  const pack = packsService.findById(r.datos.pack.id);

  const respuestas = await Promise.all(
    Array.from({ length: 9 }, () => u.cStaff.post('/api/scan', { payload: buildQrPayload(pack) })),
  );
  const cobradas = respuestas.filter((x) => x.status === 200).length;
  assert.equal(cobradas, 9);

  // Nueve entradas con umbral de dos son cuatro premios exactos, ni uno más.
  assert.equal(premios().length, 4);
  assert.deepEqual(premios().map((p) => p.sequence), [1, 2, 3, 4]);
  assert.equal(fidelidad.progreso(u.cliente.id).progress, 1);
  assert.ok(packsService.checkIntegrity().ok);
});

test('las entradas de cortesía no cuentan para ganar la siguiente', () => {
  encender({ entriesPerReward: 4, rewardTickets: 3 });
  const pack = vender(10);
  usar(pack, 4);

  const [cortesia] = packsDeCortesia();
  assert.equal(cortesia.size, 3);

  // Se usa el regalo completo: la casa no se invita a sí misma.
  usar(packsService.findById(cortesia.id), 3);
  assert.equal(premios().length, 1);
  assert.equal(fidelidad.progreso(u.cliente.id).progress, 0);

  // Las de pago sí siguen contando.
  usar(pack, 4);
  assert.equal(premios().length, 2);
});

test('el premio nunca puede ser mayor que las entradas que hay que usar', () => {
  assert.throws(
    () => encender({ entriesPerReward: 4, rewardTickets: 4 }),
    (error) => error.code === 'fidelidad_premio_invalido',
  );
});

test('una admisión grupal cuenta todas sus entradas', () => {
  encender({ entriesPerReward: 4 });
  const pack = vender(10);
  usar(pack, 1, { quantity: 4 });

  assert.equal(premios().length, 1);
  assert.equal(premios()[0].counted, 4);
});

test('anular un consumo devuelve el avance y no adelanta el premio siguiente', () => {
  encender({ entriesPerReward: 5 });
  const pack = vender(20);
  usar(pack, 4);

  const consumo = redemptions.listRedemptions({ userId: u.cliente.id, limit: 1 }).items[0];
  redemptions.voidRedemption(consumo.id, { reason: 'Se escaneó por error', actor: u.master });
  assert.equal(fidelidad.progreso(u.cliente.id).progress, 3);

  usar(pack, 1);
  assert.equal(premios().length, 0, 'con la entrada devuelta todavía falta una');
  usar(pack, 1);
  assert.equal(premios().length, 1);
});

test('anular consumos después del premio no lo quita, pero sí retrasa el siguiente', () => {
  encender({ entriesPerReward: 3 });
  const pack = vender(20);
  usar(pack, 4);
  assert.equal(premios().length, 1);

  // Se anulan dos de las cuatro entradas: el avance queda en -1.
  for (const consumo of redemptions.listRedemptions({ userId: u.cliente.id, limit: 2 }).items) {
    redemptions.voidRedemption(consumo.id, { reason: 'Corrección de caja', actor: u.master });
  }
  assert.equal(premios().length, 1, 'el premio entregado no se retira');
  const progreso = fidelidad.progreso(u.cliente.id);
  assert.equal(progreso.progress, 0, 'un avance negativo se muestra en cero');

  usar(pack, 3);
  assert.equal(premios().length, 1, 'primero hay que recuperar lo devuelto');
  usar(pack, 1);
  assert.equal(premios().length, 2);
});

// ---------------------------------------------------------------------------
// Casos que no pueden perder el premio
// ---------------------------------------------------------------------------

test('a una cuenta suspendida no se le emite nada, y al reactivarla no pierde el premio', () => {
  encender({ entriesPerReward: 5 });
  const pack = vender(20);
  usar(pack, 4);

  users.updateUser(u.cliente.id, { status: 'suspended' });
  // Con la cuenta suspendida, bajar el umbral deja el premio ganado pero sin
  // emitir: a una cuenta suspendida no se le acreditan entradas.
  fidelidad.guardarAjustes({ entriesPerReward: 3 }, { actor: u.master });
  assert.deepEqual(premios(), []);
  assert.deepEqual(packsDeCortesia(), []);

  users.updateUser(u.cliente.id, { status: 'active' });
  const resultado = fidelidad.evaluarPendientes();
  assert.equal(resultado.premios, 1);
  assert.equal(premios().length, 1);
  assert.equal(packsDeCortesia().length, 1);
});

test('una reserva que se quedó sin pack la completa el barrido', () => {
  encender({ entriesPerReward: 5 });
  const pack = vender(20);
  usar(pack, 5);
  assert.equal(packsDeCortesia().length, 1);

  // Se simula la caída del proceso justo después de reservar el premio: la
  // reserva existe, el pack no.
  const db = getDb();
  db.prepare('DELETE FROM pack_movements WHERE pack_id = (SELECT pack_id FROM loyalty_rewards WHERE user_id = ?)').run(u.cliente.id);
  db.prepare('DELETE FROM packs WHERE id = (SELECT pack_id FROM loyalty_rewards WHERE user_id = ?)').run(u.cliente.id);
  db.prepare('UPDATE loyalty_rewards SET pack_id = NULL WHERE user_id = ?').run(u.cliente.id);
  assert.equal(premios()[0].pack_id, null);

  const resultado = fidelidad.evaluarPendientes();
  assert.equal(resultado.premios, 1);
  assert.equal(premios().length, 1, 'completar una reserva no crea otro premio');
  assert.equal(premios()[0].pack_id, packsDeCortesia()[0].id);
  assert.ok(packsService.checkIntegrity().ok);
});

test('bajar el umbral entrega en el acto lo que queda ganado', () => {
  encender({ entriesPerReward: 10 });
  const pack = vender(20);
  usar(pack, 6);
  assert.deepEqual(premios(), []);

  fidelidad.guardarAjustes({ entriesPerReward: 3 }, { actor: u.master });
  assert.equal(premios().length, 2, 'seis entradas con umbral de tres son dos premios');
  assert.equal(fidelidad.progreso(u.cliente.id).progress, 0);
});

test('subir el umbral no retira nada y el siguiente premio pide más entradas', () => {
  encender({ entriesPerReward: 3 });
  const pack = vender(20);
  usar(pack, 3);
  assert.equal(premios().length, 1);

  fidelidad.guardarAjustes({ entriesPerReward: 10 }, { actor: u.master });
  usar(pack, 9);
  assert.equal(premios().length, 1, 'con el umbral nuevo todavía falta una');
  usar(pack, 1);
  assert.equal(premios().length, 2);
  assert.equal(premios()[1].threshold, 10, 'cada premio guarda el umbral con el que se ganó');
});

test('un premio de más de lo que hay que usar se rechaza al guardarlo', () => {
  assert.throws(
    () => encender({ entriesPerReward: 5, rewardTickets: 5 }),
    (error) => error.code === 'fidelidad_premio_invalido',
  );
  assert.equal(fidelidad.leerAjustes().enabled, false, 'un ajuste inválido no deja el programa a medias');
});

test('el barrido no se sale de su tope de clientes', () => {
  encender({ entriesPerReward: 2 });
  const pack = vender(10);
  usar(pack, 2);
  const resultado = fidelidad.evaluarPendientes({ limite: 1 });
  assert.ok(resultado.clientes <= 1);
});

// ---------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------

test('el premio se anuncia por correo y no como comprobante de compra', async () => {
  avisos.guardarAjustes({ enabled: true, sendFromHour: 0, sendUntilHour: 24 }, { actor: u.master });
  encender({ entriesPerReward: 3, rewardTickets: 1 });
  const pack = vender(10);
  vaciarBuzon();
  usar(pack, 3);

  const cola = getDb().prepare('SELECT * FROM notifications ORDER BY created_at, rowid').all();
  const delPremio = cola.filter((n) => n.kind === 'loyalty_reward');
  assert.equal(delPremio.length, 1);
  assert.equal(delPremio[0].dedupe_key, `loyalty_reward:${premios()[0].id}`);
  const cortesia = packsDeCortesia()[0];
  assert.equal(
    cola.filter((n) => n.kind === 'purchase' && n.pack_id === cortesia.id).length,
    0,
    'un regalo no genera comprobante de compra',
  );

  await avisos.despachar();
  const correos = buzonDePrueba().filter((c) => c.para === 'cliente@pista.ec');
  const regalo = correos.find((c) => c.asunto.includes('regalamos'));
  assert.ok(regalo, `no salió el correo del premio: ${correos.map((c) => c.asunto).join(' | ')}`);
  assert.match(regalo.texto, new RegExp(cortesia.code));
  assert.doesNotMatch(regalo.texto, /No quiero recibir más recordatorios/, 'no es publicidad: no lleva baja');

  // Y no se manda dos veces aunque el ciclo vuelva a pasar.
  await avisos.despachar();
  assert.equal(buzonDePrueba().filter((c) => c.asunto.includes('regalamos')).length, 1);
});

test('darse de baja de los recordatorios no cancela el aviso de un premio ganado', async () => {
  avisos.guardarAjustes({ enabled: true, sendFromHour: 0, sendUntilHour: 24 }, { actor: u.master });
  encender({ entriesPerReward: 2 });
  const pack = vender(10);
  usar(pack, 2);

  avisos.cambiarPreferencia(u.cliente.id, false, { via: 'cuenta' });
  const delPremio = getDb().prepare("SELECT * FROM notifications WHERE kind = 'loyalty_reward'").get();
  assert.equal(delPremio.status, 'pending');

  await avisos.despachar();
  assert.equal(getDb().prepare("SELECT status FROM notifications WHERE kind = 'loyalty_reward'").get().status, 'sent');
});

test('con el aviso del premio apagado el regalo se entrega igual, sin correo', async () => {
  avisos.guardarAjustes(
    { enabled: true, sendFromHour: 0, sendUntilHour: 24, kinds: { loyalty_reward: false } },
    { actor: u.master },
  );
  encender({ entriesPerReward: 2 });
  const pack = vender(10);
  vaciarBuzon();
  usar(pack, 2);

  assert.equal(premios().length, 1);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'loyalty_reward'").get().n, 0);
  await avisos.despachar();
  assert.equal(buzonDePrueba().filter((c) => c.asunto.includes('regalamos')).length, 0);
});

test('el máster puede mandarse una prueba del correo del premio', async () => {
  avisos.guardarAjustes({ enabled: true, sendFromHour: 0, sendUntilHour: 24 }, { actor: u.master });
  vaciarBuzon();

  const r = await u.cMaster.post('/api/admin/notifications/test', { kind: 'loyalty_reward' });
  assert.equal(r.status, 200, JSON.stringify(r.datos));

  const prueba = buzonDePrueba().find((c) => c.asunto.startsWith('[Prueba]'));
  assert.ok(prueba, 'debería haber salido un correo de prueba');
  assert.match(prueba.asunto, /regalamos/);
  assert.equal(prueba.para, 'master@pista.ec');
});

test('si el pack del premio se anula antes de salir el correo, el aviso se descarta', async () => {
  avisos.guardarAjustes({ enabled: true, sendFromHour: 0, sendUntilHour: 24 }, { actor: u.master });
  encender({ entriesPerReward: 2 });
  const pack = vender(10);
  usar(pack, 2);

  packsService.updatePack(packsDeCortesia()[0].id, { status: 'cancelled' }, { actor: u.master });
  await avisos.despachar();

  const aviso = getDb().prepare("SELECT * FROM notifications WHERE kind = 'loyalty_reward'").get();
  assert.equal(aviso.status, 'discarded');
  assert.equal(aviso.reason, 'pack_anulado');
});

// ---------------------------------------------------------------------------
// Lo que ve cada quien
// ---------------------------------------------------------------------------

test('el cliente ve su progreso con su saldo', async () => {
  encender({ entriesPerReward: 5, rewardTickets: 1 });
  const pack = vender(10);
  usar(pack, 2);

  const r = await u.cCliente.get('/api/packs/mine');
  assert.equal(r.status, 200);
  assert.equal(r.datos.loyalty.enabled, true);
  assert.equal(r.datos.loyalty.entriesPerReward, 5);
  assert.equal(r.datos.loyalty.progress, 2);
  assert.equal(r.datos.loyalty.remaining, 3);

  const resumen = await u.cCliente.get('/api/packs/mine/summary');
  assert.equal(resumen.datos.loyalty.progress, 2);

  usar(pack, 3);
  const despues = await u.cCliente.get('/api/packs/mine');
  assert.equal(despues.datos.loyalty.rewardsCount, 1);
  assert.equal(despues.datos.loyalty.ticketsEarned, 1);
  assert.equal(despues.datos.loyalty.progress, 0);
  const regalado = despues.datos.packs.find((p) => p.origin === 'loyalty');
  assert.ok(regalado, 'el pack de cortesía aparece en su lista');
  assert.equal(regalado.priceCents, 0);
});

test('la ficha del cliente trae su progreso y sus premios', () => {
  encender({ entriesPerReward: 2 });
  const pack = vender(10);
  usar(pack, 3);

  const ficha = expediente.expediente(u.cliente.id);
  assert.equal(ficha.loyalty.rewardsCount, 1);
  assert.equal(ficha.loyalty.progress, 1);
  assert.equal(ficha.loyalty.rewards.length, 1);
  assert.equal(ficha.loyalty.rewards[0].packCode, packsDeCortesia()[0].code);
});

test('el panel del máster resume el programa y quién está más cerca', async () => {
  encender({ entriesPerReward: 4, rewardTickets: 1 });
  const pack = vender(10);
  usar(pack, 5);

  const r = await u.cMaster.get('/api/admin/loyalty');
  assert.equal(r.status, 200);
  assert.equal(r.datos.status.enabled, true);
  assert.equal(r.datos.metrics.rewards, 1);
  assert.equal(r.datos.metrics.ticketsGiven, 1);
  assert.equal(r.datos.metrics.pending, 0);
  assert.ok(r.datos.metrics.costCents > 0, 'lo regalado se valora en dinero');
  assert.equal(r.datos.rewards.length, 1);
  assert.equal(r.datos.rewards[0].customerName, 'Carlos Piloto');

  const cerca = r.datos.closest.find((c) => c.userId === u.cliente.id);
  assert.ok(cerca, 'quien lleva una entrada de avance aparece en la lista');
  assert.equal(cerca.progress, 1);
  assert.equal(cerca.remaining, 3);

  const tablero = await u.cMaster.get('/api/admin/dashboard');
  assert.equal(tablero.datos.loyalty.metrics.rewards, 1);
  // El regalo no infla los ingresos: el pack de cortesía vale cero.
  assert.equal(tablero.datos.totals.revenueCents, 4500);
});

test('el máster cambia los ajustes y puede otorgar a mano lo pendiente', async () => {
  const guardado = await u.cMaster.pedir('/api/admin/loyalty/settings', {
    metodo: 'PUT',
    cuerpo: { enabled: true, entriesPerReward: 6, rewardTickets: 2, rewardExpiryDays: 45 },
  });
  assert.equal(guardado.status, 200);
  assert.equal(guardado.datos.entriesPerReward, 6);
  assert.equal(guardado.datos.rewardTickets, 2);

  const pack = vender(10);
  usar(pack, 6);
  const corrida = await u.cMaster.post('/api/admin/loyalty/run');
  assert.equal(corrida.status, 200);
  assert.equal(premios().length, 1);

  // La bitácora guarda el cambio de ajustes.
  const bitacora = getDb().prepare("SELECT * FROM audit_log WHERE action = 'fidelidad.ajustes_cambiados'").all();
  assert.equal(bitacora.length, 1);
});

test('los ajustes rechazan valores fuera de rango con un mensaje claro', async () => {
  const r = await u.cMaster.pedir('/api/admin/loyalty/settings', { metodo: 'PUT', cuerpo: { entriesPerReward: 1 } });
  assert.equal(r.status, 400);
  assert.match(r.datos.error.details.fields.entriesPerReward, /entre 2 y 100/);

  const otro = await u.cMaster.pedir('/api/admin/loyalty/settings', { metodo: 'PUT', cuerpo: { rewardExpiryDays: 900 } });
  assert.equal(otro.status, 400);
});

test('solo el máster toca el programa', async () => {
  for (const cliente of [u.cStaff, u.cCliente]) {
    assert.equal((await cliente.get('/api/admin/loyalty')).status, 403);
    assert.equal(
      (await cliente.pedir('/api/admin/loyalty/settings', { metodo: 'PUT', cuerpo: { enabled: true } })).status,
      403,
    );
    assert.equal((await cliente.post('/api/admin/loyalty/run')).status, 403);
  }
});

test('el cliente recibe el premio en vivo por el canal de eventos', async () => {
  const { abrirCanal, fijarBase } = await import('./canal.js');
  fijarBase(await levantarServidor());
  encender({ entriesPerReward: 2, rewardTickets: 1 });
  const pack = vender(10);

  const canal = await abrirCanal(u.cCliente.token);
  try {
    usar(pack, 2);
    const evento = await canal.esperar('fidelidad.recompensa');
    assert.equal(evento.datos.reward.tickets, 1);
    assert.equal(evento.datos.reward.sequence, 1);
    assert.equal(evento.datos.pack.origin, 'loyalty');
    assert.equal(evento.datos.customer.id, u.cliente.id);
  } finally {
    canal.cerrar();
  }
});

// ---------------------------------------------------------------------------
// Transferencias
// ---------------------------------------------------------------------------

test('las entradas recibidas por transferencia cuentan; el pack queda marcado como transferido', async () => {
  encender({ entriesPerReward: 3 });
  const otro = await users.createUser({
    email: 'piloto2@pista.ec',
    password: 'Neumatico-Lluvia-32',
    fullName: 'Dani Piloto',
    role: 'customer',
  });
  const pack = vender(10);

  const resultado = packsService.transferTickets(pack.id, {
    quantity: 5,
    recipient: 'piloto2@pista.ec',
    actor: u.master,
  });
  const recibido = packsService.findById(resultado.destinationPack.id);
  assert.equal(recibido.origin, 'transfer');

  for (let i = 0; i < 3; i += 1) {
    redemptions.redeemByCode({ code: recibido.code, scanner: { id: u.staff.id, email: u.staff.email } });
  }
  assert.equal(premios(otro.id).length, 1, 'lo transferido son entradas pagadas: cuentan');
});

test('una lectura guardada sin conexión también acerca el premio', () => {
  // El programa se encendió hace una hora: la lectura de hace 30 segundos es
  // posterior, así que cuenta como cualquier otra visita.
  encender({ entriesPerReward: 2 }, Date.now() - 60 * 60 * 1000);
  const pack = vender(10);
  const ahora = Date.now();

  usar(pack, 1);
  redemptions.redeemByCode({
    code: pack.code,
    scanner: { id: u.staff.id, email: u.staff.email },
    capturedAt: iso(ahora - 30_000),
    sentAt: iso(ahora),
    idempotencyKey: 'lectura-guardada-1',
  });

  assert.equal(premios().length, 1);
  assert.equal(fidelidad.progreso(u.cliente.id).counted, 2);
});

test('una lectura hecha antes de encender el programa no cuenta, aunque llegue después', () => {
  const pack = vender(10);
  const ahora = Date.now();
  encender({ entriesPerReward: 2 });

  // Dos lecturas de hace media hora, guardadas en el teléfono durante el corte:
  // la persona entró cuando el programa todavía no existía.
  for (const [i, minutos] of [30, 25].entries()) {
    redemptions.redeemByCode({
      code: pack.code,
      scanner: { id: u.staff.id, email: u.staff.email },
      capturedAt: iso(ahora - minutos * 60_000),
      sentAt: iso(ahora),
      idempotencyKey: `lectura-vieja-${i}`,
    });
  }

  assert.deepEqual(premios(), []);
  assert.equal(fidelidad.progreso(u.cliente.id).counted, 0);
});
