/**
 * El escáner durante un corte de red, de principio a fin y en un navegador real.
 *
 * Es la tarde en que se cae Internet en la pista: el operador sigue leyendo QR
 * con la cámara y tecleando códigos, alguien recarga la página sin señal, y al
 * volver la red todo se cobra solo. Lo que no se puede cobrar (un pack que se
 * quedó sin saldo mientras tanto) lo ve el operador y lo resuelve
 * administración.
 *
 * Nada de eso lo puede comprobar una prueba de API: el service worker, el
 * almacenamiento del teléfono, los eventos de red del navegador y la cámara
 * son parte del comportamiento.
 *
 * `../env-sin-conexion.js` va primero: fija la configuración antes de que se
 * evalúe la aplicación, y en ESM las importaciones se ejecutan en orden.
 */
import '../env-sin-conexion.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { levantarServidor, bajarServidor, sembrarUsuarios, CLAVES } from '../helpers.js';
import { getDb } from '../../src/db/index.js';
import { buildQrPayload } from '../../src/lib/qr.js';
import * as packsService from '../../src/services/packs.js';
import * as redemptions from '../../src/services/redemptions.js';
import * as sinConexion from '../../src/services/sinConexion.js';
import { cargarNavegador, grabarQr } from './navegador.mjs';

const chromium = await cargarNavegador();
const carpeta = mkdtempSync(path.join(tmpdir(), 'rhe-sin-conexion-'));
const B = await levantarServidor();
const { cMaster, cliente } = await sembrarUsuarios();

const errores = [];
const fallidos = [];
let totales = 0;
async function paso(nombre, fn) {
  totales += 1;
  try {
    await fn();
    console.log('OK    ', nombre);
  } catch (error) {
    console.log('FALLO ', nombre, '->', error.message.split('\n')[0]);
    fallidos.push(nombre);
  }
}

/** Guarda una captura de pantalla solo si se pidió una carpeta donde dejarlas. */
async function capturar(pagina, nombre) {
  if (!process.env.CAPTURAS) return;
  await pagina.screenshot({ path: path.join(process.env.CAPTURAS, `sin-conexion-${nombre}.png`), fullPage: true });
}

function comprobar(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}

async function emitirPack(size) {
  const r = await cMaster.post('/api/admin/packs', { userId: cliente.id, size });
  return packsService.findById(r.datos.pack.id);
}

// Tres packs del mismo cliente: uno se leerá con la cámara, otro se tecleará,
// y el tercero gastó su única entrada en otro puesto hace dos minutos, así que
// lo que se lea de él sin conexión no se podrá cobrar.
const packCamara = await emitirPack(5);
const packTecleado = await emitirPack(5);
const packAgotado = await emitirPack(1);
redemptions.redeemByCode({ code: packAgotado.code, scanner: null, deviceLabel: 'Puerta 2', now: Date.now() - 120_000 });

const video = path.join(carpeta, 'qr.y4m');
grabarQr(buildQrPayload(packCamara), video);

