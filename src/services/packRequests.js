/**
 * Solicitudes de recarga y compra de packs en línea.
 *
 * Permite a los clientes pedir packs desde su teléfono enviando su referencia de
 * pago (transferencia bancaria, DeUna, efectivo), y a la administración aprobar o
 * rechazar la solicitud con un solo clic y emisión atómica del pack.
 */
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { config } from '../config.js';
import { hub, channels } from '../lib/events.js';
import { enlaceDeWhatsapp, leerAjustes } from './avisos.js';
import * as audit from './audit.js';
import * as users from './users.js';
import * as packsService from './packs.js';

const ESTADOS_VALIDOS = new Set(['pending', 'approved', 'rejected', 'cancelled']);

/** Transforma una fila de base de datos al formato público. */
export function toPublicRequest(row) {
  if (!row) return null;
  const res = {
    id: row.id,
    userId: row.user_id,
    size: row.size,
    priceCents: row.price_cents,
    currency: row.currency,
    paymentMethod: row.payment_method,
    paymentReference: row.payment_reference,
    note: row.note ?? null,
    status: row.status,
    packId: row.pack_id ?? null,
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at ?? null,
    rejectionReason: row.rejection_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.user_full_name !== undefined) res.userName = row.user_full_name;
  if (row.user_email !== undefined) res.userEmail = row.user_email;
  if (row.user_phone) {
    res.userPhone = row.user_phone;
    const prefijo = leerAjustes().whatsappCountryCode;
    const mensaje = encodeURIComponent(
      `Hola ${row.user_full_name || ''}, te escribimos de Miniápolis sobre tu solicitud de pack de ${row.size} entradas (Ref: ${row.payment_reference}).`,
    );
    const urlBase = enlaceDeWhatsapp(row.user_phone, prefijo);
    res.whatsappUrl = urlBase ? `${urlBase}?text=${mensaje}` : null;
  } else {
    res.userPhone = row.user_phone ?? null;
    res.whatsappUrl = null;
  }
  if (row.pack_code !== undefined) res.packCode = row.pack_code;
  if (row.reviewer_name !== undefined) res.reviewerName = row.reviewer_name;

  return res;
}

/** Busca una solicitud por ID. */
export function findById(id, db = getDb()) {
  const row = db
    .prepare(
      `SELECT pr.*,
              u.full_name AS user_full_name,
              u.email AS user_email,
              u.phone AS user_phone,
              p.code AS pack_code,
              rev.full_name AS reviewer_name
         FROM pack_requests pr
         JOIN users u ON u.id = pr.user_id
         LEFT JOIN packs p ON p.id = pr.pack_id
         LEFT JOIN users rev ON rev.id = pr.reviewed_by
        WHERE pr.id = ?`,
    )
    .get(id);
  return row ? toPublicRequest(row) : null;
}

