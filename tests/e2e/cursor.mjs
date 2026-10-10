/** El cursor se dibuja de forma nativa; la página solo cambia su estado. */
import '../env-espera.js';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor } from '../helpers.js';
import { cargarNavegador } from './navegador.mjs';

const chromium = await cargarNavegador();
const base = await levantarServidor();
const navegador = await chromium.launch({ args: ['--no-sandbox'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  const pagina = await navegador.newPage({ viewport: { width: 1440, height: 900 } });
  await pagina.goto(base, { waitUntil: 'networkidle' });
  await pagina.waitForFunction(() => document.documentElement.classList.contains('cursor-propio'));
  const cursorDe = (selector) => pagina.locator(selector).evaluate((e) => getComputedStyle(e).cursor);
  const normal = await cursorDe('body');
  assert.match(normal, /^url\(/, 'el navegador debe dibujar el puntero sin esperar a pointermove');
  assert.equal(await pagina.locator('.cursor').count(), 0, 'ninguna capa de la página debe perseguir al cursor');

  const enlace = pagina.locator('.sitio-accion');
  await enlace.hover();
  await pagina.waitForFunction(() => document.documentElement.getAnimations().every((a) => a.playState !== 'running'));
  const abierto = await cursorDe('.sitio-accion');
  assert.notEqual(abierto, normal, 'la hoja se abre sobre enlaces');
  await pagina.mouse.down();
  const pulsado = await cursorDe('.sitio-accion');
  assert.notEqual(pulsado, abierto, 'la hoja se recoge al pulsar');
  await pagina.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel')));
  assert.equal(await pagina.evaluate(() => document.documentElement.classList.contains('cursor--pulsado')), false, 'cancelar el gesto debe liberar la hoja');
  await pagina.mouse.move(700, 85);
  await pagina.mouse.up();

  // Comprueba que todas las imágenes son utilizables como cursor y que el
  // punto de clic permanece en su centro, aunque cambie el tamaño de la hoja.
  for (const valor of [normal, abierto, pulsado]) {
    const [, ruta, x, y] = valor.match(/^url\("([^"]+)"\) (\d+) (\d+)/) ?? [];
    assert.ok(ruta, `cursor inválido: ${valor}`);
    const dimensiones = await pagina.evaluate(async (src) => {
      const imagen = new Image();
      imagen.src = src;
      await imagen.decode();
      return [imagen.naturalWidth, imagen.naturalHeight];
    }, ruta);
    assert.deepEqual(dimensiones, [Number(x) * 2, Number(y) * 2]);
    assert.ok(dimensiones.every((lado) => lado <= 64), 'el cursor cabe en el límite de los navegadores');
  }

  // Los controles de escritura mantienen el cursor de texto, incluso si el
  // gesto anterior fue un clic o el control vive dentro de una etiqueta.
  const campo = pagina.locator('input:not([type="hidden"])').first();
  assert.equal(await campo.evaluate((e) => getComputedStyle(e).cursor), 'text');
  await pagina.mouse.down();
  assert.equal(await pagina.evaluate(() => document.documentElement.classList.contains('cursor--pulsado')), true);
  await pagina.mouse.up();
  assert.equal(await pagina.evaluate(() => document.documentElement.classList.contains('cursor--pulsado')), false, 'soltar el ratón libera la hoja');
  await pagina.mouse.down();
  await pagina.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await pagina.evaluate(() => document.documentElement.classList.contains('cursor--pulsado')), false);
  await pagina.mouse.up();
  await pagina.mouse.move(700, 85);
  assert.equal(await cursorDe('body'), normal, 'al salir del enlace vuelve la hoja en reposo');

  await enlace.hover();
  await pagina.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await cursorDe('.sitio-accion'), 'auto', 'la preferencia de movimiento reducido también se respeta si cambia durante la visita');

  for (const opciones of [{ hasTouch: true, isMobile: true }, { reducedMotion: 'reduce' }]) {
    const contexto = await navegador.newContext({ ...opciones, viewport: { width: 390, height: 844 } });
    const otra = await contexto.newPage();
    await otra.goto(base, { waitUntil: 'networkidle' });
    assert.equal(await otra.evaluate(() => document.documentElement.classList.contains('cursor-propio')), false);
    await contexto.close();
  }
  console.log('OK: cursor nativo, hojas alineadas, apertura, pulsación, cancelación, escritura, táctil y movimiento reducido.');
} finally {
  await navegador.close();
  await bajarServidor();
}
