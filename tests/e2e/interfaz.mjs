/**
 * Prueba de la interfaz en un navegador real, con la aplicación levantada en
 * este mismo proceso (igual que la suite de API).
 *
 * Cubre lo que ninguna prueba de API puede ver: que un botón haga lo que dice.
 * Aquí viven los caminos donde el navegador es parte del comportamiento —una
 * descarga, el formateo de un campo mientras se teclea, lo que aparece en la
 * lista de actividad cuando llega un evento en vivo— y donde un fallo no se
 * nota hasta que alguien lo pulsa en la pista.
 *
 * No entra en `npm test` porque necesita Playwright, que no es dependencia del
 * proyecto. Ver el README de esta carpeta.
 *
 * `../env-espera.js` va primero: fija la espera entre consumos antes de que se
 * evalúe la configuración, y en ESM las importaciones se ejecutan en orden.
 */
import '../env-espera.js';
import { readFileSync } from 'node:fs';
import { levantarServidor, bajarServidor, sembrarUsuarios, CLAVES } from '../helpers.js';
import * as packsService from '../../src/services/packs.js';
import * as redemptions from '../../src/services/redemptions.js';

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

const chromium = await cargarNavegador();
const B = await levantarServidor();
await sembrarUsuarios();

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

const opciones = { args: ['--no-sandbox'] };
if (process.env.CHROMIUM_PATH) opciones.executablePath = process.env.CHROMIUM_PATH;
const navegador = await chromium.launch(opciones);

