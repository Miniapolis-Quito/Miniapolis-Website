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
/** Con qué contesta el APNs de mentira y cuántas conexiones ha recibido. */
let respuestaApns = 200;
let motivoApns = '';
let conexionesApns = 0;

before(async () => {
  await levantarServidor();
  apnsFalso = http2.createSecureServer({
    cert: readFileSync(CERTIFICADO_APNS.cert),
    key: readFileSync(CERTIFICADO_APNS.key),
  });
  apnsFalso.on('session', () => {
    conexionesApns += 1;
  });
  apnsFalso.on('stream', (flujo, cabeceras) => {
    avisosRecibidos.push({
      ruta: cabeceras[':path'],
      topico: cabeceras['apns-topic'],
      autorizacion: cabeceras.authorization,
      tipo: cabeceras['apns-push-type'],
    });
    if (respuestaApns === 200) {
      flujo.respond({ ':status': 200 });
      flujo.end();
      return;
    }
    // Un Apple que responde mal, para comprobar qué hace el sistema con un
    // aviso que no sale: unas respuestas dan de baja el teléfono y otras
    // tienen que reintentarse.
    flujo.respond({ ':status': respuestaApns, 'content-type': 'application/json' });
    flujo.end(JSON.stringify({ reason: motivoApns }));
  });
  // Si el puerto está ocupado (otra suite corriendo a la vez), `listen` no llama
  // a su callback sino que emite `error`: sin escucharlo, la prueba se quedaba
  // esperando para siempre en vez de fallar diciendo por qué.
  await new Promise((listo, fallo) => {
    apnsFalso.once('error', fallo);
    apnsFalso.listen(PUERTO_APNS, '127.0.0.1', listo);
  });
});

after(async () => {
  await new Promise((listo) => apnsFalso.close(listo));
  await bajarServidor();
});

beforeEach(() => {
  limpiarBase();
  avisosRecibidos.length = 0;
  conexionesApns = 0;
  respuestaApns = 200;
  motivoApns = '';
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
    [
      'icon.png',
      'icon@2x.png',
      'icon@3x.png',
      'logo.png',
      'logo@2x.png',
      'strip.png',
      'strip@2x.png',
      'strip@3x.png',
      'manifest.json',
      'pass.json',
      'signature',
    ].sort(),
  );

  const pase = JSON.parse(archivos['pass.json'].toString('utf8'));
  assert.equal(pase.storeCard.headerFields[0].value, 5, 'el pase nace con las cinco entradas');
  assert.equal(pase.storeCard.primaryFields[0].value, pack.code);
  assert.equal(pase.passTypeIdentifier, 'pass.ec.prueba.entradas');
  assert.equal(pase.webServiceURL, 'https://entradas.example/api/wallet/apple');
  assert.equal(pase.backgroundColor, 'rgb(0, 0, 0)');
  assert.equal(pase.labelColor, 'rgb(60, 254, 63)');
  assert.equal(pase.suppressStripShine, true, 'el arte del pase no debe recibir un brillo ajeno a la marca');
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
  assert.equal(contenido.storeCard.headerFields[0].changeMessage, 'Entradas disponibles: %@');
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
  assert.equal(objeto.hexBackgroundColor, '#000000');
  assert.match(objeto.logo.sourceUri.uri, /\/images\/miniapolis-wallet-icon\.png$/);
  assert.match(objeto.wideLogo.sourceUri.uri, /\/images\/miniapolis-wallet-wide-logo\.png$/);
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

// ---------------------------------------------------------------------------
// El servicio web del teléfono ante entradas hostiles
// ---------------------------------------------------------------------------

test('el identificador de avisos solo se acepta en hexadecimal', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id);

  // El token acaba en la ruta de la petición a Apple: nada de "/", "?" ni "..".
  for (const pushToken of [`../../3/device/${'a'.repeat(40)}`, `${'a'.repeat(40)}?x=1`, 'g'.repeat(64)]) {
    const { respuesta } = await registrarTelefono(pack, { pushToken });
    assert.equal(respuesta.status, 400, pushToken);
  }
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM wallet_devices').get().n, 0);

  // Y aunque uno así llegara a la base, el aviso no sale y el registro se da de baja.
  const resultado = await apns.avisar('../../otra-ruta', {
    apnsKeyId: 'X', apnsKey: 'no-se-usa', teamId: 'X', passTypeId: 'pass.ec.prueba.entradas', apnsHost: '127.0.0.1:38443',
  });
  assert.deepEqual(resultado, { ok: false, status: 0, motivo: 'BadDeviceToken' });
  assert.equal(avisosRecibidos.length, 0);
});

