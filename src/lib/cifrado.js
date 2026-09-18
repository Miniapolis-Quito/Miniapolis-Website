/**
 * Cifrado simétrico de datos guardados en base (AES-256-GCM).
 *
 * Lo usa el secreto de la verificación en dos pasos. La diferencia con una
 * contraseña es que ese secreto tiene que poder recuperarse en claro para
 * calcular el código de cada tramo, así que no vale un hash: hay que cifrarlo.
 *
 * Con esto, una copia de seguridad de la base que acabe donde no debe no
 * entrega los segundos factores de nadie: la clave no vive en la base, se
 * deriva del secreto del entorno.
 *
 * GCM añade una etiqueta de autenticación: si alguien edita la base a mano
 * para cambiar el secreto de una cuenta, el descifrado falla en vez de
 * devolver bytes distintos, y quien llama trata eso como «esta cuenta tiene el
 * segundo factor roto» en vez de dejar entrar.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';

const VERSION = 'v1';
const LARGO_IV = 12; // 96 bits, lo que recomienda NIST para GCM
const LARGO_ETIQUETA = 16;

const clavesPorProposito = new Map();

/**
 * Una clave distinta por propósito, derivada con HKDF. Cifrar dos cosas
 * diferentes con la misma clave permitiría mover un valor de un sitio a otro.
 */
function clave(proposito) {
  let derivada = clavesPorProposito.get(proposito);
  if (!derivada) {
    derivada = Buffer.from(
      crypto.hkdfSync('sha256', config.secrets.twoFactor, Buffer.from('miniapolis-cifrado-v1'), Buffer.from(proposito), 32),
    );
    clavesPorProposito.set(proposito, derivada);
  }
  return derivada;
}

/** Texto en claro → «v1.iv.etiqueta.cifrado», todo en base64url. */
export function cifrar(texto, proposito = 'general') {
  if (typeof texto !== 'string' || texto.length === 0) {
    throw new TypeError('Solo se cifra texto no vacío.');
  }
  const iv = crypto.randomBytes(LARGO_IV);
  const cifrador = crypto.createCipheriv('aes-256-gcm', clave(proposito), iv);
  const cuerpo = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);
  const etiqueta = cifrador.getAuthTag();
  return [VERSION, iv.toString('base64url'), etiqueta.toString('base64url'), cuerpo.toString('base64url')].join('.');
}

/**
 * Deshace `cifrar`. Devuelve `null` —nunca lanza— si el dato no es de este
 * formato, si la clave del entorno cambió o si alguien lo manipuló: quien
 * llama decide qué hacer, y en el único sitio donde se usa la decisión es
 * negar el acceso y pedir ayuda a la administración.
 */
export function descifrar(dato, proposito = 'general') {
  if (typeof dato !== 'string') return null;
  const partes = dato.split('.');
  if (partes.length !== 4 || partes[0] !== VERSION) return null;
  try {
    const iv = Buffer.from(partes[1], 'base64url');
    const etiqueta = Buffer.from(partes[2], 'base64url');
    const cuerpo = Buffer.from(partes[3], 'base64url');
    if (iv.length !== LARGO_IV || etiqueta.length !== LARGO_ETIQUETA) return null;
    const descifrador = crypto.createDecipheriv('aes-256-gcm', clave(proposito), iv);
    descifrador.setAuthTag(etiqueta);
    return Buffer.concat([descifrador.update(cuerpo), descifrador.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** ¿Este valor tiene la forma de algo cifrado por aquí? */
export function pareceCifrado(dato) {
  return typeof dato === 'string' && dato.startsWith(`${VERSION}.`) && dato.split('.').length === 4;
}
