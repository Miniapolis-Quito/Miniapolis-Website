/** Bitácora de auditoría: quién hizo qué, cuándo y desde dónde. */
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';

/**
 * Registra una acción. Diseñada para no fallar nunca de forma que rompa la
 * operación principal: si la auditoría falla, se registra en el log y sigue.
 */
export function record({ actor, action, entityType, entityId, metadata, ip, userAgent, db = getDb() }) {
  const entry = {
    id: newId(),
    actor_id: actor?.id ?? null,
    actor_email: actor?.email ?? null,
    action,
    entity_type: entityType ?? null,
    entity_id: entityId ?? null,
    metadata: metadata ? JSON.stringify(metadata) : null,
    ip: ip ?? null,
    user_agent: userAgent ? String(userAgent).slice(0, 300) : null,
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO audit_log (id, actor_id, actor_email, action, entity_type, entity_id, metadata, ip, user_agent, created_at)
     VALUES (@id, @actor_id, @actor_email, @action, @entity_type, @entity_id, @metadata, @ip, @user_agent, @created_at)`,
  ).run(entry);
  return entry;
}

/** Igual que `record`, pero desde un objeto `req` de Express. */
export function recordFromRequest(req, action, { entityType, entityId, metadata, db } = {}) {
  return record({
    actor: req.user ? { id: req.user.id, email: req.user.email } : null,
    action,
    entityType,
    entityId,
    metadata,
    ip: req.clientIp,
    userAgent: req.get?.('user-agent'),
    db,
  });
}

export function list({ limit = 50, offset = 0, action, entityId, actorId } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (action) {
    where.push('action = @action');
    params.action = action;
  }
  if (entityId) {
    where.push('entity_id = @entityId');
    params.entityId = entityId;
  }
  if (actorId) {
    where.push('actor_id = @actorId');
    params.actorId = actorId;
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT a.*, u.full_name AS actor_name
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
        ${clause}
        ORDER BY a.created_at DESC, a.rowid DESC
        LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit, offset });
  const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_log a ${clause}`).get(params).n;
  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      actorId: r.actor_id,
      actorEmail: r.actor_email,
      actorName: r.actor_name,
      entityType: r.entity_type,
      entityId: r.entity_id,
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
      ip: r.ip,
      createdAt: r.created_at,
    })),
  };
}