test('un identificador de tipo de pase ajeno no abre el pase', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id);
  const pase = wallet.asegurarPase(pack.id);
  const anonimo = crearCliente();
  const autorizacion = { Authorization: `ApplePass ${pase.auth_token}` };

  const ajeno = await anonimo.get(`/api/wallet/apple/v1/passes/pass.otro.negocio/${pase.serial}`, { cabeceras: autorizacion });
  assert.equal(ajeno.status, 401);
  const lista = await anonimo.get('/api/wallet/apple/v1/devices/telefono/registrations/pass.otro.negocio');
  assert.equal(lista.status, 404);
});

test('un identificador de teléfono o una marca de tiempo con forma extraña se rechazan', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id);

  const { respuesta } = await registrarTelefono(pack, { deviceId: 'tel%20con%20espacios' });
  assert.equal(respuesta.status, 400);

  const anonimo = crearCliente();
  const marca = await anonimo.get(
    `/api/wallet/apple/v1/devices/telefono/registrations/pass.ec.prueba.entradas?passesUpdatedSince=${encodeURIComponent("' OR 1=1 --")}`,
  );
  assert.equal(marca.status, 400);
});

test('el registro de avisos del teléfono aguanta cualquier cuerpo sin romperse', async () => {
  const anonimo = crearCliente();
  for (const cuerpo of [{ logs: 'no es una lista' }, { logs: [{ toString: 1 }, 42, null] }, { logs: ['línea\nfalsa'] }, {}]) {
    const r = await anonimo.post('/api/wallet/apple/v1/log', cuerpo);
    assert.equal(r.status, 200, JSON.stringify(cuerpo));
  }
});

test('un pase no acumula teléfonos sin fin', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id);

  const total = wallet.MAXIMO_TELEFONOS_POR_PASE + 3;
  for (let i = 0; i < total; i += 1) {
    const { respuesta } = await registrarTelefono(pack, { deviceId: `telefono-${i}`, pushToken: i.toString(16).padStart(64, '0') });
    assert.equal(respuesta.status, 201);
  }

  const guardados = getDb().prepare('SELECT device_id FROM wallet_devices').all().map((f) => f.device_id);
  assert.equal(guardados.length, wallet.MAXIMO_TELEFONOS_POR_PASE);
  // Se conserva el último en llegar, que es el teléfono que la persona está usando.
  assert.ok(guardados.includes(`telefono-${total - 1}`));
  assert.ok(!guardados.includes('telefono-0'));
});

