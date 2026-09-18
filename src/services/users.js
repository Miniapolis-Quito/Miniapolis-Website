/** Alta, consulta y mantenimiento de usuarios. */
import { getDb, inTransaction } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { hashPassword, verifyPassword, needsRehash, HASH_FICTICIO } from '../lib/passwords.js';
import { conflict, notFound, badRequest } from '../lib/errors.js';
import { config } from '../config.js';
import { textoBusquedaUsuario, patronLike } from '../lib/texto.js';
import { consume, reset as resetRateLimit } from '../lib/rateLimit.js';
import { notificarSesionInvalida } from './sessions.js';

/** Normaliza un correo para la comparación de unicidad. */
export function normalizeEmail(email) {
  return String(email || '').normalize('NFKC').trim().toLowerCase();
}

/**
 * Solo el personal y el máster pueden llevar el permiso de escaneo.
 *
 * Se decide aquí, y no en la ruta, para que ninguna vía de entrada (alta,
 * edición, semilla o script) pueda dejar a un cliente con permiso para
 * descontar entradas ajenas.
 */
export function puedeLlevarPermisoDeEscaneo(role) {
  return role === 'master' || role === 'staff';
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
    scanEnabled: Boolean(row.scan_enabled),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    locked: Boolean(row.locked_until && row.locked_until > new Date().toISOString()),
    /** Si recibe recordatorios por correo. Los comprobantes de compra llegan igual. */
    emailReminders: row.email_reminders === undefined ? undefined : Boolean(row.email_reminders),
    emailRemindersChangedAt: row.email_reminders_changed_at ?? null,
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

/** Número de cuentas utilizables de un rol. */
export function countActiveByRole(role, db = getDb()) {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = ? AND status = 'active'").get(role).n;
}

export async function createUser({ email, password, fullName, phone, role = 'customer', createdBy = null, status = 'active', scanEnabled = false }) {
  const normalized = normalizeEmail(email);
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  const user = {
    id: newId(),
    // Persistimos la misma forma canónica que usamos para buscar y comparar;
    // así las respuestas, avisos y enlaces no dependen de cómo se escribió el
    // correo originalmente.
    email: normalized,
    email_normalized: normalized,
    full_name: String(fullName).trim(),
    phone: phone || null,
    role,
    status,
    // Una cuenta nace sin permiso para escanear salvo que se pida
    // explícitamente: el permiso se concede, nunca se hereda del rol.
    scan_enabled: scanEnabled && puedeLlevarPermisoDeEscaneo(role) ? 1 : 0,
    password_hash: passwordHash,
    password_changed_at: now,
    created_by: createdBy,
    created_at: now,
    updated_at: now,
    search_text: textoBusquedaUsuario({ fullName, email: normalized, phone }),
  };

  try {
    getDb()
      .prepare(
        `INSERT INTO users (id, email, email_normalized, full_name, phone, role, status, scan_enabled,
                            password_hash, password_changed_at, created_by, created_at, updated_at, search_text)
         VALUES (@id, @email, @email_normalized, @full_name, @phone, @role, @status, @scan_enabled,
                 @password_hash, @password_changed_at, @created_by, @created_at, @updated_at, @search_text)`,
      )
      .run(user);
  } catch (error) {
    if (String(error.message).includes('UNIQUE') && String(error.message).includes('email_normalized')) {
      throw conflict('Ya existe una cuenta registrada con ese correo.', 'correo_en_uso');
    }
    throw error;
  }

  // Si hubo intentos fallidos previos con este correo cuando la cuenta aún no
  // existía, se limpian las cuotas para que la nueva cuenta empiece sin trabas.
  resetRateLimit(`login-fantasma:${normalized}`);
  resetRateLimit(`login-cuenta:${normalized}`);

  return findById(user.id);
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
    // temporización si el correo existe. El hash ficticio lleva los parámetros
    // vigentes, así que el costo coincide con el de una cuenta real.
    await verifyPassword(password, HASH_FICTICIO);
    return fallarCuentaInexistente(email, now);
  }

  if (user.locked_until && user.locked_until > nowIso) {
    // También aquí se paga una verificación: si el bloqueo respondiera al
    // instante, el tiempo de respuesta diría qué correos tienen cuenta.
    await verifyPassword(password, HASH_FICTICIO);
    const retryAfterSeconds = Math.ceil((Date.parse(user.locked_until) - now) / 1000);
    return { ok: false, reason: 'bloqueado', retryAfterSeconds };
  }

  const valid = await verifyPassword(password, user.password_hash);

  if (!valid) {
    // El incremento lo hace la base y no JavaScript: entre la lectura de la
    // cuenta y este punto hay un `await`, así que varios intentos simultáneos
    // leían el mismo contador y cada uno escribía «uno más», dejando probar
    // muchas más contraseñas de las que permite el bloqueo.
    const updated = db
      .prepare(
        `UPDATE users SET failed_logins = failed_logins + 1, updated_at = ?
           WHERE id = ? AND password_hash = ? AND token_version = ?
           RETURNING failed_logins`,
      )
      .get(nowIso, user.id, user.password_hash, user.token_version);
    if (!updated) {
      // La contraseña o la versión de la cuenta cambió mientras se verificaba
      // la anterior (por recuperación, administración u otro dispositivo).
      // Ese intento antiguo no debe sumar fallos a la cuenta nueva.
      return { ok: false, reason: 'credenciales' };
    }
    const { failed_logins: failed } = updated;
    const shouldLock = failed >= config.security.maxLoginAttempts;
    if (shouldLock) {
      db.prepare('UPDATE users SET failed_logins = 0, locked_until = ?, updated_at = ? WHERE id = ?').run(
        new Date(now + config.security.lockoutSeconds * 1000).toISOString(),
        nowIso,
        user.id,
      );
      return { ok: false, reason: 'bloqueado', retryAfterSeconds: config.security.lockoutSeconds };
    }
    return { ok: false, reason: 'credenciales', attemptsLeft: config.security.maxLoginAttempts - failed };
  }

  // Un intento simultáneo pudo bloquear la cuenta mientras se verificaba este:
  // acertar la contraseña en esa carrera no debe servir para saltarse el bloqueo.
  const actual = findById(user.id, db);
  if (!actual) return { ok: false, reason: 'credenciales' };
  if (actual.locked_until && actual.locked_until > nowIso) {
    const retryAfterSeconds = Math.ceil((Date.parse(actual.locked_until) - now) / 1000);
    return { ok: false, reason: 'bloqueado', retryAfterSeconds };
  }

  if (actual.status !== 'active') return { ok: false, reason: 'suspendido' };
  if (actual.password_hash !== user.password_hash || actual.token_version !== user.token_version) {
    // No permitimos que una verificación iniciada antes de un cambio de
    // contraseña/cuenta termine autenticando con datos obsoletos.
    return { ok: false, reason: 'credenciales' };
  }

  // Login correcto: se limpia el contador y, si el hash quedó con parámetros
  // antiguos, se recalcula de forma transparente.
  let passwordHash = user.password_hash;
  if (needsRehash(passwordHash)) {
    passwordHash = await hashPassword(password);
  }
  const loginUpdated = db
    .prepare(
      `UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ?, password_hash = ?, updated_at = ?
         WHERE id = ? AND password_hash = ? AND token_version = ? AND status = 'active'`,
    )
    .run(nowIso, passwordHash, nowIso, user.id, user.password_hash, user.token_version);
  if (loginUpdated.changes !== 1) return { ok: false, reason: 'credenciales' };

  return { ok: true, user: findById(user.id, db) };
}

