/**
 * Tokens de acceso firmados (JWT compacto, HS256) implementados sobre el
 * módulo crypto de Node: sin dependencias externas y con verificación en
 * tiempo constante.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const ISSUER = 'racing-hobbies-tickets';

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function signAccessToken(claims, { ttlSeconds = config.tokens.accessTtlSeconds } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    ...claims,
    iss: ISSUER,
    iat: now,
    nbf: now - 5, // tolerancia mínima de reloj
    exp: now + ttlSeconds,
    jti: crypto.randomUUID(),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${HEADER}.${body}`;
  return `${data}.${sign(data, config.secrets.accessToken)}`;
}

/**
 * Verifica un token. Devuelve `{ ok, payload }` o `{ ok:false, reason }`.
 * Nunca lanza: cualquier entrada malformada se trata como token inválido.
 */
export function verifyAccessToken(token) {
  if (typeof token !== 'string' || token.length > 4096) return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [header, body, signature] = parts;
  if (header !== HEADER) return { ok: false, reason: 'alg' };

  const expected = sign(`${header}.${body}`, config.secrets.accessToken);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'signature' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'malformed' };
  if (payload.iss !== ISSUER) return { ok: false, reason: 'issuer' };

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || now >= payload.exp) return { ok: false, reason: 'expired' };
  if (typeof payload.nbf === 'number' && now < payload.nbf) return { ok: false, reason: 'not_yet_valid' };

  return { ok: true, payload };
}

/** Hash determinista de un refresh token, para guardarlo sin poder revertirlo. */
export function hashRefreshToken(token) {
  return crypto.createHmac('sha256', config.secrets.refreshToken).update(String(token)).digest('hex');
}
