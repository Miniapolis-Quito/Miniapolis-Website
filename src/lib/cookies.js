/** Manejo de la cookie de refresco (httpOnly, no accesible desde JavaScript). */
import { config } from '../config.js';

export const REFRESH_COOKIE = 'rh_refresh';
const COOKIE_PATH = '/api/auth';

/** Parser mínimo de la cabecera Cookie; evita una dependencia adicional. */
export function parseCookies(req) {
  const header = req.headers?.cookie;
  const out = {};
  if (typeof header !== 'string' || header.length === 0 || header.length > 8192) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key || key in out) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function cookieParser(req, res, next) {
  req.cookies = parseCookies(req);
  next();
}

export function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.security.cookieSecure,
    sameSite: 'strict',
    path: COOKIE_PATH,
    maxAge: config.tokens.refreshTtlSeconds * 1000,
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: config.security.cookieSecure,
    sameSite: 'strict',
    path: COOKIE_PATH,
  });
}

/**
 * El refresh token llega normalmente en la cookie. Se admite también en el
 * cuerpo para clientes que no son navegador (por ejemplo, un tótem de la pista).
 */
export function readRefreshToken(req) {
  const fromCookie = req.cookies?.[REFRESH_COOKIE];
  if (typeof fromCookie === 'string' && fromCookie.length > 0) return fromCookie;
  const fromBody = req.body?.refreshToken;
  if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody;
  return null;
}
