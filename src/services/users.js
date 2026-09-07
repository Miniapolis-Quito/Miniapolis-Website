/** Alta, consulta y mantenimiento de usuarios. */
import { getDb, inTransaction } from '../db/index.js';
import { newId, randomToken } from '../lib/ids.js';
import { hashPassword, verifyPassword, needsRehash } from '../lib/passwords.js';
import { conflict, notFound, badRequest } from '../lib/errors.js';
import { config } from '../config.js';
import { textoBusquedaUsuario, patronLike } from '../lib/texto.js';
import { notificarSesionInvalida } from './sessions.js';

/** Normaliza un correo para la comparación de unicidad. */
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** Proyección pública de un usuario (nunca incluye el hash de contraseña). */
export function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    role: row.role,
    status: row.status,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    locked: Boolean(row.locked_until && row.locked_until > new Date().toISOString()),
  };
}

export function findById(id, db = getDb()) {
  if (typeof id !== 'string' || !id) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
}

export function findByEmail(email, db = getDb()) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return db.prepare('SELECT * FROM users WHERE email_normalized = ?').get(normalized) ?? null;
}

export function countByRole(role, db = getDb()) {
  return db.prepare('SELECT COUNT(*) AS n FROM users WHERE role = ?').get(role).n;
}

export async function createUser({ email, password, fullName, phone, role = 'customer', createdBy = null, status = 'active' }) {
  const normalized = normalizeEmail(email);
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  const user = {
    id: newId(),
    email: String(email).trim(),
    email_normalized: normalized,
    full_name: String(fullName).trim(),
    phone: phone || null,
    role,
    status,
    password_hash: passwordHash,
    password_changed_at: now,
    created_by: createdBy,
    created_at: now,
    updated_at: now,
    search_text: textoBusquedaUsuario({ fullName, email, phone }),
  };

  try {
    getDb()
      .prepare(
        `INSERT INTO users (id, email, email_normalized, full_name, phone, role, status, password_hash,
                            password_changed_at, created_by, created_at, updated_at, search_text)
         VALUES (@id, @email, @email_normalized, @full_name, @phone, @role, @status, @password_hash,
                 @password_changed_at, @created_by, @created_at, @updated_at, @search_text)`,
      )
      .run(user);
  } catch (error) {
    if (String(error.message).includes('UNIQUE') && String(error.message).includes('email_normalized')) {
      throw conflict('Ya existe una cuenta registrada con ese correo.', 'correo_en_uso');
    }
    throw error;
  }

  return findById(user.id);
}

/**
 * Hash señuelo con los parámetros de coste vigentes, para gastar el mismo
 * tiempo cuando el correo no existe. Se calcula una sola vez, la primera vez
 * que hace falta, sobre una contraseña aleatoria que nadie conoce.
 */
let senueloCache = null;
function hashSenuelo() {
  senueloCache ??= hashPassword(randomToken(32)).catch((error) => {
    senueloCache = null; // que un fallo puntual no deje el señuelo roto para siempre
    throw error;
  });
  return senueloCache;
}

/**
 * Verifica credenciales aplicando bloqueo temporal tras varios fallos.
 * @returns {{ok:true,user:object} | {ok:false,reason:string,retryAfterSeconds?:number}}
 */
export async function authenticate(email, password, { now = Date.now() } = {}) {
  const db = getDb();
  const user = findByEmail(email, db);
  const nowIso = new Date(now).toISOString();

  if (!user) {
    // Se gasta el mismo tiempo que una verificación real para no revelar por
    // temporización si el correo existe. El señuelo se genera con los mismos
    // parámetros de coste que los hashes reales: uno fijo con parámetros más
    // baratos tardaría bastante menos y volvería a delatar qué correos existen.
    await verifyPassword(password, await hashSenuelo());
    return { ok: false, reason: 'credenciales' };
  }

  if (user.locked_until && user.locked_until > nowIso) {
    const retryAfterSeconds = Math.ceil((Date.parse(user.locked_until) - now) / 1000);
    return { ok: false, reason: 'bloqueado', retryAfterSeconds };
  }

  const valid = await verifyPassword(password, user.password_hash);

  if (!valid) {
    const failed = user.failed_logins + 1;
    const shouldLock = failed >= config.security.maxLoginAttempts;
    db.prepare('UPDATE users SET failed_logins = ?, locked_until = ?, updated_at = ? WHERE id = ?').run(
      shouldLock ? 0 : failed,
      shouldLock ? new Date(now + config.security.lockoutSeconds * 1000).toISOString() : null,
      nowIso,
      user.id,
    );
    if (shouldLock) {
      return { ok: false, reason: 'bloqueado', retryAfterSeconds: config.security.lockoutSeconds };
    }
    return { ok: false, reason: 'credenciales', attemptsLeft: config.security.maxLoginAttempts - failed };
  }

  if (user.status !== 'active') return { ok: false, reason: 'suspendido' };

  // Login correcto: se limpia el contador y, si el hash quedó con parámetros
  // antiguos, se recalcula de forma transparente.
  let passwordHash = user.password_hash;
  if (needsRehash(passwordHash)) {
    passwordHash = await hashPassword(password);
  }
  db.prepare(
    'UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ?, password_hash = ?, updated_at = ? WHERE id = ?',
  ).run(nowIso, passwordHash, nowIso, user.id);

  return { ok: true, user: findById(user.id, db) };
}

