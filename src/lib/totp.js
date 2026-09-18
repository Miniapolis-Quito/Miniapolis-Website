/**
 * Códigos de un solo uso basados en tiempo (TOTP, RFC 6238, sobre HOTP,
 * RFC 4226): el segundo paso del acceso.
 *
 * Se implementa aquí, sobre el módulo `crypto` de Node, en lugar de traer una
 * dependencia: el algoritmo entero son treinta líneas y el resto del sistema ya
 * firma sus tokens y sus QR de la misma forma. Los parámetros son los que
 * esperan Google Authenticator, Aegis, 1Password y compañía —SHA-1, 6 dígitos,
 * ventanas de 30 segundos—, porque un secreto que esas aplicaciones no puedan
 * leer no sirve de nada por muy moderno que sea.
 */
import crypto from 'node:crypto';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Bytes → base32 (RFC 4648), sin relleno: es lo que se teclea en la app. */
export function base32Encode(bytes) {
  const datos = Buffer.from(bytes);
  let bits = 0;
  let valor = 0;
  let salida = '';
  for (const byte of datos) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += ALFABETO[(valor << (5 - bits)) & 31];
  return salida;
}

/**
 * base32 → bytes. Tolera minúsculas, espacios, guiones y el relleno «=» porque
 * el secreto se teclea a mano cuando la cámara no puede leer el QR. Devuelve
 * `null` ante cualquier carácter que no pertenezca al alfabeto: un secreto a
 * medias produciría códigos que nunca cuadran y nadie sabría por qué.
 */
export function base32Decode(texto) {
  if (typeof texto !== 'string') return null;
  const limpio = texto.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (limpio.length === 0) return null;

  let bits = 0;
  let valor = 0;
  const bytes = [];
  for (const caracter of limpio) {
    const indice = ALFABETO.indexOf(caracter);
    if (indice === -1) return null;
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Secreto nuevo. 20 bytes (160 bits) es lo que recomienda el RFC 4226. */
export function generarSecreto(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

/** Tramo de tiempo al que pertenece un instante. */
export function pasoDe(instante = Date.now(), periodoSegundos = 30) {
  return Math.floor(instante / 1000 / periodoSegundos);
}

/**
 * Código HOTP de un tramo concreto. La «truncación dinámica» del RFC toma
 * cuatro bytes del HMAC eligiendo el punto de partida con su último nibble.
 */
export function codigoDelPaso(secreto, paso, { digitos = 6, algoritmo = 'sha1' } = {}) {
  const clave = typeof secreto === 'string' ? base32Decode(secreto) : Buffer.from(secreto);
  if (!clave || clave.length === 0) return null;

  const contador = Buffer.alloc(8);
  // El contador es de 64 bits; JavaScript solo maneja 32 con seguridad en los
  // operadores de bits, así que se escribe en dos mitades.
  contador.writeUInt32BE(Math.floor(paso / 2 ** 32), 0);
  contador.writeUInt32BE(paso >>> 0, 4);

  const hmac = crypto.createHmac(algoritmo, clave).update(contador).digest();
  const desplazamiento = hmac[hmac.length - 1] & 0x0f;
  const binario =
    ((hmac[desplazamiento] & 0x7f) << 24) |
    ((hmac[desplazamiento + 1] & 0xff) << 16) |
    ((hmac[desplazamiento + 2] & 0xff) << 8) |
    (hmac[desplazamiento + 3] & 0xff);

  return String(binario % 10 ** digitos).padStart(digitos, '0');
}

/** Comparación sin filtrar por tiempo cuántos dígitos coincidían. */
function iguales(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/** Deja solo los dígitos: las aplicaciones muestran «123 456». */
export function normalizarCodigo(codigo) {
  return String(codigo ?? '').replace(/[\s-]/g, '');
}

/**
 * Comprueba un código contra el secreto.
 *
 * `ventana` admite tramos hacia atrás y hacia adelante para tolerar el desfase
 * del reloj del teléfono. `pasoMinimo` es lo que impide reutilizar un código:
 * quien mire por encima del hombro y teclee el mismo número dentro de los
 * mismos treinta segundos se encuentra con que ya se gastó.
 *
 * @returns {{ok:true, paso:number}|{ok:false, motivo:string}}
 */
export function verificar(secreto, codigo, {
  ahora = Date.now(),
  periodoSegundos = 30,
  digitos = 6,
  ventana = 1,
  pasoMinimo = null,
} = {}) {
  const limpio = normalizarCodigo(codigo);
  if (!new RegExp(`^\\d{${digitos}}$`).test(limpio)) return { ok: false, motivo: 'formato' };
  if (!base32Decode(secreto)) return { ok: false, motivo: 'secreto' };

  const actual = pasoDe(ahora, periodoSegundos);
  let reutilizado = false;
  for (let delta = -ventana; delta <= ventana; delta += 1) {
    const paso = actual + delta;
    if (paso < 0) continue;
    const esperado = codigoDelPaso(secreto, paso, { digitos });
    if (!esperado || !iguales(limpio, esperado)) continue;
    // El código es correcto; solo falta que no se haya usado ya.
    if (pasoMinimo !== null && paso <= pasoMinimo) {
      reutilizado = true;
      continue;
    }
    return { ok: true, paso };
  }
  return { ok: false, motivo: reutilizado ? 'reutilizado' : 'invalido' };
}

/**
 * Dirección `otpauth://` que se mete en el QR. El emisor va repetido —en la
 * etiqueta y en el parámetro— porque las aplicaciones antiguas solo leen uno
 * de los dos y así ninguna acaba mostrando la cuenta sin nombre.
 */
export function uriOtpauth({ secreto, cuenta, emisor, digitos = 6, periodoSegundos = 30 }) {
  const etiqueta = encodeURIComponent(`${emisor}:${cuenta}`);
  const parametros = new URLSearchParams({
    secret: secreto,
    issuer: emisor,
    algorithm: 'SHA1',
    digits: String(digitos),
    period: String(periodoSegundos),
  });
  return `otpauth://totp/${etiqueta}?${parametros.toString()}`;
}

/** El secreto en grupos de cuatro, para teclearlo sin perder la cuenta. */
export function secretoLegible(secreto) {
  return String(secreto).replace(/(.{4})/g, '$1 ').trim();
}
