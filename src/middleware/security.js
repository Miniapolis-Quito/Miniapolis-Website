/** Cabeceras de seguridad, CORS restringido y detección de IP del cliente. */
import { config } from '../config.js';
import { forbidden } from '../lib/errors.js';

/**
 * Política de seguridad de contenido. La interfaz no carga nada de terceros,
 * así que se puede cerrar casi por completo: sin scripts externos, sin marcos,
 * y solo conexiones al propio origen.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ');

export function securityHeaders(req, res, next) {
  res.set('Content-Security-Policy', CSP);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  res.set('Cross-Origin-Resource-Policy', 'same-origin');
  // La cámara se usa en /scan; el resto de capacidades del navegador se apaga.
  res.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()');
  res.removeHeader('X-Powered-By');
  if (config.security.cookieSecure) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

/** Resuelve la IP real del cliente, respetando el proxy solo si se configuró. */
export function clientIp(req, res, next) {
  // Express solo toma X-Forwarded-For cuando la conexión inmediata pertenece a
  // una de las redes configuradas en TRUSTED_PROXY_IPS. Leer la cabecera aquí
  // directamente permitiría falsificarla desde Internet.
  const ip = req.ip || req.socket?.remoteAddress || '';
  req.clientIp = ip.replace(/^::ffff:/, '') || 'desconocida';
  next();
}

/** CORS explícito: por defecto solo mismo origen. */
export function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && config.security.corsOrigins.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, X-Requested-With');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.set('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  return next();
}

/**
 * Defensa contra CSRF en profundidad: aunque los tokens de acceso viajan en la
 * cabecera Authorization (que un formulario de otro sitio no puede fijar), las
 * rutas que usan la cookie de refresco exigen además un origen conocido.
 */
export function sameOriginOnly(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const origin = req.headers.origin;
  if (!origin) return next(); // Clientes no navegador (curl, apps nativas) no envían Origin.

  const host = req.headers.host;
  let originUrl;
  let expectedOrigin;
  try {
    originUrl = new URL(origin);
    // "Mismo origen" incluye protocolo y puerto, no solo el host. Express
    // toma X-Forwarded-Proto únicamente de los proxies permitidos en la app.
    expectedOrigin = new URL(`${req.protocol}://${host}`).origin;
  } catch {
    return next(forbidden('Origen no válido.', 'origen_invalido'));
  }
  if (originUrl.origin === expectedOrigin) return next();
  if (config.security.corsOrigins.includes(origin)) return next();
  return next(forbidden('Petición bloqueada por seguridad (origen no permitido).', 'origen_no_permitido'));
}
