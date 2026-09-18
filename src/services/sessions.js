/**
 * Sesiones con refresh tokens rotativos.
 *
 * Cada uso de un refresh token lo consume y entrega uno nuevo de la misma
 * "familia". Si alguna vez se presenta un token ya rotado, se asume que fue
 * robado y se revoca la familia completa: el atacante y la víctima quedan
 * fuera, y la víctima simplemente vuelve a iniciar sesión.
 */
import { getDb, inTransaction } from '../db/index.js';
import { newId, randomToken } from '../lib/ids.js';
import { hashRefreshToken, signAccessToken } from '../lib/jwt.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { hub, channels } from '../lib/events.js';

export function issueSession(user, { ip, userAgent, familyId = null } = {}) {
  const db = getDb();
  const token = randomToken(32);
  const now = Date.now();
  const id = newId();
  const session = {
    id,
    family_id: familyId || id,
    user_id: user.id,
    token_hash: hashRefreshToken(token),
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + config.tokens.refreshTtlSeconds * 1000).toISOString(),
    ip: ip ?? null,
    user_agent: userAgent ? String(userAgent).slice(0, 300) : null,
  };
  db.prepare(
    `INSERT INTO sessions (id, family_id, user_id, token_hash, created_at, expires_at, ip, user_agent)
     VALUES (@id, @family_id, @user_id, @token_hash, @created_at, @expires_at, @ip, @user_agent)`,
  ).run(session);

  return { refreshToken: token, session, accessToken: buildAccessToken(user, session) };
}
export function buildAccessToken(user, session) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sid: session.id,
    ver: user.token_version,
    email: user.email,
    name: user.full_name,
  });
}

/**
 * Rota un refresh token.
 * @returns {{ok:true, accessToken, refreshToken, user}|{ok:false, reason:string}}
 */
export function rotate(refreshToken, { ip, userAgent } = {}) {
  const db = getDb();
  const hash = hashRefreshToken(refreshToken || '');

  return inTransaction(() => {
    const session = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hash);
    if (!session) return { ok: false, reason: 'invalido' };

    const nowIso = new Date().toISOString();

    // Reutilización de un token ya rotado o revocado ⇒ posible robo.
    if (session.rotated_to || session.revoked_at) {
      db.prepare(
        `UPDATE sessions SET revoked_at = ?, revoke_reason = 'token_reuse'
          WHERE family_id = ? AND revoked_at IS NULL`,
      ).run(nowIso, session.family_id);
      logger.warn('Reutilización de refresh token detectada; familia revocada', {
        userId: session.user_id,
        familyId: session.family_id,
      });
      notificarSesionInvalida(session.user_id, 'token_reutilizado');
      return { ok: false, reason: 'reutilizado', userId: session.user_id };
    }

    if (session.expires_at <= nowIso) return { ok: false, reason: 'expirado' };

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
    if (!user) return { ok: false, reason: 'invalido' };
    if (user.status !== 'active') return { ok: false, reason: 'suspendido' };

    const next = issueSession(user, { ip, userAgent, familyId: session.family_id });
    db.prepare('UPDATE sessions SET rotated_to = ?, last_used_at = ?, revoked_at = ?, revoke_reason = ? WHERE id = ?').run(
      next.session.id,
      nowIso,
      nowIso,
      'rotated',
      session.id,
    );

    return { ok: true, accessToken: next.accessToken, refreshToken: next.refreshToken, user, session: next.session };
  });
}

export function revokeByToken(refreshToken, reason = 'logout') {
  const db = getDb();
  const hash = hashRefreshToken(refreshToken || '');
  const session = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hash);
  if (!session) return false;
  db.prepare(
    `UPDATE sessions SET revoked_at = ?, revoke_reason = ? WHERE family_id = ? AND revoked_at IS NULL`,
  ).run(new Date().toISOString(), reason, session.family_id);
  return true;
}

export function revokeAllForUser(userId, reason = 'admin') {
  const cambios = getDb()
    .prepare(`UPDATE sessions SET revoked_at = ?, revoke_reason = ? WHERE user_id = ? AND revoked_at IS NULL`)
    .run(new Date().toISOString(), reason, userId).changes;
  if (cambios > 0) notificarSesionInvalida(userId, reason);
  return cambios;
}

/**
 * Revoca una sesión y todas las renovaciones de su familia: el token de acceso
 * deja de valer en la siguiente petición y la cookie de refresco ya no renueva.
 */
export function revokeSessionFamily(sessionId, reason) {
  const db = getDb();
  const fila = db.prepare('SELECT family_id FROM sessions WHERE id = ?').get(sessionId);
  if (!fila) return 0;
  return db
    .prepare('UPDATE sessions SET revoked_at = ?, revoke_reason = ? WHERE family_id = ? AND revoked_at IS NULL')
    .run(new Date().toISOString(), reason, fila.family_id).changes;
}

/**
 * Avisa por el canal en vivo a las pantallas de ese usuario para que vuelvan a
 * la página de acceso en el acto, en lugar de seguir mostrando datos hasta que
 * la siguiente petición falle.
 */
export function notificarSesionInvalida(userId, motivo = 'sesion_cerrada') {
  hub.publish(channels.user(userId), 'sesion.invalida', { motivo });
}

/** ¿La sesión referenciada por un access token sigue viva? */
export function isSessionActive(sessionId) {
  const row = getDb().prepare('SELECT revoked_at, expires_at FROM sessions WHERE id = ?').get(sessionId);
  if (!row) return false;
  if (row.revoked_at) return false;
  return row.expires_at > new Date().toISOString();
}

/**
 * Proyección pública de una sesión, en el mismo formato para el propio usuario
 * y para el panel máster: sin ella, cada ruta devolvía una forma distinta
 * (`last_used_at` en una, `lastUsedAt` en otra) del mismo dato.
 */
export function toPublicSession(row, { currentSessionId = null } = {}) {
  return {
    id: row.id,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokeReason: row.revoke_reason,
    ip: row.ip,
    userAgent: row.user_agent,
    current: currentSessionId !== null && row.id === currentSessionId,
  };
}

export function listForUser(userId) {
  return getDb()
    .prepare(
      `SELECT id, created_at, last_used_at, expires_at, revoked_at, revoke_reason, ip, user_agent
         FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .all(userId);
}

export function findById(sessionId, db = getDb()) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) ?? null;
}

/**
 * Revoca una sesión específica y todas las renovaciones de su familia.
 */
export function revokeSession(sessionId, reason = 'revocada_manualmente') {
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return { ok: false, reason: 'no_encontrada' };
  const nowIso = new Date().toISOString();
  const changes = db
    .prepare('UPDATE sessions SET revoked_at = ?, revoke_reason = ? WHERE family_id = ? AND revoked_at IS NULL')
    .run(nowIso, reason, session.family_id).changes;
  notificarSesionInvalida(session.user_id, reason);
  return { ok: true, session, revokedCount: changes };
}

/** Limpieza periódica de sesiones caducadas. */
export function purgeExpired() {
  const nowIso = new Date().toISOString();
  return getDb()
    .prepare(`DELETE FROM sessions WHERE expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?)`)
    .run(nowIso, new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()).changes;
}