test('la clave del certificado puede ir cifrada y su contraseña no viaja en los argumentos', async (t) => {
  if (process.platform === 'win32') return t.skip('usa un openssl envuelto en un script de shell');
  const { firmarManifiesto } = await import('../src/lib/pkpass.js');
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');

  const contrasena = 'Clave-Del-Pase-Muy-Secreta-1';
  const credenciales = {
    certificate: readFileSync(process.env.APPLE_PASS_CERTIFICATE, 'utf8'),
    key: crypto
      .createPrivateKey(readFileSync(process.env.APPLE_PASS_KEY, 'utf8'))
      .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: contrasena }),
    keyPassword: contrasena,
    wwdrCertificate: readFileSync(process.env.APPLE_WWDR_CERTIFICATE, 'utf8'),
  };

  // Un openssl que apunta con qué argumentos lo llamaron y luego hace su trabajo.
  const carpeta = mkdtempSync(path.join(tmpdir(), 'rhe-openssl-'));
  const real = execFileSync('sh', ['-c', 'command -v openssl']).toString().trim();
  const registro = path.join(carpeta, 'argumentos.txt');
  writeFileSync(path.join(carpeta, 'openssl'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${registro}'\nexec '${real}' "$@"\n`);
  chmodSync(path.join(carpeta, 'openssl'), 0o755);
  const pathOriginal = process.env.PATH;
  process.env.PATH = `${carpeta}${path.delimiter}${pathOriginal}`;

  try {
    const firma = firmarManifiesto(Buffer.from('{}'), credenciales);
    assert.ok(firma.length > 0, 'con la contraseña correcta, firma');
    assert.throws(() => firmarManifiesto(Buffer.from('{}'), { ...credenciales, keyPassword: 'otra' }), /No se pudo firmar/);

    const argumentos = readFileSync(registro, 'utf8');
    assert.ok(argumentos.includes('smime'), 'el openssl envuelto es el que se usó');
    assert.ok(!argumentos.includes(contrasena), 'la contraseña no puede aparecer en la línea de órdenes');
  } finally {
    process.env.PATH = pathOriginal;
    rmSync(carpeta, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Lo que se le manda a Google tiene que existir en su esquema
// ---------------------------------------------------------------------------

/**
 * La API de Google rechaza con 400 cualquier campo que no conozca: uno de más
 * no se ignora, tumba la llamada entera. Y si lo que se cae es la plantilla, no
 * se puede generar ningún enlace de "Guardar en Google Wallet", así que el
 * botón deja de funcionar para todo el mundo a la vez. Estas dos listas son las
 * del esquema oficial de `genericClass` y `genericObject`.
 */
const CAMPOS_DE_CLASE = new Set([
  'appLinkData', 'callbackOptions', 'classTemplateInfo', 'enableSmartTap', 'id', 'imageModulesData',
  'linksModuleData', 'merchantLocations', 'messages', 'multipleDevicesAndHoldersAllowedStatus',
  'redemptionIssuers', 'securityAnimation', 'textModulesData', 'valueAddedModuleData', 'viewUnlockRequirement',
]);

const CAMPOS_DE_OBJETO = new Set([
  'appLinkData', 'barcode', 'cardTitle', 'classId', 'genericType', 'groupingInfo', 'hasUsers', 'header',
  'heroImage', 'hexBackgroundColor', 'id', 'imageModulesData', 'linkedObjectIds', 'linksModuleData', 'logo',
  'merchantLocations', 'messages', 'notifications', 'passConstraints', 'rotatingBarcode', 'saveRestrictions',
  'smartTapRedemptionValue', 'state', 'subheader', 'textModulesData', 'validTimeInterval', 'valueAddedModuleData',
  'wideLogo',
]);

test('la plantilla de Google no lleva ningún campo que su API no conozca', () => {
  const clase = wallet.claseGoogle();
  const ajenos = Object.keys(clase).filter((campo) => !CAMPOS_DE_CLASE.has(campo));
  assert.deepEqual(ajenos, [], 'un campo de más devuelve 400 y deja sin plantilla a todos los pases');
  // El color de fondo es del objeto, no de la clase; mandarlo aquí era
  // justamente lo que rompía la creación de la plantilla.
  assert.equal(clase.hexBackgroundColor, undefined);
  assert.equal(clase.id, '3388000000000000000.entradas');
});

test('el objeto de Google no lleva ningún campo que su API no conozca', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id, { allowStaticQr: true, expiresAt: '2030-01-31T23:59:59.000Z' });
  const pase = wallet.asegurarPase(pack.id);

  const objeto = wallet.objetoGoogle(pack, null, pase);
  const ajenos = Object.keys(objeto).filter((campo) => !CAMPOS_DE_OBJETO.has(campo));
  assert.deepEqual(ajenos, []);
  assert.equal(objeto.genericType, 'GENERIC_ENTRY_TICKET');
});

// ---------------------------------------------------------------------------
// El pase se apaga solo cuando el pack deja de servir
// ---------------------------------------------------------------------------

test('el pase lleva la fecha de vencimiento para apagarse solo, aun sin conexión', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id, { expiresAt: '2030-01-31T23:59:59.000Z' });
  const pase = wallet.asegurarPase(pack.id);

  // Apple rechaza el pase entero si la fecha trae milisegundos.
  const apple = wallet.contenidoApple(pack, null, pase);
  assert.equal(apple.expirationDate, '2030-01-31T23:59:59Z');
  assert.equal(apple.voided, undefined, 'un pack vigente no va tachado');

  const google = wallet.objetoGoogle(pack, null, pase);
  assert.deepEqual(google.validTimeInterval, { end: { date: '2030-01-31T23:59:59Z' } });
});

