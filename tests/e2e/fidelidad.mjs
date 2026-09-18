/**
 * El programa de fidelidad «la casa invita», en un navegador real.
 *
 * La suite de API comprueba la mecánica del premio; esta, lo que solo se ve en
 * pantalla: que el programa se encienda desde el panel avisando de lo que
 * implica, que la tarjeta de sellos del cliente se llene entrada a entrada, que
 * el premio aparezca en vivo en el teléfono del cliente y en la pantalla de la
 * puerta, y que el panel y la ficha lo cuenten después.
 *
 * No entra en `npm test` porque necesita Playwright. Ver el README de esta carpeta.
 */
import '../env-recuperacion.js';
import { levantarServidor, bajarServidor, sembrarUsuarios, CLAVES } from '../helpers.js';
import { cargarNavegador } from './navegador.mjs';
import { getDb } from '../../src/db/index.js';
import * as packsService from '../../src/services/packs.js';
import * as redemptions from '../../src/services/redemptions.js';

const chromium = await cargarNavegador();
const B = await levantarServidor();
const { master, staff, cliente } = await sembrarUsuarios();

const pack = packsService.issuePack({ userId: cliente.id, size: 10, priceCents: 4500, actor: master });
const usar = (veces = 1) => {
  for (let i = 0; i < veces; i += 1) {
    redemptions.redeemByCode({ code: pack.code, scanner: { id: staff.id, email: staff.email } });
  }
};

const errores = [];
const fallidos = [];
let totales = 0;

async function paso(nombre, fn) {
  totales += 1;
  try {
    await fn();
    console.log('OK    ', nombre);
  } catch (error) {
    console.log('FALLO ', nombre, '->', error.message.replace(/\s+/g, ' ').slice(0, 600));
    fallidos.push(nombre);
  }
}

function comprobar(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}

const opciones = { args: ['--no-sandbox'] };
if (process.env.CHROMIUM_PATH) opciones.executablePath = process.env.CHROMIUM_PATH;
const navegador = await chromium.launch(opciones);

async function abrirPestana(etiqueta, viewport = { width: 1200, height: 900 }) {
  const contexto = await navegador.newContext({ viewport });
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (e) => {
    if (!/ViewTransition/i.test(e.message)) errores.push(`${etiqueta} pageerror: ${e.message}`);
  });
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errores.push(`${etiqueta} console: ${m.text()}`);
  });
  return pagina;
}

async function entrar(pagina, email, clave, destino) {
  await pagina.goto(B, { waitUntil: 'domcontentloaded' });
  await pagina.fill('#entrar-email', email);
  await pagina.fill('#entrar-password', clave);
  await pagina.click('#form-entrar button[type=submit]');
  await pagina.waitForURL(`**${destino}`, { timeout: 15000 });
}

const brindis = (pagina, texto) => pagina.locator('.brindis', { hasText: texto }).first().waitFor({ timeout: 15000 });
const premios = () => getDb().prepare('SELECT * FROM loyalty_rewards ORDER BY sequence').all();

// ---------------------------------------------------------------------------
// Administración: encender el programa
// ---------------------------------------------------------------------------

const admin = await abrirPestana('admin');

await paso('la sección de fidelidad arranca apagada y dice qué pasa al encenderla', async () => {
  await entrar(admin, 'master@pista.ec', CLAVES.master, '/admin');
  await admin.click('#pestana-fidelidad');
  await admin.waitForSelector('#fidelidad-estado .aviso', { timeout: 10000 });
  const estado = await admin.locator('#fidelidad-estado').innerText();
  comprobar(estado.includes('Apagado'), `debería decir que está apagado: ${estado}`);
  comprobar(estado.includes('arranca de cero'), `debería advertir del contador: ${estado}`);
  comprobar(await admin.isHidden('#btn-fidelidad-revisar'), '«Otorgar ahora» no tiene sentido con el programa apagado');
  const cerca = await admin.locator('#fidelidad-cerca').innerText();
  comprobar(cerca.includes('apagado'), `la lista debería explicar que está apagado: ${cerca}`);
});

