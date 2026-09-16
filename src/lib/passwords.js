/**
 * Hash de contraseñas con scrypt (incluido en Node, sin dependencias nativas
 * extra). Parámetros según las recomendaciones de OWASP para scrypt:
 * N=2^16, r=8, p=1 → ~64 MB de memoria por verificación.
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { AppError } from './errors.js';

const scrypt = promisify(crypto.scrypt);

const PARAMS = {
  N: config.isTest ? 2 ** 12 : 2 ** 16, // en pruebas se baja el costo para no ralentizar la suite
  r: 8,
  p: 1,
  keyLength: 64,
  saltLength: 16,
};

// scrypt necesita maxmem > 128*N*r; se deja margen.
const maxmem = 256 * PARAMS.N * PARAMS.r;

/**
 * Cuántos cálculos de scrypt corren a la vez y cuántos pueden esperar turno.
 *
 * Cada uno ocupa unos 64 MB. Node los reparte en su grupo de hilos (4 por
 * defecto), pero sin tope la cola crece sin límite: una avalancha de intentos de
 * entrada desde muchas direcciones —cada una por debajo de su propio límite—
 * dejaba al servidor sin memoria o respondiendo a todo con minutos de retraso,
 * también a quien solo quería escanear una entrada. Lo que no cabe se rechaza
 * con «servidor ocupado» en el acto, sin contar como intento fallido.
 */
export const MAXIMO_HASHES_EN_CURSO = Math.max(1, Number(process.env.UV_THREADPOOL_SIZE) || 4);
export const MAXIMO_HASHES_EN_ESPERA = 100;

let hashesEnCurso = 0;
const hashesEnEspera = [];

async function conTurno(tarea) {
  if (hashesEnCurso >= MAXIMO_HASHES_EN_CURSO) {
    if (hashesEnEspera.length >= MAXIMO_HASHES_EN_ESPERA) {
      throw new AppError(
        503,
        'servidor_ocupado',
        'Hay muchas personas entrando a la vez. Inténtalo de nuevo en unos segundos.',
      );
    }
    // El turno lo cede directamente quien termina: así nadie que llegue justo
    // entonces puede colarse y superar el tope.
    await new Promise((listo) => hashesEnEspera.push(listo));
  } else {
    hashesEnCurso += 1;
  }
  try {
    return await tarea();
  } finally {
    const siguiente = hashesEnEspera.shift();
    if (siguiente) siguiente();
    else hashesEnCurso -= 1;
  }
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('La contraseña debe ser un texto no vacío.');
  }
  const salt = crypto.randomBytes(PARAMS.saltLength);
  const derived = await conTurno(() =>
    scrypt(password.normalize('NFKC'), salt, PARAMS.keyLength, {
      N: PARAMS.N,
      r: PARAMS.r,
      p: PARAMS.p,
      maxmem,
    }),
  );
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Cota defensiva: un hash manipulado no debe poder pedir memoria ilimitada.
  if (N < 2 ** 10 || N > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(saltB64, 'base64');
    expected = Buffer.from(hashB64, 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  // El «servidor ocupado» sale de `conTurno` y no se traga: convertirlo en
  // `false` lo contaría como contraseña incorrecta y acabaría bloqueando cuentas.
  const derived = await conTurno(() =>
    scrypt(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: Math.max(maxmem, 256 * N * r),
    }).catch(() => null),
  );
  if (!derived) return false;
  return crypto.timingSafeEqual(derived, expected);
}

/**
 * Hash con la forma y el costo de uno real, pero que no corresponde a ninguna
 * contraseña. Verificarlo cuesta exactamente lo mismo que verificar uno de
 * verdad —los parámetros salen de `PARAMS`, no de una constante escrita a
 * mano—, que es lo que impide averiguar por tiempo de respuesta si un correo
 * está registrado.
 */
export const HASH_FICTICIO = [
  'scrypt',
  PARAMS.N,
  PARAMS.r,
  PARAMS.p,
  Buffer.alloc(PARAMS.saltLength).toString('base64'),
  Buffer.alloc(PARAMS.keyLength).toString('base64'),
].join('$');

/**
 * Contraseña temporal aleatoria, en base64url.
 *
 * Nunca es más corta que `MIN_PASSWORD_LENGTH`: con un mínimo configurado por
 * encima de lo que daban los bytes fijos, generar una fallaba la validación de
 * robustez y el alta sin contraseña devolvía un error.
 */
export function generarPasswordTemporal(bytesMinimos = 9) {
  const bytes = Math.max(bytesMinimos, Math.ceil((config.security.minPasswordLength * 3) / 4));
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Indica si un hash usa parámetros distintos a los actuales y conviene recalcularlo. */
export function needsRehash(stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) !== PARAMS.N || Number(parts[2]) !== PARAMS.r || Number(parts[3]) !== PARAMS.p;
}

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'contrasena', 'contraseña', '12345678', '123456789', '1234567890',
  'qwertyuiop', 'qwerty123', 'racinghobbies', 'administrador', 'adminadmin', 'iloveyou',
  'letmein123', 'welcome123', 'ecuador123', 'guayaquil', 'entradas123', 'password123',
]);

/**
 * Valida la robustez de una contraseña. Se prioriza la longitud sobre las
 * reglas de composición (recomendación NIST 800-63B).
 */
export function validatePasswordStrength(password, { email = '', fullName = '' } = {}) {
  const errors = [];
  // El hash usa NFKC; validar la misma representación evita que el alta, el
  // cambio y la recuperación apliquen reglas distintas a lo que realmente se
  // almacenará y verificará.
  const value = String(password || '').normalize('NFKC');
  const min = config.security.minPasswordLength;

  if (value.length < min) errors.push(`Debe tener al menos ${min} caracteres.`);
  if (value.length > 200) errors.push('No puede superar los 200 caracteres.');
  if (/^\s|\s$/.test(value)) errors.push('No puede empezar ni terminar con espacios.');

  const lower = value.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) errors.push('Es una contraseña demasiado común.');
  if (/^(.)\1+$/.test(value)) errors.push('No puede ser el mismo carácter repetido.');
  if (/^(?:0123456789|1234567890|abcdefghij)/.test(lower)) {
    errors.push('No puede ser una secuencia obvia de teclado.');
  }

  const localPart = String(email).split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 4 && lower.includes(localPart)) {
    errors.push('No puede contener el correo de la cuenta.');
  }
  for (const word of String(fullName).toLowerCase().split(/\s+/)) {
    if (word.length >= 4 && lower.includes(word)) {
      errors.push('No puede contener el nombre de la persona.');
      break;
    }
  }

  return { ok: errors.length === 0, errors };
}
