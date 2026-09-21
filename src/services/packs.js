/**
 * Packs de entradas: emisión, consulta, ajustes y consumo.
 *
 * Regla central: `packs.remaining` es una proyección. La verdad contable está
 * en `pack_movements`, donde cada alta, consumo, anulación o ajuste queda como
 * un asiento con su saldo resultante. Eso permite auditar cualquier diferencia
 * y detectar corrupción (ver `checkIntegrity`).
 */
import crypto from 'node:crypto';
import { getDb, inTransaction } from '../db/index.js';
import { newId, newPackCode, randomHex, normalizePackCode } from '../lib/ids.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { buildQrPayload } from '../lib/qr.js';
import { config } from '../config.js';
import { patronLike } from '../lib/texto.js';
import { hub, channels } from '../lib/events.js';
import { logger } from '../lib/logger.js';
import { correoDisponible, enviarCorreo } from '../lib/correo.js';
import { boton, envolverHtml, escaparHtml, saludo } from '../lib/plantillaCorreo.js';
import * as audit from './audit.js';

const ACTIVE_STATUSES = new Set(['active']);

/** Proyección del pack para el cliente. Nunca expone `secret`. */
export function toPublicPack(row, { includeQr = false, owner = null } = {}) {
  if (!row) return null;
  // Las consultas administrativas traen el estado del dueño en la propia fila;
  // quien llama también puede pasarlo explícitamente. Así el indicador
  // "usable" nunca contradice al escáner cuando la cuenta está suspendida.
  const packOwner = owner ?? (row.owner_status !== undefined ? { status: row.owner_status } : null);
  const pack = {
    id: row.id,
    code: row.code,
    userId: row.user_id,
    size: row.size,
    remaining: row.remaining,
    // Las transferencias y los ajustes cambian el saldo, pero no son entradas
    // usadas. Cuando la fila viene de una consulta simple, las consultas de
    // packs añaden este agregado; se conserva el cálculo antiguo como respaldo
    // para filas construidas por integraciones internas.
    used: row.used_tickets ?? row.size - row.remaining,
    priceCents: row.price_cents,
    currency: row.currency,
    status: row.status,
    allowStaticQr: Boolean(row.allow_static_qr),
    expiresAt: row.expires_at,
    note: row.note,
    paymentMethod: row.payment_method,
    paymentReference: row.payment_reference,
    // De dónde salió el pack: vendido, recibido por transferencia o regalado
    // por el programa de fidelidad. La app lo usa para decir «cortesía» en vez
    // de mostrar un precio de cero.
    origin: row.origin ?? 'sale',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usable: isUsable(row, { owner: packOwner }).ok,
  };
  if (row.owner_name !== undefined) pack.ownerName = row.owner_name;
  if (row.owner_email !== undefined) pack.ownerEmail = row.owner_email;
  if (includeQr) {
    pack.qr = {
      payload: buildQrPayload(row),
      ttlSeconds: config.qr.ttlSeconds,
      refreshSeconds: config.qr.refreshSeconds,
      generatedAt: new Date().toISOString(),
    };
  }
  return pack;
}

/**
 * ¿Se puede consumir una entrada de este pack ahora mismo?
 *
 * `owner` es opcional porque no todas las vistas lo tienen a mano, pero cuando
 * se pasa manda: al suspender una cuenta el panel promete que esa persona «no
 * podrá entrar ni usar sus entradas», y eso incluye el pase impreso y el
 * ingreso manual por código, que no dependen de que ella inicie sesión.
 */
export function isUsable(pack, { now = Date.now(), owner = null } = {}) {
  if (!pack) return { ok: false, reason: 'no_encontrado', message: 'El pack no existe.' };
  if (owner && owner.status !== 'active') {
    return {
      ok: false,
      reason: 'cliente_suspendido',
      message: 'La cuenta de este cliente está suspendida. Pregunta en recepción.',
    };
  }
  if (pack.status === 'cancelled') return { ok: false, reason: 'cancelado', message: 'Este pack fue anulado.' };
  if (pack.status === 'suspended') return { ok: false, reason: 'suspendido', message: 'Este pack está suspendido. Pregunta en recepción.' };
  if (pack.expires_at && Date.parse(pack.expires_at) <= now) {
    return { ok: false, reason: 'expirado', message: 'Este pack venció.' };
  }
  if (pack.status === 'expired') return { ok: false, reason: 'expirado', message: 'Este pack venció.' };
  if (pack.remaining <= 0) return { ok: false, reason: 'sin_entradas', message: 'Este pack ya no tiene entradas disponibles.' };
  if (!ACTIVE_STATUSES.has(pack.status)) return { ok: false, reason: 'inactivo', message: 'Este pack no está activo.' };
  return { ok: true };
}

export function findById(id, db = getDb()) {
  return db
    .prepare(
      `SELECT p.*,
              IFNULL((SELECT SUM(r.quantity) FROM redemptions r
                       WHERE r.pack_id = p.id AND r.status = 'confirmed'), 0) AS used_tickets
         FROM packs p WHERE p.id = ?`,
    )
    .get(id) ?? null;
}