await paso('encender el programa pide confirmación y deja el estado a la vista', async () => {
  await admin.click('#btn-fidelidad-ajustes');
  const dialogo = admin.locator('dialog[aria-labelledby="ajustes-fidelidad-titulo"][open]');
  await dialogo.waitFor();
  await dialogo.locator('#fid-umbral').fill('3');
  await dialogo.locator('#fid-premio').fill('2');
  await dialogo.locator('#fid-vence').fill('30');
  await dialogo.locator('#fid-activo').check();
  await dialogo.locator('button', { hasText: 'Guardar' }).click();

  const confirmacion = admin.locator('dialog[open]', { hasText: 'Encender el programa' });
  await confirmacion.waitFor({ timeout: 10000 });
  const texto = await confirmacion.innerText();
  comprobar(texto.includes('no cuenta'), `la confirmación debería avisar de que el pasado no cuenta: ${texto}`);
  await confirmacion.locator('button', { hasText: 'Encender' }).click();

  await brindis(admin, 'Programa de fidelidad guardado');
  const estado = await admin.locator('#fidelidad-estado').innerText();
  comprobar(estado.includes('Encendido'), `debería quedar encendido: ${estado}`);
  comprobar(estado.includes('3 entradas usadas') && estado.includes('2 entradas'), `faltan los números: ${estado}`);
  comprobar(await admin.isVisible('#btn-fidelidad-revisar'), 'ahora sí se puede otorgar a mano');
});

await paso('un premio de más entradas que el umbral se rechaza en el propio formulario', async () => {
  await admin.click('#btn-fidelidad-ajustes');
  const dialogo = admin.locator('dialog[aria-labelledby="ajustes-fidelidad-titulo"][open]');
  await dialogo.waitFor();
  await dialogo.locator('#fid-premio').fill('9');
  await dialogo.locator('button', { hasText: 'Guardar' }).click();
  await dialogo.locator('.aviso--error').waitFor({ timeout: 10000 });
  const texto = await dialogo.locator('.aviso--error').innerText();
  comprobar(/menor/.test(texto), `debería explicar el porqué: ${texto}`);
  await dialogo.locator('button', { hasText: 'Cancelar' }).click();
});

// ---------------------------------------------------------------------------
// El cliente y la puerta
// ---------------------------------------------------------------------------

const app = await abrirPestana('app', { width: 420, height: 880 });

await paso('el cliente ve su tarjeta de sellos vacía y cuántas entradas le faltan', async () => {
  await entrar(app, 'cliente@pista.ec', CLAVES.cliente, '/app');
  await app.waitForSelector('#seccion-fidelidad:not([hidden])', { timeout: 15000 });
  const texto = await app.locator('#seccion-fidelidad').innerText();
  comprobar(texto.includes('La casa invita'), `falta el título: ${texto}`);
  comprobar(texto.includes('Te faltan 3 entradas'), `debería faltarle tres: ${texto}`);
  comprobar((await app.locator('#fidelidad-sellos .sello').count()) === 3, 'la tarjeta tiene un sello por entrada del ciclo');
  comprobar((await app.locator('#fidelidad-sellos .sello--lleno').count()) === 0, 'todavía no hay ninguno lleno');
});

await paso('cada entrada usada llena un sello, sin recargar la página', async () => {
  usar(1);
  await app.locator('#fidelidad-sellos .sello--lleno').first().waitFor({ timeout: 15000 });
  const texto = await app.locator('#seccion-fidelidad').innerText();
  comprobar(texto.includes('Te faltan 2 entradas'), `ahora deberían faltarle dos: ${texto}`);

  usar(1);
  await app.waitForFunction(
    () => document.querySelectorAll('#fidelidad-sellos .sello--lleno').length === 2,
    null,
    { timeout: 15000 },
  );
  const cerca = await app.locator('#seccion-fidelidad').innerText();
  comprobar(cerca.includes('¡Te falta una entrada!'), `debería celebrar que está a una: ${cerca}`);
});

const puerta = await abrirPestana('escaner', { width: 420, height: 880 });