/** Mientras cuenta los fallos de un correo sin cuenta, la cuota dura lo que un mes. */
const VENTANA_FALLOS_FANTASMA_SECONDS = 30 * 24 * 3600;

/**
 * Un correo que no tiene cuenta se comporta igual que uno que sí la tiene: al
 * llegar al máximo de intentos fallidos «se bloquea» durante el mismo tiempo.
 * Si solo las cuentas reales se bloquearan, bastaría con fallar unas cuantas
 * veces para saber qué correos están registrados.
 */
function fallarCuentaInexistente(email, now) {
  const { maxLoginAttempts, lockoutSeconds } = config.security;
  const clave = `login-fantasma:${normalizeEmail(email)}`;
  const cuota = consume(clave, { limit: maxLoginAttempts, windowSeconds: VENTANA_FALLOS_FANTASMA_SECONDS, now });

  if (!cuota.allowed) {
    return { ok: false, reason: 'bloqueado', retryAfterSeconds: cuota.retryAfterSeconds };
  }
  if (cuota.remaining <= 0) {
    // Igual que en una cuenta real, el bloqueo empieza con el intento que lo
    // provoca y dura exactamente `lockoutSeconds`.
    getDb()
      .prepare('UPDATE rate_limits SET expires_at = ? WHERE key = ?')
      .run(new Date(now + lockoutSeconds * 1000).toISOString(), clave);
    return { ok: false, reason: 'bloqueado', retryAfterSeconds: lockoutSeconds };
  }
  return { ok: false, reason: 'credenciales' };
}

