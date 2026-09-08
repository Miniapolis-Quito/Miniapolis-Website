/**
 * Consumo de entradas.
 *
 * Todo el descuento ocurre dentro de una única transacción `BEGIN IMMEDIATE`,
 * con tres barreras independientes contra el doble consumo:
 *
 *  1. `idempotencyKey`  — un reintento de red devuelve la misma respuesta y no
 *                          descuenta otra vez.
 *  2. nonce del QR      — un mismo código dinámico no se puede usar dos veces,
 *                          ni siquiera dentro de su ventana de validez.
 *  3. tiempo de espera  — dos escaneos del mismo pack muy seguidos se rechazan
 *                          (evita el doble disparo de la cámara).
 *
 * Además, el UPDATE del saldo lleva la condición `remaining = <valor leído>`,
 * así que si dos procesos compitieran, solo uno puede ganar.
 */
import crypto from 'node:crypto';
import { getDb, inTransaction } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { conflict, notFound, badRequest } from '../lib/errors.js';
import { parseQrPayload, verifyQrPayload } from '../lib/qr.js';
import { config } from '../config.js';
import { hub, channels } from '../lib/events.js';
import * as packsService from './packs.js';
import * as audit from './audit.js';

const IDEMPOTENCY_TTL_SECONDS = 24 * 3600;