const navegador = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    '--no-sandbox',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${video}`,
  ],
});

async function abrirContexto(etiqueta, opciones = {}) {
  const contexto = await navegador.newContext({ viewport: { width: 430, height: 900 }, ...opciones });
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (e) => errores.push(`${etiqueta} pageerror: ${e.message}`));
  pagina.on('console', (m) => {
    // Sin red, cada petición fallida se anota en la consola: es lo esperado.
    // El 401 de comprobar la sesión al cargar la página de acceso, también.
    if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|Failed to load resource|401/.test(m.text())) {
      errores.push(`${etiqueta} console: ${m.text()}`);
    }
  });
  return { contexto, pagina };
}

async function entrar(pagina, email, clave, destino) {
  await pagina.goto(B, { waitUntil: 'domcontentloaded' });
  await pagina.fill('#entrar-email', email);
  await pagina.fill('#entrar-password', clave);
  await pagina.click('#form-entrar button[type=submit]');
  await pagina.waitForURL(`**${destino}`, { timeout: 20000 });
}

const texto = (pagina, selector) => pagina.textContent(selector).then((t) => (t ?? '').trim());
const esperarTexto = (pagina, selector, fragmento, timeout = 15000) =>
  pagina.waitForFunction(
    ([s, f]) => document.querySelector(s)?.textContent.includes(f),
    [selector, fragmento],
    { timeout },
  );

const { contexto: puesto, pagina: escaner } = await abrirContexto('escáner', { permissions: ['camera'] });

await paso('el operador abre el escáner con señal y queda listo para un corte', async () => {
  await entrar(escaner, 'staff@pista.ec', CLAVES.staff, '/escanear');
  await escaner.waitForSelector('#actividad .vacio, #actividad .lista', { timeout: 15000 });
  // El service worker toma el control de la página sin recargarla.
  await escaner.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 20000 });
  comprobar(await escaner.isHidden('#tarjeta-sin-conexion'), 'la tarjeta de guardadas no debería verse sin nada guardado');
  comprobar(await escaner.isHidden('#estado-sin-conexion'), 'con señal no debería avisar de que no hay conexión');
});

await puesto.setOffline(true);

await paso('sin red, un código tecleado se guarda y el operador lo ve al instante', async () => {
  await escaner.fill('#codigo-manual', packTecleado.code.toLowerCase());
  await escaner.click('#form-manual button[type=submit]');
  await esperarTexto(escaner, '.resultado__titulo', 'Guardada sin conexión');
  await esperarTexto(escaner, '#contador-sin-conexion', '1 por cobrar');
  comprobar(await escaner.isVisible('#estado-sin-conexion'), 'debería avisar de que no hay conexión');
  comprobar((await escaner.inputValue('#codigo-manual')) === '', 'el campo debería vaciarse al guardar');
  comprobar(packsService.findById(packTecleado.id).remaining === 5, 'sin red no debería haberse cobrado nada todavía');
  await capturar(escaner, '1-guardada');
});

await paso('sin red, la cámara lee el QR del cliente y también lo guarda', async () => {
  await escaner.uncheck('#chk-continuo');
  await escaner.click('#btn-camara');
  await esperarTexto(escaner, '#contador-sin-conexion', '2 por cobrar', 30000);
  await esperarTexto(escaner, '#lista-sin-conexion', packCamara.code);
});

await paso('un doble disparo sobre el mismo pack no se guarda dos veces', async () => {
  await escaner.fill('#codigo-manual', packTecleado.code);
  await escaner.click('#form-manual button[type=submit]');
  await esperarTexto(escaner, '.resultado__titulo', 'No se guardó');
  await esperarTexto(escaner, '.resultado__detalle', 'Ya guardaste una entrada');
  comprobar((await texto(escaner, '#contador-sin-conexion')) === '2 por cobrar', 'no debería haberse guardado otra');
  await capturar(escaner, '2-doble-disparo');
});

await paso('un código con formato imposible se rechaza en el momento', async () => {
  await escaner.fill('#codigo-manual', 'RHE-12');
  await escaner.click('#form-manual button[type=submit]');
  await esperarTexto(escaner, '.resultado__detalle', 'no tiene el formato de un pack');
});

await paso('sin red, consultar el saldo explica qué hacer en vez de fallar', async () => {
  await escaner.fill('#codigo-manual', packAgotado.code);
  await escaner.click('#btn-consultar');
  await esperarTexto(escaner, '.resultado__detalle', 'Sin red no se puede consultar el saldo');
});

await paso('el pack sin saldo se guarda igual: sin red el teléfono no puede saberlo', async () => {
  await escaner.click('#form-manual button[type=submit]');
  await esperarTexto(escaner, '#contador-sin-conexion', '3 por cobrar');
});

await paso('recargar la página sin red abre el escáner con el operador y lo guardado', async () => {
  await escaner.reload({ waitUntil: 'domcontentloaded' });
  await esperarTexto(escaner, '#subtitulo', 'Beto Pista');
  await esperarTexto(escaner, '#contador-sin-conexion', '3 por cobrar');
  comprobar(await escaner.isVisible('#estado-sin-conexion'), 'tras recargar debería seguir avisando de que no hay conexión');
  comprobar(await escaner.isVisible('#btn-camara'), 'el escáner debería poder usarse');
  await capturar(escaner, '3-recargada-sin-red');
});

await puesto.setOffline(false);

await paso('al volver la red se cobra todo lo guardado, con la hora en que se leyó', async () => {
  await esperarTexto(escaner, '#contador-sin-conexion', '1 por revisar', 45000);
  await escaner.waitForSelector('#estado-sin-conexion', { state: 'hidden', timeout: 15000 });

  comprobar(packsService.findById(packCamara.id).remaining === 4, 'el pack leído con la cámara debería tener 4');
  comprobar(packsService.findById(packTecleado.id).remaining === 4, 'el pack tecleado debería tener 4');
  comprobar(packsService.findById(packAgotado.id).remaining === 0, 'el pack agotado sigue en 0');

  const consumos = getDb()
    .prepare('SELECT created_at, synced_at, method, device_label FROM redemptions WHERE pack_id IN (?, ?)')
    .all(packCamara.id, packTecleado.id);
  comprobar(consumos.length === 2, `esperaba 2 consumos, hay ${consumos.length}`);
  for (const consumo of consumos) {
    comprobar(consumo.synced_at, 'el consumo debería llevar su hora de sincronización');
    comprobar(consumo.created_at < consumo.synced_at, 'la hora del consumo debería ser la de lectura, anterior a su llegada');
  }
  comprobar(consumos.some((c) => c.method === 'qr_dynamic'), 'la lectura de cámara debería constar como QR');
  comprobar(consumos.some((c) => c.method === 'manual_code'), 'la tecleada debería constar como código manual');
  comprobar(packsService.checkIntegrity().ok, 'la contabilidad debería cuadrar');
});

await paso('la entrada que no se pudo cobrar se explica y se retira al revisarla', async () => {
  await esperarTexto(escaner, '#lista-sin-conexion', 'ya no tiene entradas');
  await esperarTexto(escaner, '#lista-sin-conexion', packAgotado.code);
  await capturar(escaner, '4-por-revisar');
  await escaner.click('#lista-sin-conexion button:has-text("Entendido")');
  await escaner.waitForSelector('#tarjeta-sin-conexion', { state: 'hidden', timeout: 10000 });
});

await paso('la actividad del puesto marca lo que se leyó sin conexión', async () => {
  await esperarTexto(escaner, '#actividad', 'sin conexión, cobrada a las');
});

const { pagina: admin } = await abrirContexto('admin');

await paso('administración ve la entrada sin cobrar y la marca como resuelta', async () => {
  await entrar(admin, 'master@pista.ec', CLAVES.master, '/admin');
  await admin.waitForSelector('#tarjeta-no-cobradas:not([hidden])', { timeout: 15000 });
  await esperarTexto(admin, '#lista-no-cobradas', 'Carlos Piloto');
  await esperarTexto(admin, '#lista-no-cobradas', 'El pack ya no tenía entradas');
  await capturar(admin, '5-administracion');

  await admin.click('#lista-no-cobradas button:has-text("Marcar resuelta")');
  await admin.fill('dialog[open] input', 'Pagó la entrada en efectivo');
  await admin.click('dialog[open] button[type=submit]');
  await admin.waitForSelector('#tarjeta-no-cobradas', { state: 'hidden', timeout: 10000 });
  comprobar(sinConexion.pendientes().count === 0, 'no debería quedar ninguna pendiente');
});

await paso('en la ficha del cliente consta qué pasó y cómo se resolvió', async () => {
  await admin.goto(`${B}/admin#cliente/${cliente.id}`, { waitUntil: 'domcontentloaded' });
  await admin.click('button:has-text("Actividad")');
  await esperarTexto(admin, 'body', 'Entró durante un corte de red y su entrada no se pudo cobrar');
  await esperarTexto(admin, 'body', 'Pagó la entrada en efectivo');
  await capturar(admin, '6-ficha');
});