export async function changePassword(userId, currentPassword, newPassword) {
  const db = getDb();
  const user = findById(userId, db);
  if (!user) throw notFound('Usuario no encontrado.');
  const valid = await verifyPassword(currentPassword, user.password_hash);
  if (!valid) throw badRequest('La contraseña actual no es correcta.', { fields: { currentPassword: 'Contraseña incorrecta.' } }, 'password_incorrecta');
  return setPassword(userId, newPassword);
}

/** Cambia la contraseña e invalida todas las sesiones activas del usuario. */
export async function setPassword(userId, newPassword) {
  const db = getDb();
  const passwordHash = await hashPassword(newPassword);
  const now = new Date().toISOString();
  inTransaction(() => {
    db.prepare(
      `UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ?,
              token_version = token_version + 1, failed_logins = 0, locked_until = NULL
        WHERE id = ?`,
    ).run(passwordHash, now, now, userId);
    db.prepare(
      `UPDATE sessions SET revoked_at = ?, revoke_reason = 'password_changed'
        WHERE user_id = ? AND revoked_at IS NULL`,
    ).run(now, userId);
  });
  notificarSesionInvalida(userId, 'password_cambiada');
  return findById(userId, db);
}

export function updateUser(userId, changes, db = getDb()) {
  const user = findById(userId, db);
  if (!user) throw notFound('Usuario no encontrado.');

  const fields = [];
  const params = { id: userId, updated_at: new Date().toISOString() };

  if (changes.fullName !== undefined) {
    fields.push('full_name = @full_name');
    params.full_name = changes.fullName;
  }
  if (changes.phone !== undefined) {
    fields.push('phone = @phone');
    params.phone = changes.phone || null;
  }
  if (changes.role !== undefined) {
    fields.push('role = @role');
    params.role = changes.role;
  }
  if (changes.status !== undefined) {
    fields.push('status = @status');
    params.status = changes.status;
  }
  if (changes.email !== undefined) {
    fields.push('email = @email', 'email_normalized = @email_normalized');
    params.email = String(changes.email).trim();
    params.email_normalized = normalizeEmail(changes.email);
  }
  // Cambiar rol, suspender o cambiar el correo debe invalidar los tokens vivos.
  const invalidates = changes.role !== undefined || changes.status !== undefined || changes.email !== undefined;
  if (invalidates) fields.push('token_version = token_version + 1');

  // El texto de búsqueda se recalcula a partir del estado resultante, no del
  // parcial recibido: si solo cambia el teléfono, el nombre debe seguir ahí.
  if (changes.fullName !== undefined || changes.phone !== undefined || changes.email !== undefined) {
    fields.push('search_text = @search_text');
    params.search_text = textoBusquedaUsuario({
      fullName: changes.fullName ?? user.full_name,
      email: changes.email ?? user.email,
      phone: changes.phone !== undefined ? changes.phone : user.phone,
    });
  }

  if (fields.length === 0) return user;

  try {
    db.prepare(`UPDATE users SET ${fields.join(', ')}, updated_at = @updated_at WHERE id = @id`).run(params);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      throw conflict('Ya existe una cuenta registrada con ese correo.', 'correo_en_uso');
    }
    throw error;
  }

  if (invalidates) {
    db.prepare(
      `UPDATE sessions SET revoked_at = ?, revoke_reason = 'account_changed' WHERE user_id = ? AND revoked_at IS NULL`,
    ).run(params.updated_at, userId);
    notificarSesionInvalida(userId, 'cuenta_modificada');
  }

  return findById(userId, db);
}

export function unlockUser(userId, db = getDb()) {
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    userId,
  );
  return findById(userId, db);
}

/**
 * Lista usuarios con su saldo de entradas agregado, con búsqueda por nombre,
 * correo o teléfono.
 */
export function listUsers({ limit = 50, offset = 0, search = '', role = null, status = null } = {}) {
  const db = getDb();
  const where = [];
  const params = { limit, offset, ahora: new Date().toISOString() };

  if (search) {
    // ESCAPE evita que un "%" tecleado por el usuario actúe como comodín.
    where.push("u.search_text LIKE @search ESCAPE '\\'");
    params.search = patronLike(search);
  }
  if (role) {
    where.push('u.role = @role');
    params.role = role;
  }
  if (status) {
    where.push('u.status = @status');
    params.status = status;
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT u.*,
              IFNULL(p.packs_activos, 0)   AS packs_activos,
              IFNULL(p.entradas, 0)        AS entradas_disponibles,
              IFNULL(p.packs_totales, 0)   AS packs_totales
         FROM users u
         LEFT JOIN (
              SELECT user_id,
                     SUM(CASE WHEN usable THEN 1 ELSE 0 END)         AS packs_activos,
                     SUM(CASE WHEN usable THEN remaining ELSE 0 END) AS entradas,
                     COUNT(*)                                        AS packs_totales
                FROM (
                     SELECT user_id, remaining,
                            (status = 'active' AND remaining > 0
                             AND (expires_at IS NULL OR expires_at > @ahora)) AS usable
                       FROM packs
                )
                GROUP BY user_id
         ) p ON p.user_id = u.id
         ${clause}
         ORDER BY u.created_at DESC
         LIMIT @limit OFFSET @offset`,
    )
    .all(params);

  const total = db.prepare(`SELECT COUNT(*) AS n FROM users u ${clause}`).get(params).n;

  return {
    total,
    items: rows.map((r) => ({
      ...toPublicUser(r),
      activePacks: r.packs_activos,
      availableTickets: r.entradas_disponibles,
      totalPacks: r.packs_totales,
    })),
  };
}