export async function changePassword(userId, currentPassword, newPassword) {
  const db = getDb();
  const user = findById(userId, db);
  if (!user) throw notFound('Usuario no encontrado.');
  const valid = await verifyPassword(currentPassword, user.password_hash);
  if (!valid) throw badRequest('La contraseña actual no es correcta.', { fields: { currentPassword: 'Contraseña incorrecta.' } }, 'password_incorrecta');
  if (await verifyPassword(newPassword, user.password_hash)) {
    throw badRequest(
      'La contraseña nueva debe ser distinta a la anterior.',
      { fields: { newPassword: 'Debe ser distinta a la anterior.' } },
      'password_repetida',
    );
  }
  // El hash leído queda como testigo: si otra operación cambia la cuenta
  // mientras se calculan los hashes, este cambio no puede sobrescribirla.
  return setPassword(userId, newPassword, { expectedPasswordHash: user.password_hash });
}

/** Deja sin efecto los enlaces de recuperación pendientes de una cuenta. */
export function invalidarEnlacesDeRecuperacion(db, userId, motivo, ahoraIso = new Date().toISOString()) {
  return db
    .prepare(
      `UPDATE password_resets SET invalidated_at = ?, invalidated_reason = ?
        WHERE user_id = ? AND used_at IS NULL AND invalidated_at IS NULL`,
    )
    .run(ahoraIso, motivo, userId).changes;
}

/**
 * Escribe un hash de contraseña nuevo y todo lo que un cambio arrastra: cierra
 * las sesiones, invalida los tokens de acceso vivos, levanta el bloqueo por
 * intentos y deja sin efecto los enlaces de recuperación pendientes.
 *
 * Es síncrona y debe llamarse dentro de una transacción: la recuperación la
 * usa en la misma que canjea el enlace.
 */
export function escribirPassword(db, userId, passwordHash, { ahoraIso = new Date().toISOString(), motivo = 'password_changed' } = {}) {
  const updated = db.prepare(
    `UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ?,
            token_version = token_version + 1, failed_logins = 0, locked_until = NULL
      WHERE id = ?`,
  ).run(passwordHash, ahoraIso, ahoraIso, userId);
  if (updated.changes !== 1) return false;
  db.prepare(
    `UPDATE sessions SET revoked_at = ?, revoke_reason = ?
      WHERE user_id = ? AND revoked_at IS NULL`,
  ).run(ahoraIso, motivo, userId);
  invalidarEnlacesDeRecuperacion(db, userId, 'password_cambiada', ahoraIso);
  return true;
}