/** Crea una solicitud de recarga enviada por un cliente. */
export function createRequest({ userId, size, paymentMethod, paymentReference, note, actor, ip, userAgent }) {
  const db = getDb();
  const usuario = users.findById(userId, db);
  if (!usuario) throw notFound('Usuario no encontrado.');
  if (usuario.status !== 'active') {
    throw forbidden('Tu cuenta no está activa. Consulta en recepción.');
  }

  // Prevenir abusos: máximo 3 solicitudes pendientes al mismo tiempo por usuario.
  const pendientes = db
    .prepare("SELECT COUNT(*) AS total FROM pack_requests WHERE user_id = ? AND status = 'pending'")
    .get(userId).total;
  if (pendientes >= 3) {
    throw badRequest('Ya tienes solicitudes pendientes de revisión. Espera a que recepción las procese.');
  }

  // Buscar el precio de lista oficial en el catálogo configurado.
  const itemCatalogo = config.packCatalog.find((p) => p.size === size);
  if (!itemCatalogo) {
    throw badRequest(`El tamaño de pack (${size} entradas) no está disponible en el catálogo a la venta.`);
  }

  const id = newId();
  const ahora = new Date().toISOString();
  const precioCentavos = itemCatalogo.priceCents;

  db.prepare(
    `INSERT INTO pack_requests (
       id, user_id, size, price_cents, currency,
       payment_method, payment_reference, note, status,
       created_at, updated_at
     ) VALUES (
       @id, @userId, @size, @priceCents, @currency,
       @paymentMethod, @paymentReference, @note, 'pending',
       @ahora, @ahora
     )`,
  ).run({
    id,
    userId,
    size,
    priceCents: precioCentavos,
    currency: config.currency,
    paymentMethod,
    paymentReference: paymentReference.trim(),
    note: note ? note.trim() : null,
    ahora,
  });

  const request = findById(id, db);

  audit.record({
    actor: actor || { id: usuario.id, email: usuario.email, fullName: usuario.full_name },
    action: 'pack_request.creada',
    entityType: 'pack_request',
    entityId: id,
    metadata: {
      userId,
      size,
      priceCents: precioCentavos,
      paymentMethod,
      paymentReference: paymentReference.trim(),
    },
    ip,
    userAgent,
    db,
  });

  // Notificar al máster y administradores en tiempo real.
  hub.publish([channels.admin], 'pack_request.creada', {
    request,
    user: { id: usuario.id, fullName: usuario.full_name, email: usuario.email, phone: usuario.phone },
  });

  return request;
}

/** El cliente cancela una solicitud suya que aún no ha sido procesada. */
export function cancelRequest(requestId, { userId, actor, ip, userAgent }) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM pack_requests WHERE id = ?').get(requestId);
  if (!row) throw notFound('Solicitud no encontrada.');
  if (row.user_id !== userId) throw forbidden('Esta solicitud no te pertenece.');
  if (row.status !== 'pending') {
    throw badRequest('Esta solicitud ya fue procesada y no se puede cancelar.');
  }

  const ahora = new Date().toISOString();
  const res = db
    .prepare("UPDATE pack_requests SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending'")
    .run(ahora, requestId);

  if (res.changes === 0) {
    throw badRequest('Esta solicitud ya fue procesada y no se puede cancelar.');
  }

  audit.record({
    actor,
    action: 'pack_request.cancelada',
    entityType: 'pack_request',
    entityId: requestId,
    metadata: { userId, size: row.size },
    ip,
    userAgent,
    db,
  });

  const request = findById(requestId, db);

  hub.publish([channels.admin, channels.user(userId)], 'pack_request.cancelada', {
    id: requestId,
    userId,
  });

  return request;
}

/** La administración aprueba la solicitud y emite el pack atómicamente. */
export function approveRequest(requestId, { actor, ip, userAgent }) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM pack_requests WHERE id = ?').get(requestId);
  if (!row) throw notFound('Solicitud no encontrada.');
  if (row.status !== 'pending') {
    throw conflict('Esta solicitud ya fue procesada anteriormente.');
  }

  const usuario = users.findById(row.user_id, db);
  if (!usuario) throw notFound('El cliente de esta solicitud ya no existe.');

  // Actualización atómica del estado para ganar cualquier carrera concurrente
  const ahora = new Date().toISOString();
  const res = db
    .prepare(
      `UPDATE pack_requests
          SET status = 'approved',
              reviewed_by = ?,
              reviewed_at = ?,
              updated_at = ?
        WHERE id = ? AND status = 'pending'`,
    )
    .run(actor.id, ahora, ahora, requestId);

  if (res.changes === 0) {
    throw conflict('Esta solicitud ya fue procesada anteriormente.');
  }

  // Emitir el pack contablemente usando el servicio central de packs.
  const notaEmision = row.note ? `Recarga en línea: ${row.note}` : 'Recarga solicitada en línea';
  const pack = packsService.issuePack(
    {
      userId: row.user_id,
      size: row.size,
      priceCents: row.price_cents,
      paymentMethod: row.payment_method,
      paymentReference: row.payment_reference,
      note: notaEmision,
      actor,
      ip,
      userAgent,
    },
    db,
  );

  db.prepare('UPDATE pack_requests SET pack_id = ? WHERE id = ?').run(pack.id, requestId);

  audit.record({
    actor,
    action: 'pack_request.aprobada',
    entityType: 'pack_request',
    entityId: requestId,
    metadata: {
      userId: row.user_id,
      size: row.size,
      priceCents: row.price_cents,
      packId: pack.id,
      packCode: pack.code,
    },
    ip,
    userAgent,
    db,
  });

  const request = findById(requestId, db);

  // Notificar en tiempo real tanto al cliente como al panel máster.
  hub.publish([channels.admin, channels.user(row.user_id)], 'pack_request.aprobada', {
    request,
    pack,
    userId: row.user_id,
  });

  return { request, pack };
}