export function findByCode(code, db = getDb()) {
  return db
    .prepare(
      `SELECT p.*,
              IFNULL((SELECT SUM(r.quantity) FROM redemptions r
                       WHERE r.pack_id = p.id AND r.status = 'confirmed'), 0) AS used_tickets
         FROM packs p WHERE p.code = ?`,
    )
    .get(code) ?? null;
}

/** Busca por código tolerando errores de tipeo (minúsculas, sin guiones, etc.). */
export function findByLooseCode(input, db = getDb()) {
  const raw = String(input || '').trim().toUpperCase();
  const direct = findByCode(raw, db);
  if (direct) return direct;
  const normalized = normalizePackCode(raw);
  return normalized ? findByCode(normalized, db) : null;
}

/** Genera un código único de pack, reintentando ante una colisión improbable. */
function generateUniqueCode(db) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = newPackCode();
    if (!db.prepare('SELECT 1 FROM packs WHERE code = ?').get(code)) return code;
  }
      throw conflict('No se pudo generar un código único para el pack. Intenta de nuevo.', 'codigo_colision');
}

/**
 * Si un pack puede llevar fecha de vencimiento.
 *
 * Las entradas pagadas no caducan nunca: quien las compró ya puso el dinero y
 * la pista no se queda con él por no venir a tiempo. El vencimiento existe
 * solo para el premio de fidelidad, que nace con los días que fije el
 * programa, y para lo que se transfiera desde uno: si al pasarle un pack de
 * cortesía a otro piloto la fecha se perdiera, regalarlo sería justo la forma
 * de volverlo eterno. De ahí que baste con que la fecha ya esté puesta —solo
 * un pack de esa descendencia la tiene— para poder moverla.
 */
function puedeVencer(pack) {
  return pack.origin === 'loyalty' || Boolean(pack.expires_at);
}

/** Aviso único para los dos sitios donde se rechaza una fecha. */
const vencimientoNoAdmitido = () =>
  badRequest(
    'Las entradas pagadas no vencen; la fecha solo se admite en packs de cortesía.',
    { fields: { expiresAt: 'Solo los packs de cortesía vencen.' } },
    'vencimiento_no_admitido',
  );

/** Emite un pack nuevo para un cliente. */
export function issuePack({
  userId,
  size,
  priceCents = null,
  paymentMethod = null,
  paymentReference = null,
  note = null,
  /** Solo para `origin: 'loyalty'`: lo pagado no vence. */
  expiresAt = null,
  allowStaticQr = false,
  /** 'sale' lo normal; 'loyalty' un pack de cortesía del programa de fidelidad. */
  origin = 'sale',
  actor = null,
  ip = null,
  userAgent = null,
}) {
  const db = getDb();
  const owner = db.prepare('SELECT id, full_name, email, status FROM users WHERE id = ?').get(userId);
  if (!owner) throw notFound('El cliente indicado no existe.', 'cliente_no_encontrado');
  if (owner.status !== 'active') throw badRequest('La cuenta del cliente está suspendida.', null, 'cliente_suspendido');
  if (expiresAt && origin !== 'loyalty') throw vencimientoNoAdmitido();
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
    throw badRequest('La fecha de vencimiento debe ser futura.', { fields: { expiresAt: 'Debe ser futura.' } });
  }

  const catalogEntry = config.packCatalog.find((p) => p.size === size);
  const finalPrice = priceCents ?? catalogEntry?.priceCents ?? 0;
  const now = new Date().toISOString();

  const pack = inTransaction(() => {
    const row = {
      id: newId(),
      code: generateUniqueCode(db),
      user_id: userId,
      size,
      remaining: size,
      price_cents: finalPrice,
      currency: config.currency,
      secret: randomHex(32),
      status: 'active',
      allow_static_qr: allowStaticQr ? 1 : 0,
      expires_at: expiresAt || null,
      note: note || null,
      payment_method: paymentMethod || null,
      payment_reference: paymentReference || null,
      origin,
      created_by: actor?.id ?? null,
      created_at: now,
      updated_at: now,
    };
    db.prepare(
      `INSERT INTO packs (id, code, user_id, size, remaining, price_cents, currency, secret, status,
                          allow_static_qr, expires_at, note, payment_method, payment_reference,
                          origin, created_by, created_at, updated_at)
       VALUES (@id, @code, @user_id, @size, @remaining, @price_cents, @currency, @secret, @status,
               @allow_static_qr, @expires_at, @note, @payment_method, @payment_reference,
               @origin, @created_by, @created_at, @updated_at)`,
    ).run(row);

    db.prepare(
      `INSERT INTO pack_movements (id, pack_id, delta, balance_after, reason, actor_id, note, created_at)
       VALUES (?, ?, ?, ?, 'issue', ?, ?, ?)`,
    ).run(newId(), row.id, size, size, actor?.id ?? null, note || null, now);

    audit.record({
      actor,
      action: 'pack.emitido',
      entityType: 'pack',
      entityId: row.id,
      metadata: { code: row.code, size, userId, priceCents: finalPrice, paymentMethod, origin },
      ip,
      userAgent,
      db,
    });

    return findById(row.id, db);
  });

  const publicPack = toPublicPack(pack);
  hub.publish([channels.user(userId), channels.admin], 'pack.emitido', {
    pack: publicPack,
    owner: { id: owner.id, fullName: owner.full_name },
  });
  return publicPack;
}

