/**
 * El escáner con la cámara, de principio a fin.
 *
 * Es el trabajo diario del personal y lo único que ninguna otra prueba puede
 * tocar: hace falta una cámara que enseñe un QR de verdad. Se le da a Chromium
 * un vídeo sin comprimir con el código dentro y se comprueba que la entrada
 * queda descontada sola, sin escribir nada.
 *
 * Se recorren los dos lectores, porque en la pista conviven los dos: el nativo
 * del navegador cuando existe, y el respaldo jsQR en todo lo demás. El segundo
 * se fuerza quitando `BarcodeDetector` antes de que cargue la página.
 *
 * `../env.js` va primero: fija la configuración antes de que se evalúe la
 * aplicación, y en ESM las importaciones se ejecutan en orden.
 */
import '../env.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { levantarServidor, bajarServidor, sembrarUsuarios, CLAVES } from '../helpers.js';
import * as packsService from '../../src/services/packs.js';
import * as redemptions from '../../src/services/redemptions.js';
import { buildQrPayload } from '../../src/lib/qr.js';
import { cargarNavegador, grabarQr } from './navegador.mjs';

const chromium = await cargarNavegador();
const carpeta = mkdtempSync(path.join(tmpdir(), 'rhe-camara-'));
const B = await levantarServidor();
const { cMaster, cliente } = await sembrarUsuarios();

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

async function emitirPack() {
  const r = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  return packsService.findById(r.datos.pack.id);
}

/**
 * Abre el escáner con una cámara que está mostrando el QR de `pack` y espera a
 * que la entrada quede registrada sin tocar el teclado.
 */
async function escanearConCamara({ pack, forzarRespaldo }) {
  const video = path.join(carpeta, `${pack.code}.y4m`);
  grabarQr(buildQrPayload(pack), video);

  const navegador = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      '--no-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${video}`,
    ],
  });
  try {
    const contexto = await navegador.newContext({ viewport: { width: 900, height: 1000 }, permissions: ['camera'] });
    if (forzarRespaldo) await contexto.addInitScript(() => { delete window.BarcodeDetector; });

    const pagina = await contexto.newPage();
    const errores = [];
    pagina.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
    pagina.on('console', (m) => {
      if (m.type() === 'error') errores.push(`console: ${m.text()}`);
    });

    await pagina.goto(B, { waitUntil: 'domcontentloaded' });
    await pagina.fill('#entrar-email', 'staff@pista.ec');
    await pagina.fill('#entrar-password', CLAVES.staff);
    await pagina.click('#form-entrar button[type=submit]');
    await pagina.waitForURL('**/escanear', { timeout: 20000 });

    const hayNativo = await pagina.evaluate(() => 'BarcodeDetector' in window);
    await pagina.click('#btn-camara');
    await pagina.waitForSelector('#escaner:not([hidden]) video', { timeout: 20000 });
    await pagina.waitForFunction(
      () => document.querySelector('.resultado__titulo')?.textContent.includes('Entrada registrada'),
      { timeout: 30000 },
    );

    const motor = (await pagina.textContent('#etiqueta-motor')).trim();
    const restantes = (await pagina.textContent('.resultado__restantes')).trim();
    // El 401 de comprobar si hay sesión al cargar la página es esperado.
    const relevantes = errores.filter((e) => !/401|favicon|manifest|ViewTransition/i.test(e));
    return { motor, restantes, hayNativo, errores: relevantes };
  } finally {
    await navegador.close();
  }
}

const packUno = await emitirPack();
await paso('la cámara lee el QR y descuenta la entrada sola', async () => {
  const r = await escanearConCamara({ pack: packUno, forzarRespaldo: false });
  if (r.errores.length) throw new Error(`errores en la página: ${r.errores.join(' | ')}`);
  if (r.restantes !== '4') throw new Error(`esperaba 4 restantes, obtuve ${r.restantes}`);
  const esperado = r.hayNativo ? 'Lector nativo' : 'Lector jsQR';
  if (r.motor !== esperado) throw new Error(`el motor mostrado es "${r.motor}" y debería ser "${esperado}"`);
  console.log(`       lector usado: ${r.motor}`);

  // Queda registrado como lo que fue: un QR de la app, no un ingreso manual.
  const { items } = redemptions.listRedemptions({ packId: packUno.id });
  if (items[0].method !== 'qr_dynamic') throw new Error(`método registrado: ${items[0].method}`);
  if (packsService.findById(packUno.id).remaining !== 4) throw new Error('el saldo del pack no bajó');
});

const packDos = await emitirPack();
await paso('sin lector nativo, el respaldo jsQR hace el mismo trabajo', async () => {
  const r = await escanearConCamara({ pack: packDos, forzarRespaldo: true });
  if (r.errores.length) throw new Error(`errores en la página: ${r.errores.join(' | ')}`);
  if (r.hayNativo) throw new Error('el lector nativo debería estar fuera de juego en esta pasada');
  if (r.motor !== 'Lector jsQR') throw new Error(`el motor mostrado es "${r.motor}"`);
  if (r.restantes !== '4') throw new Error(`esperaba 4 restantes, obtuve ${r.restantes}`);
  if (packsService.findById(packDos.id).remaining !== 4) throw new Error('el saldo del pack no bajó');
});

await bajarServidor();
rmSync(carpeta, { recursive: true, force: true });

console.log(`\n${totales - fallidos.length}/${totales} pasos correctos.`);
process.exit(fallidos.length ? 1 : 0);
