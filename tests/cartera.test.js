/**
 * Pases en la cartera del teléfono.
 *
 * Lo que se comprueba aquí es la mecánica completa: que el archivo que se
 * descarga es un pase válido y firmado, que el teléfono puede registrarse para
 * recibir avisos, y —lo que pidió el cliente— que al descontar una entrada el
 * saldo del pase cambia y al teléfono le llega el aviso para venir a buscarlo.
 *
 * Las credenciales de verdad las emiten Apple y Google; `./env-cartera.js`
 * genera unas equivalentes y levanta el terreno para que la mecánica sea la
 * misma. El aviso push se manda contra un APNs de mentira que corre aquí al
 * lado, así que se comprueba el envío de verdad, con su HTTP/2 y su token.
 */
import './env-cartera.js';
import './env.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http2 from 'node:http2';
import { readFileSync } from 'node:fs';
import { PUERTO_APNS, CERTIFICADO_APNS, CLAVE_PUBLICA_GOOGLE } from './env-cartera.js';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios, crearCliente } from './helpers.js';
import { getDb } from '../src/db/index.js';
import * as wallet from '../src/services/wallet.js';
import * as apns from '../src/lib/apns.js';
import * as packsService from '../src/services/packs.js';

// ---------------------------------------------------------------------------
// APNs de mentira: apunta lo que recibe
// ---------------------------------------------------------------------------

const avisosRecibidos = [];
let apnsFalso;

before(async () => {
  await levantarServidor();
  apnsFalso = http2.createSecureServer({
    cert: readFileSync(CERTIFICADO_APNS.cert),
    key: readFileSync(CERTIFICADO_APNS.key),
  });
  apnsFalso.on('stream', (flujo, cabeceras) => {
    avisosRecibidos.push({
      ruta: cabeceras[':path'],
      topico: cabeceras['apns-topic'],
      autorizacion: cabeceras.authorization,
      tipo: cabeceras['apns-push-type'],
    });
    flujo.respond({ ':status': 200 });
    flujo.end();
  });
  await new Promise((listo) => apnsFalso.listen(PUERTO_APNS, '127.0.0.1', listo));
});

after(async () => {
  await new Promise((listo) => apnsFalso.close(listo));
  await bajarServidor();
});

beforeEach(() => {
  limpiarBase();
  avisosRecibidos.length = 0;
  apns.olvidarToken();
});

// ---------------------------------------------------------------------------
// Lector mínimo de .pkpass (un ZIP sin comprimir)
// ---------------------------------------------------------------------------

function leerPkpass(buffer) {
  const archivos = {};
  let i = 0;
  while (i + 30 <= buffer.length && buffer.readUInt32LE(i) === 0x04034b50) {
    const tamano = buffer.readUInt32LE(i + 18);
    const largoNombre = buffer.readUInt16LE(i + 26);
    const largoExtra = buffer.readUInt16LE(i + 28);
    const nombre = buffer.subarray(i + 30, i + 30 + largoNombre).toString('utf8');
    const inicio = i + 30 + largoNombre + largoExtra;
    archivos[nombre] = buffer.subarray(inicio, inicio + tamano);
    i = inicio + tamano;
  }
  return archivos;
}

async function packDePrueba(cMaster, clienteId, extras = {}) {
  const r = await cMaster.post('/api/admin/packs', { userId: clienteId, size: 5, ...extras });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  return packsService.findById(r.datos.pack.id);
}

// ---------------------------------------------------------------------------
// El pase
// ---------------------------------------------------------------------------

test('el sistema anuncia las carteras que tiene configuradas', async () => {
  const r = await crearCliente().get('/api/config');
  assert.deepEqual(r.datos.wallet, { apple: true, google: true });
});