/** Packs de un cliente, ordenados: primero los usables y los que vencen antes. */
export function listPacksForUser(userId, { includeQr = false, includeInactive = true, owner = null } = {}) {
  const db = getDb();
  expireDuePacks(db);
  const rows = db
    .prepare(
      `SELECT p.*,
              IFNULL((SELECT SUM(r.quantity) FROM redemptions r
                       WHERE r.pack_id = p.id AND r.status = 'confirmed'), 0) AS used_tickets
         FROM packs p
        WHERE p.user_id = ? ${includeInactive ? '' : "AND p.status = 'active' AND p.remaining > 0"}
        ORDER BY CASE WHEN p.status = 'active' AND p.remaining > 0 THEN 0 ELSE 1 END,
                 CASE WHEN p.expires_at IS NULL THEN 1 ELSE 0 END,
                 p.expires_at ASC,
                 p.created_at ASC`,
    )
    .all(userId);
  return rows.map((r) => {
    const usable = isUsable(r, { owner }).ok;
    return toPublicPack(r, { owner, includeQr: includeQr && usable });
  });
}

/** Resumen de saldo de un cliente. */
export function summaryForUser(userId) {
  const db = getDb();
  expireDuePacks(db);
  // La condición de vencimiento va en la consulta además de en el barrido: así
  // el saldo es correcto aunque el barrido todavía no haya marcado el pack.
  const row = db
    .prepare(
      `SELECT
         IFNULL(SUM(CASE WHEN usable THEN remaining ELSE 0 END), 0) AS disponibles,
         IFNULL(SUM(CASE WHEN usable THEN 1 ELSE 0 END), 0)         AS packs_activos,
         COUNT(*)                                                   AS packs_totales
       FROM (
         SELECT remaining,
                (status = 'active' AND remaining > 0
                 AND (expires_at IS NULL OR expires_at > @ahora)) AS usable
           FROM packs WHERE user_id = @userId
       )`,
    )
    .get({ userId, ahora: new Date().toISOString() });

  // "Usadas" son las veces que entró de verdad (sumando entradas individuales
  // o grupales), no la diferencia entre tamaño y saldo: una entrada de cortesía
  // agranda el pack y esa resta daría cero.
  const usadas = db
    .prepare("SELECT IFNULL(SUM(quantity), 0) AS n FROM redemptions WHERE user_id = ? AND status = 'confirmed'")
    .get(userId).n;

  // "Adquiridas" es lo que recibió el cliente: los asientos de emisión y las
  // entradas recibidas por transferencia.
  const adquiridas = db
    .prepare(
      `SELECT IFNULL(SUM(m.delta), 0) AS n
         FROM pack_movements m JOIN packs p ON p.id = m.pack_id
        WHERE p.user_id = ? AND m.reason IN ('issue', 'transfer_in')`,
    )
    .get(userId).n;

  // Entradas transferidas a otros clientes desde packs propios.
  const transferidas = db
    .prepare(
      `SELECT IFNULL(SUM(ABS(m.delta)), 0) AS n
         FROM pack_movements m JOIN packs p ON p.id = m.pack_id
        WHERE p.user_id = ? AND m.reason = 'transfer_out'`,
    )
    .get(userId).n;

  const nextExpiry = db
    .prepare(
      `SELECT expires_at FROM packs
        WHERE user_id = ? AND status = 'active' AND remaining > 0 AND expires_at IS NOT NULL
        ORDER BY expires_at ASC LIMIT 1`,
    )
    .get(userId);
  return {
    availableTickets: row.disponibles,
    activePacks: row.packs_activos,
    usedTickets: usadas,
    purchasedTickets: adquiridas,
    transferredTickets: transferidas,
    totalPacks: row.packs_totales,
    nextExpiryAt: nextExpiry?.expires_at ?? null,
  };
}

/**
 * Marca como vencidos los packs cuya fecha de expiración ya pasó.
 *
 * Se llama en cada lectura de saldo, así que primero comprueba con un SELECT si
 * hay algo que hacer: escribir en vacío obligaría a tomar el bloqueo de
 * escritura de SQLite en cada petición, y lo habitual es que no haya nada que
 * vencer.
 */
export function expireDuePacks(db = getDb()) {
  const now = new Date().toISOString();
  const hayVencidos = db
    .prepare(
      `SELECT 1 FROM packs
        WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?
        LIMIT 1`,
    )
    .get(now);
  if (!hayVencidos) return 0;

  const vencidos = db
    .prepare(
      `UPDATE packs SET status = 'expired', updated_at = ?
        WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?
        RETURNING id`,
    )
    .all(now, now);

  // Vencer es un cambio como cualquier otro y tiene que contarse igual: sin
  // este aviso, la pantalla del cliente seguía mostrando el pack como bueno
  // hasta recargar, y —lo importante— el pase de la cartera se quedaba
  // diciendo "Activo" para un pack que en la puerta ya no abre.
  for (const { id } of vencidos) {
    const pack = findById(id, db);
    if (!pack) continue;
    hub.publish([channels.user(pack.user_id), channels.admin], 'pack.actualizado', {
      pack: toPublicPack(pack),
      reason: 'vencido',
    });
  }

  return vencidos.length;
}

