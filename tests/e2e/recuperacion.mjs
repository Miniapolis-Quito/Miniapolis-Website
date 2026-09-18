/**
 * Recuperación y cambio de contraseña en un navegador real.
 *
 * La suite de API comprueba la mecánica; esta, lo que solo se ve en pantalla:
 * que el botón aparezca, que la página del enlace borre el token de la barra
 * de direcciones, que recargarla no lo resucite, y que el personal pueda
 * cambiar su contraseña desde la cabecera sin quedarse fuera.
 *
 * El correo sale por el transporte `memoria`: el enlace se lee del buzón de
 * prueba, igual que lo leería la persona de su bandeja de entrada.
 *
 * No entra en `npm test` porque necesita Playwright. Ver el README de esta carpeta.
 */
import '../env-recuperacion.js';
import { levantarServidor, bajarServidor, sembrarUsuarios, CLAVES } from '../helpers.js';
import { buzonDePrueba } from '../../src/lib/correo.js';
import * as recuperacion from '../../src/services/recuperacion.js';

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

const NUEVA = 'Curva-Peraltada-2026';
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

function comprobar(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}

const opciones = { args: ['--no-sandbox'] };
if (process.env.CHROMIUM_PATH) opciones.executablePath = process.env.CHROMIUM_PATH;
const navegador = await chromium.launch(opciones);

