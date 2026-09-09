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
 */
import crypto from 'node:crypto';

const API = 'https://walletobjects.googleapis.com/walletobjects/v1';
const ALCANCE = 'https://www.googleapis.com/auth/wallet_object.issuer';
const VIDA_DEL_ACCESO_MS = 50 * 60 * 1000;

let acceso = null;
let accesoCreadoEn = 0;

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

/** Solo para las pruebas: descarta el permiso de acceso guardado. */
export function olvidarAcceso() {
  acceso = null;
  accesoCreadoEn = 0;
}

/**
 * Permiso de acceso a la API, a partir de la cuenta de servicio.
 * Se reutiliza mientras siga vivo: pedir uno nuevo en cada llamada sería una
 * ida y vuelta de más por cada entrada consumida.
 */
async function permisoDeAcceso({ serviceAccountEmail, privateKey }, ahora = Date.now()) {
  if (acceso && ahora - accesoCreadoEn < VIDA_DEL_ACCESO_MS) return acceso;

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
  });

  if (!respuesta.ok) {
    throw new Error(`Google no concedió acceso a la cartera (${respuesta.status}): ${await respuesta.text()}`);
  }

  acceso = (await respuesta.json()).access_token;
  accesoCreadoEn = ahora;
  return acceso;
}

async function llamar(ruta, { metodo = 'GET', cuerpo, credenciales }) {
  const token = await permisoDeAcceso(credenciales);
  const respuesta = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await respuesta.text();
  return {
    ok: respuesta.ok,
    status: respuesta.status,
    datos: texto ? JSON.parse(texto) : null,
  };
}

/**
 * Se asegura de que exista la plantilla común a todos los pases (la "clase").
 * Se crea una sola vez; si ya está, Google responde que hay conflicto y eso es
 * exactamente lo que se buscaba.
 */
export async function asegurarClase(clase, credenciales) {
  const existe = await llamar(`/genericClass/${encodeURIComponent(clase.id)}`, { credenciales });
  if (existe.ok) return { creada: false };

  const creacion = await llamar('/genericClass', { metodo: 'POST', cuerpo: clase, credenciales });
  if (!creacion.ok && creacion.status !== 409) {
    throw new Error(`No se pudo preparar la plantilla de Google Wallet (${creacion.status}): ${JSON.stringify(creacion.datos)}`);
  }
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
 * persona lo añada, sin depender de en qué orden pasaron las cosas.
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
    throw new Error(`No se pudo crear el pase en Google Wallet (${creacion.status}): ${JSON.stringify(creacion.datos)}`);
  }

  throw new Error(
    `No se pudo actualizar el pase en Google Wallet (${actualizacion.status}): ${JSON.stringify(actualizacion.datos)}`,
  );
}
