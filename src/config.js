/**
 * Configuración central de la aplicación.
 *
 * Toda la configuración se toma de variables de entorno. En producción
 * (NODE_ENV=production) los secretos son obligatorios: el proceso se niega a
 * arrancar con valores por defecto inseguros.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');

/** Carga un archivo .env sin dependencias externas. No sobreescribe env ya definidas. */
function loadDotEnv(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv(process.env.ENV_FILE || path.join(ROOT_DIR, '.env'));

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

function requiredSecret(name, minLength = 32) {
  const value = process.env[name];
  if (value && value.length >= minLength) return value;
  if (isProduction) {
    throw new Error(
      `Configuración inválida: la variable ${name} es obligatoria en producción y debe tener al menos ${minLength} caracteres. ` +
        `Genera una con: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`,
    );
  }
  // Fuera de producción se genera un secreto efímero para poder desarrollar sin fricción.
  return crypto.randomBytes(48).toString('base64url');
}

function num(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Configuración inválida: ${name} debe ser numérico (recibido "${raw}").`);
  }
  if (parsed < min || parsed > max) {
    throw new Error(`Configuración inválida: ${name} debe estar entre ${min} y ${max} (recibido ${parsed}).`);
  }
  return parsed;
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'si', 'sí', 'on'].includes(raw.toLowerCase());
}

function list(name, fallback = []) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = Object.freeze({
  env: NODE_ENV,
  isProduction,
  isTest,

  /** Puerto e interfaz de escucha. */
  port: num('PORT', 3000, { min: 0, max: 65535 }),
  host: process.env.HOST || '0.0.0.0',

  /** Nombre público del negocio, usado en la interfaz y en los QR. */
  brandName: process.env.BRAND_NAME || 'Racing Hobbies Ecuador',
  brandShort: process.env.BRAND_SHORT || 'Racing Hobbies',
  currency: process.env.CURRENCY || 'USD',
  timezone: process.env.TZ_DISPLAY || 'America/Guayaquil',

  /** Base de datos SQLite. ':memory:' se admite para pruebas. */
  databaseFile: process.env.DATABASE_FILE || path.join(ROOT_DIR, 'data', 'tickets.db'),

  secrets: {
    /** Firma de los tokens de acceso (JWT HS256). */
    accessToken: requiredSecret('ACCESS_TOKEN_SECRET'),
    /** Derivación del hash de los refresh tokens guardados en base. */
    refreshToken: requiredSecret('REFRESH_TOKEN_SECRET'),
    /** Clave maestra para firmar los códigos QR de los packs. */
    qr: requiredSecret('QR_SECRET'),
  },

  tokens: {
    accessTtlSeconds: num('ACCESS_TOKEN_TTL', 15 * 60, { min: 60, max: 3600 }),
    refreshTtlSeconds: num('REFRESH_TOKEN_TTL', 30 * 24 * 3600, { min: 3600 }),
    streamTicketTtlSeconds: 60,
  },

  qr: {
    /** Ventana de validez de un QR dinámico, en segundos (incluye tolerancia de reloj). */
    ttlSeconds: num('QR_TTL_SECONDS', 120, { min: 30, max: 900 }),
    /** Cada cuántos segundos el cliente refresca el QR mostrado en pantalla. */
    refreshSeconds: num('QR_REFRESH_SECONDS', 30, { min: 10, max: 300 }),
  },

  redemption: {
    /**
     * Segundos que deben pasar entre dos consumos del mismo pack. Evita que un
     * doble escaneo accidental descuente dos entradas.
     */
    cooldownSeconds: num('REDEEM_COOLDOWN_SECONDS', 20, { min: 0, max: 3600 }),
  },

  security: {
    /** Orígenes permitidos para CORS. Vacío = solo mismo origen. */
    corsOrigins: list('CORS_ORIGINS', []),
    /** Marca Secure en las cookies. Por defecto activa en producción. */
    cookieSecure: bool('COOKIE_SECURE', isProduction),
    /** Confiar en X-Forwarded-For (activar solo detrás de un proxy conocido). */
    trustProxy: bool('TRUST_PROXY', false),
    /** Tamaño máximo del cuerpo JSON aceptado. */
    maxBodyBytes: num('MAX_BODY_BYTES', 64 * 1024, { min: 1024 }),
    /** Intentos fallidos de login antes de bloquear temporalmente la cuenta. */
    maxLoginAttempts: num('MAX_LOGIN_ATTEMPTS', 8, { min: 3, max: 100 }),
    lockoutSeconds: num('LOGIN_LOCKOUT_SECONDS', 15 * 60, { min: 60 }),
    /** Permite el auto-registro de clientes desde la web pública. */
    allowSelfRegistration: bool('ALLOW_SELF_REGISTRATION', true),
    /** Longitud mínima de contraseña. */
    minPasswordLength: num('MIN_PASSWORD_LENGTH', 10, { min: 8, max: 128 }),
  },

  /** Cuenta máster inicial creada en el primer arranque, si se define. */
  bootstrap: {
    masterEmail: process.env.MASTER_EMAIL || '',
    masterPassword: process.env.MASTER_PASSWORD || '',
    masterName: process.env.MASTER_NAME || 'Administrador',
  },

  /** Catálogo de packs vendibles. */
  packCatalog: [
    { size: 5, priceCents: num('PACK_5_PRICE_CENTS', 2500, { min: 0 }), label: 'Pack 5 entradas' },
    { size: 10, priceCents: num('PACK_10_PRICE_CENTS', 4500, { min: 0 }), label: 'Pack 10 entradas' },
  ],

  logLevel: process.env.LOG_LEVEL || (isTest ? 'silent' : 'info'),
});

export default config;
