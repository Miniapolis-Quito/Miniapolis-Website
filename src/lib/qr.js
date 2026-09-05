/**
 * Códigos QR de los packs.
 *
 * Formato del contenido del QR (texto plano, corto para que el QR sea denso y
 * fácil de leer con cualquier cámara):
 *
 *     RHE1|<código de pack>|<epoch en segundos>|<nonce>|<firma>
 *
 * - Modo dinámico (por defecto en la app del cliente): el timestamp avanza y la
 *   app regenera el QR cada pocos segundos. Una captura de pantalla deja de
 *   servir pasada la ventana de validez (QR_TTL_SECONDS), y el nonce impide
 *   que el mismo código se use dos veces aunque se reenvíe dentro de la ventana.
 * - Modo estático (timestamp 0): para pases impresos. Solo se acepta si el pack
 *   tiene `allow_static_qr` activado, porque un impreso sí es copiable.
 *
 * La firma es HMAC-SHA256 con una clave derivada del secreto del servidor y del
 * secreto propio del pack: sin ambos no se puede fabricar un QR válido, y
 * rotar el secreto del pack invalida todos sus códigos anteriores.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { randomToken } from './ids.js';

export const QR_VERSION = 'RHE1';
const SEPARATOR = '|';
const SIGNATURE_LENGTH = 27; // 20 bytes en base64url ≈ 160 bits de seguridad

function derivedKey(packSecret) {
  return crypto.createHmac('sha256', config.secrets.qr).update(`pack:${packSecret}`).digest();
}

function signPayload(payload, packSecret) {
  return crypto
    .createHmac('sha256', derivedKey(packSecret))
    .update(payload)
    .digest('base64url')
    .slice(0, SIGNATURE_LENGTH);
}

/**
 * Genera el contenido del QR de un pack.
 * @param {{code:string, secret:string}} pack
 * @param {{static?:boolean, at?:number}} options
 */
export function buildQrPayload(pack, { static: isStatic = false, at = Date.now() } = {}) {
  const timestamp = isStatic ? 0 : Math.floor(at / 1000);
  const nonce = isStatic ? '0' : randomToken(9); // 12 caracteres base64url
  const body = [QR_VERSION, pack.code, String(timestamp), nonce].join(SEPARATOR);
  return `${body}${SEPARATOR}${signPayload(body, pack.secret)}`;
}

/** Separa el contenido de un QR sin validar la firma (aún no se conoce el pack). */
export function parseQrPayload(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'formato' };
  const text = raw.trim();
  if (text.length === 0 || text.length > 512) return { ok: false, reason: 'formato' };

  const parts = text.split(SEPARATOR);
  if (parts.length !== 5) return { ok: false, reason: 'formato' };

  const [version, code, tsRaw, nonce, signature] = parts;
  if (version !== QR_VERSION) return { ok: false, reason: 'version' };
  if (!/^[A-Z]{2,6}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(code)) return { ok: false, reason: 'formato' };
  if (!/^\d{1,12}$/.test(tsRaw)) return { ok: false, reason: 'formato' };
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(nonce)) return { ok: false, reason: 'formato' };
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(signature)) return { ok: false, reason: 'formato' };

  const timestamp = Number(tsRaw);
  return {
    ok: true,
    code,
    timestamp,
    nonce,
    signature,
    isStatic: timestamp === 0,
    body: [version, code, tsRaw, nonce].join(SEPARATOR),
  };
}

/**
 * Verifica la firma y la vigencia de un QR ya parseado contra el pack real.
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
export function verifyQrPayload(parsed, pack, { now = Date.now(), ttlSeconds = config.qr.ttlSeconds } = {}) {
  const expected = signPayload(parsed.body, pack.secret);
  const a = Buffer.from(parsed.signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'firma' };
  }

  if (parsed.isStatic) {
    if (!pack.allow_static_qr) return { ok: false, reason: 'estatico_no_permitido' };
    return { ok: true, method: 'qr_static' };
  }

  const nowSeconds = Math.floor(now / 1000);
  const age = nowSeconds - parsed.timestamp;
  if (age > ttlSeconds) return { ok: false, reason: 'expirado' };
  // Tolerancia de reloj adelantado en el dispositivo del cliente.
  if (age < -60) return { ok: false, reason: 'futuro' };

  return { ok: true, method: 'qr_dynamic' };
}
