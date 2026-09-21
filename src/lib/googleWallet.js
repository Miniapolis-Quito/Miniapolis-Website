/**
 * Pases de Google Wallet.
 *
 * Aquí no hay archivo que descargar: el pase es un objeto que vive en los
 * servidores de Google. Guardarlo es abrir un enlace con un JWT firmado por la
 * cuenta de servicio del negocio, y actualizarlo es una llamada a su API. El
 * teléfono se entera solo, sin avisos push por nuestra parte.
 *
 * Todo va con `fetch` y `node:crypto`: la firma es RS256 y el acceso a la API
 * se consigue con el flujo de cuenta de servicio, que son unas pocas líneas.
 *
 * Una advertencia que vale para todo este archivo: la API de Google rechaza
 * con 400 cualquier campo que no conozca. Un campo de más —aunque exista en
 * otro tipo de pase— no se ignora: tumba la llamada entera. Por eso lo que se
 * manda se mantiene pegado al esquema de `genericClass` y `genericObject`.
 */
import crypto from 'node:crypto';
import { logger } from './logger.js';

const API = 'https://walletobjects.googleapis.com/walletobjects/v1';
const ALCANCE = 'https://www.googleapis.com/auth/wallet_object.issuer';
const VIDA_DEL_ACCESO_MS = 50 * 60 * 1000;
/** Google tarda; más de esto es que algo va mal y no vale la pena seguir esperando. */
const ESPERA_MAXIMA_MS = 15_000;

let acceso = null;
let accesoCreadoEn = 0;
/** De qué cuenta de servicio es el permiso guardado. */
let accesoDe = null;
/** Clases que ya se comprobaron en esta ejecución; evita una consulta por enlace. */
const clasesListas = new Set();

function base64url(valor) {
  return Buffer.from(valor).toString('base64url');
}

/** Firma un JWT RS256 con la clave de la cuenta de servicio. */
export function firmarJwt(cuerpo, privateKey) {
  const cabecera = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const datos = `${cabecera}.${base64url(JSON.stringify(cuerpo))}`;
  const firma = crypto.sign('sha256', Buffer.from(datos), crypto.createPrivateKey(privateKey)).toString('base64url');
  return `${datos}.${firma}`;
}

/** Descarta el permiso de acceso guardado (lo usan las pruebas y el reintento tras un 401). */
export function olvidarAcceso() {
  acceso = null;
  accesoCreadoEn = 0;
  accesoDe = null;
  clasesListas.clear();
}

/**
 * Permiso de acceso a la API, a partir de la cuenta de servicio.
 *
 * Se reutiliza mientras siga vivo: pedir uno nuevo en cada llamada sería una
 * ida y vuelta de más por cada entrada consumida. Se guarda junto a la cuenta
 * que lo pidió, para que cambiar de credenciales no siga usando el anterior.
 */
async function permisoDeAcceso({ serviceAccountEmail, privateKey }, ahora = Date.now()) {
  if (acceso && accesoDe === serviceAccountEmail && ahora - accesoCreadoEn < VIDA_DEL_ACCESO_MS) return acceso;

  const segundos = Math.floor(ahora / 1000);
  const asercion = firmarJwt(
    {
      iss: serviceAccountEmail,
      scope: ALCANCE,
      aud: 'https://oauth2.googleapis.com/token',
      iat: segundos,
      exp: segundos + 3600,
    },
    privateKey,
  );

  const respuesta = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: asercion,
    }),
    signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
  });

  if (!respuesta.ok) {
    throw new Error(`Google no concedió acceso a la cartera (${respuesta.status}): ${await respuesta.text()}`);
  }

  acceso = (await respuesta.json()).access_token;
  accesoCreadoEn = ahora;
  accesoDe = serviceAccountEmail;
  return acceso;
}

/**
 * Una llamada a la API.
 *
 * Si Google contesta 401, el permiso guardado ya no vale —se revocó la clave,
 * el reloj se movió— y se pide otro una sola vez. Sin esto, un permiso caído
 * dejaba los pases sin actualizar durante los cincuenta minutos que duraba su
 * caché, y cada consumo se perdía en silencio.
 */
