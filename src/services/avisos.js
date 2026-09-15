/**
 * Avisos a clientes: comprobantes de compra, recordatorios por correo y la
 * lista de clientes por recuperar.
 *
 * El diseño completo, con el porqué de cada decisión, está en
 * docs/superpowers/specs/2026-09-14-avisos-y-clientes-por-recuperar-design.md.
 * Lo esencial:
 *
 *  - Nada sale hasta que el máster lo activa desde el panel.
 *  - Cada aviso automático tiene una clave única: nunca se crea dos veces.
 *  - Justo antes de enviarlo se vuelve a comprobar, y si la situación cambió
 *    (compró otro pack, le devolvieron una entrada) se descarta con su motivo.
 *  - Los recordatorios respetan el horario de envío, la baja y un espaciado
 *    mínimo por persona. El comprobante de compra sale en el acto.
 */
import crypto from 'node:crypto';
import { getDb, inTransaction } from '../db/index.js';
import { config } from '../config.js';
import { newId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { correoDisponible, enviarCorreo } from '../lib/correo.js';
import * as fechas from '../lib/fechas.js';
import { hub, channels } from '../lib/events.js';
import * as mensajes from './mensajesDeAvisos.js';
import * as audit from './audit.js';

export const TIPOS = Object.freeze(['purchase', 'low_balance', 'depleted', 'expiring', 'inactive']);

/** Los que son recordatorios: respetan la baja, el horario y el espaciado. */
const RECORDATORIOS = new Set(['low_balance', 'depleted', 'expiring', 'inactive']);

const CLAVE_AJUSTES = 'notifications';
const MINUTO_MS = 60_000;
const HORA_MS = 60 * MINUTO_MS;
const DIA_MS = 24 * HORA_MS;

/** Una compra o un consumo más antiguos que esto ya no merecen aviso. */
const VENTANA_DE_HECHOS_MS = 48 * HORA_MS;
/** Separación mínima entre dos recordatorios o contactos a la misma persona. */
const ESPACIADO_MS = 48 * HORA_MS;
/** Un aviso que no pudo salir en una semana ya no tiene sentido. */
const CADUCIDAD_MS = 7 * DIA_MS;
/** Un envío que quedó a medias porque el proceso se cayó vuelve a la cola. */
const ENVIO_COLGADO_MS = 15 * MINUTO_MS;
/** Espera tras cada fallo. Con los tres agotados, el aviso queda como fallido. */
const REINTENTOS_MS = [5 * MINUTO_MS, 30 * MINUTO_MS, 2 * HORA_MS];
/** Correos por ciclo: los proveedores cortan a quien manda ráfagas. */
const LOTE = 20;
/** Días que se guarda un aviso descartado antes de borrarlo. */
const DIAS_DE_CONSERVACION = 90;

/** Quien se quedó sin entradas en este plazo sigue siendo recuperable. */
const DIAS_SIN_ENTRADAS_RECUPERABLE = 60;
/** Un contacto más reciente que esto manda al cliente al final de la lista. */
const DIAS_CONTACTO_RECIENTE = 7;
const MAXIMO_POR_GRUPO = 50;

const iso = (instante) => new Date(instante).toISOString();

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

export const AJUSTES_PREDETERMINADOS = Object.freeze({
  enabled: false,
  /** Desde cuándo están activos, para decirlo en el panel. */
  enabledAt: null,
  kinds: Object.freeze(Object.fromEntries(TIPOS.map((tipo) => [tipo, true]))),
  /**
   * Desde cuándo está encendido cada tipo. Lo que pasó antes (una venta, un
   * consumo) no genera ese aviso: encender un tipo no escribe por el pasado,
   * tampoco si solo se había apagado ese.
   */
  kindsEnabledAt: Object.freeze({}),
  lowBalanceThreshold: 2,
  daysBeforeExpiry: 7,
  inactiveDays: 30,
  sendFromHour: 9,
  sendUntilHour: 20,
  whatsappCountryCode: '593',
});

export function leerAjustes(db = getDb()) {
  const fila = db.prepare('SELECT value FROM settings WHERE key = ?').get(CLAVE_AJUSTES);
  let guardados = {};
  if (fila) {
    try {
      guardados = JSON.parse(fila.value) ?? {};
    } catch (error) {
      logger.error('Los ajustes de avisos guardados no se pueden leer; se usan los predeterminados', {
        message: error.message,
      });
    }
  }
  // Solo las claves conocidas: un valor viejo o ajeno no debe llegar a la interfaz.
  const ajustes = { kinds: { ...AJUSTES_PREDETERMINADOS.kinds } };
  for (const [clave, valor] of Object.entries(AJUSTES_PREDETERMINADOS)) {
    if (clave !== 'kinds') ajustes[clave] = guardados[clave] ?? valor;
  }
  for (const tipo of TIPOS) {
    if (typeof guardados.kinds?.[tipo] === 'boolean') ajustes.kinds[tipo] = guardados.kinds[tipo];
  }
  return ajustes;
}

/** Ajustes más lo que el panel necesita saber de la instalación. */
export function estado(db = getDb()) {
  return {
    ...leerAjustes(db),
    emailConfigured: correoDisponible(),
    publicUrlConfigured: Boolean(config.publicUrl),
    timezone: config.timezone,
  };
}

/** ¿Tiene sentido ofrecer al cliente el interruptor de recordatorios? */
export function recordatoriosDisponibles() {
  return correoDisponible() && leerAjustes().enabled;
}

export function guardarAjustes(cambios, { actor = null, ip = null, userAgent = null, now = Date.now() } = {}) {
  const db = getDb();
  const ahoraIso = iso(now);

  inTransaction(() => {
    const antes = leerAjustes(db);
    const despues = { ...antes, ...cambios, kinds: { ...antes.kinds, ...(cambios.kinds ?? {}) } };

    if (despues.sendFromHour >= despues.sendUntilHour) {
      throw badRequest(
        'La hora de fin del envío tiene que ser posterior a la de inicio.',
        { fields: { sendUntilHour: 'Tiene que ser posterior a la hora de inicio.' } },
        'horario_invalido',
      );
    }
    if (despues.enabled && !antes.enabled) {
      if (!correoDisponible()) {
        throw conflict(
          'No hay correo configurado, así que los avisos no podrían salir. Configura el envío de correo (ver README) y vuelve a intentarlo.',
          'correo_no_configurado',
        );
      }
      despues.enabledAt = ahoraIso;
    }
    // Encender algo no escribe por lo que pasó mientras estaba apagado.
    despues.kindsEnabledAt = { ...antes.kindsEnabledAt };
    for (const tipo of TIPOS) {
      const encendidoAhora = despues.enabled && despues.kinds[tipo];
      const encendidoAntes = antes.enabled && antes.kinds[tipo];
      if (encendidoAhora && !encendidoAntes) despues.kindsEnabledAt[tipo] = ahoraIso;
    }

    db.prepare(
      `INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(CLAVE_AJUSTES, JSON.stringify(despues), actor?.id ?? null, ahoraIso);

    // Lo que ya no se va a enviar no se queda esperando en la cola.
    const descartar = db.prepare(
      `UPDATE notifications SET status = 'discarded', reason = ?, next_attempt_at = NULL, updated_at = ?
        WHERE status = 'pending' AND channel = 'email' AND (? OR kind = ?)`,
    );
    if (!despues.enabled) descartar.run('avisos_apagados', ahoraIso, 1, '');
    for (const tipo of TIPOS) {
      if (!despues.kinds[tipo]) descartar.run('tipo_apagado', ahoraIso, 0, tipo);
    }

    // Con otro horario, lo que esperaba a la hora de inicio anterior se vuelve
    // a mirar en el próximo ciclo, que lo aplaza de nuevo si hace falta. Los
    // reintentos de un fallo conservan su espera.
    if (despues.sendFromHour !== antes.sendFromHour || despues.sendUntilHour !== antes.sendUntilHour) {
      db.prepare(
        `UPDATE notifications SET next_attempt_at = ?, updated_at = ?
          WHERE status = 'pending' AND attempts = 0 AND next_attempt_at > ?`,
      ).run(ahoraIso, ahoraIso, ahoraIso);
    }

    audit.record({
      actor,
      action: 'avisos.ajustes_cambiados',
      entityType: 'settings',
      entityId: CLAVE_AJUSTES,
      metadata: { cambios },
      ip,
      userAgent,
      db,
    });
  });

  hub.publish([channels.admin], 'avisos.actualizados', { motivo: 'ajustes' });
  return estado(db);
}

// ---------------------------------------------------------------------------
// Baja de los recordatorios
// ---------------------------------------------------------------------------

function firmaDeBaja(userId) {
  return crypto.createHmac('sha256', config.secrets.refreshToken).update(`recordatorios-baja:${userId}`).digest('base64url');
}

/** Token del enlace de baja. Solo sirve para cambiar esa preferencia. */
export function tokenDeBaja(userId) {
  return `${userId}.${firmaDeBaja(userId)}`;
}

/** Usuario al que pertenece un token de baja, o `null` si no es auténtico. */
export function usuarioDelToken(token) {
  if (typeof token !== 'string' || token.length > 200) return null;
  const punto = token.lastIndexOf('.');
  if (punto <= 0) return null;
  const userId = token.slice(0, punto);
  const recibida = Buffer.from(token.slice(punto + 1));
  const esperada = Buffer.from(firmaDeBaja(userId));
  if (recibida.length !== esperada.length || !crypto.timingSafeEqual(recibida, esperada)) return null;
  return userId;
}

/**
 * Enlace de la página de baja. El token va en el fragmento: no llega a los
 * registros del proxy ni a la cabecera Referer.
 */
export function enlaceDeBaja(userId) {
  return config.publicUrl ? `${config.publicUrl}/recordatorios#t=${tokenDeBaja(userId)}` : null;
}

/**
 * Cabeceras de la baja de un clic (RFC 8058). El proveedor de correo hace un
 * POST a esa dirección sin abrir ninguna página, así que el token tiene que ir
 * en ella.
 */
function cabecerasDeBaja(userId) {
  if (!config.publicUrl) return undefined;
  return {
    'List-Unsubscribe': `<${config.publicUrl}/api/notifications/unsubscribe?t=${encodeURIComponent(tokenDeBaja(userId))}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

const enlaceApp = () => (config.publicUrl ? `${config.publicUrl}/app` : null);

/**
 * Activa o desactiva los recordatorios de una persona.
 * @param {'cuenta'|'enlace'|'administracion'} via desde dónde se cambió
 */
export function cambiarPreferencia(userId, activar, { via, actor = null, ip = null, userAgent = null, now = Date.now() }) {
  const db = getDb();
  return inTransaction(() => {
    const usuario = db.prepare('SELECT id, email_reminders FROM users WHERE id = ?').get(userId);
    if (!usuario) throw notFound('Usuario no encontrado.');
    if (Boolean(usuario.email_reminders) === activar) return { changed: false, emailReminders: activar };

    const ahoraIso = iso(now);
    db.prepare('UPDATE users SET email_reminders = ?, email_reminders_changed_at = ?, updated_at = ? WHERE id = ?').run(
      activar ? 1 : 0,
      ahoraIso,
      ahoraIso,
      userId,
    );
    if (!activar) {
      db.prepare(
        `UPDATE notifications SET status = 'discarded', reason = 'baja', next_attempt_at = NULL, updated_at = ?
          WHERE user_id = ? AND status = 'pending' AND kind <> 'purchase'`,
      ).run(ahoraIso, userId);
    }
    audit.record({
      actor,
      action: activar ? 'recordatorios.activados' : 'recordatorios.desactivados',
      entityType: 'user',
      entityId: userId,
      metadata: { via },
      ip,
      userAgent,
      db,
    });
    return { changed: true, emailReminders: activar };
  });
}

// ---------------------------------------------------------------------------
// Estado de un cliente
// ---------------------------------------------------------------------------

function saldoUsable(db, userId, ahoraIso) {
  return db
    .prepare(
      `SELECT IFNULL(SUM(remaining), 0) AS n FROM packs
        WHERE user_id = ? AND status = 'active' AND remaining > 0 AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .get(userId, ahoraIso).n;
}

/**
 * El «ciclo» de compra es el último pack del cliente: una compra nueva abre
 * uno y permite volver a avisar cuando esas entradas se acaben.
 */
function cicloDeCompra(db, userId) {
  return db.prepare('SELECT id FROM packs WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(userId)?.id ?? null;
}

/** Última visita o última compra, lo que sea más reciente: quien acaba de comprar no está inactivo. */
const SQL_ULTIMA_ACTIVIDAD = `
  MAX(IFNULL((SELECT MAX(r.created_at) FROM redemptions r WHERE r.user_id = u.id AND r.status = 'confirmed'), ''),
      IFNULL((SELECT MAX(p.created_at) FROM packs p WHERE p.user_id = u.id), ''))`;

function ultimaActividad(db, userId) {
  return db.prepare(`SELECT ${SQL_ULTIMA_ACTIVIDAD} AS at FROM users u WHERE u.id = ?`).get(userId)?.at || null;
}

/** Cuándo se le recordó algo por última vez, por correo o a mano. */
function ultimoRecordatorio(db, userId, excluirId) {
  return (
    db
      .prepare(
        `SELECT MAX(sent_at) AS at FROM notifications
          WHERE user_id = ? AND id <> ? AND kind <> 'purchase' AND status IN ('sent', 'logged')`,
      )
      .get(userId, excluirId).at ?? null
  );
}

// ---------------------------------------------------------------------------
// Detección
// ---------------------------------------------------------------------------

/**
 * Crea los avisos que corresponden al estado actual. Es idempotente: la clave
 * única hace que volver a detectar lo mismo no cree nada.
 * @returns {number} avisos nuevos
 */
export function detectar({ now = Date.now() } = {}) {
  const db = getDb();
  const ajustes = leerAjustes(db);
  if (!ajustes.enabled || !correoDisponible()) return 0;

  const ahoraIso = iso(now);
  /** Desde cuándo un hecho merece este aviso: reciente, y posterior a encenderlo. */
  const desdeHechos = (tipo) =>
    iso(Math.max(now - VENTANA_DE_HECHOS_MS, Date.parse(ajustes.kindsEnabledAt[tipo] ?? ajustes.enabledAt ?? ahoraIso)));
  const insertar = db.prepare(
    `INSERT INTO notifications (id, user_id, pack_id, kind, channel, dedupe_key, status, next_attempt_at, data, created_at, updated_at)
     VALUES (@id, @userId, @packId, @kind, 'email', @clave, 'pending', @ahora, @data, @ahora, @ahora)
     ON CONFLICT(dedupe_key) DO NOTHING`,
  );
  let creados = 0;
  const crear = (kind, userId, packId, clave, datos = null) => {
    creados += insertar.run({
      id: newId(),
      userId,
      packId,
      kind,
      clave,
      data: datos ? JSON.stringify(datos) : null,
      ahora: ahoraIso,
    }).changes;
  };

  inTransaction(() => {
    if (ajustes.kinds.purchase) {
      const vendidos = db
        .prepare(
          `SELECT p.id, p.user_id FROM packs p JOIN users u ON u.id = p.user_id
            WHERE p.created_at >= ? AND p.status <> 'cancelled' AND u.status = 'active'`,
        )
        .all(desdeHechos('purchase'));
      for (const pack of vendidos) crear('purchase', pack.user_id, pack.id, `purchase:${pack.id}`);
    }

    if (ajustes.kinds.low_balance || ajustes.kinds.depleted) {
      const desdePocas = desdeHechos('low_balance');
      const desdeSinEntradas = desdeHechos('depleted');
      const conConsumo = db
        .prepare(
          `SELECT p.user_id, MAX(m.created_at) AS ultimo FROM pack_movements m
             JOIN packs p ON p.id = m.pack_id
             JOIN users u ON u.id = p.user_id
            WHERE m.reason = 'redeem' AND m.created_at >= ? AND u.status = 'active' AND u.email_reminders = 1
            GROUP BY p.user_id`,
        )
        .all(desdePocas < desdeSinEntradas ? desdePocas : desdeSinEntradas);
      for (const { user_id: userId, ultimo } of conConsumo) {
        const saldo = saldoUsable(db, userId, ahoraIso);
        const ciclo = cicloDeCompra(db, userId);
        if (saldo === 0) {
          if (ajustes.kinds.depleted && ultimo >= desdeSinEntradas) {
            crear('depleted', userId, null, `depleted:${userId}:${ciclo}`, { cycle: ciclo });
          }
        } else if (saldo <= ajustes.lowBalanceThreshold && ajustes.kinds.low_balance && ultimo >= desdePocas) {
          crear('low_balance', userId, null, `low_balance:${userId}:${ciclo}`, { cycle: ciclo, balance: saldo });
        }
      }
    }

    if (ajustes.kinds.expiring) {
      const porVencer = db
        .prepare(
          `SELECT p.id, p.user_id, p.expires_at, p.remaining FROM packs p JOIN users u ON u.id = p.user_id
            WHERE p.status = 'active' AND p.remaining > 0 AND p.expires_at > ? AND p.expires_at <= ?
              AND u.status = 'active' AND u.email_reminders = 1`,
        )
        .all(ahoraIso, iso(now + ajustes.daysBeforeExpiry * DIA_MS));
      for (const pack of porVencer) {
        // La fecha va en la clave: si se amplía el vencimiento, se podrá avisar
        // de nuevo cuando se acerque la fecha nueva.
        crear('expiring', pack.user_id, pack.id, `expiring:${pack.id}:${pack.expires_at}`, {
          expiresAt: pack.expires_at,
          remaining: pack.remaining,
        });
      }
    }

    if (ajustes.kinds.inactive) {
      const inactivos = db
        .prepare(
          `SELECT id, actividad FROM (
             SELECT u.id, ${SQL_ULTIMA_ACTIVIDAD} AS actividad
               FROM users u
              WHERE u.status = 'active' AND u.email_reminders = 1
                AND EXISTS (SELECT 1 FROM packs p WHERE p.user_id = u.id AND p.status = 'active' AND p.remaining > 0
                              AND (p.expires_at IS NULL OR p.expires_at > @ahora))
           ) WHERE actividad <> '' AND actividad <= @limite`,
        )
        .all({ ahora: ahoraIso, limite: iso(now - ajustes.inactiveDays * DIA_MS) });
      for (const fila of inactivos) {
        crear('inactive', fila.id, null, `inactive:${fila.id}:${fila.actividad}`, { lastActivity: fila.actividad });
      }
    }
  });

  return creados;
}

// ---------------------------------------------------------------------------
// Despacho
// ---------------------------------------------------------------------------

/**
 * Primer instante del horario de envío a partir de `now`, o `null` si ya
 * estamos dentro. Las horas son las de la pista, no las del servidor.
 */
export function siguienteHoraDeEnvio(now, { sendFromHour, sendUntilHour }, zona = config.timezone) {
  const instante = new Date(now);
  const hora = fechas.horaLocal(instante, zona);
  if (hora >= sendFromHour && hora < sendUntilHour) return null;
  const hoy = fechas.diaLocal(instante, zona);
  const dia = hora < sendFromHour ? hoy : fechas.siguienteDia(hoy);
  return new Date(fechas.inicioDelDia(dia, zona).getTime() + sendFromHour * HORA_MS);
}

const no = (motivo) => ({ ok: false, motivo });
const si = (contexto) => ({ ok: true, contexto });

/**
 * ¿Sigue teniendo sentido este aviso ahora mismo? Devuelve lo que la plantilla
 * necesita, leído en este momento y no cuando se detectó.
 */
function revalidar(db, fila, ajustes, now) {
  const ahoraIso = iso(now);
  const usuario = db.prepare('SELECT * FROM users WHERE id = ?').get(fila.user_id);
  if (!usuario || usuario.status !== 'active') return no('cuenta_suspendida');
  if (!ajustes.kinds[fila.kind]) return no('tipo_apagado');
  if (RECORDATORIOS.has(fila.kind) && !usuario.email_reminders) return no('baja');

  const datos = fila.data ? JSON.parse(fila.data) : {};
  const pack = fila.pack_id ? db.prepare('SELECT * FROM packs WHERE id = ?').get(fila.pack_id) : null;
  const saldo = saldoUsable(db, usuario.id, ahoraIso);

  switch (fila.kind) {
    case 'purchase':
      if (!pack || pack.status === 'cancelled') return no('pack_anulado');
      return si({ usuario, pack, saldo });

    case 'low_balance':
      if (cicloDeCompra(db, usuario.id) !== datos.cycle || saldo < 1 || saldo > ajustes.lowBalanceThreshold) {
        return no('ya_no_aplica');
      }
      return si({ usuario, saldo });

    case 'depleted':
      if (cicloDeCompra(db, usuario.id) !== datos.cycle || saldo !== 0) return no('ya_no_aplica');
      return si({ usuario });

    case 'expiring':
      if (!pack || pack.status !== 'active' || pack.remaining < 1 || pack.expires_at !== datos.expiresAt || pack.expires_at <= ahoraIso) {
        return no('ya_no_aplica');
      }
      return si({ usuario, pack });

    case 'inactive': {
      const actividad = ultimaActividad(db, usuario.id);
      if (saldo < 1 || actividad !== datos.lastActivity) return no('ya_no_aplica');
      // Si después de su última visita ya se le recordó algo (que el pack
      // vence, o se le escribió a mano), otro correo solo sería insistir.
      const ultimo = ultimoRecordatorio(db, usuario.id, fila.id);
      if (ultimo && ultimo > actividad) return no('ya_recordado');
      const proximoVencimiento = db
        .prepare(
          `SELECT code, expires_at FROM packs
            WHERE user_id = ? AND status = 'active' AND remaining > 0 AND expires_at > ?
            ORDER BY expires_at ASC LIMIT 1`,
        )
        .get(usuario.id, ahoraIso);
      return si({
        usuario,
        saldo,
        dias: Math.floor((now - Date.parse(actividad)) / DIA_MS),
        proximoVencimiento: proximoVencimiento ?? null,
      });
    }

    default:
      return no('tipo_desconocido');
  }
}

/**
 * Envía lo que toca de la cola.
 * @param {{now?: number, enviar?: Function, lote?: number}} opciones `enviar`
 *   se puede sustituir en las pruebas para simular un servidor de correo caído.
 */
export async function despachar({ now = Date.now(), enviar = enviarCorreo, lote = LOTE } = {}) {
  const db = getDb();
  const ajustes = leerAjustes(db);
  const ahoraIso = iso(now);
  const resultado = { enviados: 0, fallidos: 0, descartados: 0, aplazados: 0 };

  const marcar = db.prepare(
    `UPDATE notifications SET status = @status, reason = @reason, next_attempt_at = @siguiente,
            sent_at = COALESCE(@enviado, sent_at), updated_at = @ahora
      WHERE id = @id`,
  );
  const aplazar = (id, instante) =>
    db.prepare('UPDATE notifications SET next_attempt_at = ?, updated_at = ? WHERE id = ?').run(iso(instante), ahoraIso, id);

  db.prepare(
    `UPDATE notifications SET status = 'pending', updated_at = ?
      WHERE status = 'sending' AND updated_at <= ?`,
  ).run(ahoraIso, iso(now - ENVIO_COLGADO_MS));

  const descartarPendientes = db.prepare(
    `UPDATE notifications SET status = 'discarded', reason = ?, next_attempt_at = NULL, updated_at = ?
      WHERE status = 'pending' AND channel = 'email' AND created_at <= ?`,
  );
  if (!ajustes.enabled || !correoDisponible()) {
    resultado.descartados += descartarPendientes.run(ajustes.enabled ? 'sin_correo' : 'avisos_apagados', ahoraIso, ahoraIso).changes;
    return resultado;
  }
  resultado.descartados += descartarPendientes.run('caducado', ahoraIso, iso(now - CADUCIDAD_MS)).changes;

  const pendientes = db
    .prepare(
      `SELECT * FROM notifications
        WHERE status = 'pending' AND channel = 'email' AND next_attempt_at <= ?
        ORDER BY CASE kind WHEN 'purchase' THEN 0 WHEN 'depleted' THEN 1 WHEN 'low_balance' THEN 2
                           WHEN 'expiring' THEN 3 ELSE 4 END,
                 created_at ASC, rowid ASC
        LIMIT ?`,
    )
    .all(ahoraIso, lote);

  const horaDeEnvio = siguienteHoraDeEnvio(now, ajustes);

  for (const fila of pendientes) {
    const veredicto = revalidar(db, fila, ajustes, now);
    if (!veredicto.ok) {
      marcar.run({ id: fila.id, status: 'discarded', reason: veredicto.motivo, siguiente: null, enviado: null, ahora: ahoraIso });
      resultado.descartados += 1;
      continue;
    }

    const esRecordatorio = RECORDATORIOS.has(fila.kind);
    if (esRecordatorio) {
      if (horaDeEnvio) {
        aplazar(fila.id, horaDeEnvio);
        resultado.aplazados += 1;
        continue;
      }
      const ultimo = ultimoRecordatorio(db, fila.user_id, fila.id);
      if (ultimo && Date.parse(ultimo) + ESPACIADO_MS > now) {
        aplazar(fila.id, Date.parse(ultimo) + ESPACIADO_MS);
        resultado.aplazados += 1;
        continue;
      }
    }

    // La actualización condicional es la que decide: si otro ciclo se lo
    // llevó antes, este no lo envía.
    const tomado = db
      .prepare(`UPDATE notifications SET status = 'sending', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'pending'`)
      .run(ahoraIso, fila.id);
    if (tomado.changes !== 1) continue;
    const intento = fila.attempts + 1;

    try {
      await enviar(
        mensajes.correoDeAviso(fila.kind, {
          ...veredicto.contexto,
          now,
          enlaceApp: enlaceApp(),
          enlaceBaja: esRecordatorio ? enlaceDeBaja(fila.user_id) : null,
          cabeceras: esRecordatorio ? cabecerasDeBaja(fila.user_id) : undefined,
        }),
      );
      marcar.run({ id: fila.id, status: 'sent', reason: null, siguiente: null, enviado: ahoraIso, ahora: ahoraIso });
      resultado.enviados += 1;
    } catch (error) {
      const agotado = intento > REINTENTOS_MS.length;
      const motivo = String(error?.message || error).slice(0, 300);
      marcar.run({
        id: fila.id,
        status: agotado ? 'failed' : 'pending',
        reason: motivo,
        siguiente: agotado ? null : iso(now + REINTENTOS_MS[intento - 1]),
        enviado: null,
        ahora: ahoraIso,
      });
      if (agotado) resultado.fallidos += 1;
      logger.warn('No se pudo enviar un aviso', { id: fila.id, tipo: fila.kind, intento, message: motivo });
    }
  }

  return resultado;
}

// ---------------------------------------------------------------------------
// Ciclo
// ---------------------------------------------------------------------------

async function unaVuelta({ now = Date.now(), enviar } = {}) {
  const creados = detectar({ now });
  const resultado = await despachar({ now, enviar });
  const total = { creados, ...resultado };
  if (creados || resultado.enviados || resultado.fallidos || resultado.descartados) {
    hub.publish([channels.admin], 'avisos.actualizados', total);
  }
  return total;
}

let enCurso = null;
let siguiente = null;

/**
 * Detecta y envía. Nunca corren dos vueltas a la vez: si se pide otra mientras
 * una trabaja, se hace una sola más cuando termine, por muchas veces que se pida.
 */
export function ciclo(opciones = {}) {
  if (!enCurso) {
    enCurso = unaVuelta(opciones).finally(() => {
      enCurso = null;
    });
    return enCurso;
  }
  siguiente ??= enCurso
    .catch(() => {})
    .then(() => {
      siguiente = null;
      return ciclo(opciones);
    });
  return siguiente;
}

let intervalo = null;
let suscripcion = null;
let temporizador = null;

/**
 * Pone a trabajar los avisos: una vuelta por minuto y otra pocos segundos
 * después de una venta o un consumo, para que el comprobante llegue mientras la
 * persona sigue en el mostrador.
 * @returns {Function} para detenerlos
 */
export function iniciar({ cadaMs = MINUTO_MS, esperaTrasEventoMs = 5_000 } = {}) {
  if (intervalo) return detener;
  const lanzar = () => {
    temporizador = null;
    ciclo().catch((error) => logger.error('Falló el ciclo de avisos', { message: error.message }));
  };
  intervalo = setInterval(lanzar, cadaMs);
  intervalo.unref();

  const interesantes = new Set(['pack.emitido', 'entrada.consumida']);
  suscripcion = hub.subscribe([channels.admin], (evento) => {
    // Si ya hay una vuelta programada, se deja: en una puerta con cola, un
    // temporizador que se reiniciara con cada escaneo no llegaría nunca.
    if (!interesantes.has(evento.type) || temporizador) return;
    temporizador = setTimeout(lanzar, esperaTrasEventoMs);
    temporizador.unref();
  });
  return detener;
}

export function detener() {
  clearInterval(intervalo);
  clearTimeout(temporizador);
  suscripcion?.();
  intervalo = null;
  temporizador = null;
  suscripcion = null;
}

/** Borra los avisos descartados hace tiempo; lo enviado se conserva como historial. */
export function purgar(now = Date.now()) {
  return getDb()
    .prepare(`DELETE FROM notifications WHERE status = 'discarded' AND updated_at <= ?`)
    .run(iso(now - DIAS_DE_CONSERVACION * DIA_MS)).changes;
}

// ---------------------------------------------------------------------------
// Acciones del panel
// ---------------------------------------------------------------------------

function mapear(fila) {
  return {
    id: fila.id,
    userId: fila.user_id,
    customerName: fila.customer_name ?? null,
    kind: fila.kind,
    channel: fila.channel,
    status: fila.status,
    reason: fila.reason,
    attempts: fila.attempts,
    packCode: fila.pack_code ?? null,
    actorName: fila.actor_name ?? null,
    createdAt: fila.created_at,
    sentAt: fila.sent_at,
    nextAttemptAt: fila.next_attempt_at,
  };
}

const SQL_LISTADO = `
  SELECT n.*, u.full_name AS customer_name, p.code AS pack_code, a.full_name AS actor_name
    FROM notifications n
    JOIN users u      ON u.id = n.user_id
    LEFT JOIN packs p ON p.id = n.pack_id
    LEFT JOIN users a ON a.id = n.actor_id`;

/** Historial de avisos y contactos, del más reciente al más antiguo. */
export function listar({ limit = 50, offset = 0, status = null, userId = null } = {}) {
  const db = getDb();
  const where = [];
  const parametros = { limit, offset };
  if (status) {
    where.push('n.status = @status');
    parametros.status = status;
  }
  if (userId) {
    where.push('n.user_id = @userId');
    parametros.userId = userId;
  }
  const clausula = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const filas = db
    .prepare(`${SQL_LISTADO} ${clausula} ORDER BY COALESCE(n.sent_at, n.created_at) DESC, n.rowid DESC LIMIT @limit OFFSET @offset`)
    .all(parametros);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM notifications n ${clausula}`).get(parametros).n;
  return { total, items: filas.map(mapear) };
}

/** Deja constancia de que alguien escribió o llamó a un cliente. */
export function registrarContacto({ userId, channel, kind, actor, now = Date.now() }) {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) throw notFound('Usuario no encontrado.');
  const id = newId();
  const ahoraIso = iso(now);
  db.prepare(
    `INSERT INTO notifications (id, user_id, kind, channel, status, sent_at, actor_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'logged', ?, ?, ?, ?)`,
  ).run(id, userId, kind, channel, ahoraIso, actor?.id ?? null, ahoraIso, ahoraIso);
  hub.publish([channels.admin], 'avisos.actualizados', { motivo: 'contacto' });
  return mapear(db.prepare(`${SQL_LISTADO} WHERE n.id = ?`).get(id));
}

/**
 * Vuelve a poner en la cola un aviso que agotó sus intentos. Cuenta como uno
 * recién creado —también para la caducidad de una semana—, porque es alguien
 * del panel quien decide ahora que todavía tiene sentido enviarlo. Antes de
 * salir se revalida como cualquier otro.
 */
export function reintentar(id, { now = Date.now() } = {}) {
  const db = getDb();
  const ahoraIso = iso(now);
  const cambio = db
    .prepare(
      `UPDATE notifications SET status = 'pending', attempts = 0, reason = NULL, next_attempt_at = ?, created_at = ?, updated_at = ?
        WHERE id = ? AND status = 'failed'`,
    )
    .run(ahoraIso, ahoraIso, ahoraIso, id);
  if (cambio.changes !== 1) {
    if (!db.prepare('SELECT 1 FROM notifications WHERE id = ?').get(id)) throw notFound('No existe ese aviso.');
    throw conflict('Solo se puede reintentar un aviso que falló.', 'aviso_no_fallido');
  }
  hub.publish([channels.admin], 'avisos.actualizados', { motivo: 'reintento' });
  return mapear(db.prepare(`${SQL_LISTADO} WHERE n.id = ?`).get(id));
}

/**
 * Manda al máster un ejemplo del aviso elegido, con datos ficticios, para ver
 * cómo lo recibirá un cliente antes de encender nada.
 */
export async function enviarPrueba({ kind, actor, ip = null, userAgent = null, now = Date.now() }) {
  if (!correoDisponible()) {
    throw conflict('No hay correo configurado, así que no se puede enviar la prueba.', 'correo_no_configurado');
  }
  const db = getDb();
  const usuario = db.prepare('SELECT * FROM users WHERE id = ?').get(actor.id);
  if (!usuario) throw notFound('Usuario no encontrado.');

  const catalogo = config.packCatalog.at(-1);
  const pack = {
    code: 'RHE-PRUE-BA26',
    size: catalogo.size,
    remaining: 2,
    price_cents: catalogo.priceCents,
    currency: config.currency,
    payment_method: 'efectivo',
    payment_reference: null,
    created_at: iso(now),
    expires_at: iso(now + 5 * DIA_MS),
  };
  const ajustes = leerAjustes(db);
  const mensaje = mensajes.correoDeAviso(kind, {
    usuario,
    pack,
    saldo: 2,
    dias: ajustes.inactiveDays + 4,
    proximoVencimiento: { code: pack.code, expires_at: pack.expires_at },
    now,
    enlaceApp: enlaceApp(),
    enlaceBaja: RECORDATORIOS.has(kind) ? enlaceDeBaja(usuario.id) : null,
  });
  try {
    await enviarCorreo({ ...mensaje, asunto: `[Prueba] ${mensaje.asunto}` });
  } catch (error) {
    // Quien pide la prueba es quien tiene que arreglar el correo: se le dice
    // qué respondió el servidor en vez de un error interno sin más.
    throw new AppError(502, 'correo_fallido', `No se pudo enviar la prueba: ${error.message}`);
  }

  audit.record({
    actor,
    action: 'avisos.prueba_enviada',
    entityType: 'settings',
    entityId: CLAVE_AJUSTES,
    metadata: { kind, para: usuario.email },
    ip,
    userAgent,
  });
  return { ok: true, to: usuario.email };
}

// ---------------------------------------------------------------------------
// Clientes por recuperar
// ---------------------------------------------------------------------------

/**
 * Número para abrir WhatsApp: solo dígitos y con el prefijo del país.
 * `0991112233` → `593991112233`; `+593 99 111 2233` se respeta tal cual.
 */
export function numeroDeWhatsapp(telefono, prefijo = AJUSTES_PREDETERMINADOS.whatsappCountryCode) {
  const bruto = String(telefono ?? '').trim();
  if (!bruto) return null;
  let digitos = bruto.replace(/\D/g, '');
  if (bruto.startsWith('+')) {
    /* ya lleva el país */
  } else if (digitos.startsWith('00')) {
    digitos = digitos.slice(2);
  } else if (digitos.startsWith('0')) {
    digitos = prefijo + digitos.slice(1);
  } else if (digitos.length <= 10) {
    digitos = prefijo + digitos;
  }
  return digitos.length >= 8 && digitos.length <= 15 ? digitos : null;
}

export function enlaceDeWhatsapp(telefono, prefijo, texto = '') {
  const numero = numeroDeWhatsapp(telefono, prefijo);
  if (!numero) return null;
  return `https://wa.me/${numero}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
}

const GRUPOS = {
  expiring: 'expiring',
  depleted: 'depleted',
  inactive: 'inactive',
  lowBalance: 'low_balance',
};

/**
 * Clientes con los que conviene hablar, en cuatro grupos. Cada persona aparece
 * en uno solo, el más urgente: entradas pagadas por vencer, sin entradas,
 * sin venir hace tiempo, y con pocas entradas.
 */
export function oportunidades({ now = Date.now() } = {}) {
  const db = getDb();
  const ajustes = leerAjustes(db);
  const ahoraIso = iso(now);
  const limiteVence = iso(now + ajustes.daysBeforeExpiry * DIA_MS);
  const USABLE = `p.user_id = u.id AND p.status = 'active' AND p.remaining > 0`;
  const POR_VENCER = `${USABLE} AND p.expires_at > @ahora AND p.expires_at <= @limiteVence`;

  const filas = db
    .prepare(
      `SELECT u.id, u.full_name, u.email, u.phone, u.email_reminders,
              IFNULL((SELECT SUM(p.remaining) FROM packs p WHERE ${USABLE} AND (p.expires_at IS NULL OR p.expires_at > @ahora)), 0) AS saldo,
              IFNULL((SELECT SUM(p.remaining) FROM packs p WHERE ${POR_VENCER}), 0) AS por_vencer,
              (SELECT COUNT(*) FROM packs p WHERE ${POR_VENCER}) AS packs_por_vencer,
              (SELECT MIN(p.expires_at) FROM packs p WHERE ${POR_VENCER}) AS vence,
              (SELECT MAX(r.created_at) FROM redemptions r WHERE r.user_id = u.id AND r.status = 'confirmed') AS ultima_visita,
              (SELECT MAX(p.created_at) FROM packs p WHERE p.user_id = u.id) AS ultima_compra,
              (SELECT COUNT(*) FROM packs p WHERE p.user_id = u.id AND p.status <> 'cancelled') AS packs,
              (SELECT COUNT(*) FROM redemptions r WHERE r.user_id = u.id AND r.status = 'confirmed') AS visitas
         FROM users u
        WHERE u.status = 'active'
          AND EXISTS (SELECT 1 FROM packs p WHERE p.user_id = u.id AND p.status <> 'cancelled')`,
    )
    .all({ ahora: ahoraIso, limiteVence });

  // Último contacto de cada cliente en el mes, por correo o a mano. Van en
  // orden ascendente para que el más reciente sea el que quede en el mapa.
  const contactos = new Map();
  const filasDeContacto = db
    .prepare(
      `SELECT n.user_id, n.channel, n.kind, n.sent_at, a.full_name AS actor_name
         FROM notifications n LEFT JOIN users a ON a.id = n.actor_id
        WHERE n.status IN ('sent', 'logged') AND n.kind <> 'purchase' AND n.sent_at >= ?
        ORDER BY n.sent_at ASC`,
    )
    .all(iso(now - 30 * DIA_MS));
  for (const c of filasDeContacto) {
    contactos.set(c.user_id, { channel: c.channel, kind: c.kind, at: c.sent_at, actorName: c.actor_name });
  }

  const grupos = { expiring: [], depleted: [], inactive: [], lowBalance: [] };
  for (const f of filas) {
    const actividad = [f.ultima_visita, f.ultima_compra].filter(Boolean).sort().at(-1) ?? null;
    const diasSinActividad = actividad ? Math.floor((now - Date.parse(actividad)) / DIA_MS) : null;

    let grupo = null;
    if (f.por_vencer > 0) grupo = 'expiring';
    else if (f.saldo === 0) grupo = diasSinActividad !== null && diasSinActividad <= DIAS_SIN_ENTRADAS_RECUPERABLE ? 'depleted' : null;
    else if (diasSinActividad !== null && diasSinActividad >= ajustes.inactiveDays) grupo = 'inactive';
    else if (f.saldo <= ajustes.lowBalanceThreshold) grupo = 'lowBalance';
    if (!grupo) continue;

    const contacto = contactos.get(f.id) ?? null;
    const porVencer = f.por_vencer > 0 ? { tickets: f.por_vencer, packs: f.packs_por_vencer, expiresAt: f.vence } : null;
    const texto = mensajes.mensajeDeWhatsapp(GRUPOS[grupo], {
      usuario: f,
      saldo: f.saldo,
      porVencer,
      dias: diasSinActividad,
    });

    grupos[grupo].push({
      userId: f.id,
      fullName: f.full_name,
      email: f.email,
      phone: f.phone,
      emailReminders: Boolean(f.email_reminders),
      kind: GRUPOS[grupo],
      availableTickets: f.saldo,
      expiring: porVencer,
      lastVisitAt: f.ultima_visita,
      lastPurchaseAt: f.ultima_compra,
      daysSinceActivity: diasSinActividad,
      packs: f.packs,
      visits: f.visitas,
      whatsappUrl: enlaceDeWhatsapp(f.phone, ajustes.whatsappCountryCode, texto),
      lastContact: contacto,
      recentlyContacted: Boolean(contacto && now - Date.parse(contacto.at) < DIAS_CONTACTO_RECIENTE * DIA_MS),
    });
  }

  const orden = {
    expiring: (a, b) => a.expiring.expiresAt.localeCompare(b.expiring.expiresAt),
    depleted: (a, b) => (b.lastVisitAt ?? b.lastPurchaseAt ?? '').localeCompare(a.lastVisitAt ?? a.lastPurchaseAt ?? ''),
    inactive: (a, b) => b.availableTickets - a.availableTickets || b.daysSinceActivity - a.daysSinceActivity,
    lowBalance: (a, b) => (b.lastVisitAt ?? '').localeCompare(a.lastVisitAt ?? ''),
  };

  const salida = {};
  for (const [nombre, lista] of Object.entries(grupos)) {
    // Los contactados hace poco van al final: siguen a la vista, pero lo
    // primero que se ve es a quién nadie ha llamado todavía.
    lista.sort((a, b) => Number(a.recentlyContacted) - Number(b.recentlyContacted) || orden[nombre](a, b));
    salida[nombre] = { count: lista.length, items: lista.slice(0, MAXIMO_POR_GRUPO) };
  }

  return {
    thresholds: {
      lowBalanceThreshold: ajustes.lowBalanceThreshold,
      daysBeforeExpiry: ajustes.daysBeforeExpiry,
      inactiveDays: ajustes.inactiveDays,
      depletedDays: DIAS_SIN_ENTRADAS_RECUPERABLE,
    },
    totals: {
      customers: Object.values(grupos).reduce((suma, lista) => suma + lista.length, 0),
      // Entradas ya pagadas que se pueden perder o quedarse sin usar.
      ticketsAtStake:
        grupos.expiring.reduce((suma, c) => suma + c.expiring.tickets, 0) +
        grupos.inactive.reduce((suma, c) => suma + c.availableTickets, 0),
    },
    groups: salida,
  };
}

/** Cifras del último mes para la cabecera de la sección. */
export function metricas({ now = Date.now() } = {}) {
  const db = getDb();
  const desde = iso(now - 30 * DIA_MS);
  const fila = db
    .prepare(
      `SELECT
         IFNULL(SUM(CASE WHEN status = 'sent'   AND sent_at    >= @desde THEN 1 ELSE 0 END), 0) AS enviados,
         IFNULL(SUM(CASE WHEN status IN ('pending', 'sending')              THEN 1 ELSE 0 END), 0) AS pendientes,
         IFNULL(SUM(CASE WHEN status = 'failed' AND updated_at >= @desde THEN 1 ELSE 0 END), 0) AS fallidos,
         IFNULL(SUM(CASE WHEN status = 'logged' AND sent_at    >= @desde THEN 1 ELSE 0 END), 0) AS contactos
       FROM notifications`,
    )
    .get({ desde });
  const bajas = db.prepare('SELECT COUNT(*) AS n FROM users WHERE email_reminders = 0').get().n;
  return {
    sent: fila.enviados,
    pending: fila.pendientes,
    failed: fila.fallidos,
    contacts: fila.contactos,
    unsubscribed: bajas,
  };
}

/** Todo lo que pinta la sección de avisos, en una sola respuesta. */
export function resumen({ now = Date.now() } = {}) {
  return { status: estado(), metrics: metricas({ now }), opportunities: oportunidades({ now }) };
}
