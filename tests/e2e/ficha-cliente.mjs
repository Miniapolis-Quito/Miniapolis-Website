/**
 * Prueba en navegador de la ficha del cliente.
 *
 * Recorre lo que hace de verdad quien atiende: abrir la ficha desde el listado,
 * corregir un dato, regalar entradas, anular un consumo cobrado por error y
 * comprobar que todo eso queda reflejado en la actividad y que la contabilidad
 * sigue cuadrando.
 *
 * Necesita Playwright, un servidor en marcha y datos de demostración
 * (`npm run seed`). Ver el README de esta carpeta.
 */
import { chromium } from 'playwright';

const B = process.env.BASE_URL || 'http://localhost:3000';
const CAPTURAS = process.env.CAPTURAS || null;
const MASTER = {
  email: process.env.MASTER_EMAIL || 'admin@racinghobbies.ec',
  password: process.env.MASTER_PASSWORD || 'Pista-RC-Master-2026',
};
/** Cliente de los datos de demostración sobre el que se trabaja. */
const CLIENTE = process.env.CLIENTE_DEMO || 'andres@ejemplo.com';

const errores = [];
const pasosFallidos = [];
let pasosTotales = 0;

async function paso(nombre, fn) {
  pasosTotales += 1;
  try {
    await fn();
    console.log('OK  ', nombre);
  } catch (error) {
    console.log('FALLO', nombre, '->', error.message.split('\n')[0]);
    pasosFallidos.push(nombre);
    errores.push(`${nombre}: ${error.message.split('\n')[0]}`);
  }
}

