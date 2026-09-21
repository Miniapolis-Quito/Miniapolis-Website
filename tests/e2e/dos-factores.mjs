/**
 * Verificación en dos pasos, de punta a punta en un navegador real.
 *
 * Lo que aquí se comprueba no lo puede ver una prueba de API: que el QR se
 * dibuje, que los códigos de respaldo se puedan copiar, que la página de
 * acceso pase al segundo paso en vez de quedarse colgada, y que el panel del
 * máster refleje quién lo tiene puesto.
 *
 * No entra en `npm test` porque necesita Playwright. Ver el README de esta
 * carpeta.
 */
import { levantarServidor, bajarServidor, sembrarUsuarios, CLAVES } from '../helpers.js';
import { cargarNavegador } from './navegador.mjs';
import * as totp from '../../src/lib/totp.js';

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

async function abrirPestana(etiqueta) {
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (e) => errores.push(`${etiqueta} pageerror: ${e.message}`));
  pagina.on('console', (m) => {
    if (m.type() === 'error') errores.push(`${etiqueta} console: ${m.text()}`);
  });
  return pagina;
}

/** Código del tramo actual, o del siguiente cuando el actual ya se gastó. */
const codigoDe = (secreto, desplazamiento = 0) =>
  totp.codigoDelPaso(secreto, totp.pasoDe(Date.now()) + desplazamiento);

const staff = await abrirPestana('staff');
let secreto = null;
let codigosDeRespaldo = [];

// ---------------------------------------------------------------------------
// Activarla desde la cabecera
// ---------------------------------------------------------------------------

await paso('el personal entra y abre «Seguridad»', async () => {
  await staff.goto(B, { waitUntil: 'domcontentloaded' });
  await staff.fill('#entrar-email', 'staff@pista.ec');
  await staff.fill('#entrar-password', CLAVES.staff);
  await staff.click('#form-entrar button[type=submit]');
  await staff.waitForURL('**/escanear', { timeout: 15000 });

  await staff.click('.barra button:has-text("Seguridad")');
  await staff.waitForSelector('dialog[open] h2:has-text("Seguridad de mi cuenta")', { timeout: 10000 });
  await staff.waitForSelector('dialog[open] button:has-text("Activar verificación en dos pasos")', { timeout: 10000 });
});

await paso('el QR aparece dibujado y la clave se puede teclear a mano', async () => {
  await staff.click('dialog[open] button:has-text("Activar verificación en dos pasos")');
  const qr = staff.locator('dialog[open] img.qr-dos-factores');
  await qr.waitFor({ timeout: 10000 });
  const ancho = await qr.evaluate((img) => img.naturalWidth);
  if (!ancho) throw new Error('el QR no llegó a dibujarse');

  await staff.click('dialog[open] details summary');
  const clave = (await staff.textContent('dialog[open] .clave-manual')).trim();
  secreto = clave.replace(/\s/g, '');
  if (!/^[A-Z2-7]{32}$/.test(secreto)) throw new Error(`clave con forma inesperada: ${clave}`);
});

await paso('un código incorrecto lo dice y no activa nada', async () => {
  await staff.fill('dialog[open] input[name=code]', '000000');
  await staff.click('dialog[open] button:has-text("Confirmar y activar")');
  await staff.waitForSelector('dialog[open] .aviso--error', { timeout: 10000 });
});

await paso('el código bueno la activa y entrega los códigos de respaldo', async () => {
  await staff.fill('dialog[open] input[name=code]', codigoDe(secreto));
  await staff.click('dialog[open] button:has-text("Confirmar y activar")');
  await staff.waitForSelector('dialog[open] .lista-codigos', { timeout: 10000 });
  codigosDeRespaldo = await staff.locator('dialog[open] .lista-codigos code').allTextContents();
  if (codigosDeRespaldo.length !== 10) throw new Error(`llegaron ${codigosDeRespaldo.length} códigos`);
  for (const codigo of codigosDeRespaldo) {
    if (!/^[0-9A-Z]{5}-[0-9A-Z]{5}$/.test(codigo)) throw new Error(`código con forma rara: ${codigo}`);
  }
  await staff.click('dialog[open] button:has-text("Ya los guardé")');
  await staff.waitForSelector('dialog[open] .aviso--ok', { timeout: 10000 });
});

// ---------------------------------------------------------------------------
// Entrar en dos pasos
// ---------------------------------------------------------------------------

await paso('al volver a entrar, la contraseña lleva al segundo paso', async () => {
  const nueva = await abrirPestana('staff-2');
  await nueva.goto(B, { waitUntil: 'domcontentloaded' });
  await nueva.fill('#entrar-email', 'staff@pista.ec');
  await nueva.fill('#entrar-password', CLAVES.staff);
  await nueva.click('#form-entrar button[type=submit]');
  await nueva.waitForSelector('#form-segundo-paso:not([hidden])', { timeout: 15000 });
  if (!(await nueva.isHidden('#form-entrar'))) throw new Error('el formulario de contraseña sigue a la vista');

  // El tramo en el que se activó ya se gastó: se usa el siguiente.
  await nueva.fill('#segundo-paso-codigo', codigoDe(secreto, 1));
  await nueva.click('#form-segundo-paso button[type=submit]');
  await nueva.waitForURL('**/escanear', { timeout: 15000 });
  await nueva.close();
});

