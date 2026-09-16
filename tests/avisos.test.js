/**
 * Avisos a clientes: comprobantes, recordatorios, baja y clientes por recuperar.
 *
 * El correo sale por el transporte `memoria`, así que se comprueba lo que
 * recibiría de verdad la persona: cuántos correos, con qué asunto, qué enlaces
 * y qué cabeceras. El tiempo se controla pasando `now` al ciclo o moviendo las
 * fechas guardadas, nunca esperando.
 */
import './env-recuperacion.js';
import './env.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios, crearCliente } from './helpers.js';
import { getDb } from '../src/db/index.js';
import { config } from '../src/config.js';
import { buzonDePrueba, vaciarBuzon, enviarCorreo } from '../src/lib/correo.js';
import * as fechas from '../src/lib/fechas.js';
import * as avisos from '../src/services/avisos.js';
import * as packsService from '../src/services/packs.js';
import * as redemptions from '../src/services/redemptions.js';
import * as users from '../src/services/users.js';
import * as expediente from '../src/services/expediente.js';

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
const iso = (instante) => new Date(instante).toISOString();

let baseUrl;
let u;

before(async () => {
  baseUrl = await levantarServidor();
});
after(bajarServidor);
beforeEach(async () => {
  limpiarBase();
  vaciarBuzon();
  u = await sembrarUsuarios();
});

/** Con el horario abierto todo el día, las pruebas no dependen de la hora a la que corren. */
const TODO_EL_DIA = { sendFromHour: 0, sendUntilHour: 24 };

function activar(cambios = {}) {
  return avisos.guardarAjustes({ enabled: true, ...TODO_EL_DIA, ...cambios }, { actor: u.master });
}

const pausa = (ms) => new Promise((listo) => setTimeout(listo, ms));

/** Con precio, salvo que se diga otra cosa: un pack a cero se anuncia como cortesía. */
function vender(extra = {}, userId = u.cliente.id) {
  return packsService.issuePack({ userId, size: 5, priceCents: 2000, actor: u.master, ...extra });
}

function usar(pack, veces = 1) {
  for (let i = 0; i < veces; i += 1) {
    redemptions.redeemByCode({ code: pack.code, scanner: { id: u.staff.id, email: u.staff.email } });
  }
}

const correosDe = (direccion = 'cliente@pista.ec') => buzonDePrueba().filter((c) => c.para === direccion);
const avisosGuardados = () => getDb().prepare('SELECT * FROM notifications ORDER BY created_at, rowid').all();

/** Hace como si los recordatorios ya enviados fueran de hace días, para saltar el espaciado. */
function envejecerEnvios(dias = 3) {
  getDb().prepare('UPDATE notifications SET sent_at = ? WHERE sent_at IS NOT NULL').run(iso(Date.now() - dias * DIA));
}

/** Lleva toda la historia de un cliente (compras, visitas, movimientos) a hace `dias` días. */
function envejecerCliente(userId, dias) {
  const db = getDb();
  const antes = iso(Date.now() - dias * DIA);
  db.prepare('UPDATE packs SET created_at = ? WHERE user_id = ?').run(antes, userId);
  db.prepare('UPDATE redemptions SET created_at = ? WHERE user_id = ?').run(antes, userId);
  db.prepare('UPDATE pack_movements SET created_at = ? WHERE pack_id IN (SELECT id FROM packs WHERE user_id = ?)').run(antes, userId);
}

async function crearClienteExtra(nombre, correo, telefono = null) {
  return users.createUser({ email: correo, password: 'Rueda-Delantera-2026', fullName: nombre, phone: telefono });
}

// ---------------------------------------------------------------------------
// Encendido y comprobante de compra
// ---------------------------------------------------------------------------

test('vienen apagados: una instalación que se actualiza no escribe a nadie', async () => {
  const pack = vender({ size: 3 });
  usar(pack, 2);
  const resultado = await avisos.ciclo();
  assert.equal(resultado.creados, 0);
  assert.equal(resultado.enviados, 0);
  assert.equal(avisosGuardados().length, 0);
  assert.equal(buzonDePrueba().length, 0);
});