async function llamar(ruta, { metodo = 'GET', cuerpo, credenciales, reintentado = false }) {
  const token = await permisoDeAcceso(credenciales);
  let respuesta;
  try {
    respuesta = await fetch(`${API}${ruta}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
    });
  } catch (error) {
    // Una red caída no es una respuesta: se dice con estado 0 para que quien
    // llama lo trate como fallo temporal y lo vuelva a intentar más tarde.
    return { ok: false, status: 0, datos: { error: error.message } };
  }

  if (respuesta.status === 401 && !reintentado) {
    olvidarAcceso();
    return llamar(ruta, { metodo, cuerpo, credenciales, reintentado: true });
  }

  const texto = await respuesta.text();
  let datos = null;
  if (texto) {
    try {
      datos = JSON.parse(texto);
    } catch {
      datos = { respuesta: texto };
    }
  }
  return {
    ok: respuesta.ok,
    status: respuesta.status,
    datos,
  };
}

/**
 * Se asegura de que exista la plantilla común a todos los pases (la "clase").
 * Se crea una sola vez; si ya está, Google responde que hay conflicto y eso es
 * exactamente lo que se buscaba.
 */
export async function asegurarClase(clase, credenciales) {
  if (clasesListas.has(clase.id)) return { creada: false };

  const existe = await llamar(`/genericClass/${encodeURIComponent(clase.id)}`, { credenciales });
  if (existe.ok) {
    clasesListas.add(clase.id);
    return { creada: false };
  }

  const creacion = await llamar('/genericClass', { metodo: 'POST', cuerpo: clase, credenciales });
  if (!creacion.ok && creacion.status !== 409) {
    throw new Error(
      `No se pudo preparar la plantilla de Google Wallet (${creacion.status}): ${JSON.stringify(creacion.datos)}`,
    );
  }
  clasesListas.add(clase.id);
  return { creada: creacion.ok };
}

/** Enlace de "Guardar en Google Wallet" para un pase concreto. */
export function enlaceParaGuardar(objeto, { serviceAccountEmail, privateKey }) {
  const jwt = firmarJwt(
    {
      iss: serviceAccountEmail,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      payload: { genericObjects: [objeto] },
    },
    privateKey,
  );
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

/**
 * Deja el objeto del pase con los datos de ahora.
 *
 * Se intenta actualizar y, si todavía no existe —el cliente guardó el enlace
 * pero nunca llegó a abrirlo—, se crea. Así el saldo queda al día en cuanto la
 * persona lo añada, sin depender de en qué orden pasaron las cosas. Y si entre
 * las dos llamadas alguien lo creó (el propio cliente abriendo el enlace en ese
 * instante), el 409 no es un error: se vuelve a actualizar y listo.
 */
export async function guardarObjeto(objeto, credenciales) {
  const actualizacion = await llamar(`/genericObject/${encodeURIComponent(objeto.id)}`, {
    metodo: 'PATCH',
    cuerpo: objeto,
    credenciales,
  });
  if (actualizacion.ok) return { creado: false };

  if (actualizacion.status === 404) {
    const creacion = await llamar('/genericObject', { metodo: 'POST', cuerpo: objeto, credenciales });
    if (creacion.ok) return { creado: true };

    if (creacion.status === 409) {
      const segunda = await llamar(`/genericObject/${encodeURIComponent(objeto.id)}`, {
        metodo: 'PATCH',
        cuerpo: objeto,
        credenciales,
      });
      if (segunda.ok) return { creado: false };
      throw new Error(
        `No se pudo actualizar el pase recién creado en Google Wallet (${segunda.status}): ${JSON.stringify(segunda.datos)}`,
      );
    }

    throw new Error(`No se pudo crear el pase en Google Wallet (${creacion.status}): ${JSON.stringify(creacion.datos)}`);
  }

  throw new Error(
    `No se pudo actualizar el pase en Google Wallet (${actualizacion.status}): ${JSON.stringify(actualizacion.datos)}`,
  );
}

/**
 * Comprueba de una vez que las credenciales sirven y que la plantilla existe.
 * Se llama al arrancar para que un error de configuración salga en el registro
 * del servidor y no la primera vez que un cliente pulsa el botón.
 */
export async function comprobarConfiguracion(clase, credenciales) {
  try {
    await asegurarClase(clase, credenciales);
    return { ok: true };
  } catch (error) {
    logger.warn('Google Wallet está configurado pero no responde como se espera', { message: error.message });
    return { ok: false, message: error.message };
  }
}
