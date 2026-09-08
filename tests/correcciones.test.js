/**
 * Pruebas de los fallos encontrados en la revisión a fondo.
 *
 * Cubren lo que se corrigió y, sobre todo, fijan el contrato para que ninguno
 * vuelva a colarse: la exportación exige sesión de máster (el panel la pedía
 * con un enlace que no la enviaba), una cuenta suspendida no puede consumir
 * entradas, un código ambiguo no se "arregla" hasta acabar en el pack de otra
 * persona, y las fechas de los informes son las de la pista, no las del reloj
 * del servidor.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, crearCliente, sembrarUsuarios } from './helpers.js';
import { normalizePackCode } from '../src/lib/ids.js';
import * as packsService from '../src/services/packs.js';

before(levantarServidor);
after(bajarServidor);
beforeEach(limpiarBase);

async function emitirPack(cMaster, userId, size = 5, extras = {}) {
  const r = await cMaster.post('/api/admin/packs', { userId, size, ...extras });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  return packsService.findById(r.datos.pack.id);
}

// ---------------------------------------------------------------------------
// Exportación a CSV
// ---------------------------------------------------------------------------

test('los reportes CSV exigen sesión de máster', async () => {
  const { cMaster, cStaff } = await sembrarUsuarios();
  const anonimo = crearCliente();

  // El panel antes los enlazaba con un <a href>, que no envía el token: la
  // descarga acababa siempre en un 401 disfrazado de archivo.
  for (const entidad of ['packs', 'consumos', 'clientes']) {
    assert.equal((await anonimo.get(`/api/admin/export/${entidad}.csv`)).status, 401);
    assert.equal((await cStaff.get(`/api/admin/export/${entidad}.csv`)).status, 403);

    const r = await cMaster.get(`/api/admin/export/${entidad}.csv`);
    assert.equal(r.status, 200, `${entidad} debería exportarse`);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    assert.match(r.headers.get('content-disposition'), /attachment; filename=/);
  }
});

test('un reporte inexistente responde 404 y no un archivo vacío', async () => {
  const { cMaster } = await sembrarUsuarios();
  assert.equal((await cMaster.get('/api/admin/export/inventado.csv')).status, 404);
});

// ---------------------------------------------------------------------------
// Cuentas suspendidas
// ---------------------------------------------------------------------------

test('suspender a un cliente le impide seguir usando sus entradas', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  assert.equal((await cStaff.post('/api/scan/manual', { code: pack.code })).status, 200);

  const suspension = await cMaster.patch(`/api/admin/users/${cliente.id}`, { status: 'suspended' });
  assert.equal(suspension.status, 200);

  const canje = await cStaff.post('/api/scan/manual', { code: pack.code });
  assert.equal(canje.status, 409, JSON.stringify(canje.datos));
  assert.equal(canje.datos.error.code, 'cliente_suspendido');

  // Y el saldo no se movió.
  assert.equal(packsService.findById(pack.id).remaining, 4);
});

test('la consulta del pack avisa de que la cuenta está suspendida', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);
  await cMaster.patch(`/api/admin/users/${cliente.id}`, { status: 'suspended' });

  const r = await cStaff.get(`/api/scan/lookup/${pack.code}`);
  assert.equal(r.status, 200);
  assert.equal(r.datos.usable, false);
  assert.equal(r.datos.reason, 'cliente_suspendido');
});

test('reactivar la cuenta devuelve el uso normal de las entradas', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  await cMaster.patch(`/api/admin/users/${cliente.id}`, { status: 'suspended' });
  await cMaster.patch(`/api/admin/users/${cliente.id}`, { status: 'active' });

  const canje = await cStaff.post('/api/scan/manual', { code: pack.code });
  assert.equal(canje.status, 200, JSON.stringify(canje.datos));
  assert.equal(canje.datos.remaining, 4);
});

// ---------------------------------------------------------------------------
// Códigos tecleados a mano
// ---------------------------------------------------------------------------

test('el código tecleado se normaliza y los caracteres confundibles se traducen', () => {
  // Lo que se corrige sin más: mayúsculas, espacios, guiones y el prefijo.
  assert.equal(normalizePackCode('rhe23456789'), 'RHE-2345-6789');
  assert.equal(normalizePackCode('  RHE 2345 6789 '), 'RHE-2345-6789');
  assert.equal(normalizePackCode('2345-6789'), 'RHE-2345-6789');

  // El alfabeto excluye 0, 1, I, L, O y U justamente porque se confunden con
  // los caracteres que sí lo forman. Quien lee un cartón impreso teclea el que
  // ve, así que se traducen: O y 0 a Q, I/L/1 a 7, y U a V.
  assert.equal(normalizePackCode('RHE-O345-6789'), 'RHE-Q345-6789');
  assert.equal(normalizePackCode('RHE-2345-678I'), 'RHE-2345-6787');
  assert.equal(normalizePackCode('RHE-UUUU-2222'), 'RHE-VVVV-2222');

  // Lo que no cuadra se rechaza en vez de resolver a medias.
  assert.equal(normalizePackCode('RHE-234-6789'), '', 'un código corto no vale');
  assert.equal(normalizePackCode('RHE-2345-678$'), '', 'un carácter fuera del alfabeto no vale');
  assert.equal(normalizePackCode(null), '');
});

test('un código que no existe no descuenta la entrada de nadie', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const pack = packsService.findById(emitido.datos.pack.id);

  // Un código con el formato correcto pero que no corresponde a ningún pack.
  const inventado = 'RHE-2222-3333';
  assert.notEqual(inventado, pack.code);

  const r = await cStaff.post('/api/scan/manual', { code: inventado });
  assert.equal(r.status, 404);
  assert.equal(r.datos.error.code, 'pack_no_encontrado');
  assert.equal(packsService.findById(pack.id).remaining, 5, 'ningún pack pierde entradas');
});

// ---------------------------------------------------------------------------
// Zona horaria de los informes
// ---------------------------------------------------------------------------

test('la interfaz puede saber en qué zona horaria trabaja la pista', async () => {
  // La interfaz formatea fechas y horas con esta zona; si no la publicara,
  // pintaría el día del navegador de quien mira, que puede estar en otro país.
  const anonimo = crearCliente();
  const r = await anonimo.get('/api/config');
  assert.equal(r.status, 200);
  assert.equal(typeof r.datos.timezone, 'string');
  assert.ok(r.datos.timezone.includes('/'), `zona inesperada: ${r.datos.timezone}`);
});

// ---------------------------------------------------------------------------
// Canales en vivo
// ---------------------------------------------------------------------------

test('un mismo usuario no acumula canales en vivo sin límite', async () => {
  const { cMaster, cCliente } = await sembrarUsuarios();
  const base = await levantarServidor();
  const abiertos = [];

  try {
    // Diez pestañas del mismo cliente, como una que se reconecta en bucle.
    for (let intento = 0; intento < 10; intento += 1) {
      const controlador = new AbortController();
      const respuesta = await fetch(`${base}/api/events`, {
        headers: { Authorization: `Bearer ${cCliente.token}`, Accept: 'text/event-stream' },
        signal: controlador.signal,
      });
      assert.equal(respuesta.status, 200);
      abiertos.push(controlador);
    }

    // El servidor va cerrando las más antiguas: la última en llegar es la que
    // la persona está mirando.
    await new Promise((listo) => setTimeout(listo, 120));
    const panel = await cMaster.get('/api/admin/dashboard');
    assert.ok(
      panel.datos.liveConnections < 10,
      `quedaron ${panel.datos.liveConnections} canales abiertos: no se está aplicando el tope`,
    );
    assert.ok(panel.datos.liveConnections >= 1, 'al menos la última conexión debe seguir viva');
  } finally {
    for (const controlador of abiertos) controlador.abort();
    await new Promise((listo) => setTimeout(listo, 60));
  }
});