test('el comprobante de compra llega una vez, con los datos del pack y sin baja', async () => {
  activar();
  const pack = vender({ size: 10, priceCents: 4500, paymentMethod: 'transferencia', paymentReference: 'TRX-99' });

  await avisos.ciclo();
  await avisos.ciclo();

  const correos = correosDe();
  assert.equal(correos.length, 1, 'ni dos ciclos seguidos lo duplican');
  const [correo] = correos;
  assert.match(correo.asunto, /pack de 10 entradas/);
  assert.ok(correo.texto.includes(pack.code));
  assert.match(correo.texto, /Importe: \$\s?45[,.]00 · Transferencia/);
  assert.match(correo.texto, /Referencia: TRX-99/);
  assert.match(correo.texto, /https:\/\/entradas\.example\/app/);
  // El comprobante no es un recordatorio: no se ofrece darse de baja de él.
  assert.deepEqual(correo.cabeceras, {});
  assert.ok(!correo.texto.includes('/recordatorios#t='));
  assert.equal(avisosGuardados()[0].status, 'sent');
});

test('un pack de cortesía se anuncia como cortesía, sin importe', async () => {
  activar();
  vender({ size: 2, priceCents: 0, paymentMethod: 'cortesia' });
  await avisos.ciclo();
  const [correo] = correosDe();
  assert.match(correo.asunto, /Te acreditamos 2 entradas/);
  assert.ok(!/Importe/.test(correo.texto));
});

test('lo que se vendió antes de encenderlos no genera comprobante', async () => {
  vender();
  await pausa(5);
  activar();
  await avisos.ciclo();
  assert.equal(buzonDePrueba().length, 0);
});

// ---------------------------------------------------------------------------
// Recordatorios de saldo
// ---------------------------------------------------------------------------