test('el cliente descarga un pase firmado con su saldo dentro', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id);

  const r = await cCliente.get(`/api/wallet/apple/pass/${pack.id}`, { binario: true });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/vnd.apple.pkpass');

  const archivos = leerPkpass(r.datos);
  assert.deepEqual(
    Object.keys(archivos).sort(),
    ['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png', 'manifest.json', 'pass.json', 'signature'].sort(),
  );

  const pase = JSON.parse(archivos['pass.json'].toString('utf8'));
  assert.equal(pase.storeCard.headerFields[0].value, 5, 'el pase nace con las cinco entradas');
  assert.equal(pase.storeCard.primaryFields[0].value, pack.code);
  assert.equal(pase.passTypeIdentifier, 'pass.ec.prueba.entradas');
  assert.equal(pase.webServiceURL, 'https://entradas.example/api/wallet/apple');
  assert.ok(pase.authenticationToken, 'sin contraseña el teléfono no podría pedir el pase');

  // El manifiesto tiene que describir de verdad lo que va dentro: si no, el
  // teléfono rechaza el pase sin explicar por qué.
  const manifiesto = JSON.parse(archivos['manifest.json'].toString('utf8'));
  for (const [nombre, huella] of Object.entries(manifiesto)) {
    assert.equal(crypto.createHash('sha1').update(archivos[nombre]).digest('hex'), huella, nombre);
  }
  assert.ok(archivos.signature.length > 100, 'el pase va sin firmar');
});

test('el pase no lleva código si el pack no admite uno que no rota', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const normal = await packDePrueba(cMaster, cliente.id);
  const conImpreso = await packDePrueba(cMaster, cliente.id, { allowStaticQr: true });

  const sinCodigo = JSON.parse(
    leerPkpass((await cCliente.get(`/api/wallet/apple/pass/${normal.id}`, { binario: true })).datos)['pass.json'],
  );
  assert.equal(sinCodigo.barcodes, undefined, 'un pase copiable exige habilitarlo pack por pack');
  assert.match(sinCodigo.storeCard.backFields[0].value, /abre la app/i);

  const conCodigo = JSON.parse(
    leerPkpass((await cCliente.get(`/api/wallet/apple/pass/${conImpreso.id}`, { binario: true })).datos)['pass.json'],
  );
  assert.equal(conCodigo.barcodes[0].format, 'PKBarcodeFormatQR');
  assert.match(conCodigo.barcodes[0].message, /^RHE1\|/);
  assert.equal(conCodigo.barcodes[0].altText, conImpreso.code);
});

test('el pase de un cliente no se le entrega a otro', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const otro = await cMaster.post('/api/admin/users', {
    email: 'ajeno@pista.ec', fullName: 'Piloto Ajeno', role: 'customer', password: 'Palanca-Cambios-55',
  });
  const ajeno = await packDePrueba(cMaster, otro.datos.user.id);

  const r = await cCliente.get(`/api/wallet/apple/pass/${ajeno.id}`);
  assert.equal(r.status, 403);

  const google = await cCliente.get(`/api/wallet/google/pass/${ajeno.id}`);
  assert.equal(google.status, 403);
});

test('el permiso de descarga vale un rato y solo para su pack', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id);
  const otro = await packDePrueba(cMaster, cliente.id);

  const permiso = await cCliente.get(`/api/wallet/apple/ticket/${pack.id}`);
  assert.equal(permiso.status, 200);
  const ticket = new URL(permiso.datos.url).searchParams.get('t');
  assert.ok(ticket);

  // Sin sesión, pero con el permiso, el teléfono llega al pase.
  const anonimo = crearCliente();
  assert.equal((await anonimo.get(`/api/wallet/apple/pass/${pack.id}?t=${encodeURIComponent(ticket)}`)).status, 200);
  // El mismo permiso no sirve para otro pack, ni uno inventado para el suyo.
  assert.equal((await anonimo.get(`/api/wallet/apple/pass/${otro.id}?t=${encodeURIComponent(ticket)}`)).status, 401);
  assert.equal((await anonimo.get(`/api/wallet/apple/pass/${pack.id}?t=falso`)).status, 401);
  assert.equal((await anonimo.get(`/api/wallet/apple/pass/${pack.id}`)).status, 401);

  // Y caduca: uno firmado en el pasado ya no abre nada.
  const caducado = wallet.firmarTicket(pack.id, { ahora: Date.now() - 3600_000 });
  assert.equal(wallet.ticketValido(pack.id, caducado), false);
});

// ---------------------------------------------------------------------------
// El servicio web que mantiene el pase al día
// ---------------------------------------------------------------------------

