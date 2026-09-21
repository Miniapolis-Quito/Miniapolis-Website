/**
 * El cliente de Google Wallet, con Google de mentira.
 *
 * Lo que se comprueba aquí son los caminos que en producción aparecen justo
 * cuando peor viene: un permiso de acceso que dejó de valer, dos peticiones que
 * se cruzan al crear el mismo pase, la red que se cae. Ninguno se puede
 * provocar contra Google de verdad, y son precisamente los que dejarían el
 * saldo del pase congelado sin que nadie se entere.
 *
 * Esta suite no levanta el servidor: las funciones reciben las credenciales por
 * parámetro, así que basta con una clave generada aquí mismo.
 */
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import * as google from '../src/lib/googleWallet.js';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const credenciales = { serviceAccountEmail: 'pases@proyecto.iam.gserviceaccount.com', privateKey };

const fetchReal = globalThis.fetch;
/** Lo que se le pidió a Google, en orden. */
let llamadas = [];
/** Respuestas preparadas para las rutas de la API, en orden de llegada. */
let respuestas = [];

const respuesta = (status, cuerpo = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(cuerpo),
  json: async () => cuerpo,
});

beforeEach(() => {
  google.olvidarAcceso();
  llamadas = [];
  respuestas = [];
  globalThis.fetch = async (url, opciones = {}) => {
    const direccion = String(url);
    llamadas.push({ url: direccion, metodo: opciones.method ?? 'GET' });

    if (direccion.startsWith('https://oauth2.googleapis.com/token')) {
      return respuesta(200, { access_token: `token-${llamadas.length}` });
    }
    const siguiente = respuestas.shift();
    if (!siguiente) throw new Error(`Llamada sin respuesta preparada: ${opciones.method ?? 'GET'} ${direccion}`);
    if (siguiente instanceof Error) throw siguiente;
    return respuesta(siguiente.status, siguiente.cuerpo ?? {});
  };
});

afterEach(() => {
  globalThis.fetch = fetchReal;
  google.olvidarAcceso();
});

/** Solo las llamadas a la API de pases; el permiso de acceso va aparte. */
const aLaApi = () => llamadas.filter((l) => l.url.includes('walletobjects.googleapis.com'));

const objeto = { id: '338.abc', classId: '338.entradas' };

test('un pase que todavía no existe se crea al intentar actualizarlo', async () => {
  respuestas = [{ status: 404 }, { status: 200 }];
  assert.deepEqual(await google.guardarObjeto(objeto, credenciales), { creado: true });
  assert.deepEqual(
    aLaApi().map((l) => l.metodo),
    ['PATCH', 'POST'],
  );
});

test('si el cliente abre el enlace justo a la vez, el conflicto no es un error', async () => {
  // PATCH dice que no existe, POST dice que sí (lo creó el propio cliente al
  // abrir su enlace en ese instante): lo correcto es volver a actualizarlo.
  respuestas = [{ status: 404 }, { status: 409 }, { status: 200 }];
  assert.deepEqual(await google.guardarObjeto(objeto, credenciales), { creado: false });
  assert.deepEqual(
    aLaApi().map((l) => l.metodo),
    ['PATCH', 'POST', 'PATCH'],
  );
});

test('un permiso de acceso que dejó de valer se renueva y la llamada se repite', async () => {
  respuestas = [{ status: 401 }, { status: 200 }];
  assert.deepEqual(await google.guardarObjeto(objeto, credenciales), { creado: false });

  // Dos permisos pedidos: el guardado y el nuevo. Sin esto, un permiso caído
  // dejaba los pases sin actualizar durante los cincuenta minutos que duraba
  // su caché, y cada consumo se perdía en silencio.
  assert.equal(llamadas.filter((l) => l.url.includes('oauth2')).length, 2);
  assert.deepEqual(
    aLaApi().map((l) => l.metodo),
    ['PATCH', 'PATCH'],
  );
});

test('el reintento por permiso caducado se hace una sola vez', async () => {
  respuestas = [{ status: 401 }, { status: 401 }];
  await assert.rejects(() => google.guardarObjeto(objeto, credenciales), /No se pudo actualizar el pase/);
  assert.equal(aLaApi().length, 2, 'un 401 que insiste no puede convertirse en un bucle');
});

test('la red caída se cuenta como fallo, no como pase actualizado', async () => {
  respuestas = [new Error('getaddrinfo ENOTFOUND')];
  await assert.rejects(() => google.guardarObjeto(objeto, credenciales), /No se pudo actualizar el pase/);
});

test('la plantilla se comprueba una vez y no en cada enlace', async () => {
  const clase = { id: '338.entradas' };
  respuestas = [{ status: 404 }, { status: 200 }];
  assert.deepEqual(await google.asegurarClase(clase, credenciales), { creada: true });
  assert.equal(aLaApi().length, 2);

  // La segunda vez no vuelve a preguntar: era una ida y vuelta de más en cada
  // botón de "Guardar en Google Wallet".
  assert.deepEqual(await google.asegurarClase(clase, credenciales), { creada: false });
  assert.equal(aLaApi().length, 2);
});

test('una plantilla que ya existía no se intenta crear dos veces', async () => {
  respuestas = [{ status: 404 }, { status: 409 }];
  assert.deepEqual(await google.asegurarClase({ id: '338.entradas' }, credenciales), { creada: false });
});

test('un campo que Google no conoce se cuenta como error y se explica', async () => {
  respuestas = [
    { status: 404 },
    { status: 400, cuerpo: { error: { message: 'Cannot find field: hexBackgroundColor' } } },
  ];
  await assert.rejects(
    () => google.asegurarClase({ id: '338.entradas', hexBackgroundColor: '#000' }, credenciales),
    /hexBackgroundColor/,
  );
});