await paso('la puerta se entera del premio para poder decírselo a la persona', async () => {
  await entrar(puerta, 'staff@pista.ec', CLAVES.staff, '/escanear');
  await puerta.waitForSelector('#puesto', { timeout: 15000 }).catch(() => {});

  usar(1); // la tercera entrada: completa la tarjeta
  await brindis(puerta, 'completó su tarjeta');
  await brindis(app, 'La casa invita');

  comprobar(premios().length === 1, `debería haber un premio: ${premios().length}`);
});

await paso('el pack de cortesía aparece en la app del cliente como regalo', async () => {
  await app.locator('.pack', { hasText: 'cortesía de la casa' }).first().waitFor({ timeout: 15000 });
  const saldo = await app.locator('#saldo-numero').innerText();
  comprobar(saldo === '9', `7 de pago + 2 de regalo son 9 entradas: ${saldo}`);
  const tarjeta = await app.locator('#seccion-fidelidad').innerText();
  comprobar(/2 entradas regaladas/i.test(tarjeta), `la etiqueta debería contar lo regalado: ${tarjeta}`);
  comprobar(tarjeta.includes('1 premio ganado'), `debería contar el premio: ${tarjeta}`);
});

await paso('usar el regalo no acerca el premio siguiente', async () => {
  const cortesia = getDb().prepare("SELECT code FROM packs WHERE origin = 'loyalty'").get();
  redemptions.redeemByCode({ code: cortesia.code, scanner: { id: staff.id, email: staff.email } });
  await app.waitForFunction(() => document.querySelector('#saldo-numero')?.textContent === '8', null, { timeout: 15000 });
  const tarjeta = await app.locator('#seccion-fidelidad').innerText();
  comprobar(tarjeta.includes('Te faltan 3 entradas'), `el ciclo nuevo sigue en cero: ${tarjeta}`);
  comprobar((await app.locator('#fidelidad-sellos .sello--lleno').count()) === 0, 'ningún sello lleno con una entrada de cortesía');
});

// ---------------------------------------------------------------------------
// Lo que queda en el panel
// ---------------------------------------------------------------------------

await paso('el panel cuenta lo invitado y a quién le falta poco', async () => {
  usar(1); // para que aparezca en «a quién le falta poco»
  await admin.click('#pestana-resumen');
  await admin.click('#pestana-fidelidad');
  await admin.waitForSelector('#fidelidad-premios .lista__item', { timeout: 15000 });

  const premiados = await admin.locator('#fidelidad-premios').innerText();
  comprobar(premiados.includes('Carlos Piloto'), `debería aparecer el cliente: ${premiados}`);
  comprobar(premiados.includes('2 entradas por 3 entradas usadas'), `debería explicar el premio: ${premiados}`);

  const metricas = await admin.locator('#fidelidad-metricas').innerText();
  comprobar(/\b2\b/.test(metricas) && /entradas regaladas/i.test(metricas), `faltan las cifras: ${metricas}`);

  const cerca = await admin.locator('#fidelidad-cerca').innerText();
  comprobar(cerca.includes('Carlos Piloto') && /le faltan 2/i.test(cerca), `debería decir cuánto le falta: ${cerca}`);
});

await paso('la ficha del cliente lleva su tarjeta y sus premios', async () => {
  await admin.goto(`${B}/admin#cliente/${cliente.id}`, { waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('#ficha-cliente .tarjeta', { timeout: 15000 });
  const bloque = admin.locator('section.tarjeta', { hasText: 'La casa invita' }).first();
  await bloque.waitFor({ timeout: 15000 });
  const texto = await bloque.innerText();
  comprobar(texto.includes('de 3 entradas de este ciclo'), `debería decir cómo va el ciclo: ${texto}`);
  comprobar(texto.includes('Premio 1: 2 entradas de cortesía'), `debería listar el premio: ${texto}`);
});

await navegador.close();
await bajarServidor();

console.log(`\n${totales - fallidos.length}/${totales} pasos correctos.`);
if (errores.length) {
  console.log('\nErrores de la página:');
  for (const e of errores) console.log('  ', e);
}
process.exit(fallidos.length || errores.length ? 1 : 0);
