/**
 * Packs de entradas: emisión, consulta, ajustes y consumo.
 *
 * Regla central: `packs.remaining` es una proyección. La verdad contable está
 * en `pack_movements`, donde cada alta, consumo, anulación o ajuste queda como
 * un asiento con su saldo resultante. Eso permite auditar cualquier diferencia
 * y detectar corrupción (ver `checkIntegrity`).
 */
import { getDb, inTransaction } from '../db/index.js';
import { newId, newPackCode, randomHex, normalizePackCode } from '../lib/ids.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { buildQrPayload } from '../lib/qr.js';
import { config } from '../config.js';
import { patronLike } from '../lib/texto.js';
import { hub, channels } from '../lib/events.js';
import * as audit from './audit.js';

const ACTIVE_STATUSES = new Set(['active']);

/** Proyección del pack para el cliente. Nunca expone `secret`. */
export function toPublicPack(row, { includeQr = false } = {}) {
  if (!row) return null;
  const pack = {
    id: row.id,
    code: row.code,
    userId: row.user_id,
    size: row.size,
    remaining: row.remaining,
    used: row.size - row.remaining,
    priceCents: row.price_cents,
    currency: row.currency,
    status: row.status,
    allowStaticQr: Boolean(row.allow_static_qr),
    expiresAt: row.expires_at,
    note: row.note,
    paymentMethod: row.payment_method,
    paymentReference: row.payment_reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usable: isUsable(row).ok,
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

/** ¿Se puede consumir una entrada de este pack ahora mismo? */
export function isUsable(pack, { now = Date.now() } = {}) {
  if (!pack) return { ok: false, reason: 'no_encontrado', message: 'El pack no existe.' };
  if (pack.status === 'cancelled') return { ok: false, reason: 'cancelado', message: 'Este pack fue anulado.' };
  if (pack.status === 'suspended') return { ok: false, reason: 'suspendido', message: 'Este pack está suspendido. Consulta en recepción.' };
  if (pack.expires_at && Date.parse(pack.expires_at) <= now) {
    return { ok: false, reason: 'expirado', message: 'Este pack venció.' };
  }
  if (pack.status === 'expired') return { ok: false, reason: 'expirado', message: 'Este pack venció.' };
  if (pack.remaining <= 0) return { ok: false, reason: 'sin_entradas', message: 'Este pack ya no tiene entradas disponibles.' };
  if (!ACTIVE_STATUSES.has(pack.status)) return { ok: false, reason: 'inactivo', message: 'Este pack no está activo.' };
  return { ok: true };
}

export function findById(id, db = getDb()) {
  return db.prepare('SELECT * FROM packs WHERE id = ?').get(id) ?? null;
}

export function findByCode(code, db = getDb()) {
  return db.prepare('SELECT * FROM packs WHERE code = ?').get(code) ?? null;
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
  throw conflict('No se pudo generar un código único para el pack. Inténtalo de nuevo.', 'codigo_colision');
}

/** Emite un pack nuevo para un cliente. */
export function issuePack({
  userId,
  size,
  priceCents = null,
  paymentMethod = null,
  paymentReference = null,
  note = null,
  expiresAt = null,
  allowStaticQr = false,
  actor = null,
  ip = null,
  userAgent = null,
}) {
  const db = getDb();
  const owner = db.prepare('SELECT id, full_name, email, status FROM users WHERE id = ?').get(userId);
  if (!owner) throw notFound('El cliente indicado no existe.', 'cliente_no_encontrado');
  if (owner.status !== 'active') throw badRequest('La cuenta del cliente está suspendida.', null, 'cliente_suspendido');
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
      created_by: actor?.id ?? null,
      created_at: now,
      updated_at: now,
    };
    db.prepare(
      `INSERT INTO packs (id, code, user_id, size, remaining, price_cents, currency, secret, status,
                          allow_static_qr, expires_at, note, payment_method, payment_reference,
                          created_by, created_at, updated_at)
       VALUES (@id, @code, @user_id, @size, @remaining, @price_cents, @currency, @secret, @status,
               @allow_static_qr, @expires_at, @note, @payment_method, @payment_reference,
               @created_by, @created_at, @updated_at)`,
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
      metadata: { code: row.code, size, userId, priceCents: finalPrice, paymentMethod },
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
export function listPacksForUser(userId, { includeQr = false, includeInactive = true } = {}) {
  const db = getDb();
  expireDuePacks(db);
  const rows = db
    .prepare(
      `SELECT * FROM packs
        WHERE user_id = ? ${includeInactive ? '' : "AND status = 'active' AND remaining > 0"}
        ORDER BY CASE WHEN status = 'active' AND remaining > 0 THEN 0 ELSE 1 END,
                 CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END,
                 expires_at ASC,
                 created_at ASC`,
    )
    .all(userId);
  return rows.map((r) => toPublicPack(r, { includeQr: includeQr && isUsable(r).ok }));
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
         IFNULL(SUM(size - remaining), 0)                           AS usadas,
         IFNULL(SUM(size), 0)                                       AS compradas,
         COUNT(*)                                                   AS packs_totales
       FROM (
         SELECT size, remaining,
                (status = 'active' AND remaining > 0
                 AND (expires_at IS NULL OR expires_at > @ahora)) AS usable
           FROM packs WHERE user_id = @userId
       )`,
    )
    .get({ userId, ahora: new Date().toISOString() });
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
    usedTickets: row.usadas,
    purchasedTickets: row.compradas,
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

  return db
    .prepare(
      `UPDATE packs SET status = 'expired', updated_at = ?
        WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`,
    )
    .run(now, now).changes;
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
      `SELECT p.*, u.full_name AS owner_name, u.email AS owner_email
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