test('quedan pocas y se acabaron: uno de cada por compra, y vuelve a avisar tras recomprar', async () => {
  activar({ kinds: { purchase: false } });
  const pack = vender({ size: 4 });

  usar(pack);
  await avisos.ciclo();
  assert.equal(correosDe().length, 0, 'con 3 entradas todavía no toca avisar');

  usar(pack);
  await avisos.ciclo();
  usar(pack);
  await avisos.ciclo();
  let correos = correosDe();
  assert.equal(correos.length, 1, 'con 2 avisa; con 1, en la misma compra, ya no insiste');
  assert.match(correos[0].asunto, /Te quedan 2 entradas/);
  assert.match(correos[0].texto, /Pack 5 entradas: \$\s?25[,.]00/, 'lleva el catálogo para recomprar');

  // Un recordatorio lleva la baja en el cuerpo y en las cabeceras de un clic.
  assert.match(correos[0].texto, /https:\/\/entradas\.example\/recordatorios#t=[\w-]+\.[\w-]+/);
  assert.match(
    correos[0].cabeceras['List-Unsubscribe'],
    /^<https:\/\/entradas\.example\/api\/notifications\/unsubscribe\?t=[\w.-]+>$/,
  );
  assert.equal(correos[0].cabeceras['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');

  envejecerEnvios();
  usar(pack);
  await avisos.ciclo();
  correos = correosDe();
  assert.equal(correos.length, 2);
  assert.match(correos[1].asunto, /Usaste tu última entrada/);

  // Una compra nueva abre otro ciclo.
  const otro = vender({ size: 3 });
  envejecerEnvios();
  usar(otro);
  await avisos.ciclo();
  assert.equal(correosDe().length, 3);
  assert.match(correosDe()[2].asunto, /Te quedan 2 entradas/);
});

test('un aviso que dejó de aplicar antes de salir se descarta con su motivo', async () => {
  activar({ kinds: { purchase: false } });
  const pack = vender({ size: 3 });
  usar(pack);
  assert.equal(avisos.detectar(), 1, 'quedan 2: toca avisar');

  vender({ size: 10 }); // compra otro antes de que salga el correo
  const resultado = await avisos.despachar();

  assert.equal(resultado.enviados, 0);
  assert.equal(resultado.descartados, 1);
  assert.equal(avisosGuardados()[0].status, 'discarded');
  assert.equal(avisosGuardados()[0].reason, 'ya_no_aplica');
  assert.equal(correosDe().length, 0);
});

test('si se le devuelve la entrada antes de avisar, el «se acabaron» no sale', async () => {
  activar({ kinds: { purchase: false } });
  const pack = vender({ size: 1 });
  usar(pack);
  assert.equal(avisos.detectar(), 1);

  const [consumo] = redemptions.listRedemptions({ packId: pack.id }).items;
  redemptions.voidRedemption(consumo.id, { reason: 'Error del puesto', actor: u.master });
  await avisos.despachar();

  assert.equal(correosDe().length, 0);
  assert.equal(avisosGuardados()[0].reason, 'ya_no_aplica');
});

// ---------------------------------------------------------------------------
// Horario y espaciado
// ---------------------------------------------------------------------------

test('el horario de envío se calcula en la zona de la pista', () => {
  const horario = { sendFromHour: 9, sendUntilHour: 20 };
  assert.equal(avisos.siguienteHoraDeEnvio(Date.parse('2026-09-14T12:00:00Z'), horario, 'UTC'), null);
  assert.equal(iso(avisos.siguienteHoraDeEnvio(Date.parse('2026-09-14T08:59:00Z'), horario, 'UTC')), '2026-09-14T09:00:00.000Z');
  assert.equal(iso(avisos.siguienteHoraDeEnvio(Date.parse('2026-09-14T20:00:00Z'), horario, 'UTC')), '2026-09-15T09:00:00.000Z');
  // Las 20:00 en Guayaquil son la 01:00 UTC del día siguiente; las 9:00, las 14:00 UTC.
  assert.equal(
    iso(avisos.siguienteHoraDeEnvio(Date.parse('2026-09-15T01:00:00Z'), horario, 'America/Guayaquil')),
    '2026-09-15T14:00:00.000Z',
  );
  assert.equal(avisos.siguienteHoraDeEnvio(Date.parse('2026-09-15T03:00:00Z'), { sendFromHour: 0, sendUntilHour: 24 }), null);
});

test('de noche el recordatorio espera a la mañana; el comprobante sale en el acto', async () => {
  activar({ sendFromHour: 9, sendUntilHour: 20 });
  const pack = vender({ size: 3 });
  usar(pack);

  const zona = config.timezone;
  const hoy = fechas.diaLocal(new Date(), zona);
  const noche = fechas.inicioDelDia(hoy, zona).getTime() + 22 * HORA;
  const manana = fechas.inicioDelDia(fechas.siguienteDia(hoy), zona).getTime() + 9 * HORA;

  const deNoche = await avisos.ciclo({ now: noche });
  assert.equal(deNoche.enviados, 1, 'el comprobante no espera');
  assert.equal(deNoche.aplazados, 1);
  const recordatorio = avisosGuardados().find((a) => a.kind === 'low_balance');
  assert.equal(recordatorio.status, 'pending');
  assert.equal(recordatorio.next_attempt_at, iso(manana));

  const aLaManana = await avisos.ciclo({ now: manana + 5 * MINUTO });
  assert.equal(aLaManana.enviados, 1);
  assert.deepEqual(correosDe().map((c) => c.asunto.split(' en ')[0]).sort(), ['Te quedan 2 entradas', 'Tu pack de 3 entradas']);
});

test('ampliar el horario pone en la cola lo que esperaba a la mañana', async () => {
  activar({ sendFromHour: 9, sendUntilHour: 10, kinds: { purchase: false } });
  const pack = vender({ size: 3 });
  usar(pack);

  const zona = config.timezone;
  const noche = fechas.inicioDelDia(fechas.diaLocal(new Date(), zona), zona).getTime() + 23 * HORA;
  await avisos.ciclo({ now: noche });
  const esperando = avisosGuardados()[0];
  assert.ok(esperando.next_attempt_at > iso(noche), 'queda para la mañana');

  avisos.guardarAjustes(TODO_EL_DIA, { actor: u.master, now: noche });
  await avisos.ciclo({ now: noche + MINUTO });
  assert.equal(correosDe().length, 1);
});

test('dos recordatorios a la misma persona se separan al menos 48 horas', async () => {
  activar({ kinds: { purchase: false } });
  vender({ size: 5, expiresAt: iso(Date.now() + 3 * DIA) });
  const otro = vender({ size: 3 });
  usar(otro); // saldo total 7: sin «quedan pocas»

  await avisos.ciclo();
  assert.equal(correosDe().length, 1, 'sale el de vencimiento');

  usar(otro);
  getDb().prepare("UPDATE packs SET remaining = 0, status = 'cancelled' WHERE expires_at IS NOT NULL").run();
  const ahora = Date.now();
  const resultado = await avisos.ciclo({ now: ahora });
  assert.equal(resultado.aplazados, 1, 'el de «quedan pocas» espera');
  assert.equal(correosDe().length, 1);

  const pendiente = avisosGuardados().find((a) => a.kind === 'low_balance');
  assert.ok(Date.parse(pendiente.next_attempt_at) >= ahora + 47 * HORA);
  await avisos.ciclo({ now: Date.parse(pendiente.next_attempt_at) + MINUTO });
  assert.equal(correosDe().length, 2);
});

// ---------------------------------------------------------------------------
// Vencimiento e inactividad
// ---------------------------------------------------------------------------

test('por vencer: avisa una vez, y otra si se cambia la fecha', async () => {
  activar({ kinds: { purchase: false } });
  const pack = vender({ size: 5, expiresAt: iso(Date.now() + 3 * DIA) });

  await avisos.ciclo();
  await avisos.ciclo();
  assert.equal(correosDe().length, 1);
  assert.match(correosDe()[0].asunto, /Tus 5 entradas vencen el/);
  assert.match(correosDe()[0].texto, new RegExp(`Tu pack ${pack.code} tiene 5 entradas sin usar`));

  packsService.updatePack(pack.id, { expiresAt: iso(Date.now() + 5 * DIA) }, { actor: u.master });
  envejecerEnvios();
  await avisos.ciclo();
  assert.equal(correosDe().length, 2);
});

test('inactividad: escribe a quien tiene entradas y no viene, una sola vez', async () => {
  activar({ kinds: { purchase: false } });
  const pack = vender({ size: 5 });
  usar(pack);
  envejecerCliente(u.cliente.id, 40);

  await avisos.ciclo();
  await avisos.ciclo();
  const correos = correosDe();
  assert.equal(correos.length, 1);
  assert.match(correos[0].asunto, /tienes 4 entradas/);
  assert.match(correos[0].texto, /Hace 40 días que no te vemos/);
});

test('si ya se le recordó algo después de su última visita, no se insiste por inactividad', async () => {
  activar({ kinds: { purchase: false } });
  vender({ size: 5, expiresAt: iso(Date.now() + 3 * DIA) });
  envejecerCliente(u.cliente.id, 40);

  await avisos.ciclo();

  assert.deepEqual(correosDe().map((c) => /vencen/.test(c.asunto)), [true]);
  const inactividad = avisosGuardados().find((a) => a.kind === 'inactive');
  assert.equal(inactividad.status, 'discarded');
  assert.equal(inactividad.reason, 'ya_recordado');
});

// ---------------------------------------------------------------------------
// Baja
// ---------------------------------------------------------------------------

test('baja desde el enlace: consulta, baja, alta y token alterado', async () => {
  const token = avisos.tokenDeBaja(u.cliente.id);
  const anonimo = crearCliente();

  let r = await anonimo.post('/api/notifications/preferences', { token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.datos, { firstName: 'Carlos', emailReminders: true });

  r = await anonimo.post('/api/notifications/unsubscribe', { token });
  assert.deepEqual(r.datos, { firstName: 'Carlos', emailReminders: false });
  assert.equal(users.findById(u.cliente.id).email_reminders, 0);

  r = await anonimo.post('/api/notifications/resubscribe', { token });
  assert.equal(r.datos.emailReminders, true);

  const firma = token.split('.')[1];
  for (const falso of [`${u.cliente.id}.${firma.slice(0, -2)}xx`, `${u.staff.id}.${firma}`, 'basura', '']) {
    r = await anonimo.post('/api/notifications/unsubscribe', { token: falso });
    assert.equal(r.status, 400, `«${falso}» no debería servir`);
    assert.equal(r.datos.error.code, 'enlace_invalido');
  }

  const registro = getDb()
    .prepare("SELECT metadata FROM audit_log WHERE action = 'recordatorios.desactivados' AND entity_id = ?")
    .get(u.cliente.id);
  assert.deepEqual(JSON.parse(registro.metadata), { via: 'enlace' });
});

test('la baja de un clic de Gmail y Outlook (RFC 8058) funciona sin sesión ni origen', async () => {
  const token = avisos.tokenDeBaja(u.cliente.id);
  const respuesta = await fetch(`${baseUrl}/api/notifications/unsubscribe?t=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  });
  assert.equal(respuesta.status, 200);
  assert.equal(users.findById(u.cliente.id).email_reminders, 0);
});

test('quien se da de baja no recibe recordatorios, pero sí sus comprobantes', async () => {
  activar();
  const pack = vender({ size: 3 });
  usar(pack);
  avisos.detectar();

  const r = await u.cCliente.patch('/api/auth/me', { emailReminders: false });
  assert.equal(r.status, 200);
  assert.equal(r.datos.user.emailReminders, false);
  assert.equal(avisosGuardados().find((a) => a.kind === 'low_balance').reason, 'baja', 'lo pendiente se descarta en el acto');

  await avisos.ciclo();
  assert.deepEqual(correosDe().map((c) => /Tu pack de 3 entradas/.test(c.asunto)), [true]);

  const vuelta = await u.cCliente.patch('/api/auth/me', { emailReminders: true, fullName: 'Carlos Piloto Veloz' });
  assert.equal(vuelta.datos.user.emailReminders, true);
  assert.equal(vuelta.datos.user.fullName, 'Carlos Piloto Veloz');
});

// ---------------------------------------------------------------------------
// Robustez de la cola
// ---------------------------------------------------------------------------

test('un correo caído se reintenta con esperas crecientes y, agotado, queda fallido', async () => {
  activar();
  vender();
  const caido = async () => {
    throw new Error('SMTP caído');
  };

  let ahora = Date.now();
  const esperas = [];
  for (let intento = 1; intento <= 3; intento += 1) {
    await avisos.ciclo({ now: ahora, enviar: caido });
    const [fila] = avisosGuardados();
    assert.equal(fila.status, 'pending');
    assert.equal(fila.attempts, intento);
    assert.equal(fila.reason, 'SMTP caído');
    esperas.push(Math.round((Date.parse(fila.next_attempt_at) - ahora) / MINUTO));
    ahora = Date.parse(fila.next_attempt_at);
  }
  assert.deepEqual(esperas, [5, 30, 120]);

  await avisos.ciclo({ now: ahora, enviar: caido });
  const [agotado] = avisosGuardados();
  assert.equal(agotado.status, 'failed');

  const r = await u.cMaster.post(`/api/admin/notifications/${agotado.id}/retry`, {});
  assert.equal(r.status, 200);
  assert.equal(r.datos.status, 'pending');
  await avisos.ciclo();
  assert.equal(avisosGuardados()[0].status, 'sent');
  assert.equal(correosDe().length, 1);

  const otra = await u.cMaster.post(`/api/admin/notifications/${agotado.id}/retry`, {});
  assert.equal(otra.status, 409, 'solo se reintenta lo que falló');
});

test('un envío que quedó a medias porque el proceso se cayó vuelve a la cola', async () => {
  activar();
  vender();
  avisos.detectar();
  getDb().prepare("UPDATE notifications SET status = 'sending', updated_at = ?").run(iso(Date.now() - 20 * MINUTO));

  await avisos.despachar();
  assert.equal(avisosGuardados()[0].status, 'sent');
});

test('varios ciclos a la vez no mandan nada dos veces', async () => {
  activar();
  vender();
  vender({ size: 10 });
  await Promise.all([avisos.ciclo(), avisos.ciclo(), avisos.ciclo(), avisos.ciclo()]);
  assert.equal(correosDe().length, 2);
});

test('una cuenta suspendida no recibe nada, ni lo que ya estaba en cola', async () => {
  activar();
  vender();
  avisos.detectar();
  users.updateUser(u.cliente.id, { status: 'suspended' });
  vender({}, u.staff.id);
  users.updateUser(u.staff.id, { status: 'suspended' });

  await avisos.ciclo();
  assert.equal(buzonDePrueba().length, 0);
  assert.equal(avisosGuardados()[0].reason, 'cuenta_suspendida');
});

test('apagar los avisos, o un tipo, vacía su parte de la cola', async () => {
  activar({ sendFromHour: 9, sendUntilHour: 10 });
  const pack = vender({ size: 3 });
  usar(pack);
  avisos.detectar();

  avisos.guardarAjustes({ kinds: { low_balance: false } }, { actor: u.master });
  let guardados = avisosGuardados();
  assert.equal(guardados.find((a) => a.kind === 'low_balance').reason, 'tipo_apagado');
  assert.equal(guardados.find((a) => a.kind === 'purchase').status, 'pending');

  avisos.guardarAjustes({ enabled: false }, { actor: u.master });
  guardados = avisosGuardados();
  assert.equal(guardados.find((a) => a.kind === 'purchase').reason, 'avisos_apagados');
});

test('volver a encenderlos no escribe por lo que pasó mientras estaban apagados', async () => {
  activar();
  avisos.guardarAjustes({ enabled: false }, { actor: u.master });
  vender();
  await pausa(5);
  activar();
  await avisos.ciclo();
  assert.equal(buzonDePrueba().length, 0);
});

test('encender un solo tipo tampoco escribe por lo que pasó mientras estaba apagado', async () => {
  activar({ kinds: { purchase: false, low_balance: false } });
  const pack = vender({ size: 3 });
  usar(pack); // quedan 2, con «quedan pocas» apagado
  await pausa(5);
  avisos.guardarAjustes({ kinds: { purchase: true, low_balance: true } }, { actor: u.master });

  await avisos.ciclo();
  assert.equal(buzonDePrueba().length, 0, 'ni el comprobante ni el aviso de antes de encenderlos');

  // Lo que pasa después de encenderlos, en cambio, sí se avisa.
  vender({ size: 5 });
  await avisos.ciclo();
  assert.deepEqual(correosDe().map((c) => c.asunto.split(' en ')[0]), ['Tu pack de 5 entradas']);
});

test('si el servidor de correo rechaza la prueba, el máster ve el motivo', async () => {
  const r = await u.cMaster.post('/api/admin/notifications/test', { kind: 'purchase' });
  assert.equal(r.status, 200, 'con el buzón de pruebas sale bien');

  // Un destinatario que el transporte rechaza simula el fallo del servidor.
  getDb().prepare('UPDATE users SET email = ? WHERE id = ?').run('sin-arroba', u.master.id);
  const fallo = await u.cMaster.post('/api/admin/notifications/test', { kind: 'purchase' });
  assert.equal(fallo.status, 502);
  assert.match(fallo.datos.error.message, /^No se pudo enviar la prueba: El destinatario del correo no es válido/);
});

test('los descartados viejos se purgan; lo enviado se conserva', async () => {
  activar();
  vender();
  await avisos.ciclo();
  const db = getDb();
  db.prepare(
    `INSERT INTO notifications (id, user_id, kind, channel, status, reason, created_at, updated_at)
     VALUES ('viejo', ?, 'inactive', 'email', 'discarded', 'baja', ?, ?)`,
  ).run(u.cliente.id, iso(Date.now() - 100 * DIA), iso(Date.now() - 100 * DIA));

  assert.equal(avisos.purgar(), 1);
  assert.deepEqual(avisosGuardados().map((a) => a.status), ['sent']);
});

// ---------------------------------------------------------------------------
// Seguridad de los correos
// ---------------------------------------------------------------------------

test('lo que viene de la base se escapa en el HTML del correo', async () => {
  activar();
  users.updateUser(u.cliente.id, { fullName: '<b>Carlos</b> Piloto' });
  vender({ paymentMethod: 'transferencia', paymentReference: '<script>alert(1)</script>' });
  await avisos.ciclo();
  const [correo] = correosDe();
  assert.ok(!correo.html.includes('<script>'));
  assert.ok(!correo.html.includes('<b>Carlos'));
  assert.ok(correo.html.includes('&lt;script&gt;'));
});

test('un correo solo admite las cabeceras de baja, y sin saltos de línea', async () => {
  const base = { para: 'a@pista.ec', asunto: 'x', texto: 'y' };
  await assert.rejects(enviarCorreo({ ...base, cabeceras: { Bcc: 'otro@pista.ec' } }), /no está permitida/);
  await assert.rejects(
    enviarCorreo({ ...base, cabeceras: { 'List-Unsubscribe': '<https://x.example>\r\nBcc: otro@pista.ec' } }),
    /no está permitida/,
  );
});

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

test('solo el máster ve y cambia los avisos', async () => {
  for (const cliente of [u.cStaff, u.cCliente]) {
    assert.equal((await cliente.get('/api/admin/notifications/overview')).status, 403);
    assert.equal((await cliente.pedir('/api/admin/notifications/settings', { metodo: 'PUT', cuerpo: { enabled: true } })).status, 403);
    assert.equal((await cliente.post('/api/admin/notifications/contacts', { userId: u.cliente.id, channel: 'phone', kind: 'inactive' })).status, 403);
  }
});

test('los ajustes se validan, se guardan con fecha de activación y quedan en la auditoría', async () => {
  const guardar = (cuerpo) => u.cMaster.pedir('/api/admin/notifications/settings', { metodo: 'PUT', cuerpo });

  let r = await guardar({ sendFromHour: 20, sendUntilHour: 9 });
  assert.equal(r.status, 400);
  assert.equal(r.datos.error.code, 'horario_invalido');

  r = await guardar({ lowBalanceThreshold: 0 });
  assert.equal(r.status, 400);
  assert.equal(r.datos.error.details.fields.lowBalanceThreshold, 'Indica entre 1 y 10 entradas.');

  assert.equal((await guardar({ loQueSea: true })).status, 400);
  assert.equal((await guardar({ whatsappCountryCode: '+593' })).status, 400);

  r = await guardar({ enabled: true, lowBalanceThreshold: 3, kinds: { inactive: false } });
  assert.equal(r.status, 200);
  assert.equal(r.datos.enabled, true);
  assert.ok(r.datos.enabledAt);
  assert.equal(r.datos.lowBalanceThreshold, 3);
  assert.equal(r.datos.kinds.inactive, false);
  assert.equal(r.datos.kinds.purchase, true, 'lo que no se envía se conserva');
  assert.equal(r.datos.emailConfigured, true);

  const config = await crearCliente().get('/api/config');
  assert.equal(config.datos.emailReminders, true);
  assert.ok(getDb().prepare("SELECT 1 FROM audit_log WHERE action = 'avisos.ajustes_cambiados'").get());
});

test('la prueba llega al máster con los datos de ejemplo', async () => {
  const r = await u.cMaster.post('/api/admin/notifications/test', { kind: 'expiring' });
  assert.equal(r.status, 200);
  const [correo] = correosDe('master@pista.ec');
  assert.match(correo.asunto, /^\[Prueba\] Tus 2 entradas vencen el/);
  assert.equal(correosDe().length, 0, 'a ningún cliente');
});

test('revisar ahora detecta y envía sin esperar al ciclo', async () => {
  activar();
  vender();
  const r = await u.cMaster.post('/api/admin/notifications/run', {});
  assert.equal(r.status, 200);
  assert.equal(r.datos.creados, 1);
  assert.equal(r.datos.enviados, 1);

  const historial = await u.cMaster.get('/api/admin/notifications?status=sent');
  assert.equal(historial.datos.total, 1);
  assert.equal(historial.datos.items[0].customerName, 'Carlos Piloto');
  assert.equal(historial.datos.items[0].kind, 'purchase');
});

test('clientes por recuperar: cada uno en su grupo más urgente, con WhatsApp listo', async () => {
  users.updateUser(u.cliente.id, { phone: '0991112233' });
  const pocas = vender({ size: 3 });
  usar(pocas); // Carlos: le quedan 2

  const ana = await crearClienteExtra('Ana Vence', 'ana@pista.ec', '+593992223344');
  vender({ size: 5, expiresAt: iso(Date.now() + 3 * DIA) }, ana.id);
  const beto = await crearClienteExtra('Beto Sin', 'beto@pista.ec');
  usar(vender({ size: 1 }, beto.id));
  const dora = await crearClienteExtra('Dora Quieta', 'dora@pista.ec');
  vender({ size: 5 }, dora.id);
  envejecerCliente(dora.id, 45);
  const eva = await crearClienteExtra('Eva Contenta', 'eva@pista.ec');
  vender({ size: 10 }, eva.id);
  // Un pack que vence y que además lleva tiempo sin venir: manda el vencimiento.
  const fito = await crearClienteExtra('Fito Doble', 'fito@pista.ec');
  vender({ size: 2, expiresAt: iso(Date.now() + 2 * DIA) }, fito.id);
  envejecerCliente(fito.id, 50);

  const r = await u.cMaster.get('/api/admin/notifications/overview');
  assert.equal(r.status, 200);
  const { groups, totals } = r.datos.opportunities;
  const nombres = (grupo) => groups[grupo].items.map((c) => c.fullName);

  assert.deepEqual(nombres('expiring'), ['Fito Doble', 'Ana Vence'], 'el que vence antes, primero');
  assert.deepEqual(nombres('depleted'), ['Beto Sin']);
  assert.deepEqual(nombres('inactive'), ['Dora Quieta']);
  assert.deepEqual(nombres('lowBalance'), ['Carlos Piloto']);
  assert.equal(totals.customers, 5);
  assert.equal(totals.ticketsAtStake, 5 + 2 + 5, 'entradas pagadas por vencer o sin usar');
  assert.equal(groups.inactive.items[0].daysSinceActivity, 45);

  const carlos = groups.lowBalance.items[0];
  assert.ok(carlos.whatsappUrl.startsWith('https://wa.me/593991112233?text='));
  const texto = decodeURIComponent(carlos.whatsappUrl.split('text=')[1]);
  assert.match(texto, /^Hola, Carlos\. Te escribimos de Miniápolis\. Te quedan 2 entradas\./);
  assert.equal(groups.depleted.items[0].whatsappUrl, null, 'sin teléfono no hay WhatsApp');

  // Registrar el contacto lo deja a la vista y en la ficha.
  const contacto = await u.cMaster.post('/api/admin/notifications/contacts', {
    userId: u.cliente.id, channel: 'whatsapp', kind: 'low_balance',
  });
  assert.equal(contacto.status, 201);
  const despues = await u.cMaster.get('/api/admin/notifications/overview');
  const carlosDespues = despues.datos.opportunities.groups.lowBalance.items[0];
  assert.equal(carlosDespues.recentlyContacted, true);
  assert.equal(carlosDespues.lastContact.channel, 'whatsapp');
  assert.equal(carlosDespues.lastContact.actorName, 'Ana Máster');
  assert.equal(despues.datos.metrics.contacts, 1);

  const ficha = expediente.expediente(u.cliente.id);
  const enLaFicha = ficha.timeline.items.find((e) => e.tipo === 'aviso');
  assert.equal(enLaFicha.clave, 'low_balance');
  assert.equal(enLaFicha.metadata.channel, 'whatsapp');
  assert.equal(enLaFicha.actorName, 'Ana Máster');
  assert.ok(ficha.whatsappUrl.startsWith('https://wa.me/593991112233'));
});

test('el máster cambia desde la ficha si alguien recibe recordatorios', async () => {
  let r = await u.cMaster.patch(`/api/admin/users/${u.cliente.id}`, { emailReminders: false });
  assert.equal(r.status, 200);
  assert.equal(r.datos.user.emailReminders, false);
  assert.ok(r.datos.user.emailRemindersChangedAt);

  const acciones = getDb().prepare('SELECT action, metadata FROM audit_log WHERE entity_id = ? ORDER BY rowid').all(u.cliente.id);
  assert.ok(acciones.some((a) => a.action === 'recordatorios.desactivados' && JSON.parse(a.metadata).via === 'administracion'));
  assert.ok(!acciones.some((a) => a.action === 'usuario.actualizado'), 'no hubo otros cambios que registrar');

  r = await u.cMaster.patch(`/api/admin/users/${u.cliente.id}`, { emailReminders: false });
  assert.equal(r.status, 200, 'repetirlo no es un error');
});

test('el número de WhatsApp se normaliza con el prefijo del país', () => {
  assert.equal(avisos.numeroDeWhatsapp('0991112233'), '593991112233');
  assert.equal(avisos.numeroDeWhatsapp('991112233'), '593991112233');
  assert.equal(avisos.numeroDeWhatsapp('+593991112233'), '593991112233');
  assert.equal(avisos.numeroDeWhatsapp('593991112233'), '593991112233');
  assert.equal(avisos.numeroDeWhatsapp('0034612345678'), '34612345678');
  assert.equal(avisos.numeroDeWhatsapp('+1 (415) 555-0100'), '14155550100');
  assert.equal(avisos.numeroDeWhatsapp('0991112233', '57'), '57991112233');
  assert.equal(avisos.numeroDeWhatsapp('123'), null);
  assert.equal(avisos.numeroDeWhatsapp(''), null);
  assert.equal(avisos.numeroDeWhatsapp(null), null);
});