/** Cambia estado, nota, vencimiento o modo de QR estático de un pack. */
export function updatePack(packId, changes, { actor, ip, userAgent } = {}) {
  const db = getDb();
  const pack = findById(packId, db);
  if (!pack) throw notFound('Pack no encontrado.');

  const fields = [];
  const params = { id: packId, updated_at: new Date().toISOString() };

  if (changes.status !== undefined) {
    if (pack.status === 'cancelled' && changes.status !== 'cancelled') {
      throw conflict('Un pack anulado no se puede reactivar. Emite uno nuevo.', 'pack_anulado');
    }
    // Reactivar sin mover la fecha de vencimiento no serviría de nada: el
    // barrido de vencidos volvería a marcarlo en la siguiente lectura y el
    // panel diría "reactivado" sobre un pack que sigue sin funcionar.
    const vencimiento = changes.expiresAt !== undefined ? changes.expiresAt : pack.expires_at;
    if (changes.status === 'active' && vencimiento && Date.parse(vencimiento) <= Date.now()) {
      throw conflict(
        'Este pack venció. Para reactivarlo, cambia antes su fecha de vencimiento o quítala.',
        'pack_expirado',
        { expiresAt: vencimiento },
      );
    }
    fields.push('status = @status');
    params.status = changes.status;
  }
  if (changes.note !== undefined) {
    fields.push('note = @note');
    params.note = changes.note || null;
  }
  if (changes.expiresAt !== undefined) {
    // Quitarla siempre se puede; ponerla, solo donde el vencimiento tiene sentido.
    if (changes.expiresAt && !puedeVencer(pack)) throw vencimientoNoAdmitido();
    if (changes.expiresAt && Date.parse(changes.expiresAt) <= Date.now()) {
      throw badRequest('La fecha de vencimiento debe ser futura.', { fields: { expiresAt: 'Debe ser futura.' } });
    }
    fields.push('expires_at = @expires_at');
    params.expires_at = changes.expiresAt || null;
  }
  if (changes.allowStaticQr !== undefined) {
    fields.push('allow_static_qr = @allow_static_qr');
    params.allow_static_qr = changes.allowStaticQr ? 1 : 0;
  }
  if (fields.length === 0) return toPublicPack(pack);

  const updated = inTransaction(() => {
    db.prepare(`UPDATE packs SET ${fields.join(', ')}, updated_at = @updated_at WHERE id = @id`).run(params);
    audit.record({
      actor,
      action: 'pack.actualizado',
      entityType: 'pack',
      entityId: packId,
      metadata: { code: pack.code, changes },
      ip,
      userAgent,
      db,
    });
    return findById(packId, db);
  });

  const publicPack = toPublicPack(updated);
  hub.publish([channels.user(updated.user_id), channels.admin], 'pack.actualizado', { pack: publicPack });
  return publicPack;
}

/** Ajuste manual de entradas (corrección o cortesía). Siempre deja asiento. */
export function adjustPack(packId, { delta, reason, actor, ip, userAgent }) {
  const db = getDb();

  const result = inTransaction(() => {
    const pack = findById(packId, db);
    if (!pack) throw notFound('Pack no encontrado.');
    if (pack.status === 'cancelled') throw conflict('No se puede ajustar un pack anulado.', 'pack_anulado');

    const newRemaining = pack.remaining + delta;
    if (newRemaining < 0) {
      throw badRequest(`El pack solo tiene ${pack.remaining} entrada(s); no se pueden quitar ${Math.abs(delta)}.`, null, 'saldo_insuficiente');
    }
    const newSize = Math.max(pack.size, newRemaining);
    const now = new Date().toISOString();
    // Si estaba agotado o vencido y se le acreditan entradas, vuelve a estar activo.
    const newStatus =
      newRemaining > 0 && (pack.status === 'depleted' || (pack.status === 'expired' && !pack.expires_at))
        ? 'active'
        : newRemaining === 0 && pack.status === 'active'
          ? 'depleted'
          : pack.status;

    db.prepare('UPDATE packs SET remaining = ?, size = ?, status = ?, updated_at = ? WHERE id = ?').run(
      newRemaining,
      newSize,
      newStatus,
      now,
      packId,
    );
    db.prepare(
      `INSERT INTO pack_movements (id, pack_id, delta, balance_after, reason, actor_id, note, created_at)
       VALUES (?, ?, ?, ?, 'adjust', ?, ?, ?)`,
    ).run(newId(), packId, delta, newRemaining, actor?.id ?? null, reason, now);

    audit.record({
      actor,
      action: 'pack.ajustado',
      entityType: 'pack',
      entityId: packId,
      metadata: { code: pack.code, delta, reason, before: pack.remaining, after: newRemaining },
      ip,
      userAgent,
      db,
    });

    return findById(packId, db);
  });

  const publicPack = toPublicPack(result);
  hub.publish([channels.user(result.user_id), channels.admin], 'pack.actualizado', {
    pack: publicPack,
    reason: 'ajuste',
  });
  return publicPack;
}

const IDEMPOTENCY_TTL_SECONDS = 24 * 3600;

