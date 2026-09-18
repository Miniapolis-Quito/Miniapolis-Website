/**
 * Configuración central de la aplicación.
 *
 * Toda la configuración se toma de variables de entorno. En producción
 * (NODE_ENV=production) los secretos son obligatorios: el proceso se niega a
 * arrancar con valores por defecto inseguros.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { isIP } from 'node:net';
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

/**
 * Valores publicados en los archivos de ejemplo de este repositorio. Cumplen la
 * longitud mínima, así que sin esta lista una instalación que copiara
 * `.env.development.example` arrancaría en producción con secretos y una
 * contraseña de administrador que conoce cualquiera con acceso al código.
 */
const VALORES_DE_EJEMPLO = new Set([
  'desarrollo-access-cambiame-por-uno-de-verdad-00',
  'desarrollo-refresh-cambiame-por-uno-de-verdad-0',
  'desarrollo-qr-cambiame-por-uno-de-verdad-000000',
  'Pista-RC-Master-2026',
  'Pista-Demo-2026',
]);

function rechazarValorDeEjemplo(name, value) {
  if (!isProduction || !value) return;
  if (VALORES_DE_EJEMPLO.has(value) || /c[aá]mbiame|changeme/i.test(value)) {
    throw new Error(
      `Configuración inválida: ${name} tiene un valor de ejemplo publicado en el repositorio. ` +
        'Genera uno propio con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }
}

/** Qué secreto se usó ya para qué: cada uso debe tener el suyo. */
const secretosUsados = new Map();

function requiredSecret(name, minLength = 32) {
  const value = process.env[name];
  rechazarValorDeEjemplo(name, value);
  if (isProduction && value && secretosUsados.has(value)) {
    // Un mismo secreto para firmar sesiones y QR haría que filtrar uno
    // comprometiera los dos.
    throw new Error(`Configuración inválida: ${name} repite el valor de ${secretosUsados.get(value)}. Cada secreto debe ser distinto.`);
  }
  if (value) secretosUsados.set(value, name);
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

/**
 * Direcciones de los proxies desde los que se acepta X-Forwarded-For. Confiar
 * en cualquier proxy permitiría que alguien que alcance Node directamente
 * eligiera su propia IP y esquivara los límites de intentos.
 */
function trustedProxyIps() {
  if (!bool('TRUST_PROXY', false)) return [];

  const entries = list('TRUSTED_PROXY_IPS');
  if (entries.length === 0) {
    if (isProduction) {
      throw new Error(
        'Configuración inválida: TRUST_PROXY=true exige TRUSTED_PROXY_IPS en producción. ' +
          'Indica la IP o red CIDR del proxy inverso (por ejemplo, "127.0.0.1,::1").',
      );
    }
    // Para desarrollo, el único proxy razonable sin configuración explícita es
    // uno local (Caddy/nginx en la misma máquina). Nunca se confía en Internet.
    return ['127.0.0.1', '::1'];
  }

  for (const entry of entries) {
    const [address, prefix, ...extra] = entry.split('/');
    const family = isIP(address);
    const maxPrefix = family === 4 ? 32 : family === 6 ? 128 : -1;
    if (
      extra.length > 0 ||
      maxPrefix < 0 ||
      (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > maxPrefix))
    ) {
      throw new Error(
        `Configuración inválida: TRUSTED_PROXY_IPS contiene "${entry}". Usa una IP o una red CIDR válida.`,
      );
    }
  }
  return entries;
}

/**
 * Lee un secreto que puede venir en la variable o en un archivo apuntado por
 * ella. Los certificados y las claves privadas se guardan en disco, con sus
 * permisos, y no pegados en el entorno.
 */
function secretoOArchivo(nombre) {
  const valor = (process.env[nombre] || '').trim();
  if (!valor) return '';
  // Una clave en PEM empieza por "-----BEGIN"; cualquier otra cosa es una ruta.
  if (valor.startsWith('-----BEGIN')) return valor.replace(/\\n/g, '\n');
  try {
    return fs.readFileSync(path.resolve(ROOT_DIR, valor), 'utf8');
  } catch (error) {
    throw new Error(`Configuración inválida: no se pudo leer ${nombre} desde "${valor}": ${error.message}`);
  }
}

/** Valida la base pública usada para construir enlaces sensibles. */
function publicUrl() {
  const raw = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return '';

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Configuración inválida: PUBLIC_URL debe ser una URL absoluta HTTP(S).');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      'Configuración inválida: PUBLIC_URL debe ser una URL HTTP(S) sin credenciales, consulta ni fragmento.',
    );
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

/**
 * Pases para la cartera del teléfono (Apple Wallet y Google Wallet).
 *
 * Cada plataforma se activa por su cuenta y solo si están todos sus datos: sin
 * credenciales la función queda apagada y el resto del sistema no se entera.
 * Las credenciales las emite el negocio —Apple pide una cuenta de desarrollador
 * y Google una cuenta de servicio—, así que no hay valores por defecto que
 * puedan colarse en producción.
 */
function wallet() {
  const apple = {
    passTypeId: process.env.APPLE_PASS_TYPE_ID || '',
    teamId: process.env.APPLE_TEAM_ID || '',
    certificate: secretoOArchivo('APPLE_PASS_CERTIFICATE'),
    key: secretoOArchivo('APPLE_PASS_KEY'),
    keyPassword: process.env.APPLE_PASS_KEY_PASSWORD || '',
    wwdrCertificate: secretoOArchivo('APPLE_WWDR_CERTIFICATE'),
    apnsKeyId: process.env.APPLE_APNS_KEY_ID || '',
    apnsKey: secretoOArchivo('APPLE_APNS_KEY'),
    apnsHost: process.env.APPLE_APNS_HOST || 'api.push.apple.com',
  };
  apple.enabled = Boolean(
    apple.passTypeId && apple.teamId && apple.certificate && apple.key && apple.wwdrCertificate,
  );
  // El envío push es opcional: sin él el pase se crea igual, pero el saldo solo
  // se actualiza cuando el teléfono lo consulta por su cuenta.
  apple.pushEnabled = Boolean(apple.enabled && apple.apnsKeyId && apple.apnsKey && apple.teamId);

  const google = {
    issuerId: process.env.GOOGLE_WALLET_ISSUER_ID || '',
    serviceAccountEmail: process.env.GOOGLE_WALLET_SERVICE_ACCOUNT || '',
    privateKey: secretoOArchivo('GOOGLE_WALLET_PRIVATE_KEY'),
    classSuffix: process.env.GOOGLE_WALLET_CLASS || 'entradas',
  };
  google.enabled = Boolean(google.issuerId && google.serviceAccountEmail && google.privateKey);
  google.classId = google.enabled ? `${google.issuerId}.${google.classSuffix}` : '';

  return { apple, google, enabled: apple.enabled || google.enabled };
}

/**
 * Correo saliente. Hoy lo usa la recuperación de contraseña.
 *
 * Con SMTP_HOST se usa SMTP; MAIL_TRANSPORT puede pedir además `memoria` (solo
 * pruebas) o `consola` (nunca en producción). Sin nada de eso, el correo queda
 * apagado y la recuperación no se ofrece. Una configuración a medias no
 * arranca: es mejor enterarse al desplegar que cuando alguien pide un enlace.
 */
function correo() {
  const pedido = (process.env.MAIL_TRANSPORT || '').trim().toLowerCase();
  if (!['', 'smtp', 'memoria', 'consola'].includes(pedido)) {
    throw new Error(`Configuración inválida: MAIL_TRANSPORT debe ser "smtp", "memoria" o "consola" (recibido "${pedido}").`);
  }

  const host = (process.env.SMTP_HOST || '').trim();
  const port = num('SMTP_PORT', 587, { min: 1, max: 65535 });
  const secure = bool('SMTP_SECURE', port === 465);
  const requireTLS = secure ? false : bool('SMTP_REQUIRE_TLS', true);
  const archivoClave = (process.env.SMTP_PASSWORD_FILE || '').trim();
  let password = process.env.SMTP_PASSWORD || '';
  if (archivoClave) {
    try {
      password = fs.readFileSync(path.resolve(ROOT_DIR, archivoClave), 'utf8').trim();
    } catch (error) {
      throw new Error(`Configuración inválida: no se pudo leer SMTP_PASSWORD_FILE desde "${archivoClave}": ${error.message}`);
    }
  }

  const from = (process.env.MAIL_FROM || '').trim();
  if (/[\r\n]/.test(from)) throw new Error('Configuración inválida: MAIL_FROM no puede tener saltos de línea.');

  const modo = pedido || (host ? 'smtp' : '');
  if (modo === 'memoria' && !isTest) {
    throw new Error('Configuración inválida: MAIL_TRANSPORT=memoria solo existe para las pruebas.');
  }
  if (modo === 'consola' && isProduction) {
    throw new Error(
      'Configuración inválida: MAIL_TRANSPORT=consola escribe en el registro enlaces que dan acceso a cuentas; no se admite en producción.',
    );
  }
  if (modo === 'smtp') {
    if (!host) throw new Error('Configuración inválida: el correo por SMTP necesita SMTP_HOST.');
    const direccion = from.match(/<([^<>]+)>\s*$/)?.[1] ?? from;
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(direccion)) {
      throw new Error('Configuración inválida: MAIL_FROM debe ser una dirección, por ejemplo "Miniápolis <entradas@tu-dominio.ec>".');
    }
    const local = ['localhost', '127.0.0.1', '::1'].includes(host);
    if (!secure && !requireTLS && !local) {
      throw new Error(
        'Configuración inválida: SMTP_REQUIRE_TLS=false solo se admite con un relé en la propia máquina; el correo lleva enlaces que dan acceso a cuentas.',
      );
    }
  }

  return Object.freeze({
    modo,
    enabled: Boolean(modo),
    from: from || `${process.env.BRAND_SHORT || 'Miniápolis'} <no-responder@localhost>`,
    smtp: Object.freeze({ host, port, secure, requireTLS, user: (process.env.SMTP_USER || '').trim(), password }),
  });
}

/**
 * Catálogo de packs a la venta.
 *
 * Se admite una lista completa en `PACK_CATALOG` ("5:2500,10:4500,20:8000":
 * entradas por pack y precio en centavos) para que una pista pueda cambiar sus
 * packs sin tocar el código. Si no está, se usan las dos variables de siempre,
 * que es lo que ya tienen las instalaciones en marcha.
 */
function packCatalog() {
  const raw = (process.env.PACK_CATALOG || '').trim();
  if (!raw) {
    return [
      { size: 5, priceCents: num('PACK_5_PRICE_CENTS', 2500, { min: 0 }), label: 'Pack 5 entradas' },
      { size: 10, priceCents: num('PACK_10_PRICE_CENTS', 4500, { min: 0 }), label: 'Pack 10 entradas' },
    ];
  }

  const invalido = (detalle) =>
    new Error(`Configuración inválida: PACK_CATALOG ${detalle}. Formato esperado: "5:2500,10:4500".`);

  const vistos = new Set();
  const entradas = raw
    .split(',')
    .map((trozo) => trozo.trim())
    .filter(Boolean)
    .map((trozo) => {
      const partes = trozo.split(':');
      if (partes.length !== 2) throw invalido(`no entiende "${trozo}"`);
      const size = Number(partes[0].trim());
      const priceCents = Number(partes[1].trim());
      if (!Number.isInteger(size) || size < 1 || size > 500) {
        throw invalido(`tiene un tamaño de pack fuera de rango en "${trozo}" (1 a 500)`);
      }
      if (!Number.isInteger(priceCents) || priceCents < 0) {
        throw invalido(`tiene un precio que no es un entero de centavos en "${trozo}"`);
      }
      if (vistos.has(size)) throw invalido(`repite el pack de ${size} entradas`);
      vistos.add(size);
      return { size, priceCents, label: `Pack ${size} entradas` };
    });

  if (entradas.length === 0) throw invalido('está vacío');
  return entradas.sort((a, b) => a.size - b.size);
}

export const config = Object.freeze({
  env: NODE_ENV,
  isProduction,
  isTest,

  /** Puerto e interfaz de escucha. */
  port: num('PORT', 3000, { min: 0, max: 65535 }),
  host: process.env.HOST || '0.0.0.0',

  /** Nombre público del negocio, usado en la interfaz y en los QR. */
  brandName: process.env.BRAND_NAME || 'Miniápolis #3',
  brandShort: process.env.BRAND_SHORT || 'Miniápolis',
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

  offlineScan: (() => {
    /**
     * Horas que puede pasar una lectura guardada en el escáner sin conexión
     * antes de que el servidor deje de aceptarla. Con 0 el escáner no guarda
     * lecturas para después y solo se admite lo que tarda un reintento de red.
     */
    const horas = num('OFFLINE_SCAN_MAX_HOURS', 24, { min: 0, max: 168 });
    return Object.freeze({ enabled: horas > 0, maxAgeSeconds: Math.round(horas * 3600) });
  })(),

  security: {
    /** Orígenes permitidos para CORS. Vacío = solo mismo origen. */
    corsOrigins: list('CORS_ORIGINS', []),
    /** Marca Secure en las cookies. Por defecto activa en producción. */
    cookieSecure: bool('COOKIE_SECURE', isProduction),
    /** Proxies concretos autorizados a aportar X-Forwarded-For. */
    trustedProxyIps: Object.freeze(trustedProxyIps()),
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
    masterPassword: (() => {
      rechazarValorDeEjemplo('MASTER_PASSWORD', process.env.MASTER_PASSWORD);
      return process.env.MASTER_PASSWORD || '';
    })(),
    masterName: process.env.MASTER_NAME || 'Administrador',
  },

  /**
   * Dirección pública del sistema. El pase de la cartera lleva dentro la URL a
   * la que el teléfono pedirá el saldo actualizado, y tiene que ser absoluta.
   */
  publicUrl: publicUrl(),

  /** Pases para la cartera del teléfono. */
  wallet: wallet(),

  /** Correo saliente. */
  correo: correo(),

  /** Recuperación de contraseña por correo. */
  passwordReset: Object.freeze({
    /** Cuánto vale el enlace. Corto: es una llave de la cuenta dentro de un buzón. */
    ttlSeconds: num('PASSWORD_RESET_TTL_SECONDS', 30 * 60, { min: 5 * 60, max: 24 * 3600 }),
  }),

  /** Catálogo de packs vendibles. */
  packCatalog: Object.freeze(packCatalog().map((entrada) => Object.freeze(entrada))),

  /** Datos bancarios y de cobro para recargas en línea. */
  payment: Object.freeze({
    bankName: (process.env.PAYMENT_BANK_NAME || 'Banco Pichincha').trim(),
    accountType: (process.env.PAYMENT_ACCOUNT_TYPE || 'Ahorros').trim(),
    accountNumber: (process.env.PAYMENT_ACCOUNT_NUMBER || '2200000000').trim(),
    accountHolder: (process.env.PAYMENT_ACCOUNT_HOLDER || 'Miniápolis #3 Pista RC').trim(),
    idNumber: (process.env.PAYMENT_ID_NUMBER || '1790000000001').trim(),
    deunaPhone: (process.env.PAYMENT_DEUNA_PHONE || '0990000000').trim(),
    instructions: (process.env.PAYMENT_INSTRUCTIONS || 'Realiza tu transferencia o pago por DeUna e ingresa el número de comprobante.').trim(),
  }),

  logLevel: process.env.LOG_LEVEL || (isTest ? 'silent' : 'info'),
});

export default config;