test('un pack anulado va tachado en el pase, no solo con otro texto', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id);
  const pase = wallet.asegurarPase(pack.id);
  await cMaster.patch(`/api/admin/packs/${pack.id}`, { status: 'cancelled' });

  const apple = wallet.contenidoApple(packsService.findById(pack.id), null, pase);
  assert.equal(apple.voided, true, 'sin esto el teléfono lo sigue enseñando como bueno');
});

test('un pase que lleva código no se puede regalar desde el teléfono', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const conCodigo = await packDePrueba(cMaster, cliente.id, { allowStaticQr: true });
  const sinCodigo = await packDePrueba(cMaster, cliente.id);

  // Con código, el pase es una entrada: compartirlo sería regalar entradas.
  assert.equal(wallet.contenidoApple(conCodigo, null, wallet.asegurarPase(conCodigo.id)).sharingProhibited, true);
  assert.equal(wallet.contenidoApple(sinCodigo, null, wallet.asegurarPase(sinCodigo.id)).sharingProhibited, undefined);
});

test('una cuenta suspendida se ve suspendida también en el pase', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id);
  const pase = wallet.asegurarPase(pack.id);
  await cMaster.patch(`/api/admin/users/${cliente.id}`, { status: 'suspended' });

  const dueno = getDb().prepare('SELECT * FROM users WHERE id = ?').get(cliente.id);
  const fresco = packsService.findById(pack.id);
  const apple = wallet.contenidoApple(fresco, dueno, pase);
  assert.equal(apple.storeCard.secondaryFields.find((c) => c.key === 'estado').value, 'Cuenta suspendida');
  assert.equal(wallet.objetoGoogle(fresco, dueno, pase).state, 'INACTIVE');
});

test('al vencer un pack, la cartera se entera sin que nadie toque nada', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id, { expiresAt: '2030-01-31T23:59:59.000Z' });
  const { pase } = await registrarTelefono(pack);

  // El pack vence de puro pasar el tiempo: nadie lo anula ni lo escanea.
  getDb().prepare('UPDATE packs SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', pack.id);
  assert.equal(packsService.expireDuePacks(), 1);

  await new Promise((listo) => setTimeout(listo, 2500));
  assert.equal(avisosRecibidos.length, 1, 'al teléfono hay que avisarle también cuando el pack caduca');

  const vencido = packsService.findById(pack.id);
  const apple = wallet.contenidoApple(vencido, null, pase);
  assert.equal(apple.storeCard.secondaryFields.find((c) => c.key === 'estado').value, 'Vencido');
  assert.equal(wallet.objetoGoogle(vencido, null, pase).state, 'EXPIRED');
});

// ---------------------------------------------------------------------------
// Un aviso que falla no se pierde
// ---------------------------------------------------------------------------

test('si el aviso no sale, el pase queda pendiente y el barrido lo reintenta', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id);
  await registrarTelefono(pack);

  // Apple se cae justo cuando se cobra la entrada.
  respuestaApns = 503;
  motivoApns = 'ServiceUnavailable';
  await cStaff.post('/api/scan/manual', { code: pack.code });
  await new Promise((listo) => setTimeout(listo, 2500));

  const pendiente = getDb().prepare('SELECT * FROM wallet_passes WHERE pack_id = ?').get(pack.id);
  assert.ok(pendiente.sync_pending_at, 'el cambio tiene que quedar anotado hasta que se comunique');
  assert.equal(pendiente.sync_attempts, 1);
  assert.ok(pendiente.sync_next_at, 'el reintento espera antes de volver a intentarlo');

  // Y cuando Apple vuelve, el barrido lo recoge sin que nadie vuelva a escanear.
  respuestaApns = 200;
  avisosRecibidos.length = 0;
  await wallet.reconciliar({ ahora: Date.now() + 10 * 60 * 1000 });

  assert.equal(avisosRecibidos.length, 1, 'el aviso perdido tiene que salir en el siguiente barrido');
  const alDia = getDb().prepare('SELECT * FROM wallet_passes WHERE pack_id = ?').get(pack.id);
  assert.equal(alDia.sync_pending_at, null);
  assert.equal(alDia.sync_attempts, 0);
  assert.ok(alDia.synced_at);
});

