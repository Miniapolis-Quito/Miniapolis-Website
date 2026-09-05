/**
 * Logger estructurado mínimo (JSON en producción, legible en desarrollo).
 * Redacta automáticamente campos sensibles para que nunca acaben en disco.
 */
import { config } from '../config.js';

const LEVELS = { silent: 100, error: 40, warn: 30, info: 20, debug: 10 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

const SENSITIVE = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'password_hash',
  'token',
  'accessToken',
  'refreshToken',
  'refresh_token',
  'authorization',
  'cookie',
  'secret',
  'qrPayload',
  'payload',
  'ticket',
]);

function redact(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE.has(key) ? '[redactado]' : redact(val, depth + 1);
  }
  return out;
}

function emit(level, message, meta) {
  if (LEVELS[level] < threshold) return;
  const entry = { ts: new Date().toISOString(), level, message, ...(meta ? redact(meta) : {}) };
  const line = config.isProduction
    ? JSON.stringify(entry)
    : `${entry.ts} ${level.toUpperCase().padEnd(5)} ${message}${meta ? ' ' + JSON.stringify(redact(meta)) : ''}`;
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const logger = {
  error: (message, meta) => emit('error', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  info: (message, meta) => emit('info', message, meta),
  debug: (message, meta) => emit('debug', message, meta),
};

export default logger;
