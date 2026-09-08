/**
 * Limitación de tasa con ventana fija, persistida en SQLite.
 *
 * Se guarda en base (y no en memoria) para que los límites sobrevivan a un
 * reinicio del proceso: si alguien está probando contraseñas, reiniciar el
 * servidor no debe regalarle una cuota nueva.
 */
import { getDb, inTransaction } from '../db/index.js';
import { tooManyRequests } from './errors.js';

const CLEANUP_EVERY_MS = 60_000;
let lastCleanup = 0;

function cleanup(db, nowIso) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_EVERY_MS) return;
  lastCleanup = now;
  db.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').run(nowIso);
  db.prepare('DELETE FROM used_nonces WHERE expires_at <= ?').run(nowIso);
  db.prepare('DELETE FROM idempotency_keys WHERE expires_at <= ?').run(nowIso);
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso);
}

/**
 * Consume una unidad de cuota para `key`.
 * @returns {{allowed:boolean, remaining:number, retryAfterSeconds:number, limit:number}}
 */
export function consume(key, { limit, windowSeconds, now = Date.now() }) {
  const db = getDb();
  const nowIso = new Date(now).toISOString();
  // La lectura y el incremento deben ser indivisibles. Sin la transacción,
  // dos procesos Node que compartan la misma base podían leer la misma cuota y
  // ambos autorizar una petición adicional.
  return inTransaction(() => {
    cleanup(db, nowIso);

    const row = db.prepare('SELECT count, window_start, expires_at FROM rate_limits WHERE key = ?').get(key);

    if (!row || row.expires_at <= nowIso) {
      const expiresAt = new Date(now + windowSeconds * 1000).toISOString();
      db.prepare(
        `INSERT INTO rate_limits (key, count, window_start, expires_at) VALUES (?, 1, ?, ?)
         ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start, expires_at = excluded.expires_at`,
      ).run(key, nowIso, expiresAt);
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0, limit };
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(row.expires_at) - now) / 1000));
    if (row.count >= limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds, limit };
    }

    db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').run(key);
    return { allowed: true, remaining: limit - row.count - 1, retryAfterSeconds, limit };
  });
}

export function reset(key) {
  getDb().prepare('DELETE FROM rate_limits WHERE key = ?').run(key);
}

/**
 * Middleware de Express. `keyFn` decide el ámbito del límite (IP, usuario, ...).
 */
export function rateLimit({ name, limit, windowSeconds, keyFn, message }) {
  return (req, res, next) => {
    const scope = keyFn ? keyFn(req) : req.clientIp;
    if (scope === null || scope === undefined) return next();
    const key = `${name}:${scope}`;
    const result = consume(key, { limit, windowSeconds });
    res.set('RateLimit-Limit', String(limit));
    res.set('RateLimit-Remaining', String(Math.max(0, result.remaining)));
    if (!result.allowed) {
      res.set('Retry-After', String(result.retryAfterSeconds));
      return next(
        tooManyRequests(
          message || `Demasiados intentos. Espera ${result.retryAfterSeconds} segundos e inténtalo de nuevo.`,
          { retryAfterSeconds: result.retryAfterSeconds },
        ),
      );
    }
    req.rateLimitKey = key;
    return next();
  };
}