test('un teléfono que Apple ya no conoce se da de baja en vez de reintentarse', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id);
  await registrarTelefono(pack);

  respuestaApns = 410;
  motivoApns = 'Unregistered';
  await cStaff.post('/api/scan/manual', { code: pack.code });
  await new Promise((listo) => setTimeout(listo, 2500));

  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM wallet_devices').get().n, 0);
  // Darlo de baja resuelve el problema: no hay nada que reintentar.
  const fila = getDb().prepare('SELECT * FROM wallet_passes WHERE pack_id = ?').get(pack.id);
  assert.equal(fila.sync_pending_at, null);
});

test('los teléfonos de un mismo pase se avisan por una sola conexión', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id);
  for (let i = 0; i < 3; i += 1) {
    await registrarTelefono(pack, { deviceId: `telefono-${i}`, pushToken: i.toString(16).padStart(64, '0') });
  }

  conexionesApns = 0;
  await cStaff.post('/api/scan/manual', { code: pack.code });
  await new Promise((listo) => setTimeout(listo, 2500));

  assert.equal(avisosRecibidos.length, 3, 'los tres teléfonos tienen que enterarse');
  assert.equal(conexionesApns, 1, 'una conexión por aparato es justo lo que Apple pide no hacer');
});

// ---------------------------------------------------------------------------
// Entregar el pase en el mostrador
// ---------------------------------------------------------------------------

test('el mostrador ve si el cliente ya guardó su pase y dónde', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id);

  const sinGuardar = await cMaster.get(`/api/admin/packs/${pack.id}/wallet`);
  assert.equal(sinGuardar.status, 200);
  assert.deepEqual(sinGuardar.datos.carteras, { apple: true, google: true });
  assert.equal(sinGuardar.datos.guardado, false);
  assert.equal(sinGuardar.datos.telefonos, 0);

  await registrarTelefono(pack);
  const guardado = await cMaster.get(`/api/admin/packs/${pack.id}/wallet`);
  assert.equal(guardado.datos.guardado, true);
  assert.equal(guardado.datos.telefonos, 1);
  assert.equal(guardado.datos.alDia, true);
});

test('la invitación del mostrador deja al cliente guardar su pase sin iniciar sesión', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id);

  const invitacion = await cMaster.post(`/api/admin/packs/${pack.id}/wallet/invitacion`);
  assert.equal(invitacion.status, 200, JSON.stringify(invitacion.datos));
  assert.ok(invitacion.datos.qr.startsWith('<svg'), 'el mostrador enseña un QR, no un enlace para dictar');

  // El permiso viaja en el fragmento: esa parte nunca llega al servidor.
  const fragmento = new URLSearchParams(new URL(invitacion.datos.url).hash.slice(1));
  assert.equal(fragmento.get('p'), pack.id);
  const token = fragmento.get('t');
  assert.ok(token);

  const telefono = crearCliente();
  const datos = await telefono.post('/api/wallet/invitacion', { packId: pack.id, token });
  assert.equal(datos.status, 200);
  assert.equal(datos.datos.pack.code, pack.code);
  assert.equal(datos.datos.pack.remaining, 5);
  assert.equal(datos.datos.titular, 'Carlos Piloto');
  // Ni el correo ni el teléfono del cliente: esta página la abre quien tenga
  // el enlace durante unos minutos.
  assert.equal(datos.datos.pack.userId, undefined);
  assert.equal(JSON.stringify(datos.datos).includes('@'), false);

  // Y desde ahí llega al pase de Apple sin haber iniciado sesión nunca.
  const apple = await telefono.post('/api/wallet/invitacion/apple', { packId: pack.id, token });
  assert.equal(apple.status, 200);
  const descarga = await crearCliente().get(new URL(apple.datos.url).pathname + new URL(apple.datos.url).search, {
    binario: true,
  });
  assert.equal(descarga.status, 200);
  assert.equal(JSON.parse(leerPkpass(descarga.datos)['pass.json']).storeCard.primaryFields[0].value, pack.code);
});

