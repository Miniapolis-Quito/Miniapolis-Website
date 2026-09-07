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
import { desfaseMinutos, inicioDelDia, claveDia, modificadorSqlite } from '../src/lib/tiempo.js';
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

test('el código se normaliza sin inventarse caracteres', () => {
  // Lo que sí se corrige: mayúsculas, espacios, guiones y el prefijo.
  assert.equal(normalizePackCode('rhe23456789'), 'RHE-2345-6789');
  assert.equal(normalizePackCode('  RHE 2345 6789 '), 'RHE-2345-6789');
  assert.equal(normalizePackCode('2345-6789'), 'RHE-2345-6789');

  // Lo que no: el alfabeto no usa 0, O, 1, I, L ni U, así que un código que los
  // contiene no es un código real. Sustituirlos sería adivinar, y la letra
  // adivinada podría formar el código de otra persona.
  for (const ambiguo of ['RHE-O345-6789', 'RHE-2345-678I', 'RHE-0000-1111', 'RHE-UUUU-2222']) {
    assert.equal(normalizePackCode(ambiguo), '', `${ambiguo} debería rechazarse`);
  }

  assert.equal(normalizePackCode('RHE-234-6789'), '', 'un código corto no vale');
  assert.equal(normalizePackCode(null), '');
});

test('un código ambiguo no descuenta la entrada de otro cliente', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await emitirPack(cMaster, cliente.id, 5);

  // Se cambia un carácter del código real por su parecido ambiguo. Antes, la
  // sustitución automática podía devolver justo este pack (u otro distinto).
  const conAmbiguo = pack.code.replace(/Q/g, 'O').replace(/7/g, 'I');
  if (conAmbiguo !== pack.code) {
    const r = await cStaff.post('/api/scan/manual', { code: conAmbiguo });
    assert.equal(r.status, 404, JSON.stringify(r.datos));
  }

  // El código correcto sigue funcionando, escrito de cualquier forma razonable.
  const r = await cStaff.post('/api/scan/manual', { code: pack.code.toLowerCase().replace(/-/g, ' ') });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
});

// ---------------------------------------------------------------------------
// Zona horaria de los informes
// ---------------------------------------------------------------------------

test('las fechas del panel se calculan en la zona de la pista', () => {
  // 02:30 UTC del 7 son las 21:30 del 6 en Guayaquil: para la pista sigue
  // siendo el día anterior, y "usadas hoy" no debe reiniciarse todavía.
  const instante = new Date('2026-09-07T02:30:00Z');

  assert.equal(desfaseMinutos('America/Guayaquil', instante), -300);
  assert.equal(claveDia('America/Guayaquil', instante), '2026-09-06');
  assert.equal(inicioDelDia('America/Guayaquil', instante).toISOString(), '2026-09-06T05:00:00.000Z');
  assert.equal(modificadorSqlite('America/Guayaquil', instante), '-300 minutes');

  // En una zona por delante de UTC el signo se invierte.
  assert.equal(claveDia('Europe/Madrid', instante), '2026-09-07');
  assert.equal(modificadorSqlite('Europe/Madrid', instante), '+120 minutes');
});

test('el panel informa en qué zona están las fechas del gráfico', async () => {
  const { cMaster } = await sembrarUsuarios();
  const r = await cMaster.get('/api/admin/dashboard');
  assert.equal(r.status, 200);
  assert.equal(typeof r.datos.timezone, 'string');
  assert.ok(r.datos.timezone.length > 0);
});

// ---------------------------------------------------------------------------
// Canales en vivo
// ---------------------------------------------------------------------------

test('un mismo usuario no puede abrir canales en vivo sin límite', async () => {
  const { cCliente } = await sembrarUsuarios();
  const abiertos = [];

  try {
    let rechazado = null;
    for (let intento = 0; intento < 8 && !rechazado; intento += 1) {
      const controlador = new AbortController();
      const respuesta = await fetch(`${await levantarServidor()}/api/events`, {
        headers: { Authorization: `Bearer ${cCliente.token}`, Accept: 'text/event-stream' },
        signal: controlador.signal,
      });
      if (respuesta.status === 429) {
        rechazado = respuesta;
        controlador.abort();
      } else {
        assert.equal(respuesta.status, 200);
        abiertos.push(controlador);
      }
    }

    assert.ok(rechazado, 'el servidor debería cortar tras unos pocos canales');
    assert.ok(abiertos.length >= 1 && abiertos.length <= 6, `canales aceptados: ${abiertos.length}`);
  } finally {
    for (const controlador of abiertos) controlador.abort();
    // Se le da un instante al servidor para soltar las conexiones abortadas.
    await new Promise((listo) => setTimeout(listo, 60));
  }
});