await paso('un código de respaldo también abre la sesión', async () => {
  const nueva = await abrirPestana('staff-3');
  await nueva.goto(B, { waitUntil: 'domcontentloaded' });
  await nueva.fill('#entrar-email', 'staff@pista.ec');
  await nueva.fill('#entrar-password', CLAVES.staff);
  await nueva.click('#form-entrar button[type=submit]');
  await nueva.waitForSelector('#form-segundo-paso:not([hidden])', { timeout: 15000 });
  await nueva.fill('#segundo-paso-codigo', codigosDeRespaldo[0]);
  await nueva.click('#form-segundo-paso button[type=submit]');
  await nueva.waitForURL('**/escanear', { timeout: 15000 });
  await nueva.close();
});

await paso('cancelar el segundo paso devuelve a la contraseña', async () => {
  const nueva = await abrirPestana('staff-4');
  await nueva.goto(B, { waitUntil: 'domcontentloaded' });
  await nueva.fill('#entrar-email', 'staff@pista.ec');
  await nueva.fill('#entrar-password', CLAVES.staff);
  await nueva.click('#form-entrar button[type=submit]');
  await nueva.waitForSelector('#form-segundo-paso:not([hidden])', { timeout: 15000 });
  await nueva.click('#btn-cancelar-segundo-paso');
  await nueva.waitForSelector('#form-entrar:not([hidden])', { timeout: 10000 });
  if (await nueva.inputValue('#entrar-password')) throw new Error('la contraseña se quedó escrita en pantalla');
  await nueva.close();
});

// ---------------------------------------------------------------------------
// El panel del máster
// ---------------------------------------------------------------------------

const admin = await abrirPestana('admin');

await paso('el panel de seguridad muestra quién la tiene puesta', async () => {
  await admin.goto(B, { waitUntil: 'domcontentloaded' });
  await admin.fill('#entrar-email', 'master@pista.ec');
  await admin.fill('#entrar-password', CLAVES.master);
  await admin.click('#form-entrar button[type=submit]');
  await admin.waitForURL('**/admin', { timeout: 15000 });

  await admin.click('.pestana[data-panel=seguridad]');
  await admin.waitForSelector('#seguridad-equipo table tbody tr', { timeout: 15000 });
  const filas = await admin.locator('#seguridad-equipo tbody tr').allTextContents();
  const delOperador = filas.find((f) => f.includes('staff@pista.ec'));
  if (!delOperador?.includes('Sí')) throw new Error(`el operador no consta con segundo factor: ${delOperador}`);
  const delMaster = filas.find((f) => f.includes('master@pista.ec'));
  if (!delMaster?.includes('No')) throw new Error(`el máster no consta sin segundo factor: ${delMaster}`);
});

await paso('el máster no puede exigirla mientras no la tenga él mismo', async () => {
  const interruptor = admin.locator('#seguridad-exigir');
  await interruptor.waitFor({ timeout: 10000 });
  if (!(await interruptor.isDisabled())) throw new Error('el interruptor debería estar bloqueado');
  await admin.waitForSelector('text=actívala primero en tu propia cuenta', { timeout: 5000 }).catch(() => {
    throw new Error('falta la explicación de por qué no se puede exigir');
  });
});

await paso('el máster puede quitarle el segundo factor a quien perdió el teléfono', async () => {
  await admin.click('#seguridad-equipo tbody tr:has-text("staff@pista.ec") button:has-text("Quitar")');
  await admin.click('dialog[open] button:has-text("Quitarlo")');
  await admin.waitForSelector('.brindis--ok', { timeout: 10000 });
  await admin.waitForFunction(
    () => {
      const fila = [...document.querySelectorAll('#seguridad-equipo tbody tr')].find((f) =>
        f.textContent.includes('staff@pista.ec'),
      );
      return fila && fila.textContent.includes('No');
    },
    { timeout: 10000 },
  );
});

await paso('quitado el segundo factor, la contraseña vuelve a bastar', async () => {
  const nueva = await abrirPestana('staff-5');
  await nueva.goto(B, { waitUntil: 'domcontentloaded' });
  await nueva.fill('#entrar-email', 'staff@pista.ec');
  await nueva.fill('#entrar-password', CLAVES.staff);
  await nueva.click('#form-entrar button[type=submit]');
  await nueva.waitForURL('**/escanear', { timeout: 15000 });
  await nueva.close();
});

await navegador.close();
await bajarServidor();

// El navegador anota como error de consola cualquier 4xx, y esta prueba provoca
// varios a propósito: el 401 de comprobar si hay sesión al cargar y el 400 del
// código incorrecto.
const ESPERADOS = /favicon|manifest|status of (400|401)|ViewTransition/i;
const relevantes = errores.filter((e) => !ESPERADOS.test(e));

console.log('\n=== errores de consola/página ===');
console.log(relevantes.length ? relevantes.join('\n') : 'ninguno');
console.log(`\n${totales - fallidos.length}/${totales} pasos correctos.`);
process.exit(relevantes.length || fallidos.length ? 1 : 0);