function hashTransferPayload(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function lookupIdempotentTransfer(db, key, userId, endpoint, requestHash) {
  if (!key) return null;
  const row = db.prepare('SELECT * FROM idempotency_keys WHERE user_id = ? AND key = ?').get(userId, key);
  if (!row) return null;
  if (row.expires_at <= new Date().toISOString()) {
    db.prepare('DELETE FROM idempotency_keys WHERE user_id = ? AND key = ?').run(userId, key);
    return null;
  }
  if (row.endpoint !== endpoint || row.request_hash !== requestHash) {
    throw conflict(
      'Esa clave de idempotencia ya se usó para otra operación. Genera una nueva.',
      'idempotencia_conflicto',
    );
  }
  return JSON.parse(row.response);
}

function saveIdempotentTransfer(db, { key, userId, endpoint, requestHash, statusCode = 200, body }) {
  if (!key) return;
  const now = Date.now();
  db.prepare(
    `INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, status_code, response, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, key) DO NOTHING`,
  ).run(
    key,
    userId,
    endpoint,
    requestHash,
    statusCode,
    JSON.stringify(body),
    new Date(now).toISOString(),
    new Date(now + IDEMPOTENCY_TTL_SECONDS * 1000).toISOString(),
  );
}

/**
 * Un destinatario que no sirve se responde siempre igual, diga lo que diga el
 * motivo: no existe, está suspendido o no es una cuenta de cliente.
 *
 * El buscador de destinatarios es el único sitio donde alguien de fuera puede
 * preguntar por una dirección o un teléfono ajeno. Si contestara «suspendido»
 * a unos y «no existe» a otros, serviría para averiguar quién tiene cuenta
 * probando correos, que es justo lo que no debe poder hacerse. Recepción
 * resuelve los dos casos, y eso es lo que dice el mensaje.
 */
const MENSAJE_DESTINATARIO_NO_DISPONIBLE =
  'No encontramos una cuenta de cliente disponible con ese correo o teléfono. ' +
  'Pídele que cree la suya en la app, o acércate a recepción y lo resolvemos.';

function destinatarioNoDisponible() {
  return notFound(MENSAJE_DESTINATARIO_NO_DISPONIBLE, 'destinatario_no_encontrado');
}

/**
 * Transfiere una cantidad de entradas de un pack propio a otro cliente registrado.
 */
export function transferTickets(sourcePackId, { quantity, recipient, note = null, idempotencyKey = null, actor, ip = null, userAgent = null }) {
  const db = getDb();
  // Solo el máster ve a quién fue a parar la entrada con todos sus datos. Un
  // cliente recibe lo justo para confirmar que acertó de persona: el nombre.
  const esMaster = actor?.role === 'master';

  const rawRecipient = String(recipient || '').trim().toLowerCase();
  const requestHash = hashTransferPayload({ sourcePackId, quantity, recipient: rawRecipient, note });

  if (idempotencyKey && actor?.id) {
    const cached = lookupIdempotentTransfer(db, idempotencyKey, actor.id, 'transfer', requestHash);
    if (cached) return { ...cached, idempotentReplay: true };
  }

  const outcome = inTransaction(() => {
    const sourcePack = findById(sourcePackId, db);
    if (!sourcePack) throw notFound('Pack no encontrado.');

    if (actor && actor.role !== 'master' && sourcePack.user_id !== actor.id) {
      throw forbidden('Este pack no te pertenece.');
    }

    const sender = db.prepare('SELECT id, full_name, email, status FROM users WHERE id = ?').get(sourcePack.user_id);
    const usable = isUsable(sourcePack, { owner: sender });
    if (!usable.ok) {
      throw badRequest(usable.message, { reason: usable.reason }, `pack_${usable.reason}`);
    }

    if (sourcePack.remaining < quantity) {
      throw conflict(
        `Al pack solo le quedan ${sourcePack.remaining} ${sourcePack.remaining === 1 ? 'entrada' : 'entradas'}, pero se intentaron transferir ${quantity}.`,
        'saldo_insuficiente',
        { requested: quantity, remaining: sourcePack.remaining, pack: toPublicPack(sourcePack) },
      );
    }

    const term = String(recipient || '').trim().toLowerCase();
    const rawTerm = String(recipient || '').trim();
    const cleanPhone = rawTerm.replace(/[\s-]/g, '');

    // 1. Búsqueda exacta por correo (la columna email_normalized es única)
    let targetUser = db
      .prepare('SELECT id, full_name, email, phone, status, role FROM users WHERE email_normalized = ? OR email = ?')
      .get(term, rawTerm);

    // 2. Si no se encontró por correo y tiene formato telefónico, buscar por variantes
    if (!targetUser && cleanPhone.length >= 6 && /^\+?[0-9]+$/.test(cleanPhone)) {
      const phoneVariants = new Set([cleanPhone, rawTerm]);
      if (cleanPhone.startsWith('+593') && cleanPhone.length === 13) {
        phoneVariants.add(`0${cleanPhone.slice(4)}`);
      } else if (cleanPhone.startsWith('593') && cleanPhone.length === 12) {
        phoneVariants.add(`0${cleanPhone.slice(3)}`);
      } else if (cleanPhone.startsWith('0') && cleanPhone.length === 10) {
        phoneVariants.add(`+593${cleanPhone.slice(1)}`);
        phoneVariants.add(`593${cleanPhone.slice(1)}`);
      }

      const placeholders = Array.from(phoneVariants).map(() => '?').join(', ');
      const matchingUsers = db
        .prepare(`SELECT id, full_name, email, phone, status, role FROM users WHERE phone IN (${placeholders})`)
        .all(...phoneVariants);

      if (matchingUsers.length > 1) {
        throw conflict(
          'Hay más de una cuenta registrada con ese número de teléfono. Usa el correo electrónico del destinatario para transferir.',
          'telefono_ambiguo',
        );
      }
      if (matchingUsers.length === 1) {
        targetUser = matchingUsers[0];
      }
    }

    if (!targetUser) throw destinatarioNoDisponible();

    if (targetUser.id === sender.id) {
      throw badRequest('No puedes transferirte entradas a ti mismo.', null, 'auto_transferencia');
    }

    // Una transferencia va de un cliente a otro. Admitirla hacia una cuenta de
    // personal o máster convertiría el buscador de destinatarios en una forma
    // de confirmar la dirección del administrador —y de colarle entradas que
    // nadie le vendió—. El máster sí puede mover entradas a donde haga falta.
    if (!esMaster && targetUser.role !== 'customer') throw destinatarioNoDisponible();

    // Mismo error que si no existiera: ver MENSAJE_DESTINATARIO_NO_DISPONIBLE.
    if (targetUser.status !== 'active') throw destinatarioNoDisponible();

    const now = new Date().toISOString();

    // 1. Descontar del pack emisor
    const remainingBefore = sourcePack.remaining;
    const remainingAfter = remainingBefore - quantity;
    const newStatus = remainingAfter === 0 ? 'depleted' : sourcePack.status;

    const updatedSource = db
      .prepare('UPDATE packs SET remaining = ?, status = ?, updated_at = ? WHERE id = ? AND remaining = ?')
      .run(remainingAfter, newStatus, now, sourcePack.id, remainingBefore);
    if (updatedSource.changes !== 1) {
      throw conflict('El saldo del pack cambió mientras se procesaba. Intenta de nuevo.', 'conflicto_concurrencia');
    }

    const noteSender = `Transferido a ${targetUser.full_name}${note ? `: ${note}` : ''}`;
    db.prepare(
      `INSERT INTO pack_movements (id, pack_id, delta, balance_after, reason, actor_id, note, created_at)
       VALUES (?, ?, ?, ?, 'transfer_out', ?, ?, ?)`,
    ).run(newId(), sourcePack.id, -quantity, remainingAfter, actor?.id ?? null, noteSender, now);

    // 2. Crear pack para el destinatario
    const newPackId = newId();
    const newCode = generateUniqueCode(db);
    const newSecret = randomHex(32);
    const noteReceiver = `Transferido por ${sender.full_name}${note ? `: ${note}` : ''}`;
    // La fecha viaja con las entradas. Solo la tiene un pack de cortesía (o
    // algo transferido desde uno), y perderla al cambiar de manos convertiría
    // la transferencia en el atajo para que un premio no venciera nunca.
    const expiresAt = sourcePack.expires_at || null;

    db.prepare(
      `INSERT INTO packs (id, code, user_id, size, remaining, price_cents, currency, secret, status,
                          allow_static_qr, expires_at, note, payment_method, payment_reference,
                          origin, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'active', 0, ?, ?, 'transferencia', ?, 'transfer', ?, ?, ?)`,
    ).run(
      newPackId,
      newCode,
      targetUser.id,
      quantity,
      quantity,
      config.currency,
      newSecret,
      expiresAt,
      noteReceiver,
      `from:${sourcePack.code}`,
      actor?.id ?? null,
      now,
      now,
    );

    db.prepare(
      `INSERT INTO pack_movements (id, pack_id, delta, balance_after, reason, actor_id, note, created_at)
       VALUES (?, ?, ?, ?, 'transfer_in', ?, ?, ?)`,
    ).run(newId(), newPackId, quantity, quantity, actor?.id ?? null, noteReceiver, now);

    const transferId = newId();
    db.prepare(
      `INSERT INTO transfers (id, sender_id, recipient_id, source_pack_id, destination_pack_id, quantity, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(transferId, sender.id, targetUser.id, sourcePack.id, newPackId, quantity, note || null, now);

    audit.record({
      actor,
      action: 'pack.transferido',
      entityType: 'pack',
      entityId: sourcePack.id,
      metadata: {
        sourceCode: sourcePack.code,
        newPackId,
        newCode,
        quantity,
        senderId: sender.id,
        recipientId: targetUser.id,
        recipientEmail: targetUser.email,
        note,
      },
      ip,
      userAgent,
      db,
    });

    return {
      sourcePack: findById(sourcePack.id, db),
      newPack: findById(newPackId, db),
      sender,
      recipient: targetUser,
      quantity,
      note,
    };
  });

  const publicSource = toPublicPack(outcome.sourcePack);
  const publicNew = toPublicPack(outcome.newPack);

  hub.publish([channels.user(outcome.sender.id), channels.admin], 'pack.actualizado', {
    pack: publicSource,
    reason: 'transferencia_saliente',
    transferredTo: { id: outcome.recipient.id, fullName: outcome.recipient.full_name },
    quantity: outcome.quantity,
  });

  hub.publish([channels.user(outcome.recipient.id), channels.admin], 'pack.recibido', {
    pack: publicNew,
    from: { id: outcome.sender.id, fullName: outcome.sender.full_name },
    quantity: outcome.quantity,
  });

  if (correoDisponible() && outcome.recipient.email) {
    const cantTexto = `${outcome.quantity} ${outcome.quantity === 1 ? 'entrada' : 'entradas'}`;
    const asunto = `¡Has recibido ${cantTexto} para la pista de ${config.brandName}!`;
    const notaTexto = outcome.note ? `\nMensaje de ${outcome.sender.full_name}: "${outcome.note}"\n` : '';
    const cuerpoTexto =
      `${saludo(outcome.recipient)}\n\n` +
      `${outcome.sender.full_name} te envió ${cantTexto} para la pista de ${config.brandName}.\n` +
      notaTexto +
      `\nCódigo de tu nuevo pack: ${publicNew.code}\n` +
      `Entradas disponibles: ${publicNew.remaining}\n\n` +
      `Puedes ver tu código QR y saldo en cualquier momento en:\n${config.publicUrl}/app\n\n` +
      `¡Te esperamos en la pista!\n` +
      `${config.brandName}`;

    const bloquesHtml = [
      saludo(outcome.recipient),
      `<strong>${escaparHtml(outcome.sender.full_name)}</strong> te envió <strong>${cantTexto}</strong> para la pista de ${escaparHtml(config.brandName)}.`,
      ...(outcome.note
        ? [`<blockquote style="margin:0 0 16px;padding:8px 16px;border-left:4px solid #3cfe3f;background:#f9f9f9;font-style:italic">"${escaparHtml(outcome.note)}"</blockquote>`]
        : []),
      `<p style="margin:0 0 8px">Código de tu nuevo pack: <strong style="font-family:monospace;font-size:16px">${escaparHtml(publicNew.code)}</strong><br>Entradas disponibles: <strong>${publicNew.remaining}</strong></p>`,
      boton(`${config.publicUrl}/app`, 'Ver mis entradas'),
    ];

    const cuerpoHtml = envolverHtml(bloquesHtml, {
      pie: `${escaparHtml(config.brandName)} · Acceso a pista`,
    });

    enviarCorreo({
      para: outcome.recipient.email,
      asunto,
      texto: cuerpoTexto,
      html: cuerpoHtml,
    }).catch((err) => {
      logger.warn('No se pudo enviar correo de transferencia al destinatario', { message: err.message });
    });
  }

  const responseData = {
    ok: true,
    message: `Le pasaste ${outcome.quantity} ${outcome.quantity === 1 ? 'entrada' : 'entradas'} a ${outcome.recipient.full_name}.`,
    transferred: outcome.quantity,
    sourcePack: publicSource,
    destinationPack: publicNew,
    newPack: publicNew,
    // El nombre basta para confirmar que la entrada fue a la persona correcta.
    // El correo y el identificador interno solo los ve el máster: devolvérselos
    // a cualquier cliente convertía la transferencia en una forma de sacar la
    // dirección de cualquier titular con solo saber su teléfono.
    recipient: {
      fullName: outcome.recipient.full_name,
      ...(esMaster ? { id: outcome.recipient.id, email: outcome.recipient.email } : {}),
    },
  };

  if (idempotencyKey && actor?.id) {
    saveIdempotentTransfer(db, {
      key: idempotencyKey,
      userId: actor.id,
      endpoint: 'transfer',
      requestHash,
      statusCode: 200,
      body: responseData,
    });
  }

  return responseData;
}

/**
 * Lista las transferencias en las que participó un cliente (como emisor o como receptor).
 */
export function listTransfersForUser(userId, { limit = 50, offset = 0, direction = 'all' } = {}) {
  const db = getDb();
  const where = [];
  const params = { userId, limit, offset };

  if (direction === 'sent') {
    where.push('t.sender_id = @userId');
  } else if (direction === 'received') {
    where.push('t.recipient_id = @userId');
  } else {
    where.push('(t.sender_id = @userId OR t.recipient_id = @userId)');
  }

  const clause = `WHERE ${where.join(' AND ')}`;
  const rows = db
    .prepare(
      `SELECT t.*,
              s.full_name AS sender_name, s.email AS sender_email,
              r.full_name AS recipient_name, r.email AS recipient_email,
              sp.code AS source_pack_code, dp.code AS destination_pack_code
         FROM transfers t
         JOIN users s ON s.id = t.sender_id
         JOIN users r ON r.id = t.recipient_id
         JOIN packs sp ON sp.id = t.source_pack_id
         JOIN packs dp ON dp.id = t.destination_pack_id
         ${clause}
        ORDER BY t.created_at DESC
        LIMIT @limit OFFSET @offset`,
    )
    .all(params);

  const total = db.prepare(`SELECT COUNT(*) AS n FROM transfers t ${clause}`).get(params).n;

  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      direction: row.sender_id === userId ? 'sent' : 'received',
      quantity: row.quantity,
      note: row.note,
      createdAt: row.created_at,
      sender: { id: row.sender_id, fullName: row.sender_name, email: row.sender_email },
      recipient: { id: row.recipient_id, fullName: row.recipient_name, email: row.recipient_email },
      counterparty:
        row.sender_id === userId
          ? { id: row.recipient_id, fullName: row.recipient_name, email: row.recipient_email }
          : { id: row.sender_id, fullName: row.sender_name, email: row.sender_email },
      sourcePackCode: row.source_pack_code,
      destinationPackCode: row.destination_pack_code,
    })),
  };
}

/**
 * Lista todas las transferencias de la pista para el panel de administración.
 */
export function listAllTransfers({ limit = 50, offset = 0, senderId = null, recipientId = null } = {}) {
  const db = getDb();
  const where = [];
  const params = { limit, offset };

  if (senderId) {
    where.push('t.sender_id = @senderId');
    params.senderId = senderId;
  }
  if (recipientId) {
    where.push('t.recipient_id = @recipientId');
    params.recipientId = recipientId;
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT t.*,
              s.full_name AS sender_name, s.email AS sender_email,
              r.full_name AS recipient_name, r.email AS recipient_email,
              sp.code AS source_pack_code, dp.code AS destination_pack_code
         FROM transfers t
         JOIN users s ON s.id = t.sender_id
         JOIN users r ON r.id = t.recipient_id
         JOIN packs sp ON sp.id = t.source_pack_id
         JOIN packs dp ON dp.id = t.destination_pack_id
         ${clause}
        ORDER BY t.created_at DESC
        LIMIT @limit OFFSET @offset`,
    )
    .all(params);

  const total = db.prepare(`SELECT COUNT(*) AS n FROM transfers t ${clause}`).get(params).n;

  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      quantity: row.quantity,
      note: row.note,
      createdAt: row.created_at,
      sender: { id: row.sender_id, fullName: row.sender_name, email: row.sender_email },
      recipient: { id: row.recipient_id, fullName: row.recipient_name, email: row.recipient_email },
      sourcePackCode: row.source_pack_code,
      destinationPackCode: row.destination_pack_code,
    })),
  };
}