const opciones = { args: ['--no-sandbox'] };
if (process.env.CHROMIUM_PATH) opciones.executablePath = process.env.CHROMIUM_PATH;
const navegador = await chromium.launch(opciones);
const pagina = await (await navegador.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();

pagina.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
pagina.on('console', (m) => {
  // 401 al comprobar si hay sesión y 409 de las anulaciones son esperados.
  if (m.type() === 'error' && !/401|409/.test(m.text())) errores.push(`console: ${m.text().slice(0, 140)}`);
});

const capturar = async (nombre) => {
  if (CAPTURAS) await pagina.screenshot({ path: `${CAPTURAS}/${nombre}.png`, fullPage: true });
};

const saldoVisible = () => pagina.locator('.ficha .metrica__valor').first().textContent();
const esperarSaldo = (n) =>
  pagina.waitForFunction((v) => Number(document.querySelector('.ficha .metrica__valor')?.textContent) === v, n, {
    timeout: 10000,
  });

await paso('entrar como máster y abrir la ficha de un cliente', async () => {
  await pagina.goto(B, { waitUntil: 'domcontentloaded' });
  await pagina.fill('#entrar-email', MASTER.email);
  await pagina.fill('#entrar-password', MASTER.password);
  await pagina.click('#form-entrar button[type=submit]');
  await pagina.waitForURL('**/admin');
  await pagina.click('.pestana[data-panel=clientes]');
  await pagina.waitForSelector('#tabla-usuarios table');
  await pagina.locator('#tabla-usuarios tr', { hasText: CLIENTE }).getByRole('button', { name: 'Abrir ficha' }).click();
  await pagina.waitForSelector('.ficha__nombre');
});
await capturar('ficha-resumen');

await paso('la dirección identifica al cliente y sobrevive a recargar', async () => {
  if (!/#cliente\//.test(pagina.url())) throw new Error(`la dirección no apunta a la ficha: ${pagina.url()}`);
  const nombre = await pagina.locator('.ficha__nombre').textContent();
  await pagina.reload({ waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('.ficha__nombre');
  const despues = await pagina.locator('.ficha__nombre').textContent();
  if (nombre !== despues) throw new Error('tras recargar se muestra otro cliente');
});

await paso('corregir el teléfono desde la pestaña Datos', async () => {
  await pagina.locator('.ficha .pestana[data-pestana=datos]').click();
  await pagina.waitForSelector('#ficha-telefono');
  await pagina.fill('#ficha-telefono', '+593 98 765 4321');
  await pagina.click('#ficha-panel button[type=submit]');
  await pagina.waitForFunction(
    () => document.querySelector('.ficha__contacto')?.textContent.includes('98 765 4321'),
    { timeout: 10000 },
  );
});

const saldoInicial = Number(await saldoVisible());

await paso('acreditar entradas de cortesía dejando constancia del motivo', async () => {
  await pagina.locator('.ficha .pestana[data-pestana=packs]').click();
  await pagina.waitForSelector('#ficha-panel .pack__codigo');
  await pagina.locator('#ficha-panel').getByRole('button', { name: 'Ajustar entradas' }).first().click();
  await pagina.waitForSelector('dialog[open] input');
  await pagina.fill('dialog[open] input', '3');
  await pagina.getByRole('button', { name: 'Siguiente' }).click();
  await pagina.waitForSelector('dialog[open] input');
  await pagina.fill('dialog[open] input', 'Cortesía por avería en la pista');
  await pagina.getByRole('button', { name: 'Aplicar ajuste' }).click();
  await esperarSaldo(saldoInicial + 3);
});
await capturar('ficha-packs');

await paso('el ajuste aparece en la actividad con su motivo y su autor', async () => {
  await pagina.locator('.ficha .pestana[data-pestana=actividad]').click();
  await pagina.waitForSelector('#ficha-panel .tiempo__item');
  const texto = await pagina.locator('#ficha-panel .tiempo__item').first().textContent();
  if (!/Ajuste manual/.test(texto)) throw new Error(`no se ve el ajuste: ${texto.slice(0, 90)}`);
  if (!/avería/.test(texto)) throw new Error('no se ve el motivo del ajuste');
});
await capturar('ficha-actividad');

await paso('anular un consumo devuelve la entrada al cliente', async () => {
  await pagina.locator('.ficha .pestana[data-pestana=consumos]').click();
  await pagina.waitForSelector('#ficha-panel table');
  const anulables = pagina.locator('#ficha-panel').getByRole('button', { name: 'Anular' });
  if ((await anulables.count()) === 0) {
    // La prueba modifica los datos: si ya se ejecutó antes, este cliente puede
    // tener todos sus consumos anulados.
    throw new Error('no quedan consumos por anular; vuelve a cargar los datos con "npm run seed"');
  }
  const antes = Number(await saldoVisible());
  await anulables.first().click();
  await pagina.waitForSelector('dialog[open] input');
  await pagina.fill('dialog[open] input', 'Cobrada a la persona equivocada');
  await pagina.getByRole('button', { name: 'Anular y devolver' }).click();
  await esperarSaldo(antes + 1);
});

await paso('suspender y reactivar se refleja en las etiquetas de la ficha', async () => {
  await pagina.getByRole('button', { name: 'Suspender', exact: true }).first().click();
  await pagina.getByRole('button', { name: 'Suspender', exact: true }).last().click();
  await pagina.waitForSelector('.ficha__etiquetas .etiqueta--error');
  await pagina.getByRole('button', { name: 'Reactivar', exact: true }).first().click();
  await pagina.getByRole('button', { name: 'Reactivar', exact: true }).last().click();
  await pagina.waitForSelector('.ficha__etiquetas .etiqueta--ok');
});

await paso('volver al listado y comprobar que la contabilidad cuadra', async () => {
  await pagina.locator('.ficha__volver').click();
  await pagina.waitForSelector('#tabla-usuarios table');
  await pagina.click('.pestana[data-panel=resumen]');
  await pagina.waitForSelector('#integridad .aviso--ok', { timeout: 10000 });
});

await paso('la ficha se lee en un teléfono sin desbordarse', async () => {
  await pagina.setViewportSize({ width: 390, height: 900 });
  await pagina.click('.pestana[data-panel=clientes]');
  await pagina.waitForSelector('#tabla-usuarios table');
  await pagina.locator('#tabla-usuarios tr', { hasText: CLIENTE }).getByRole('button', { name: 'Abrir ficha' }).click();
  await pagina.waitForSelector('.ficha__nombre');
  for (const pestana of ['resumen', 'packs', 'consumos', 'actividad', 'acceso', 'datos']) {
    await pagina.locator(`.ficha .pestana[data-pestana=${pestana}]`).click();
    await pagina.waitForTimeout(250);
    const desborde = await pagina.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (desborde > 0) throw new Error(`la pestaña ${pestana} desborda ${desborde}px a lo ancho`);
  }
});
await capturar('ficha-movil');

await navegador.close();

const ESPERADOS = /favicon|manifest|status of (401|409)|ViewTransition/i;
const relevantes = errores.filter((e) => !ESPERADOS.test(e));

console.log('\n=== errores de consola/página ===');
console.log(relevantes.length ? relevantes.join('\n') : 'ninguno');
console.log(`\n${pasosTotales - pasosFallidos.length}/${pasosTotales} pasos correctos.`);
process.exit(relevantes.length || pasosFallidos.length ? 1 : 0);