function hashRequest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Deja un código tecleado en su forma canónica, para comparar reintentos. */
function normalizarCodigo(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Busca una respuesta ya emitida para la misma clave de idempotencia.
 *
 * La búsqueda es solo por clave, sin filtrar por operación: una clave la genera
 * el cliente y debe identificar un único intento. Si la misma clave aparece en
 * otra operación o con otros datos, es un error del cliente y se responde con
 * un conflicto claro, en vez de dejar que choque más adelante contra el índice
 * único de `redemptions` y acabe en un error interno.
 */
function lookupIdempotent(db, key, endpoint, requestHash) {
  if (!key) return null;
  const row = db.prepare('SELECT * FROM idempotency_keys WHERE key = ?').get(key);
  if (!row) return null;
  if (row.expires_at <= new Date().toISOString()) {
    db.prepare('DELETE FROM idempotency_keys WHERE key = ?').run(key);
    return null;
  }
  if (row.endpoint !== endpoint || row.request_hash !== requestHash) {
    throw conflict(
      'Esa clave de idempotencia ya se usó para otra operación. Genera una nueva.',
      'idempotencia_conflicto',
    );
  }
  return { statusCode: row.status_code, body: JSON.parse(row.response) };
}

function saveIdempotent(db, { key, userId, endpoint, requestHash, statusCode, body }) {
  if (!key) return;
  const now = Date.now();
  db.prepare(
    `INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, status_code, response, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO NOTHING`,
  ).run(
    key,
    userId ?? null,
    endpoint,
    requestHash,
    statusCode,
    JSON.stringify(body),
    new Date(now).toISOString(),
    new Date(now + IDEMPOTENCY_TTL_SECONDS * 1000).toISOString(),
  );
}

/** Último consumo confirmado de un pack, para el control de tiempo de espera. */
function lastConfirmedRedemption(db, packId) {
  return db
    .prepare(
      `SELECT * FROM redemptions
        WHERE pack_id = ? AND status = 'confirmed'
        ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(packId);
}

/**
 * Núcleo del consumo: descuenta una entrada del pack indicado.
 * Debe llamarse ya dentro de una transacción.
 */
function redeemOne(db, { pack, method, scannedBy, deviceLabel, idempotencyKey, nonce, ip, now }) {
  const nowIso = new Date(now).toISOString();

  // Relectura dentro de la transacción: el estado que se valida es el que se escribe.
  const fresh = packsService.findById(pack.id, db);
  const usable = packsService.isUsable(fresh, {
    now,
    ownerStatus: packsService.ownerStatus(fresh, db),
  });
  if (!usable.ok) {
    throw conflict(usable.message, usable.code ?? `pack_${usable.reason}`, {
      pack: packsService.toPublicPack(fresh),
    });
  }

  // Barrera 3: dos escaneos muy seguidos del mismo pack.
  const cooldown = config.redemption.cooldownSeconds;
  if (cooldown > 0) {
    const last = lastConfirmedRedemption(db, fresh.id);
    if (last) {
      const elapsed = (now - Date.parse(last.created_at)) / 1000;
      if (elapsed < cooldown) {
        throw conflict(
          `Este pack ya registró una entrada hace ${Math.max(1, Math.round(elapsed))} segundos. ` +
            `Espera ${Math.ceil(cooldown - elapsed)} segundos si de verdad quieres descontar otra.`,
          'espera_activa',
          {
            waitSeconds: Math.ceil(cooldown - elapsed),
            lastRedemptionAt: last.created_at,
            pack: packsService.toPublicPack(fresh),
          },
        );
      }
    }
  }

  const remainingBefore = fresh.remaining;
  const remainingAfter = remainingBefore - 1;
  const newStatus = remainingAfter === 0 ? 'depleted' : fresh.status;

  // Guarda optimista: solo descuenta si el saldo sigue siendo el que se leyó.
  const updated = db
    .prepare('UPDATE packs SET remaining = ?, status = ?, updated_at = ? WHERE id = ? AND remaining = ?')
    .run(remainingAfter, newStatus, nowIso, fresh.id, remainingBefore);
  if (updated.changes !== 1) {
    throw conflict('El saldo del pack cambió mientras se procesaba. Vuelve a escanear.', 'conflicto_concurrencia');
  }

  const redemptionId = newId();
  db.prepare(
    `INSERT INTO redemptions (id, pack_id, user_id, scanned_by, device_label, method,
                              remaining_before, remaining_after, status, idempotency_key, nonce, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)`,
  ).run(
    redemptionId,
    fresh.id,
    fresh.user_id,
    scannedBy ?? null,
    deviceLabel ?? null,
    method,
    remainingBefore,
    remainingAfter,
    idempotencyKey ?? null,
    nonce ?? null,
    ip ?? null,
    nowIso,
  );

  db.prepare(
    `INSERT INTO pack_movements (id, pack_id, delta, balance_after, reason, redemption_id, actor_id, created_at)
     VALUES (?, ?, -1, ?, 'redeem', ?, ?, ?)`,
  ).run(newId(), fresh.id, remainingAfter, redemptionId, scannedBy ?? null, nowIso);

  return {
    redemptionId,
    remainingBefore,
    remainingAfter,
    method,
    deviceLabel: deviceLabel ?? null,
    pack: packsService.findById(fresh.id, db),
    createdAt: nowIso,
  };
}

/** Publica el resultado del consumo a los canales en vivo. */
function publishRedemption(result, owner, scanner) {
  const payload = {
    redemptionId: result.redemptionId,
    pack: packsService.toPublicPack(result.pack),
    remaining: result.remainingAfter,
    // El método y el puesto viajan en el evento para que la lista en vivo del
    // escáner muestre lo que de verdad pasó y no una suposición.
    method: result.method,
    deviceLabel: result.deviceLabel ?? null,
    owner: { id: owner.id, fullName: owner.full_name },
    scannedBy: scanner ? { id: scanner.id, fullName: scanner.fullName } : null,
    at: result.createdAt,
  };
  hub.publish(
    [channels.user(result.pack.user_id), channels.staff, channels.admin],
    'entrada.consumida',
    payload,
  );
}

/**
 * Canjea una entrada a partir del contenido de un QR.
 * @returns {{statusCode:number, body:object}}
 */
export function redeemByQr({ payload, scanner, deviceLabel, idempotencyKey, ip, userAgent, now = Date.now() }) {
  const db = getDb();
  const endpoint = 'scan';
  const requestHash = hashRequest({ payload, deviceLabel });

  const cached = lookupIdempotent(db, idempotencyKey, endpoint, requestHash);
  if (cached) return { ...cached, idempotentReplay: true };

  const parsed = parseQrPayload(payload);
  if (!parsed.ok) {
    throw badRequest(
      'El código escaneado no corresponde a una entrada de ' + config.brandShort + '.',
      { reason: parsed.reason },
      'qr_invalido',
    );
  }

  const pack = packsService.findByCode(parsed.code, db);
  if (!pack) throw notFound('No existe ningún pack con ese código.', 'pack_no_encontrado');

  const verification = verifyQrPayload(parsed, pack, { now });
  if (!verification.ok) {
    const messages = {
      firma: 'El código no es auténtico. Pide al cliente que actualice su pantalla.',
      expirado: 'El código ya venció. Pide al cliente que muestre el QR actualizado.',
      futuro: 'El reloj del dispositivo del cliente está desfasado. Que actualice su pantalla.',
      estatico_no_permitido: 'Este pack no admite códigos impresos. Usa el QR de la app.',
    };
    audit.record({
      actor: scanner ? { id: scanner.id, email: scanner.email } : null,
      action: 'escaneo.rechazado',
      entityType: 'pack',
      entityId: pack.id,
      metadata: { code: pack.code, reason: verification.reason },
      ip,
      userAgent,
      db,
    });
    throw badRequest(messages[verification.reason] || 'El código no es válido.', { reason: verification.reason }, `qr_${verification.reason}`);
  }

  const owner = db.prepare('SELECT id, full_name, email, status FROM users WHERE id = ?').get(pack.user_id);

  const result = inTransaction(() => {
    // Barrera 2: el nonce de un QR dinámico solo se acepta una vez.
    if (verification.method === 'qr_dynamic') {
      const nonceKey = `${pack.id}:${parsed.nonce}`;
      const inserted = db
        .prepare(
          `INSERT INTO used_nonces (nonce, pack_id, expires_at, created_at)
           VALUES (?, ?, ?, ?) ON CONFLICT(nonce) DO NOTHING`,
        )
        .run(
          nonceKey,
          pack.id,
          new Date(now + (config.qr.ttlSeconds + 300) * 1000).toISOString(),
          new Date(now).toISOString(),
        );
      if (inserted.changes !== 1) {
        throw conflict(
          'Ese código QR ya fue utilizado. Pide al cliente que actualice su pantalla.',
          'qr_ya_usado',
        );
      }
    }

    const consumo = redeemOne(db, {
      pack,
      method: verification.method,
      scannedBy: scanner?.id ?? null,
      deviceLabel,
      idempotencyKey,
      nonce: parsed.nonce,
      ip,
      now,
    });

    const respuesta = {
      ok: true,
      message: `Entrada registrada. Quedan ${consumo.remainingAfter} entrada(s).`,
      redemptionId: consumo.redemptionId,
      method: verification.method,
      remaining: consumo.remainingAfter,
      remainingBefore: consumo.remainingBefore,
      pack: packsService.toPublicPack(consumo.pack),
      customer: { id: owner.id, fullName: owner.full_name },
      at: consumo.createdAt,
    };

    saveIdempotent(db, {
      key: idempotencyKey,
      userId: scanner?.id,
      endpoint,
      requestHash,
      statusCode: 200,
      body: respuesta,
    });

    return { ...consumo, body: respuesta };
  });

  const body = result.body;

  audit.record({
    actor: scanner ? { id: scanner.id, email: scanner.email } : null,
    action: 'entrada.consumida',
    entityType: 'pack',
    entityId: pack.id,
    metadata: {
      code: pack.code,
      method: verification.method,
      remaining: result.remainingAfter,
      redemptionId: result.redemptionId,
      deviceLabel,
    },
    ip,
    userAgent,
    db,
  });

  publishRedemption(result, owner, scanner);
  return { statusCode: 200, body };
}

/**
 * Canje manual por código de pack, para cuando la cámara falla o el cliente no
 * trae el teléfono. Requiere personal autenticado y queda marcado como manual.
 */
export function redeemByCode({ code, scanner, deviceLabel, idempotencyKey, ip, userAgent, now = Date.now() }) {
  const db = getDb();
  const endpoint = 'manual';
  const requestHash = hashRequest({ code: normalizarCodigo(code), deviceLabel });

  const cached = lookupIdempotent(db, idempotencyKey, endpoint, requestHash);
  if (cached) return { ...cached, idempotentReplay: true };

  const pack = packsService.findByLooseCode(code, db);
  if (!pack) throw notFound('No existe ningún pack con ese código.', 'pack_no_encontrado');

  const owner = db.prepare('SELECT id, full_name, email, status FROM users WHERE id = ?').get(pack.user_id);

  const result = inTransaction(() => {
    const consumo = redeemOne(db, {
      pack,
      method: 'manual_code',
      scannedBy: scanner?.id ?? null,
      deviceLabel,
      idempotencyKey,
      nonce: null,
      ip,
      now,
    });

    const respuesta = {
      ok: true,
      message: `Entrada registrada manualmente. Quedan ${consumo.remainingAfter} entrada(s).`,
      redemptionId: consumo.redemptionId,
      method: 'manual_code',
      remaining: consumo.remainingAfter,
      remainingBefore: consumo.remainingBefore,
      pack: packsService.toPublicPack(consumo.pack),
      customer: { id: owner.id, fullName: owner.full_name },
      at: consumo.createdAt,
    };

    saveIdempotent(db, { key: idempotencyKey, userId: scanner?.id, endpoint, requestHash, statusCode: 200, body: respuesta });

    return { ...consumo, body: respuesta };
  });

  const body = result.body;

  audit.record({
    actor: scanner ? { id: scanner.id, email: scanner.email } : null,
    action: 'entrada.consumida_manual',
    entityType: 'pack',
    entityId: pack.id,
    metadata: { code: pack.code, remaining: result.remainingAfter, redemptionId: result.redemptionId, deviceLabel },
    ip,
    userAgent,
    db,
  });

  publishRedemption(result, owner, scanner);
  return { statusCode: 200, body };
}

/** Anula un consumo y devuelve la entrada al pack. Solo el usuario máster. */
export function voidRedemption(redemptionId, { reason, actor, ip, userAgent }) {
  const db = getDb();

  const outcome = inTransaction(() => {
    const redemption = db.prepare('SELECT * FROM redemptions WHERE id = ?').get(redemptionId);
    if (!redemption) throw notFound('No existe ese consumo.');
    if (redemption.status === 'voided') throw conflict('Ese consumo ya fue anulado.', 'ya_anulado');

    const pack = packsService.findById(redemption.pack_id, db);
    if (!pack) throw notFound('El pack asociado ya no existe.');

    const now = new Date().toISOString();
    db.prepare('UPDATE redemptions SET status = ?, voided_by = ?, voided_at = ?, void_reason = ? WHERE id = ?').run(
      'voided',
      actor?.id ?? null,
      now,
      reason,
      redemptionId,
    );

    const remainingAfter = pack.remaining + 1;
    const newStatus = pack.status === 'depleted' ? 'active' : pack.status;
    // Si al pack se le acreditaron entradas hasta llenarlo, devolver una lo
    // haría crecer. Se agranda igual que en un ajuste manual: negarse dejaría
    // sin salida a una corrección legítima.
    const newSize = Math.max(pack.size, remainingAfter);
    db.prepare('UPDATE packs SET remaining = ?, size = ?, status = ?, updated_at = ? WHERE id = ?').run(
      remainingAfter,
      newSize,
      newStatus,
      now,
      pack.id,
    );
    db.prepare(
      `INSERT INTO pack_movements (id, pack_id, delta, balance_after, reason, redemption_id, actor_id, note, created_at)
       VALUES (?, ?, 1, ?, 'void', ?, ?, ?, ?)`,
    ).run(newId(), pack.id, remainingAfter, redemptionId, actor?.id ?? null, reason, now);

    audit.record({
      actor,
      action: 'entrada.anulada',
      entityType: 'redemption',
      entityId: redemptionId,
      metadata: { packCode: pack.code, reason, remaining: remainingAfter },
      ip,
      userAgent,
      db,
    });

    return { pack: packsService.findById(pack.id, db), remainingAfter };
  });

  const publicPack = packsService.toPublicPack(outcome.pack);
  hub.publish([channels.user(outcome.pack.user_id), channels.staff, channels.admin], 'entrada.anulada', {
    redemptionId,
    pack: publicPack,
    remaining: outcome.remainingAfter,
    reason,
  });
  return { pack: publicPack, remaining: outcome.remainingAfter };
}

function mapRedemption(r) {
  return {
    id: r.id,
    packId: r.pack_id,
    packCode: r.pack_code,
    userId: r.user_id,
    customerName: r.customer_name,
    scannedBy: r.scanned_by,
    scannerName: r.scanner_name,
    deviceLabel: r.device_label,
    method: r.method,
    remainingBefore: r.remaining_before,
    remainingAfter: r.remaining_after,
    status: r.status,
    voidReason: r.void_reason,
    voidedAt: r.voided_at,
    createdAt: r.created_at,
  };
}

/** Historial de consumos con filtros. */
export function listRedemptions({ limit = 50, offset = 0, userId = null, packId = null, scannerId = null, since = null, status = null } = {}) {
  const db = getDb();
  const where = [];
  const params = { limit, offset };
  if (userId) {
    where.push('r.user_id = @userId');
    params.userId = userId;
  }
  if (packId) {
    where.push('r.pack_id = @packId');
    params.packId = packId;
  }
  if (scannerId) {
    where.push('r.scanned_by = @scannerId');
    params.scannerId = scannerId;
  }
  if (since) {
    where.push('r.created_at >= @since');
    params.since = since;
  }
  if (status) {
    where.push('r.status = @status');
    params.status = status;
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT r.*, p.code AS pack_code, c.full_name AS customer_name, s.full_name AS scanner_name
         FROM redemptions r
         JOIN packs p ON p.id = r.pack_id
         JOIN users c ON c.id = r.user_id
         LEFT JOIN users s ON s.id = r.scanned_by
         ${clause}
         ORDER BY r.created_at DESC, r.rowid DESC
         LIMIT @limit OFFSET @offset`,
    )
    .all(params);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM redemptions r ${clause}`).get(params).n;
  return { total, items: rows.map(mapRedemption) };
}