/** La administración rechaza la solicitud indicando el motivo. */
export function rejectRequest(requestId, { reason, actor, ip, userAgent }) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM pack_requests WHERE id = ?').get(requestId);
  if (!row) throw notFound('Solicitud no encontrada.');
  if (row.status !== 'pending') {
    throw conflict('Esta solicitud ya fue procesada anteriormente.');
  }

  const ahora = new Date().toISOString();
  const res = db
    .prepare(
      `UPDATE pack_requests
          SET status = 'rejected',
              rejection_reason = ?,
              reviewed_by = ?,
              reviewed_at = ?,
              updated_at = ?
        WHERE id = ? AND status = 'pending'`,
    )
    .run(reason.trim(), actor.id, ahora, ahora, requestId);

  if (res.changes === 0) {
    throw conflict('Esta solicitud ya fue procesada anteriormente.');
  }

  audit.record({
    actor,
    action: 'pack_request.rechazada',
    entityType: 'pack_request',
    entityId: requestId,
    metadata: {
      userId: row.user_id,
      size: row.size,
      reason: reason.trim(),
    },
    ip,
    userAgent,
    db,
  });

  const request = findById(requestId, db);

  hub.publish([channels.admin, channels.user(row.user_id)], 'pack_request.rechazada', {
    id: requestId,
    reason: reason.trim(),
    userId: row.user_id,
    request,
  });

  return request;
}

/** Lista solicitudes con opciones de filtrado. */
export function listRequests({ status, userId, limit = 50, offset = 0 } = {}, db = getDb()) {
  const condiciones = [];
  const parametros = { limit, offset };

  if (status && ESTADOS_VALIDOS.has(status)) {
    condiciones.push('pr.status = @status');
    parametros.status = status;
  }
  if (userId) {
    condiciones.push('pr.user_id = @userId');
    parametros.userId = userId;
  }

  const clausulaWhere = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';

  const filas = db
    .prepare(
      `SELECT pr.*,
              u.full_name AS user_full_name,
              u.email AS user_email,
              u.phone AS user_phone,
              p.code AS pack_code,
              rev.full_name AS reviewer_name
         FROM pack_requests pr
         JOIN users u ON u.id = pr.user_id
         LEFT JOIN packs p ON p.id = pr.pack_id
         LEFT JOIN users rev ON rev.id = pr.reviewed_by
         ${clausulaWhere}
        ORDER BY pr.created_at DESC
        LIMIT @limit OFFSET @offset`,
    )
    .all(parametros);

  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM pack_requests pr ${clausulaWhere}`)
    .get(parametros).n;

  return { total, items: filas.map(toPublicRequest) };
}

/** Lista rápida de solicitudes pendientes para la portada de administración. */
export function listPendingRequests(limit = 30, db = getDb()) {
  return listRequests({ status: 'pending', limit, offset: 0 }, db).items;
}

/** Cantidad de solicitudes actualmente pendientes. */
export function countPendingRequests(db = getDb()) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM pack_requests WHERE status = 'pending'")
    .get().n;
}
