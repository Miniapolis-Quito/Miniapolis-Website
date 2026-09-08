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

/** Longitud del cuerpo de un código, sin contar el prefijo. */
const CODE_BODY_LENGTH = 8;
const CODE_BODY_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_BODY_LENGTH}}$`);

/** Normaliza un código escrito a mano: mayúsculas, sin separadores y con guiones. */
export function normalizePackCode(input, prefix = 'RHE') {
  if (typeof input !== 'string') return '';
  // Se descarta cualquier separador (guiones, espacios, puntos, barras): en el
  // mostrador el código se dicta en voz alta y cada quien lo escribe distinto.
  let cleaned = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  // El prefijo solo se quita si lo que sobra tiene el largo de un cuerpo. Las
  // letras R, H y E también forman parte del alfabeto de los códigos, así que
  // recortarlo a ciegas destrozaría un cuerpo que empiece por "RHE" y que el
  // cliente haya dictado sin el prefijo.
  if (cleaned.length === prefix.length + CODE_BODY_LENGTH && cleaned.startsWith(prefix)) {
    cleaned = cleaned.slice(prefix.length);
  }

  // Confusiones típicas al teclear un código que no usa estas letras/dígitos.
  // El alfabeto excluye 0, 1, I, L, O y U precisamente porque se confunden con
  // los caracteres que sí lo forman: O/0 con Q, I/L/1 con 7, y U con V.
  cleaned = cleaned.replace(/[O0]/g, 'Q').replace(/[IL1]/g, '7').replace(/U/g, 'V');

  if (cleaned.length !== CODE_BODY_LENGTH) return '';
  if (!CODE_BODY_PATTERN.test(cleaned)) return '';
  return `${prefix}-${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

/** Token aleatorio en base64url, apto para secretos de sesión. */
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function randomHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}