async function abrirPestana(etiqueta) {
  const contexto = await navegador.newContext({ viewport: { width: 1100, height: 900 } });
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (e) => {
    if (!/ViewTransition/i.test(e.message)) errores.push(`${etiqueta} pageerror: ${e.message}`);
  });
  pagina.on('console', (m) => {
    // Los 400 y 401 que la propia prueba provoca aparecen como recursos fallidos;
    // lo que interesa son los errores de JavaScript.
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
      errores.push(`${etiqueta} console: ${m.text()}`);
    }
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

const textoDe = (pagina, selector) => pagina.locator(selector).innerText();

// ---------------------------------------------------------------------------
// Recuperar la contraseña
// ---------------------------------------------------------------------------

const acceso = await abrirPestana('acceso');
let token = null;

await paso('la página de acceso ofrece recuperar la contraseña', async () => {
  await acceso.goto(B, { waitUntil: 'domcontentloaded' });
  await acceso.waitForSelector('#zona-olvido:not([hidden])', { timeout: 10000 });
});

await paso('pedir el enlace aprovecha el correo ya escrito y muestra un aviso neutro', async () => {
  await acceso.fill('#entrar-email', 'cliente@pista.ec');
  await acceso.click('#btn-olvido');
  await acceso.waitForSelector('#form-recuperar:not([hidden])');
  comprobar(await acceso.isHidden('#form-entrar'), 'el formulario de entrar debería ocultarse');
  comprobar((await acceso.inputValue('#recuperar-email')) === 'cliente@pista.ec', 'el correo escrito no pasó al formulario');

  await acceso.click('#form-recuperar button[type=submit]');
  await acceso.waitForSelector('#aviso.aviso--ok', { timeout: 10000 });
  comprobar((await textoDe(acceso, '#aviso')).startsWith('Si hay una cuenta con ese correo'), 'el aviso debería ser neutro');

  await recuperacion.esperarTareas();
  const correo = buzonDePrueba().find((c) => c.para === 'cliente@pista.ec');
  comprobar(correo, 'no llegó el correo de recuperación');
  token = /#token=([A-Za-z0-9_-]{43})/.exec(correo.texto)[1];
});

await paso('volver a entrar deja la página como estaba', async () => {
  await acceso.click('#btn-volver-entrar');
  await acceso.waitForSelector('#form-entrar:not([hidden])');
  comprobar(await acceso.isHidden('#form-recuperar'), 'el formulario de recuperar debería ocultarse');
  comprobar(await acceso.isVisible('#zona-olvido'), 'el botón de recuperar debería volver a verse');
});

const enlace = await abrirPestana('enlace');

await paso('el enlace abre el formulario y borra el token de la barra', async () => {
  await enlace.goto(`${B}/restablecer#token=${token}`, { waitUntil: 'domcontentloaded' });
  await enlace.waitForSelector('#form-restablecer:not([hidden])', { timeout: 10000 });
  comprobar(!enlace.url().includes('token') && !enlace.url().includes('#'), `el token sigue en la barra: ${enlace.url()}`);
});

await paso('si las dos contraseñas no coinciden se señala sin gastar el enlace', async () => {
  await enlace.fill('#nueva-password', NUEVA);
  await enlace.fill('#confirmar-password', `${NUEVA}-otra`);
  await enlace.click('#form-restablecer button[type=submit]');
  await enlace.waitForFunction(() =>
    document.querySelector('#confirmar-password').closest('.campo').querySelector('.campo__error').textContent.includes('no coinciden'),
  );
  comprobar(recuperacion.comprobar(token).ok, 'el enlace no debería haberse gastado');
});

await paso('una contraseña débil muestra el motivo', async () => {
  await enlace.fill('#nueva-password', 'Carlos-Piloto-2026');
  await enlace.fill('#confirmar-password', 'Carlos-Piloto-2026');
  await enlace.click('#form-restablecer button[type=submit]');
  await enlace.waitForSelector('#aviso.aviso--error', { timeout: 10000 });
  comprobar((await textoDe(enlace, '#aviso')).includes('nombre'), 'debería explicar que contiene el nombre');
  comprobar(await enlace.isVisible('#form-restablecer'), 'el formulario debería seguir disponible');
});

await paso('guarda la contraseña nueva y ofrece volver a entrar', async () => {
  await enlace.fill('#nueva-password', NUEVA);
  await enlace.fill('#confirmar-password', NUEVA);
  await enlace.click('#form-restablecer button[type=submit]');
  await enlace.waitForSelector('#aviso.aviso--ok', { timeout: 10000 });
  comprobar((await textoDe(enlace, '#aviso')).includes('Contraseña cambiada'), 'falta la confirmación');
  comprobar(await enlace.isVisible('#acciones-final'), 'falta el botón para ir a entrar');
  comprobar(await enlace.isHidden('#form-restablecer'), 'el formulario debería ocultarse');
});

await paso('recargar la página no resucita el enlace', async () => {
  await enlace.reload({ waitUntil: 'domcontentloaded' });
  await enlace.waitForSelector('#aviso.aviso--error', { timeout: 10000 });
  comprobar(await enlace.isHidden('#form-restablecer'), 'sin token no debería haber formulario');
});

await paso('el mismo enlace, abierto otra vez, ya no sirve', async () => {
  await enlace.goto(`${B}/restablecer#token=${token}`, { waitUntil: 'domcontentloaded' });
  await enlace.waitForSelector('#aviso.aviso--error', { timeout: 10000 });
  const txt = await textoDe(enlace, '#aviso');
  comprobar(txt.includes('no sirve') || txt.includes('no es válido'), 'debería decir que el enlace no sirve');
});

const cliente = await abrirPestana('cliente');

await paso('la contraseña vieja ya no entra y la nueva sí', async () => {
  await cliente.goto(B, { waitUntil: 'domcontentloaded' });
  await cliente.fill('#entrar-email', 'cliente@pista.ec');
  await cliente.fill('#entrar-password', CLAVES.cliente);
  await cliente.click('#form-entrar button[type=submit]');
  await cliente.waitForSelector('#aviso.aviso--error', { timeout: 10000 });
  await entrar(cliente, 'cliente@pista.ec', NUEVA, '/app');
});

// ---------------------------------------------------------------------------
// Cambiar la contraseña con sesión
// ---------------------------------------------------------------------------

await paso('el cliente cambia su contraseña en Mi cuenta y sigue dentro', async () => {
  await cliente.waitForSelector('#btn-cuenta', { timeout: 15000 });
  await cliente.click('#btn-cuenta');
  await cliente.fill('#password-actual', NUEVA);
  await cliente.fill('#password-nueva', 'Chicane-Lenta-2027');
  await cliente.fill('#password-confirmar', 'Chicane-Lenta-2027');
  await cliente.click('#form-password button[type=submit]');
  await cliente.waitForSelector('#aviso-password.aviso--ok', { timeout: 10000 });
  // Da tiempo al aviso en vivo de «sesión invalidada» que manda el servidor.
  await cliente.waitForTimeout(2500);
  comprobar(cliente.url().endsWith('/app'), `quien cambió su contraseña no debería quedar fuera: ${cliente.url()}`);
  await cliente.click('#btn-cerrar-cuenta');
  await cliente.click('#btn-recargar-historial');
  await cliente.waitForTimeout(500);
  comprobar(cliente.url().endsWith('/app'), 'la sesión nueva debería seguir funcionando');
});

const master = await abrirPestana('master');

await paso('el máster cambia su contraseña desde la cabecera', async () => {
  await entrar(master, 'master@pista.ec', CLAVES.master, '/admin');
  // Acotado a la cabecera: el panel tiene otros botones ocultos con esa palabra.
  await master.click('#cabecera button:has-text("Contraseña")');
  await master.waitForSelector('#cambio-actual');
  await master.fill('#cambio-actual', CLAVES.master);
  await master.fill('#cambio-nueva', 'Recta-Principal-3030');
  await master.fill('#cambio-confirmar', 'Recta-Principal-3030');
  // Solo el diálogo abierto: el panel guarda otros diálogos ocultos con formularios.
  await master.click('dialog[open] form button[type=submit]');
  await master.waitForSelector('dialog[open] .aviso--ok', { timeout: 10000 });
  await master.waitForTimeout(2500);
  comprobar(master.url().endsWith('/admin'), `el máster no debería quedar fuera: ${master.url()}`);
});

await paso('en la cabecera del cliente no aparece el botón del personal', async () => {
  comprobar((await cliente.locator('.barra button:has-text("Contraseña")').count()) === 0, 'el cliente ya lo tiene en Mi cuenta');
});

await navegador.close();
await bajarServidor();

console.log(`\n${totales - fallidos.length}/${totales} pasos correctos`);
if (errores.length) {
  console.log('\nErrores en el navegador:');
  for (const error of errores) console.log('  -', error);
}
process.exit(fallidos.length || errores.length ? 1 : 0);
