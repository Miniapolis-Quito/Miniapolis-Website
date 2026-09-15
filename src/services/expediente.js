/**
 * Expediente de un cliente: todo lo que el sistema sabe de una persona, reunido
 * para la ficha del panel máster.
 *
 * La idea es que quien atiende no tenga que cruzar cuatro pantallas para
 * responder "¿cuántas entradas le quedan?", "¿quién le descontó la última?" o
 * "¿por qué su pack tiene un ajuste?".
 */
import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { notFound } from '../lib/errors.js';
import * as users from './users.js';
import * as packsService from './packs.js';
import * as redemptions from './redemptions.js';
import * as sessions from './sessions.js';
import * as avisos from './avisos.js';

/** Acciones que ya aparecen como movimiento contable; no se repiten en la línea de tiempo. */
const ACCIONES_DUPLICADAS = [
  'entrada.consumida',
  'entrada.consumida_manual',
  'entrada.anulada',
  'pack.emitido',
  'pack.ajustado',
];

/**
 * Bitácora de todo lo que toca a este cliente: su cuenta, sus packs y sus
 * consumos, más lo que él mismo hizo (entrar, cambiar su contraseña).
 */
export function auditoria(userId, { limit = 50, offset = 0 } = {}) {
  const db = getDb();
  const filtro = `
    WHERE a.actor_id = @userId
       OR (a.entity_type = 'user'       AND a.entity_id = @userId)
       OR (a.entity_type = 'pack'       AND a.entity_id IN (SELECT id FROM packs       WHERE user_id = @userId))
       OR (a.entity_type = 'redemption' AND a.entity_id IN (SELECT id FROM redemptions WHERE user_id = @userId))`;

  const filas = db
    .prepare(
      `SELECT a.*, u.full_name AS actor_name
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
         ${filtro}
        ORDER BY a.created_at DESC, a.rowid DESC
        LIMIT @limit OFFSET @offset`,
    )
    .all({ userId, limit, offset });

  const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_log a ${filtro}`).get({ userId }).n;

  return {
    total,
    items: filas.map((f) => ({
      id: f.id,
      action: f.action,
      actorId: f.actor_id,
      actorName: f.actor_name,
      actorEmail: f.actor_email,
      entityType: f.entity_type,
      entityId: f.entity_id,
      metadata: f.metadata ? JSON.parse(f.metadata) : null,
      ip: f.ip,
      createdAt: f.created_at,
      /** Verdadero cuando fue el propio cliente quien hizo la acción. */
      porElCliente: f.actor_id === userId,
    })),
  };
}

/**
 * Línea de tiempo unificada: movimientos de entradas y eventos de la cuenta en
 * un único hilo cronológico, que es como una persona recuerda lo que pasó.
 */
export function lineaDeTiempo(userId, { limit = 60, offset = 0 } = {}) {
  const db = getDb();
  const marcadores = ACCIONES_DUPLICADAS.map((_, i) => `@accion${i}`).join(', ');
  const parametros = { userId, limit, offset };
  ACCIONES_DUPLICADAS.forEach((accion, i) => {
    parametros[`accion${i}`] = accion;
  });

  const union = `
    SELECT 'movimiento' AS tipo, m.id AS id, m.created_at AS created_at, m.reason AS clave,
           m.delta AS delta, m.balance_after AS balance_after, p.code AS pack_code,
           m.note AS nota, m.actor_id AS actor_id, m.redemption_id AS redemption_id,
           NULL AS metadata, NULL AS ip
      FROM pack_movements m JOIN packs p ON p.id = m.pack_id
     WHERE p.user_id = @userId
    UNION ALL
    SELECT 'cuenta', a.id, a.created_at, a.action,
           NULL, NULL, NULL,
           NULL, a.actor_id, NULL,
           a.metadata, a.ip
      FROM audit_log a
     WHERE (a.actor_id = @userId OR (a.entity_type = 'user' AND a.entity_id = @userId))
       AND a.action NOT IN (${marcadores})
    UNION ALL
    -- Lo que se le envió o se le escribió. Lo pendiente y lo descartado no es
    -- algo que le haya pasado a la persona, así que no entra en su historia.
    SELECT 'aviso', n.id, COALESCE(n.sent_at, n.updated_at), n.kind,
           NULL, NULL, p.code,
           NULL, n.actor_id, NULL,
           json_object('channel', n.channel, 'status', n.status, 'reason', n.reason), NULL
      FROM notifications n LEFT JOIN packs p ON p.id = n.pack_id
     WHERE n.user_id = @userId AND n.status IN ('sent', 'logged', 'failed')`;

  const filas = db
    .prepare(
      `SELECT e.*, u.full_name AS actor_name, r.method AS metodo, r.device_label AS puesto, r.status AS estado_consumo
         FROM (${union}) e
         LEFT JOIN users u       ON u.id = e.actor_id
         LEFT JOIN redemptions r ON r.id = e.redemption_id
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT @limit OFFSET @offset`,
    )
    .all(parametros);

  const total = db.prepare(`SELECT COUNT(*) AS n FROM (${union})`).get(parametros).n;

  return {
    total,
    items: filas.map((f) => ({
      tipo: f.tipo,
      id: f.id,
      clave: f.clave,
      createdAt: f.created_at,
      delta: f.delta,
      balanceAfter: f.balance_after,
      packCode: f.pack_code,
      nota: f.nota,
      actorId: f.actor_id,
      actorName: f.actor_name,
      redemptionId: f.redemption_id,
      metodo: f.metodo,
      puesto: f.puesto,
      estadoConsumo: f.estado_consumo,
      metadata: f.metadata ? JSON.parse(f.metadata) : null,
      ip: f.ip,
      porElCliente: f.actor_id === userId,
    })),
  };
}

/** Nombre del día de la semana en la zona horaria configurada. */
const formatoDia = new Intl.DateTimeFormat('es-EC', { timeZone: config.timezone, weekday: 'long' });
const formatoSemana = new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone }); // AAAA-MM-DD

/**
 * Hábitos del cliente: cuánto ha gastado, cada cuánto viene y qué días.
 * Los agrupamientos se hacen en JavaScript para respetar la zona horaria
 * configurada; SQLite no sabe de husos horarios.
 */
export function estadisticas(userId) {
  const db = getDb();

  const dinero = db
    .prepare(
      `SELECT IFNULL(SUM(price_cents), 0) AS gastado, COUNT(*) AS packs
         FROM packs WHERE user_id = ? AND status <> 'cancelled'`,
    )
    .get(userId);

  const visitas = db
    .prepare(
      `SELECT created_at FROM redemptions
        WHERE user_id = ? AND status = 'confirmed'
        ORDER BY created_at ASC`,
    )
    .all(userId)
    .map((f) => f.created_at);

  // Días de la semana, en orden de calendario y no de aparición.
  const dias = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const porDia = new Map(dias.map((d) => [d, 0]));
  const porSemana = new Map();

  for (const marca of visitas) {
    const fecha = new Date(marca);
    const dia = formatoDia.format(fecha).toLowerCase();
    if (porDia.has(dia)) porDia.set(dia, porDia.get(dia) + 1);

    // Lunes de esa semana, como clave del agrupamiento.
    const local = formatoSemana.format(fecha);
    const [anio, mes, diaMes] = local.split('-').map(Number);
    const referencia = new Date(Date.UTC(anio, mes - 1, diaMes));
    const desplazamiento = (referencia.getUTCDay() + 6) % 7; // 0 = lunes
    referencia.setUTCDate(referencia.getUTCDate() - desplazamiento);
    const clave = referencia.toISOString().slice(0, 10);
    porSemana.set(clave, (porSemana.get(clave) ?? 0) + 1);
  }

  // Serie de las últimas doce semanas, con los ceros incluidos.
  const semanas = [];
  const hoy = new Date();
  const hoyLocal = formatoSemana.format(hoy).split('-').map(Number);
  const lunesActual = new Date(Date.UTC(hoyLocal[0], hoyLocal[1] - 1, hoyLocal[2]));
  lunesActual.setUTCDate(lunesActual.getUTCDate() - ((lunesActual.getUTCDay() + 6) % 7));
  for (let i = 11; i >= 0; i -= 1) {
    const semana = new Date(lunesActual);
    semana.setUTCDate(semana.getUTCDate() - i * 7);
    const clave = semana.toISOString().slice(0, 10);
    semanas.push({ semana: clave, visitas: porSemana.get(clave) ?? 0 });
  }

  // Cada cuántos días vuelve, de media. Con menos de tres visitas no hay
  // patrón que promediar: dos fechas seguidas darían "viene a diario".
  let cadenciaDias = null;
  if (visitas.length >= 3) {
    const primera = Date.parse(visitas[0]);
    const ultima = Date.parse(visitas[visitas.length - 1]);
    cadenciaDias = Math.round(((ultima - primera) / (visitas.length - 1) / 86400000) * 10) / 10;
  }

  return {
    gastadoCents: dinero.gastado,
    packsComprados: dinero.packs,
    visitas: visitas.length,
    primeraVisita: visitas[0] ?? null,
    ultimaVisita: visitas[visitas.length - 1] ?? null,
    diasDesdeUltimaVisita: visitas.length
      ? Math.floor((Date.now() - Date.parse(visitas[visitas.length - 1])) / 86400000)
      : null,
    cadenciaDias,
    porDiaSemana: dias.map((dia) => ({ dia, visitas: porDia.get(dia) })),
    porSemana: semanas,
  };
}

/** Todo el expediente de un cliente, en una sola respuesta. */
export function expediente(userId) {
  const usuario = users.findById(userId);
  if (!usuario) throw notFound('Usuario no encontrado.');

  return {
    user: users.toPublicUser(usuario),
    summary: packsService.summaryForUser(userId),
    stats: estadisticas(userId),
    // Se pasa el dueño para que, con la cuenta suspendida, sus packs aparezcan
    // como inutilizables: es lo que el panel promete al suspender a alguien.
    packs: packsService.listPacksForUser(userId, { owner: usuario }),
    redemptions: redemptions.listRedemptions({ userId, limit: 30 }),
    timeline: lineaDeTiempo(userId, { limit: 40 }),
    audit: auditoria(userId, { limit: 30 }),
    sessions: sessions.listForUser(userId).map((fila) => sessions.toPublicSession(fila)),
    // Para escribirle por WhatsApp desde la cabecera de la ficha.
    whatsappUrl: avisos.enlaceDeWhatsapp(usuario.phone, avisos.leerAjustes().whatsappCountryCode),
    currency: config.currency,
  };
}
