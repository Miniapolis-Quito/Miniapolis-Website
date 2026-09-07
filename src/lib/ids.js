import crypto from 'node:crypto';

/** Identificador interno opaco (UUID v4). */
export function newId() {
  return crypto.randomUUID();
}

/**
 * Alfabeto sin caracteres ambiguos (sin 0/O, 1/I/L, U) para códigos que una
 * persona puede tener que leer en voz alta o teclear en el mostrador.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomChars(length) {
  const out = new Array(length);
  const bytes = crypto.randomBytes(length * 2);
  let bi = 0;
  for (let i = 0; i < length; i += 1) {
    // Rechazo de sesgo: se descartan bytes que no caen en un múltiplo exacto.
    let byte;
    do {
      if (bi >= bytes.length) {
        bytes.set(crypto.randomBytes(bytes.length));
        bi = 0;
      }
      byte = bytes[bi++];
    } while (byte >= 256 - (256 % CODE_ALPHABET.length));
    out[i] = CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return out.join('');
}

/** Código público de un pack: RHE-XXXX-XXXX (~30^8 ≈ 6.5e11 combinaciones). */
export function newPackCode(prefix = 'RHE') {
  return `${prefix}-${randomChars(4)}-${randomChars(4)}`;
}

const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{8}$`);

/**
 * Normaliza un código escrito a mano: mayúsculas, sin espacios, sin guiones y
 * con el prefijo opcional.
 *
 * Deliberadamente NO intenta "arreglar" un 0, una O, un 1, una I, una L ni una
 * U. El alfabeto excluye esos caracteres justo para que no haya ambigüedad, así
 * que un código que los contiene no puede ser un código real; sustituirlos por
 * el carácter más parecido significaría adivinar, y la letra adivinada sí es
 * válida — el resultado podría ser el pack de otra persona, al que se le
 * descontaría una entrada. Ante la duda se devuelve cadena vacía y quien atiende
 * vuelve a mirar el cartón.
 */
export function normalizePackCode(input, prefix = 'RHE') {
  if (typeof input !== 'string') return '';
  let cleaned = input.trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (cleaned.startsWith(prefix)) cleaned = cleaned.slice(prefix.length);
  if (!CODE_PATTERN.test(cleaned)) return '';
  return `${prefix}-${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

/** Token aleatorio en base64url, apto para secretos de sesión. */
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function randomHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}
