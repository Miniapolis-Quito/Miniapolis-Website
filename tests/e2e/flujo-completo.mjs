/**
 * Prueba de extremo a extremo del flujo completo, en un navegador real.
 *
 * Cubre lo que las pruebas de API no pueden: que la interfaz se pinte bien, que
 * los permisos por rol redirijan donde toca, y sobre todo que el saldo del
 * cliente cambie en vivo cuando el personal escanea, sin recargar la página.
 *
 * Requiere Playwright y un servidor en marcha. Ver el README de esta carpeta.
 */

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

const B = process.env.BASE_URL || 'http://localhost:3000';
const CAPTURAS = process.env.CAPTURAS || null;
const MASTER = {
  email: process.env.MASTER_EMAIL || 'admin@racinghobbies.ec',
  password: process.env.MASTER_PASSWORD || 'Pista-RC-Master-2026',
};

/**
 * Esta prueba se puede repetir sobre el mismo servidor, y el sistema no deja
 * registrar dos veces el mismo correo. En vez de ir a la base a borrar lo de
 * la vez anterior —que además es la base de quien esté ejecutando esto—, cada
 * ejecución se inventa sus propios correos. No hay nada que limpiar después.
 */
const SELLO = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CLIENTE_EMAIL = `piloto+${SELLO}@ejemplo.com`;
const STAFF_EMAIL = `pista+${SELLO}@ejemplo.com`;

const errores = [];
const pasosFallidos = [];
let pasosTotales = 0;

/** Guarda una captura solo si se pidió una carpeta donde dejarlas. */
async function capturar(pagina, nombre) {
  if (!CAPTURAS) return;
  await pagina.screenshot({ path: `${CAPTURAS}/${nombre}.png`, fullPage: true });
}

const opcionesNavegador = { args: ['--no-sandbox'] };
if (process.env.CHROMIUM_PATH) opcionesNavegador.executablePath = process.env.CHROMIUM_PATH;

const navegador = await chromium.launch(opcionesNavegador);
const contexto = await navegador.newContext({ viewport: { width: 430, height: 900 } });
const pagina = await contexto.newPage();
pagina.on('console', (m) => { if (m.type() === 'error') errores.push('console: ' + m.text()); });
pagina.on('pageerror', (e) => errores.push('pageerror: ' + e.message));

async function paso(nombre, fn) {
  pasosTotales += 1;
  try {
    await fn();
    console.log('OK  ', nombre);
  } catch (error) {
    console.log('FALLO', nombre, '->', error.message);
    pasosFallidos.push(nombre);
    errores.push(`${nombre}: ${error.message}`);
  }
}

