/**
 * Aviso a los teléfonos de que su pase cambió (APNs).
 *
 * Para un pase de cartera el aviso va vacío: no es una notificación que se vea,
 * sino un golpecito para que el teléfono vuelva a pedir el pase. Lo que llega
 * después es una petición al servicio web del pase, que devuelve el saldo nuevo.
 *
 * Se usa autenticación por token (.p8) en vez de por certificado: una sola
 * clave sirve para siempre y no caduca cada año como los certificados.
 *
 * Los avisos de un mismo pase salen por una sola conexión HTTP/2. Abrir una por
 * teléfono es justo lo que Apple pide no hacer: el saludo TLS cuesta más que el
 * aviso, y una familia con cuatro teléfonos multiplicaba por cuatro ese coste
 * en cada entrada que se cobraba.
 */
import crypto from 'node:crypto';
import http2 from 'node:http2';
import { logger } from './logger.js';

/** El token de APNs vale una hora; se renueva antes para no apurar el margen. */
const VIDA_DEL_TOKEN_MS = 50 * 60 * 1000;

/** Lo que se espera por una conexión o por un aviso antes de darlo por perdido. */
const ESPERA_MS = 10_000;

/** Un token de APNs es hexadecimal; el largo exacto lo decide Apple. */
export const PUSH_TOKEN_VALIDO = /^[0-9A-Fa-f]{32,200}$/;

/**
 * Lo que responde Apple cuando el problema es nuestro token de proveedor, no el
 * teléfono. Se firma otro y se reintenta: si no, un token que caducó antes de
 * tiempo dejaría todos los pases sin actualizar hasta la siguiente renovación.
 */
const TOKEN_DE_PROVEEDOR_MALO = new Set(['ExpiredProviderToken', 'InvalidProviderToken']);

/** Apple ya no conoce a ese teléfono: hay que darlo de baja, no reintentar. */
const TELEFONO_DE_BAJA = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic']);

let tokenEnUso = null;
let tokenCreadoEn = 0;
let tokenDe = null;

function base64url(valor) {
  return Buffer.from(valor).toString('base64url');
}

/** Token de autenticación firmado con la clave .p8 (ES256). */
function tokenDeAutenticacion({ keyId, key, teamId }, ahora = Date.now()) {
  if (tokenEnUso && tokenDe === `${teamId}:${keyId}` && ahora - tokenCreadoEn < VIDA_DEL_TOKEN_MS) return tokenEnUso;

  const cabecera = base64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const cuerpo = base64url(JSON.stringify({ iss: teamId, iat: Math.floor(ahora / 1000) }));
  const firma = crypto
    .sign('sha256', Buffer.from(`${cabecera}.${cuerpo}`), {
      key: crypto.createPrivateKey(key),
      dsaEncoding: 'ieee-p1363',
    })
    .toString('base64url');

  tokenEnUso = `${cabecera}.${cuerpo}.${firma}`;
  tokenCreadoEn = ahora;
  tokenDe = `${teamId}:${keyId}`;
  return tokenEnUso;
}

/** Obliga a firmar un token nuevo. Lo usan las pruebas y el reintento tras un 403. */
export function olvidarToken() {
  tokenEnUso = null;
  tokenCreadoEn = 0;
  tokenDe = null;
}

/** Abre la conexión con Apple y espera a que esté lista de verdad. */
function abrirConexion(apnsHost) {
  return new Promise((resolver, rechazar) => {
    let sesion;
    try {
      sesion = http2.connect(`https://${apnsHost}`);
    } catch (error) {
      rechazar(error);
      return;
    }

    const reloj = setTimeout(() => {
      fallar(new Error('tiempo de espera agotado al conectar con Apple'));
    }, ESPERA_MS);
    reloj.unref?.();

    const limpiar = () => {
      clearTimeout(reloj);
      sesion.off('connect', conectada);
      sesion.off('error', fallar);
    };
    function conectada() {
      limpiar();
      // A partir de aquí la conexión tiene que tener siempre quien escuche sus
      // errores: sin un oyente, un fallo de red derribaría el proceso entero.
      sesion.on('error', (error) => logger.warn('La conexión con Apple falló', { message: error.message }));
      resolver(sesion);
    }
    function fallar(error) {
      limpiar();
      try {
        sesion.destroy();
      } catch {
        /* la sesión ya estaba cerrada */
      }
      rechazar(error);
    }

    sesion.once('connect', conectada);
    sesion.once('error', fallar);
  });
}

