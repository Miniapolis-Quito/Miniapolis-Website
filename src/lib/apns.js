/**
 * Aviso a los teléfonos de que su pase cambió (APNs).
 *
 * Para un pase de cartera el aviso va vacío: no es una notificación que se vea,
 * sino un golpecito para que el teléfono vuelva a pedir el pase. Lo que llega
 * después es una petición al servicio web del pase, que devuelve el saldo nuevo.
 *
 * Se usa autenticación por token (.p8) en vez de por certificado: una sola
 * clave sirve para siempre y no caduca cada año como los certificados.
 */
import crypto from 'node:crypto';
import http2 from 'node:http2';
import { logger } from './logger.js';

/** El token de APNs vale una hora; se renueva antes para no apurar el margen. */
const VIDA_DEL_TOKEN_MS = 50 * 60 * 1000;

/** Un token de APNs es hexadecimal; el largo exacto lo decide Apple. */
export const PUSH_TOKEN_VALIDO = /^[0-9A-Fa-f]{32,200}$/;

let tokenEnUso = null;
let tokenCreadoEn = 0;

function base64url(valor) {
  return Buffer.from(valor).toString('base64url');
}

/** Token de autenticación firmado con la clave .p8 (ES256). */
function tokenDeAutenticacion({ keyId, key, teamId }, ahora = Date.now()) {
  if (tokenEnUso && ahora - tokenCreadoEn < VIDA_DEL_TOKEN_MS) return tokenEnUso;

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
  return tokenEnUso;
}

/** Solo para las pruebas: obliga a firmar un token nuevo. */
export function olvidarToken() {
  tokenEnUso = null;
  tokenCreadoEn = 0;
}

/**
 * Envía el aviso a un teléfono.
 * @returns {Promise<{ok: boolean, status: number, motivo?: string}>}
 */
export function avisar(pushToken, { apnsKeyId, apnsKey, teamId, passTypeId, apnsHost }) {
  return new Promise((resolver) => {
    // El token acaba dentro de la ruta de la petición a Apple, firmada con la
    // clave del negocio. Uno con "/", "?" o ".." apuntaría a otra ruta; se trata
    // como un token inválido para que se dé de baja.
    if (typeof pushToken !== 'string' || !PUSH_TOKEN_VALIDO.test(pushToken)) {
      resolver({ ok: false, status: 0, motivo: 'BadDeviceToken' });
      return;
    }

    let sesion;
    try {
      sesion = http2.connect(`https://${apnsHost}`);
    } catch (error) {
      resolver({ ok: false, status: 0, motivo: error.message });
      return;
    }

    const terminar = (resultado) => {
      try {
        sesion.close();
      } catch {
        /* la sesión ya estaba cerrada */
      }
      resolver(resultado);
    };

    sesion.on('error', (error) => terminar({ ok: false, status: 0, motivo: error.message }));
    sesion.setTimeout(10_000, () => terminar({ ok: false, status: 0, motivo: 'tiempo de espera agotado' }));

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
 * Avisa a varios teléfonos y dice cuáles hay que dar de baja.
 *
 * Apple responde 410 cuando un teléfono ya no tiene el pase: esos registros se
 * borran, porque si no el sistema seguiría avisando para siempre a un aparato
 * que ya no existe.
 */
export async function avisarATodos(tokens, credenciales) {
  const caducados = [];
  let enviados = 0;

  for (const token of tokens) {
    const resultado = await avisar(token, credenciales);
    if (resultado.ok) {
      enviados += 1;
    } else if (resultado.status === 410 || resultado.motivo === 'BadDeviceToken') {
      caducados.push(token);
    } else {
      logger.warn('No se pudo avisar a un teléfono del cambio en su pase', {
        status: resultado.status,
        motivo: resultado.motivo,
      });
    }
  }

  return { enviados, caducados };
}