/** Lista packs con filtros para el panel de administración. */
export function listPacks({ limit = 50, offset = 0, status = null, search = '', userId = null } = {}) {
  const db = getDb();
  expireDuePacks(db);
  const where = [];
  const params = { limit, offset };

  if (status === 'usable') {
    where.push("p.status = 'active' AND p.remaining > 0");
  } else if (status) {
    where.push('p.status = @status');
    params.status = status;
  }
  if (userId) {
    where.push('p.user_id = @userId');
    params.userId = userId;
  }
  if (search) {
    // Dos patrones: el código va en mayúsculas y sin tildes, y el nombre del
    // cliente contra la columna normalizada, para que "maria" encuentre a María.
    where.push("(p.code LIKE @codigo ESCAPE '\\' OR u.search_text LIKE @search ESCAPE '\\')");
    params.search = patronLike(search);
    params.codigo = `%${String(search).trim().toUpperCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT p.*, u.full_name AS owner_name, u.email AS owner_email, u.status AS owner_status,
              IFNULL((SELECT SUM(r.quantity) FROM redemptions r
                       WHERE r.pack_id = p.id AND r.status = 'confirmed'), 0) AS used_tickets
         FROM packs p JOIN users u ON u.id = p.user_id
         ${clause}
         ORDER BY p.created_at DESC
         LIMIT @limit OFFSET @offset`,
    )
    .all(params);
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM packs p JOIN users u ON u.id = p.user_id ${clause}`)
    .get(params).n;

  return { total, items: rows.map((r) => toPublicPack(r)) };
}

/** Historial contable de un pack. */
export function movements(packId, { limit = 100 } = {}) {
  return getDb()
    .prepare(
      `SELECT m.*, u.full_name AS actor_name
         FROM pack_movements m LEFT JOIN users u ON u.id = m.actor_id
        WHERE m.pack_id = ?
        ORDER BY m.created_at DESC, m.rowid DESC
        LIMIT ?`,
    )
    .all(packId, limit)
    .map((r) => ({
      id: r.id,
      delta: r.delta,
      balanceAfter: r.balance_after,
      reason: r.reason,
      redemptionId: r.redemption_id,
      actorId: r.actor_id,
      actorName: r.actor_name,
      note: r.note,
      createdAt: r.created_at,
    }));
}

/**
 * Verificación de integridad: el saldo de cada pack debe coincidir con la suma
 * de sus movimientos. Se expone en el panel máster y en las pruebas.
 */
export function checkIntegrity() {
  const db = getDb();
  const mismatches = db
    .prepare(
      `SELECT p.id, p.code, p.remaining, IFNULL(SUM(m.delta), 0) AS ledger
         FROM packs p LEFT JOIN pack_movements m ON m.pack_id = p.id
        GROUP BY p.id
        HAVING p.remaining <> IFNULL(SUM(m.delta), 0)`,
    )
    .all();
  const negative = db.prepare('SELECT id, code, remaining FROM packs WHERE remaining < 0').all();
  const overflow = db.prepare('SELECT id, code, remaining, size FROM packs WHERE remaining > size').all();
  return {
    ok: mismatches.length === 0 && negative.length === 0 && overflow.length === 0,
    mismatches,
    negative,
    overflow,
    checkedAt: new Date().toISOString(),
  };
}