/** Manda un aviso por una conexión ya abierta. */
function avisarPor(sesion, pushToken, { apnsKeyId, apnsKey, teamId, passTypeId }) {
  return new Promise((resolver) => {
    // El token acaba dentro de la ruta de la petición a Apple, firmada con la
    // clave del negocio. Uno con "/", "?" o ".." apuntaría a otra ruta; se trata
    // como un token inválido para que se dé de baja.
    if (typeof pushToken !== 'string' || !PUSH_TOKEN_VALIDO.test(pushToken)) {
      resolver({ ok: false, status: 0, motivo: 'BadDeviceToken' });
      return;
    }

    let listo = false;
    const terminar = (resultado) => {
      if (listo) return;
      listo = true;
      clearTimeout(reloj);
      sesion.off('close', cortada);
      sesion.off('error', cortada);
      resolver(resultado);
    };
    const cortada = () => terminar({ ok: false, status: 0, motivo: 'la conexión con Apple se cortó' });
    const reloj = setTimeout(() => terminar({ ok: false, status: 0, motivo: 'tiempo de espera agotado' }), ESPERA_MS);
    reloj.unref?.();
    sesion.once('close', cortada);
    sesion.once('error', cortada);

    let peticion;
    try {
      peticion = sesion.request({
        ':method': 'POST',
        ':path': `/3/device/${pushToken}`,
        authorization: `bearer ${tokenDeAutenticacion({ keyId: apnsKeyId, key: apnsKey, teamId })}`,
        'apns-topic': passTypeId,
        'apns-push-type': 'background',
        'apns-priority': '5',
        'content-type': 'application/json',
      });
    } catch (error) {
      terminar({ ok: false, status: 0, motivo: error.message });
      return;
    }

    let estado = 0;
    let cuerpo = '';
    peticion.on('response', (cabeceras) => {
      estado = cabeceras[':status'];
    });
    peticion.setEncoding('utf8');
    peticion.on('data', (trozo) => {
      cuerpo += trozo;
    });
    peticion.on('error', (error) => terminar({ ok: false, status: 0, motivo: error.message }));
    peticion.on('end', () => {
      let motivo;
      try {
        motivo = cuerpo ? JSON.parse(cuerpo).reason : undefined;
      } catch {
        motivo = cuerpo || undefined;
      }
      terminar({ ok: estado === 200, status: estado, motivo });
    });

    // El cuerpo va vacío a propósito: el pase se actualiza consultando, no con
    // lo que venga en el aviso.
    peticion.end('{}');
  });
}

/**
 * Envía el aviso a un teléfono, abriendo y cerrando la conexión.
 * Para varios teléfonos es mejor `avisarATodos`, que la reutiliza.
 * @returns {Promise<{ok: boolean, status: number, motivo?: string}>}
 */
export async function avisar(pushToken, credenciales) {
  if (typeof pushToken !== 'string' || !PUSH_TOKEN_VALIDO.test(pushToken)) {
    return { ok: false, status: 0, motivo: 'BadDeviceToken' };
  }

  let sesion;
  try {
    sesion = await abrirConexion(credenciales.apnsHost);
  } catch (error) {
    return { ok: false, status: 0, motivo: error.message };
  }
  try {
    return await avisarPor(sesion, pushToken, credenciales);
  } finally {
    try {
      sesion.destroy();
    } catch {
      /* la sesión ya estaba cerrada */
    }
  }
}

/**
 * Avisa a varios teléfonos por una sola conexión y dice cuáles hay que dar de
 * baja y cuántos avisos no salieron.
 *
 * Apple responde 410 cuando un teléfono ya no tiene el pase: esos registros se
 * borran, porque si no el sistema seguiría avisando para siempre a un aparato
 * que ya no existe. Lo que falla por otra razón cuenta como atrasado, y quien
 * llama decide reintentarlo.
 */
export async function avisarATodos(tokens, credenciales) {
  const caducados = [];
  let enviados = 0;
  let fallidos = 0;
  if (tokens.length === 0) return { enviados, caducados, fallidos };

  let sesion;
  try {
    sesion = await abrirConexion(credenciales.apnsHost);
  } catch (error) {
    logger.warn('No se pudo conectar con Apple para avisar de un cambio', { message: error.message });
    return { enviados: 0, caducados: [], fallidos: tokens.length };
  }

  try {
    for (const token of tokens) {
      let resultado = await avisarPor(sesion, token, credenciales);

      // El problema puede ser nuestro token de proveedor, no el teléfono: se
      // firma otro y se reintenta una vez.
      if (resultado.status === 403 && TOKEN_DE_PROVEEDOR_MALO.has(resultado.motivo)) {
        olvidarToken();
        resultado = await avisarPor(sesion, token, credenciales);
      }

      if (resultado.ok) {
        enviados += 1;
      } else if (resultado.status === 410 || TELEFONO_DE_BAJA.has(resultado.motivo)) {
        caducados.push(token);
      } else {
        fallidos += 1;
        logger.warn('No se pudo avisar a un teléfono del cambio en su pase', {
          status: resultado.status,
          motivo: resultado.motivo,
        });
      }
    }
  } finally {
    try {
      sesion.destroy();
    } catch {
      /* la sesión ya estaba cerrada */
    }
  }

  return { enviados, caducados, fallidos };
}