/** Registra un teléfono como lo haría iOS y devuelve sus datos. */
async function registrarTelefono(pack, { deviceId = 'telefono-de-carlos', pushToken = 'a'.repeat(64) } = {}) {
  const pase = wallet.asegurarPase(pack.id);
  const anonimo = crearCliente();
  const r = await anonimo.post(
    `/api/wallet/apple/v1/devices/${deviceId}/registrations/pass.ec.prueba.entradas/${pase.serial}`,
    { pushToken },
    { cabeceras: { Authorization: `ApplePass ${pase.auth_token}` } },
  );
  return { pase, respuesta: r, deviceId, pushToken };
}

test('el teléfono se registra con la contraseña del propio pase', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id);

  const { pase, respuesta } = await registrarTelefono(pack);
  assert.equal(respuesta.status, 201, 'la primera vez, creado');

  // Repetir el registro es normal —el teléfono lo reintenta— y no es un error.
  const repetido = await registrarTelefono(pack);
  assert.equal(repetido.respuesta.status, 200);

  // Con una contraseña que no es la suya, no.
  const anonimo = crearCliente();
  const conOtra = await anonimo.post(
    `/api/wallet/apple/v1/devices/otro/registrations/pass.ec.prueba.entradas/${pase.serial}`,
    { pushToken: 'b'.repeat(64) },
    { cabeceras: { Authorization: 'ApplePass no-es-la-buena' } },
  );
  assert.equal(conOtra.status, 401);
});

test('al descontar una entrada, el pase cambia y el teléfono recibe el aviso', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id);
  const { pase, pushToken } = await registrarTelefono(pack);
  const antes = getDb().prepare('SELECT updated_at FROM wallet_passes WHERE pack_id = ?').get(pack.id).updated_at;

  // El personal cobra una entrada, como cualquier otro día.
  const consumo = await cStaff.post('/api/scan/manual', { code: pack.code });
  assert.equal(consumo.status, 200);
  assert.equal(consumo.datos.remaining, 4);

  // El aviso sale agrupado un instante después, para no mandar uno por escaneo.
  await new Promise((listo) => setTimeout(listo, 2500));

  assert.equal(avisosRecibidos.length, 1, 'debería haber salido un aviso al teléfono');
  assert.equal(avisosRecibidos[0].ruta, `/3/device/${pushToken}`);
  assert.equal(avisosRecibidos[0].topico, 'pass.ec.prueba.entradas', 'el aviso va al identificador del pase');
  assert.match(avisosRecibidos[0].autorizacion, /^bearer eyJ/, 'el aviso va firmado con la clave de APNs');

  const despues = getDb().prepare('SELECT updated_at FROM wallet_passes WHERE pack_id = ?').get(pack.id).updated_at;
  assert.ok(despues > antes, 'el pase debería constar como cambiado');

  // Y cuando el teléfono viene a buscarlo, se lleva el saldo nuevo.
  const anonimo = crearCliente();
  const nuevo = await anonimo.get(`/api/wallet/apple/v1/passes/pass.ec.prueba.entradas/${pase.serial}`, {
    binario: true,
    cabeceras: { Authorization: `ApplePass ${pase.auth_token}` },
  });
  assert.equal(nuevo.status, 200);
  const contenido = JSON.parse(leerPkpass(nuevo.datos)['pass.json']);
  assert.equal(contenido.storeCard.headerFields[0].value, 4, 'el pase tiene que traer las cuatro que quedan');
  assert.equal(contenido.storeCard.headerFields[0].changeMessage, 'Te quedan %@ entradas.');
});