await paso('tras cerrar sesión, el escáner no abre sin red con esa identidad', async () => {
  await escaner.click('#cabecera button:has-text("Salir")');
  // Salir navega a la página de acceso; se espera a que llegue sin depender de
  // cuántas redirecciones hagan falta.
  for (let intento = 0; new URL(escaner.url()).pathname !== '/'; intento += 1) {
    comprobar(intento < 60, `debería haber vuelto a la página de acceso y está en ${escaner.url()}`);
    await new Promise((resolver) => setTimeout(resolver, 250));
  }
  await escaner.waitForSelector('#form-entrar', { timeout: 15000 });
  const operador = await escaner.evaluate(() => localStorage.getItem('rh_escaner:operador'));
  comprobar(operador === null, 'cerrar sesión debería olvidar quién trabajaba en el teléfono');
  await puesto.setOffline(true);
  await escaner.goto(`${B}/escanear`, { waitUntil: 'domcontentloaded' });
  await esperarTexto(escaner, 'main', 'no tiene una sesión reciente');
  await capturar(escaner, '7-sin-sesion-guardada');
  await puesto.setOffline(false);
});

await paso('ninguna pantalla tuvo errores', async () => {
  comprobar(errores.length === 0, errores.join(' | '));
});

await navegador.close();
await bajarServidor();
rmSync(carpeta, { recursive: true, force: true });

console.log(`\n${totales - fallidos.length}/${totales} pasos correctos.`);
process.exit(fallidos.length ? 1 : 0);