await paso('carga login', async () => {
  await pagina.goto(B, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#form-entrar', { timeout: 15000 });
});

await paso('registro de cliente', async () => {
  await pagina.click('#pestana-registro');
  await pagina.fill('#registro-nombre', 'Carlos Piloto');
  await pagina.fill('#registro-email', CLIENTE_EMAIL);
  await pagina.fill('#registro-telefono', '+593 99 888 7766');
  await pagina.fill('#registro-password', 'Nitro-Buggy-2026!');
  await pagina.click('#form-registro button[type=submit]');
  await pagina.waitForURL('**/app', { timeout: 15000 });
  await pagina.waitForSelector('#contenido:not([hidden])', { timeout: 15000 });
});

await paso('portal muestra saldo cero', async () => {
  const n = await pagina.textContent('#saldo-numero');
  if (n.trim() !== '0') throw new Error('saldo esperado 0, obtenido ' + n);
  const vacio = await pagina.isVisible('#lista-packs .vacio');
  if (!vacio) throw new Error('no se muestra el estado vacío');
});
await capturar(pagina, '01-cliente-vacio');

// --- sesión del máster en otra pestaña ---
const paginaAdmin = await contexto.browser().newContext({ viewport: { width: 1280, height: 900 } }).then(c => c.newPage());
paginaAdmin.on('pageerror', (e) => errores.push('admin pageerror: ' + e.message));
paginaAdmin.on('console', (m) => { if (m.type() === 'error') errores.push('admin console: ' + m.text()); });

await paso('login máster', async () => {
  await paginaAdmin.goto(B, { waitUntil: 'domcontentloaded' });
  await paginaAdmin.fill('#entrar-email', MASTER.email);
  await paginaAdmin.fill('#entrar-password', MASTER.password);
  await paginaAdmin.click('#form-entrar button[type=submit]');
  await paginaAdmin.waitForURL('**/admin', { timeout: 15000 });
  await paginaAdmin.waitForSelector('#metricas .tarjeta', { timeout: 15000 });
});
await capturar(paginaAdmin, '02-admin-resumen');

await paso('máster vende un pack de 10', async () => {
  await paginaAdmin.click('.pestana[data-panel=packs]');
  await paginaAdmin.click('#btn-nuevo-pack');
  await paginaAdmin.waitForSelector('#dialogo-pack[open]');
  await paginaAdmin.fill('#pack-cliente', 'piloto');
  await paginaAdmin.waitForSelector('#resultados-cliente button', { timeout: 15000 });
  await paginaAdmin.click('#resultados-cliente button');
  await paginaAdmin.selectOption('#pack-size', '10');
  await paginaAdmin.click('#form-pack button[type=submit]');
  await paginaAdmin.waitForSelector('#dialogo-detalle[open]', { timeout: 15000 });
});
await capturar(paginaAdmin, '03-admin-pack');

await paso('el cliente ve el pack en vivo (sin recargar)', async () => {
  await pagina.waitForFunction(() => document.querySelector('#saldo-numero')?.textContent.trim() === '10', { timeout: 15000 });
  await pagina.waitForSelector('#seccion-qr:not([hidden]) svg', { timeout: 15000 });
});
await capturar(pagina, '04-cliente-qr');

const codigoPack = (await pagina.textContent('#qr-codigo')).trim();
console.log('   código del pack:', codigoPack);

// --- puesto de escaneo (personal) ---
await paso('máster crea personal de pista', async () => {
  await paginaAdmin.click('#dialogo-detalle [data-cerrar]');
  await paginaAdmin.waitForSelector('#dialogo-detalle', { state: 'hidden' });
  await paginaAdmin.click('.pestana[data-panel=clientes]');
  await paginaAdmin.click('#btn-nuevo-usuario');
  await paginaAdmin.waitForSelector('#dialogo-usuario[open]');
  await paginaAdmin.fill('#usuario-nombre', 'Operador Pista');
  await paginaAdmin.fill('#usuario-email', STAFF_EMAIL);
  await paginaAdmin.selectOption('#usuario-rol', 'staff');
  await paginaAdmin.fill('#usuario-password', 'Chicane-Nocturna-77');
  await paginaAdmin.click('#form-usuario button[type=submit]');
  await paginaAdmin.waitForSelector('#dialogo-usuario', { state: 'hidden', timeout: 15000 });
});

const ctxStaff = await navegador.newContext({ viewport: { width: 900, height: 1000 } });
const paginaStaff = await ctxStaff.newPage();
paginaStaff.on('pageerror', (e) => errores.push('staff pageerror: ' + e.message));
paginaStaff.on('console', (m) => { if (m.type() === 'error') errores.push('staff console: ' + m.text()); });

await paso('login del personal y acceso al escáner', async () => {
  await paginaStaff.goto(B, { waitUntil: 'domcontentloaded' });
  await paginaStaff.fill('#entrar-email', STAFF_EMAIL);
  await paginaStaff.fill('#entrar-password', 'Chicane-Nocturna-77');
  await paginaStaff.click('#form-entrar button[type=submit]');
  await paginaStaff.waitForURL('**/escanear', { timeout: 15000 });
  await paginaStaff.waitForSelector('#resultado', { timeout: 15000 });
});

await paso('consumo por código manual', async () => {
  await paginaStaff.fill('#dispositivo', 'Puerta 1');
  await paginaStaff.fill('#codigo-manual', codigoPack);
  await paginaStaff.click('#form-manual button[type=submit]');
  await paginaStaff.waitForSelector('.resultado--ok', { timeout: 15000 });
  const restantes = await paginaStaff.textContent('.resultado__restantes');
  if (restantes.trim() !== '9') throw new Error('esperaba 9 restantes, obtuve ' + restantes);
});
await capturar(paginaStaff, '05-escaner-ok');

await paso('el cliente ve el descuento en tiempo real', async () => {
  await pagina.waitForFunction(() => document.querySelector('#saldo-numero')?.textContent.trim() === '9', { timeout: 15000 });
});

await paso('segundo intento inmediato: bloqueado por espera', async () => {
  await paginaStaff.fill('#codigo-manual', codigoPack);
  await paginaStaff.click('#form-manual button[type=submit]');
  await paginaStaff.waitForSelector('.resultado--alerta', { timeout: 15000 });
  const texto = await paginaStaff.textContent('.resultado__detalle');
  if (!/segundos/.test(texto)) throw new Error('mensaje de espera inesperado: ' + texto);
});
await capturar(paginaStaff, '06-escaner-espera');

await paso('el máster ve la actividad', async () => {
  await paginaAdmin.click('.pestana[data-panel=consumos]');
  await paginaAdmin.waitForSelector('#tabla-consumos .lista__item', { timeout: 15000 });
});

await paso('verificación de integridad contable', async () => {
  await paginaAdmin.click('.pestana[data-panel=resumen]');
  await paginaAdmin.waitForSelector('#integridad .aviso--ok', { timeout: 15000 });
});
await capturar(paginaAdmin, '07-admin-final');

await paso('el cliente no puede entrar al panel máster', async () => {
  await pagina.goto(B + '/admin', { waitUntil: 'domcontentloaded' });
  await pagina.waitForURL('**/app', { timeout: 15000 });
});

await paso('la sesión sobrevive a recargar la página', async () => {
  await pagina.goto(B + '/app', { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#contenido:not([hidden])', { timeout: 15000 });
  const n = await pagina.textContent('#saldo-numero');
  if (n.trim() !== '9') throw new Error('saldo tras recarga: ' + n);
});

await navegador.close();

// El navegador registra como "error de consola" cualquier respuesta 4xx, y esta
// prueba provoca varias a propósito: el 401 de comprobar si hay sesión al
// cargar la página, y el 409 del segundo escaneo dentro del tiempo de espera.
// Se descartan para que solo queden los fallos de verdad.
const ESPERADOS = /favicon|manifest|status of (401|409)|ViewTransition/i;
const relevantes = errores.filter((e) => !ESPERADOS.test(e));

console.log('\n=== errores de consola/página ===');
console.log(relevantes.length ? relevantes.join('\n') : 'ninguno');

const fallos = pasosFallidos.length;
console.log(`\n${pasosTotales - fallos}/${pasosTotales} pasos correctos.`);
process.exit(relevantes.length || fallos ? 1 : 0);