/** Cambia la contraseña e invalida todas las sesiones activas del usuario. */
export async function setPassword(userId, newPassword, { expectedPasswordHash = null } = {}) {
  const db = getDb();
  const passwordHash = await hashPassword(newPassword);
  const changed = inTransaction(() => {
    if (expectedPasswordHash !== null) {
      const actual = findById(userId, db);
      if (!actual || actual.password_hash !== expectedPasswordHash) {
        throw badRequest(
          'La cuenta cambió mientras se actualizaba. Comprueba la contraseña actual e intenta de nuevo.',
          null,
          'password_cambio_concurrente',
        );
      }
    }
    return escribirPassword(db, userId, passwordHash);
  });
  if (!changed) throw notFound('Usuario no encontrado.');
  const user = findById(userId, db);
  if (user) {
    resetRateLimit(`login-cuenta:${user.email_normalized}`);
    resetRateLimit(`password-actual-fallos:${userId}`);
  }
  notificarSesionInvalida(userId, 'password_cambiada');
  return user;
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

  // El permiso de escaneo y el rol se resuelven juntos: si alguien deja de ser
  // personal, pierde el permiso en la misma operación. Dejarlo para una
  // segunda llamada abriría una ventana en la que un cliente podría escanear.
  const rolResultante = changes.role ?? user.role;
  const permisoPedido = changes.scanEnabled;
  const permisoResultante = permisoPedido === undefined ? Boolean(user.scan_enabled) : permisoPedido;
  const permisoFinal = permisoResultante && puedeLlevarPermisoDeEscaneo(rolResultante);
  if (permisoFinal !== Boolean(user.scan_enabled)) {
    fields.push('scan_enabled = @scan_enabled');
    params.scan_enabled = permisoFinal ? 1 : 0;
  }
  if (changes.email !== undefined) {
    fields.push('email = @email', 'email_normalized = @email_normalized');
    params.email = normalizeEmail(changes.email);
    params.email_normalized = params.email;
  }
  // Cambiar rol, suspender, cambiar el correo o retirar el permiso de escaneo
  // debe invalidar los tokens vivos: quien esté con el escáner abierto en la
  // puerta tiene que volver a identificarse, no seguir con lo que ya tenía.
  const pierdePermiso = Boolean(user.scan_enabled) && !permisoFinal;
  const invalidates =
    changes.role !== undefined || changes.status !== undefined || changes.email !== undefined || pierdePermiso;
  if (invalidates) fields.push('token_version = token_version + 1');

  // El texto de búsqueda se recalcula a partir del estado resultante, no del
  // parcial recibido: si solo cambia el teléfono, el nombre debe seguir ahí.
  if (changes.fullName !== undefined || changes.phone !== undefined || changes.email !== undefined) {
    fields.push('search_text = @search_text');
    params.search_text = textoBusquedaUsuario({
      fullName: changes.fullName ?? user.full_name,
      email: changes.email !== undefined ? params.email : user.email,
      phone: changes.phone !== undefined ? changes.phone : user.phone,
    });
  }

  if (fields.length === 0) return user;

  const guardar = db.transaction(() => {
    // La comprobación de la ruta administrativa no basta: dos peticiones
    // concurrentes podrían ver dos másters activos y degradarlos a la vez.
    // Repetirla dentro de la transacción de escritura garantiza que siempre
    // sobreviva al menos uno, incluso si otra operación acaba de cambiar la
    // cuenta que estamos contando.
    const dejaDeSerMasterActivo =
      user.role === 'master' && (changes.role === 'customer' || changes.role === 'staff' || changes.status === 'suspended');
    if (dejaDeSerMasterActivo) {
      const activos = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'master' AND status = 'active'").get().n;
      if (activos <= 1) throw conflict('Debe quedar al menos un usuario máster activo.', 'ultimo_master');
    }

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
      // Un enlace de recuperación iba a la dirección de antes, o a una cuenta
      // que ahora está suspendida o tiene otro rol: ya no debe servir. Todo va
      // en la misma transacción que el cambio para cerrar la ventana de carrera.
      invalidarEnlacesDeRecuperacion(db, userId, 'cuenta_modificada', params.updated_at);
      notificarSesionInvalida(userId, 'cuenta_modificada');
    }

    return findById(userId, db);
  });
  return guardar.immediate();
}

export function unlockUser(userId, db = getDb()) {
  const user = findById(userId, db);
  if (!user) throw notFound('Usuario no encontrado.');
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    userId,
  );
  resetRateLimit(`login-cuenta:${user.email_normalized}`);
  resetRateLimit(`password-actual-fallos:${userId}`);
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
