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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import { levantarServidor, bajarServidor, sembrarUsuarios, CLAVES } from '../helpers.js';
import * as packsService from '../../src/services/packs.js';
import * as redemptions from '../../src/services/redemptions.js';
import { buildQrPayload } from '../../src/lib/qr.js';

/** Playwright no es dependencia del proyecto: si falta, se dice cómo instalarlo. */
async function cargarNavegador() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    process.stderr.write(
      '\nEsta prueba necesita Playwright, que no es dependencia del proyecto:\n\n' +
        '  npm install --no-save playwright\n' +
        '  npx playwright install chromium\n\n',
    );
    process.exit(1);
  }
}

/**
 * Escribe un vídeo Y4M (I420 sin comprimir, que es lo que acepta la cámara
 * falsa de Chromium) con el QR centrado sobre fondo blanco.
 */
function grabarQr(texto, ruta, { ancho = 640, alto = 480, cuadros = 10 } = {}) {
  const qr = QRCode.create(texto, { errorCorrectionLevel: 'M' });
  const modulos = qr.modules.size;
  const margen = 4;
  const escala = Math.floor(Math.min(ancho, alto) / (modulos + margen * 2));
  const lado = escala * (modulos + margen * 2);
  const x0 = Math.floor((ancho - lado) / 2);
  const y0 = Math.floor((alto - lado) / 2);

  const luma = Buffer.alloc(ancho * alto, 255);
  for (let fila = 0; fila < modulos; fila += 1) {
    for (let col = 0; col < modulos; col += 1) {
      if (!qr.modules.data[fila * modulos + col]) continue;
      const px = x0 + (col + margen) * escala;
      const py = y0 + (fila + margen) * escala;
      for (let dy = 0; dy < escala; dy += 1) {
        luma.fill(0, (py + dy) * ancho + px, (py + dy) * ancho + px + escala);
      }
    }
  }
  // Croma neutro: la imagen es en blanco y negro.
  const croma = Buffer.alloc((ancho / 2) * (alto / 2), 128);

  const partes = [Buffer.from(`YUV4MPEG2 W${ancho} H${alto} F30:1 Ip A1:1 C420mpeg2\n`)];
  for (let i = 0; i < cuadros; i += 1) partes.push(Buffer.from('FRAME\n'), luma, croma, croma);
  writeFileSync(ruta, Buffer.concat(partes));
}

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
    const relevantes = errores.filter((e) => !/401|favicon|manifest/i.test(e));
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
