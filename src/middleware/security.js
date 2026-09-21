import { isIP } from 'node:net';
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
  res.set('X-Permitted-Cross-Domain-Policies', 'none');
  res.set('X-Download-Options', 'noopen');
  // La cámara se usa en /scan; el resto de capacidades del navegador se apaga.
  res.set(
    'Permissions-Policy',
    'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), display-capture=(), browsing-topics=(), sync-xhr=()',
  );
  res.removeHeader('X-Powered-By');
  if (config.security.cookieSecure) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

/**
 * Normaliza una dirección IP para el cálculo de cuotas de tasa.
 * En IPv6, un mismo cliente dispone de subredes completas (/64); agrupar por
 * el prefijo de red impide rotar direcciones dentro del mismo bloque.
 */
export function normalizeIpForScope(ip) {
  if (!ip || typeof ip !== 'string') return 'desconocida';
  const clean = ip.replace(/^::ffff:/, '').trim().split('%')[0];
  if (isIP(clean) === 6) {
    const partes = clean.split('::');
    let hextetos = [];
    if (partes.length === 2) {
      const izquierda = partes[0] ? partes[0].split(':') : [];
      const derecha = partes[1] ? partes[1].split(':') : [];
      const faltantes = 8 - (izquierda.length + derecha.length);
      hextetos = [...izquierda, ...Array(faltantes).fill('0'), ...derecha];
    } else {
      hextetos = clean.split(':');
    }
    const prefijo = hextetos.slice(0, 4).map((h) => h.padStart(4, '0').toLowerCase()).join(':');
    return `${prefijo}::/64`;
  }
  return clean;
}

/** Resuelve la IP real del cliente, respetando el proxy solo si se configuró. */
export function clientIp(req, res, next) {
  // Express solo toma X-Forwarded-For cuando la conexión inmediata pertenece a
  // una de las redes configuradas en TRUSTED_PROXY_IPS. Leer la cabecera aquí
  // directamente permitiría falsificarla desde Internet.
  const ip = req.ip || req.socket?.remoteAddress || '';
  req.clientIp = ip.replace(/^::ffff:/, '') || 'desconocida';
  req.rateLimitIp = normalizeIpForScope(req.clientIp);
  next();
}

/**
 * ¿Es esta petición la consulta previa que hace el navegador antes de una
 * petición con CORS? Lo es solo si trae origen y dice qué método pretende usar;
 * un OPTIONS suelto, escrito a mano, no lo es.
 */
function esConsultaPrevia(req) {
  return (
    req.method === 'OPTIONS' &&
    typeof req.headers.origin === 'string' &&
    typeof req.headers['access-control-request-method'] === 'string'
  );
}

/** CORS explícito: por defecto solo mismo origen. */
export function cors(req, res, next) {
  const origin = req.headers.origin;
  // `Vary: Origin` va siempre, también cuando el origen no está permitido: si
  // solo apareciera en las respuestas con CORS, una caché compartida podría
  // servirle a un origen la respuesta que se preparó para otro.
  res.set('Vary', 'Origin');
  if (origin && config.security.corsOrigins.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, X-Requested-With');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.set('Access-Control-Max-Age', '600');
  }
  // Solo la consulta previa termina aquí. Antes contestaba 204 cualquier
  // OPTIONS, para cualquier ruta, antes de pasar por el límite de peticiones:
  // una respuesta gratis e ilimitada que servía para tantear el servidor sin
  // dejar rastro en ninguna cuota. El resto sigue el camino normal.
  if (esConsultaPrevia(req)) return res.status(204).end();
  return next();
}

/**
 * Defensa contra CSRF en profundidad: aunque los tokens de acceso viajan en la
 * cabecera Authorization (que un formulario de otro sitio no puede fijar), las
 * rutas que usan la cookie de refresco exigen además un origen conocido.
 */
export function sameOriginOnly(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const secFetchSite = req.headers['sec-fetch-site'];
  const origin = req.headers.origin;
  const referer = req.headers.referer;

  // Si no hay Origin pero sí Referer (en envíos de formularios tradicionales),
  // se valida el origen del Referer.
  let requestOrigin = origin;
  if (!requestOrigin && referer) {
    try {
      requestOrigin = new URL(referer).origin;
    } catch {
      return next(forbidden('Referer no válido.', 'referer_invalido'));
    }
  }

  if (!requestOrigin) {
    if (secFetchSite === 'cross-site') {
      return next(forbidden('Petición bloqueada por seguridad (cross-site sin origen).', 'cross_site_no_permitido'));
    }
    return next(); // Clientes no navegador (curl, apps nativas, demonio de pases) no envían Origin.
  }

  const host = req.headers.host;
  let originUrl;
  let expectedOrigin;
  try {
    originUrl = new URL(requestOrigin);
    // "Mismo origen" incluye protocolo y puerto, no solo el host. Express
    // toma X-Forwarded-Proto únicamente de los proxies permitidos en la app.
    expectedOrigin = new URL(`${req.protocol}://${host}`).origin;
  } catch {
    return next(forbidden('Origen no válido.', 'origen_invalido'));
  }
  if (originUrl.origin === expectedOrigin) return next();
  if (config.security.corsOrigins.includes(originUrl.origin)) return next();
  return next(forbidden('Petición bloqueada por seguridad (origen no permitido).', 'origen_no_permitido'));
}
