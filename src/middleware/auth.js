/** Autenticación por token de acceso y control de roles. */
import { verifyAccessToken } from '../lib/jwt.js';
import { getDb } from '../db/index.js';
import { isSessionActive } from '../services/sessions.js';
import { unauthorized, forbidden } from '../lib/errors.js';

const ROLE_RANK = { customer: 1, staff: 2, master: 3 };

function extractToken(req) {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

/**
 * Resuelve `req.user` a partir del token. No falla si no hay token: eso lo
 * decide `requireAuth`. Se revalida contra la base para que suspender a un
 * usuario o cambiarle el rol surta efecto de inmediato, sin esperar a que
 * caduque su token.
 */
export function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) return next();

  const result = verifyAccessToken(token);
  if (!result.ok) {
    req.authError = result.reason;
    return next();
  }

  const payload = result.payload;
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
  if (!row) {
    req.authError = 'usuario_inexistente';
    return next();
  }
  if (row.status !== 'active') {
    req.authError = 'suspendido';
    return next();
  }
  if (row.token_version !== payload.ver) {
    req.authError = 'token_obsoleto';
    return next();
  }
  if (!payload.sid || !isSessionActive(payload.sid)) {
    req.authError = 'sesion_cerrada';
    return next();
  }

  req.user = {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    status: row.status,
    sessionId: payload.sid,
  };
  return next();
}

const AUTH_MESSAGES = {
  expired: 'Tu sesión expiró. Vuelve a entrar.',
  suspendido: 'Tu cuenta está suspendida. Contacta con el administrador.',
  token_obsoleto: 'Tu sesión ya no es válida. Vuelve a entrar.',
  sesion_cerrada: 'Tu sesión fue cerrada. Vuelve a entrar.',
};

export function requireAuth(req, res, next) {
  if (req.user) return next();
  const reason = req.authError;
  return next(
    unauthorized(AUTH_MESSAGES[reason] || 'Necesitas iniciar sesión.', reason === 'expired' ? 'token_expirado' : 'no_autenticado'),
  );
}

/** Exige un rol mínimo: master > staff > customer. */
export function requireRole(minimumRole) {
  const required = ROLE_RANK[minimumRole];
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    if ((ROLE_RANK[req.user.role] ?? 0) >= required) return next();
    return next(forbidden('Tu cuenta no tiene permisos para esta acción.'));
  };
}

export const requireMaster = requireRole('master');
export const requireStaff = requireRole('staff');