test('la invitación no sirve para otro pack, ni caducada, ni la crea un cliente', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id);
  const otro = await packDePrueba(cMaster, cliente.id);

  const invitacion = await cMaster.post(`/api/admin/packs/${pack.id}/wallet/invitacion`);
  const token = new URLSearchParams(new URL(invitacion.datos.url).hash.slice(1)).get('t');
  const telefono = crearCliente();

  assert.equal((await telefono.post('/api/wallet/invitacion', { packId: otro.id, token })).status, 401);
  assert.equal((await telefono.post('/api/wallet/invitacion', { packId: pack.id, token: 'inventado' })).status, 401);
  assert.equal((await telefono.post('/api/wallet/invitacion', { packId: 'no-es-un-uuid', token })).status, 401);

  // Una firmada en el pasado ya no abre nada.
  const caducada = wallet.firmarInvitacion(pack.id, { ahora: Date.now() - 60 * 60 * 1000 });
  assert.equal(wallet.invitacionValida(pack.id, caducada), false);

  // Y el permiso de descarga y el de invitación no se pueden confundir: cada
  // uno se firma con su propósito y dura lo suyo.
  assert.equal(wallet.ticketValido(pack.id, token), false);
  assert.equal(wallet.invitacionValida(pack.id, wallet.firmarTicket(pack.id)), false);

  // Un cliente no puede fabricarse una invitación para nadie, ni para sí mismo.
  assert.equal((await cCliente.post(`/api/admin/packs/${pack.id}/wallet/invitacion`)).status, 403);
});

test('suspender una cuenta también llega al pase que el cliente lleva encima', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id);
  await registrarTelefono(pack);
  const antes = getDb().prepare('SELECT updated_at FROM wallet_passes WHERE pack_id = ?').get(pack.id).updated_at;

  // Suspender no toca ningún pack, pero deja sus entradas sin valer en la
  // puerta: el pase tiene que decir lo mismo que el escáner.
  await cMaster.patch(`/api/admin/users/${cliente.id}`, { status: 'suspended' });
  await new Promise((listo) => setTimeout(listo, 2500));

  assert.equal(avisosRecibidos.length, 1, 'al teléfono hay que avisarle de que su cuenta quedó suspendida');
  const despues = getDb().prepare('SELECT updated_at FROM wallet_passes WHERE pack_id = ?').get(pack.id).updated_at;
  assert.ok(despues > antes, 'el pase debería constar como cambiado');

  // Y al reactivarla, vuelve a verse como activo.
  avisosRecibidos.length = 0;
  await cMaster.patch(`/api/admin/users/${cliente.id}`, { status: 'active' });
  await new Promise((listo) => setTimeout(listo, 2500));
  assert.equal(avisosRecibidos.length, 1);

  const dueno = getDb().prepare('SELECT * FROM users WHERE id = ?').get(cliente.id);
  const pase = wallet.asegurarPase(pack.id);
  const apple = wallet.contenidoApple(packsService.findById(pack.id), dueno, pase);
  assert.equal(apple.storeCard.secondaryFields.find((c) => c.key === 'estado').value, 'Activo');
});

test('si el cliente se cambia el nombre, el pase deja de llevar el viejo', async () => {
  const { cMaster, cCliente, cliente } = await sembrarUsuarios();
  const pack = await packDePrueba(cMaster, cliente.id);
  await registrarTelefono(pack);

  const cambio = await cCliente.patch('/api/auth/me', { fullName: 'Carlos Piloto Serrano' });
  assert.equal(cambio.status, 200, JSON.stringify(cambio.datos));
  await new Promise((listo) => setTimeout(listo, 2500));

  assert.equal(avisosRecibidos.length, 1, 'el pase enseña el nombre; si cambia, hay que refrescarlo');
  const dueno = getDb().prepare('SELECT * FROM users WHERE id = ?').get(cliente.id);
  const apple = wallet.contenidoApple(packsService.findById(pack.id), dueno, wallet.asegurarPase(pack.id));
  assert.equal(apple.storeCard.secondaryFields.find((c) => c.key === 'titular').value, 'Carlos Piloto Serrano');
});