test('el teléfono pregunta qué cambió y no se le repite lo ya visto', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id);
  const { pase, deviceId } = await registrarTelefono(pack);
  const anonimo = crearCliente();

  const listaInicial = await anonimo.get(
    `/api/wallet/apple/v1/devices/${deviceId}/registrations/pass.ec.prueba.entradas`,
  );
  assert.equal(listaInicial.status, 200);
  assert.deepEqual(listaInicial.datos.serialNumbers, [pase.serial]);

  // Con la marca de la última vez, ya no hay novedades.
  const sinNovedad = await anonimo.get(
    `/api/wallet/apple/v1/devices/${deviceId}/registrations/pass.ec.prueba.entradas?passesUpdatedSince=${encodeURIComponent(listaInicial.datos.lastUpdated)}`,
  );
  assert.equal(sinNovedad.status, 204);

  // Se consume una entrada y entonces sí.
  await cStaff.post('/api/scan/manual', { code: pack.code });
  await new Promise((listo) => setTimeout(listo, 2500));
  const conNovedad = await anonimo.get(
    `/api/wallet/apple/v1/devices/${deviceId}/registrations/pass.ec.prueba.entradas?passesUpdatedSince=${encodeURIComponent(listaInicial.datos.lastUpdated)}`,
  );
  assert.equal(conNovedad.status, 200);
  assert.deepEqual(conNovedad.datos.serialNumbers, [pase.serial]);
});

test('el teléfono que borró el pase deja de recibir avisos', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id);
  const { pase, deviceId } = await registrarTelefono(pack);
  const anonimo = crearCliente();

  const baja = await anonimo.pedir(
    `/api/wallet/apple/v1/devices/${deviceId}/registrations/pass.ec.prueba.entradas/${pase.serial}`,
    { metodo: 'DELETE', cabeceras: { Authorization: `ApplePass ${pase.auth_token}` } },
  );
  assert.equal(baja.status, 200);

  await cStaff.post('/api/scan/manual', { code: pack.code });
  await new Promise((listo) => setTimeout(listo, 2500));
  assert.equal(avisosRecibidos.length, 0, 'a un teléfono dado de baja no se le avisa');
});

// ---------------------------------------------------------------------------
// Google Wallet
// ---------------------------------------------------------------------------

test('el pase de Google lleva el saldo y va firmado por la cuenta de servicio', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id, { allowStaticQr: true });
  const pase = wallet.asegurarPase(pack.id);
  const dueno = { full_name: 'Carlos Piloto' };

  const objeto = wallet.objetoGoogle(pack, dueno, pase);
  assert.equal(objeto.id, `3388000000000000000.${pase.serial}`);
  assert.equal(objeto.state, 'ACTIVE');
  assert.equal(objeto.header.defaultValue.value, '5');
  assert.equal(objeto.textModulesData.find((t) => t.id === 'restantes').body, '5 de 5');
  assert.equal(objeto.barcode.value.startsWith('RHE1|'), true);

  // El enlace de "guardar" es un JWT que Google verifica con la clave pública
  // de la cuenta de servicio: si no está bien firmado, no guarda nada.
  const enlace = (await import('../src/lib/googleWallet.js')).enlaceParaGuardar(
    { id: objeto.id, classId: objeto.classId },
    { serviceAccountEmail: process.env.GOOGLE_WALLET_SERVICE_ACCOUNT, privateKey: process.env.GOOGLE_WALLET_PRIVATE_KEY },
  );
  assert.ok(enlace.startsWith('https://pay.google.com/gp/v/save/'));

  const jwt = enlace.split('/save/')[1];
  const [cabecera, cuerpo, firma] = jwt.split('.');
  assert.equal(
    crypto.verify('sha256', Buffer.from(`${cabecera}.${cuerpo}`), CLAVE_PUBLICA_GOOGLE, Buffer.from(firma, 'base64url')),
    true,
    'el enlace tiene que ir firmado por la cuenta de servicio',
  );
  const carga = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
  assert.equal(carga.typ, 'savetowallet');
  assert.equal(carga.payload.genericObjects[0].id, objeto.id);
});

test('un pack agotado o anulado sale como inactivo en la cartera', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id, { size: 1 });
  const pase = wallet.asegurarPase(pack.id);

  await cMaster.patch(`/api/admin/packs/${pack.id}`, { status: 'cancelled' });
  const anulado = packsService.findById(pack.id);

  assert.equal(wallet.objetoGoogle(anulado, null, pase).state, 'INACTIVE');
  const apple = wallet.contenidoApple(anulado, null, pase);
  assert.equal(apple.storeCard.secondaryFields.find((c) => c.key === 'estado').value, 'Anulado');
});