/** Abre una pestaña que reporta cualquier error de consola o de página. */
async function abrirPestana(ancho, alto, etiqueta) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto }, acceptDownloads: true });
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (e) => errores.push(`${etiqueta} pageerror: ${e.message}`));
  pagina.on('console', (m) => {
    if (m.type() === 'error') errores.push(`${etiqueta} console: ${m.text()}`);
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

// ---------------------------------------------------------------------------
// Administración
// ---------------------------------------------------------------------------

const admin = await abrirPestana(1280, 900, 'admin');

await paso('el máster entra al panel', async () => {
  await entrar(admin, 'master@pista.ec', CLAVES.master, '/admin');
  await admin.waitForSelector('#metricas .tarjeta', { timeout: 15000 });
});

// Los reportes van por la API autenticada: un enlace normal llegaría sin sesión
// y devolvería un 401 en vez del archivo, así que se descargan con fetch.
for (const entidad of ['packs', 'consumos', 'clientes']) {
  await paso(`descarga el reporte de ${entidad}`, async () => {
    const [descarga] = await Promise.all([
      admin.waitForEvent('download', { timeout: 15000 }),
      admin.click(`[data-exportar=${entidad}]`),
    ]);
    const nombre = descarga.suggestedFilename();
    if (!nombre.startsWith(`${entidad}-`) || !nombre.endsWith('.csv')) {
      throw new Error(`nombre de archivo inesperado: ${nombre}`);
    }
    const bytes = readFileSync(await descarga.path());
    // Los tres primeros bytes son la marca de codificación (EF BB BF). Sin ella
    // Excel abre los acentos mal, que es justo para lo que está.
    if (bytes[0] !== 0xef || bytes[1] !== 0xbb || bytes[2] !== 0xbf) {
      throw new Error(`el CSV llegó sin marca de codificación: ${bytes.subarray(0, 6).toString('hex')}`);
    }
    if (bytes.toString('utf8').split('\r\n')[0].split(',').length < 5) {
      throw new Error('cabeceras inesperadas en el CSV');
    }
  });
}

await paso('el máster vende un pack de 10', async () => {
  await admin.click('.pestana[data-panel=packs]');
  await admin.click('#btn-nuevo-pack');
  await admin.waitForSelector('#dialogo-pack[open]');
  await admin.fill('#pack-cliente', 'carlos');
  await admin.waitForSelector('#resultados-cliente button', { timeout: 15000 });
  await admin.click('#resultados-cliente button');
  await admin.selectOption('#pack-size', '10');
  await admin.click('#form-pack button[type=submit]');
  await admin.waitForSelector('#dialogo-detalle[open]', { timeout: 15000 });
});

const codigo = (await admin.textContent('#detalle-cuerpo h2')).trim();
console.log('       código del pack:', codigo);

await paso('el detalle del pack permite poner vencimiento', async () => {
  const boton = admin.locator('#dialogo-detalle button', { hasText: /vencimiento/ });
  if ((await boton.count()) === 0) throw new Error('no aparece la acción de vencimiento');
  await boton.first().click();
  const campo = admin.locator('dialog[open] input[type=date]').first();
  await campo.waitFor({ timeout: 8000 });
  await campo.fill(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  await admin.locator('dialog[open] button[type=submit]').last().click();
  await admin.waitForSelector('.brindis--ok', { timeout: 10000 });
  await admin.waitForFunction(() => document.querySelector('#detalle-cuerpo')?.textContent.includes('Vence el'), {
    timeout: 10000,
  });
});

// ---------------------------------------------------------------------------
// Puesto de control
// ---------------------------------------------------------------------------

const staff = await abrirPestana(900, 1000, 'staff');

await paso('el personal entra al escáner', async () => {
  await entrar(staff, 'staff@pista.ec', CLAVES.staff, '/escanear');
  await staff.waitForSelector('#resultado', { timeout: 10000 });
});

await paso('teclear el código completo no lo deforma', async () => {
  await staff.fill('#dispositivo', 'Mostrador');
  await staff.click('#codigo-manual');
  await staff.type('#codigo-manual', codigo, { delay: 12 });
  const escrito = await staff.inputValue('#codigo-manual');
  if (escrito !== codigo) throw new Error(`se tecleó ${codigo} y quedó ${escrito}`);
});

await paso('teclear solo el cuerpo también sirve', async () => {
  await staff.fill('#codigo-manual', '');
  await staff.click('#codigo-manual');
  await staff.type('#codigo-manual', codigo.slice(4).replace('-', ''), { delay: 12 });
  const escrito = await staff.inputValue('#codigo-manual');
  if (escrito !== codigo.slice(4)) throw new Error(`se esperaba ${codigo.slice(4)} y quedó ${escrito}`);
});

await paso('consulta y consumo por código manual', async () => {
  await staff.click('#btn-consultar');
  await staff.waitForSelector('.resultado--ok', { timeout: 15000 });
  await staff.fill('#codigo-manual', codigo);
  await staff.click('#form-manual button[type=submit]');
  await staff.waitForFunction(
    () => document.querySelector('.resultado__titulo')?.textContent.includes('Entrada registrada'),
    { timeout: 15000 },
  );
  const restantes = (await staff.textContent('.resultado__restantes')).trim();
  if (restantes !== '9') throw new Error(`esperaba 9 restantes, obtuve ${restantes}`);
});

await paso('la actividad en vivo muestra el método real, no "QR app"', async () => {
  await staff.waitForFunction(
    () => {
      const fila = document.querySelector('#actividad ul li');
      return Boolean(fila) && fila.textContent.includes('Código manual') && fila.textContent.includes('Mostrador');
    },
    { timeout: 15000 },
  );
});

await paso('el segundo intento inmediato avisa de la espera', async () => {
  await staff.fill('#codigo-manual', codigo);
  await staff.click('#form-manual button[type=submit]');
  await staff.waitForSelector('.resultado--alerta', { timeout: 15000 });
});

// ---------------------------------------------------------------------------
// Portal del cliente
// ---------------------------------------------------------------------------

const cliente = await abrirPestana(430, 900, 'cliente');

await paso('el cliente ve su saldo y su pase con QR', async () => {
  await entrar(cliente, 'cliente@pista.ec', CLAVES.cliente, '/app');
  await cliente.waitForSelector('#contenido:not([hidden])', { timeout: 15000 });
  await cliente.waitForFunction(() => document.querySelector('#saldo-numero')?.textContent.trim() === '9', {
    timeout: 15000,
  });
  await cliente.waitForSelector('#seccion-qr:not([hidden]) svg', { timeout: 15000 });
});

await paso('el cliente ve bajar su saldo en vivo, sin recargar', async () => {
  if (!packsService.findByCode(codigo)) throw new Error('no se encontró el pack recién emitido');
  // El reloj adelantado salta la espera entre consumos sin dormir la prueba.
  redemptions.redeemByCode({ code: codigo, scanner: null, deviceLabel: 'Puerta 2', now: Date.now() + 60_000 });
  await cliente.waitForFunction(() => document.querySelector('#saldo-numero')?.textContent.trim() === '8', {
    timeout: 15000,
  });
});

await navegador.close();
await bajarServidor();

// El navegador registra como error de consola cualquier respuesta 4xx, y esta
// prueba provoca varias a propósito: el 401 de comprobar si hay sesión al
// cargar, y el 409 del segundo escaneo dentro del tiempo de espera.
const ESPERADOS = /favicon|manifest|status of (401|409)/i;
const relevantes = errores.filter((e) => !ESPERADOS.test(e));

console.log('\n=== errores de consola/página ===');
console.log(relevantes.length ? relevantes.join('\n') : 'ninguno');
console.log(`\n${totales - fallidos.length}/${totales} pasos correctos.`);
process.exit(relevantes.length || fallidos.length ? 1 : 0);
