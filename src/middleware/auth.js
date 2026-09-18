/** Autenticación por token de acceso y control de roles. */
import { verifyAccessToken } from '../lib/jwt.js';
import { getDb } from '../db/index.js';
import { isSessionActive } from '../services/sessions.js';
import { pendienteDeActivar } from '../services/dosFactores.js';
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
    // Se lee de la base en cada petición, igual que el rol: retirar el permiso
    // surte efecto en el siguiente escaneo, sin esperar a que caduque nada.
    scanEnabled: Boolean(row.scan_enabled),
    // También se lee en cada petición: si la administración retira el segundo
    // factor de una cuenta, la siguiente petición ya lo sabe.
    twoFactorEnabled: Boolean(row.totp_enabled),
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

/**
 * Si la pista exige verificación en dos pasos al personal y esta cuenta aún no
 * la tiene, sus permisos quedan en suspenso: puede entrar y configurarla desde
 * su cuenta, pero no tocar el panel ni descontar entradas. La comprobación se
 * hace aquí, en el guardián de permisos, y no en cada ruta: así ninguna ruta
 * nueva puede olvidarse de ella.
 */
export function bloqueoPorDosFactores(user) {
  if (!pendienteDeActivar(user)) return null;
  return forbidden(
    'Esta pista exige verificación en dos pasos al personal. Actívala en «Seguridad», dentro de tu cuenta, para recuperar tus permisos.',
    'dos_factores_requerido',
  );
}

/** Exige un rol mínimo: master > staff > customer. */
export function requireRole(minimumRole) {
  const required = ROLE_RANK[minimumRole];
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    if ((ROLE_RANK[req.user.role] ?? 0) < required) {
      return next(forbidden('Tu cuenta no tiene permisos para esta acción.'));
    }
    const pendiente = bloqueoPorDosFactores(req.user);
    if (pendiente) return next(pendiente);
    return next();
  };
}

export const requireMaster = requireRole('master');
export const requireStaff = requireRole('staff');

/**
 * Exige permiso explícito para usar el escáner de la puerta.
 *
 * El rol de personal abre la pantalla; este permiso es el que deja descontar
 * entradas. Se concede cuenta por cuenta desde la administración, incluso a
 * los másteres, para que la respuesta a "¿quién puede tocar el saldo de un
 * cliente?" sea siempre una lista corta y revisable.
 */
export function requireScanner(req, res, next) {
  if (!req.user) return requireAuth(req, res, next);
  if ((ROLE_RANK[req.user.role] ?? 0) < ROLE_RANK.staff) {
    return next(forbidden('Tu cuenta no tiene permisos para esta acción.'));
  }
  const pendiente = bloqueoPorDosFactores(req.user);
  if (pendiente) return next(pendiente);
  if (!req.user.scanEnabled) {
    return next(
      forbidden(
        'Tu cuenta no está autorizada para escanear. Pídele al administrador que te habilite el escáner.',
        'escaneo_no_autorizado',
      ),
    );
  }
  return next();
}
