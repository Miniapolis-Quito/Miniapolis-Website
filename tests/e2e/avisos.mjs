/**
 * Avisos y clientes por recuperar en un navegador real.
 *
 * La suite de API comprueba la mecánica de la cola; esta, lo que solo se ve en
 * pantalla: que cada cliente aparezca en su grupo, que el botón de WhatsApp
 * abra la conversación ya escrita y deje el contacto registrado, que encender
 * los avisos pida confirmación y que lo enviado llegue al historial y a la
 * ficha. También recorre lo que ve el cliente: el interruptor de «Mi cuenta» y
 * la página del enlace de baja.
 *
 * El correo sale por el transporte `memoria`. No entra en `npm test` porque
 * necesita Playwright. Ver el README de esta carpeta.
 */
import '../env-recuperacion.js';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { levantarServidor, bajarServidor, sembrarUsuarios, CLAVES } from '../helpers.js';
import { cargarNavegador } from './navegador.mjs';
import { buzonDePrueba } from '../../src/lib/correo.js';
import { getDb } from '../../src/db/index.js';
import * as users from '../../src/services/users.js';
import * as packsService from '../../src/services/packs.js';
import * as redemptions from '../../src/services/redemptions.js';

const chromium = await cargarNavegador();
const B = await levantarServidor();
const { master, staff, cliente } = await sembrarUsuarios();

const DIA = 86_400_000;
const iso = (instante) => new Date(instante).toISOString();
const CAPTURAS = process.env.CAPTURAS || null;
if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });

// ---------------------------------------------------------------------------
// Datos: un cliente por cada grupo
// ---------------------------------------------------------------------------

const vender = (userId, extra = {}) =>
  packsService.issuePack({ userId, size: 5, priceCents: 2500, actor: master, ...extra });
const usar = (pack) => redemptions.redeemByCode({ code: pack.code, scanner: { id: staff.id, email: staff.email } });
const nuevoCliente = (fullName, email, phone = null) =>
  users.createUser({ email, fullName, phone, password: 'Rueda-Delantera-2026' });

function envejecer(userId, dias) {
  const db = getDb();
  const antes = iso(Date.now() - dias * DIA);
  db.prepare('UPDATE packs SET created_at = ? WHERE user_id = ?').run(antes, userId);
  db.prepare('UPDATE redemptions SET created_at = ? WHERE user_id = ?').run(antes, userId);
  db.prepare('UPDATE pack_movements SET created_at = ? WHERE pack_id IN (SELECT id FROM packs WHERE user_id = ?)').run(antes, userId);
}

users.updateUser(cliente.id, { phone: '0991112233' });
usar(vender(cliente.id, { size: 3 })); // Carlos: le quedan 2

const ana = await nuevoCliente('Ana Vence', 'ana@pista.ec', '+593992223344');
vender(ana.id, { expiresAt: iso(Date.now() + 3 * DIA) });

const beto = await nuevoCliente('Beto Sin', 'beto@pista.ec');
usar(vender(beto.id, { size: 1 }));

const dora = await nuevoCliente('Dora Quieta', 'dora@pista.ec', '0993334455');
vender(dora.id);
envejecer(dora.id, 45);

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

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
  // WhatsApp no se abre de verdad: se sirve una página vacía en su lugar.
  await contexto.route('https://wa.me/**', (ruta) =>
    ruta.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>WhatsApp</title>' }),
  );
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (e) => errores.push(`${etiqueta} pageerror: ${e.message}`));
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

async function capturar(pagina, nombre) {
  if (CAPTURAS) await pagina.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`), fullPage: true });
}

const recordatoriosDe = (userId) => getDb().prepare('SELECT email_reminders FROM users WHERE id = ?').get(userId).email_reminders;
const brindis = (pagina, texto) => pagina.locator('.brindis', { hasText: texto }).first().waitFor({ timeout: 10000 });

async function abrirAvisos(pagina) {
  await pagina.click('#pestana-avisos');
  await pagina.waitForSelector('#avisos-grupos .pestana', { timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Administración
// ---------------------------------------------------------------------------

const admin = await abrirPestana('admin');

await paso('la sección de avisos arranca apagada y explica por qué no sale nada', async () => {
  await entrar(admin, 'master@pista.ec', CLAVES.master, '/admin');
  await abrirAvisos(admin);
  const estado = await admin.locator('#avisos-estado').innerText();
  comprobar(estado.includes('Apagados'), `debería decir que están apagados: ${estado}`);
  comprobar(await admin.isHidden('#btn-avisos-revisar'), '«Revisar ahora» no tiene sentido con los avisos apagados');
});

await paso('cada cliente aparece en su grupo, empezando por lo más urgente', async () => {
  // `allInnerTexts` devuelve el texto ya pasado por CSS, y las pestañas van en
  // mayúsculas: se compara el texto del documento, que es el que escribe el
  // código.
  const grupos = await admin.locator('#avisos-grupos .pestana').allTextContents();
  comprobar(
    JSON.stringify(grupos.map((g) => g.replace(/\s+/g, ' ').trim())) ===
      JSON.stringify(['Por vencer 1', 'Sin entradas 1', 'No vienen 1', 'Quedan pocas 1']),
    `grupos inesperados: ${JSON.stringify(grupos)}`,
  );
  const seleccionado = await admin.locator('#avisos-grupos .pestana[aria-selected="true"]').textContent();
  comprobar(seleccionado.startsWith('Por vencer'), 'debería abrirse el grupo de vencimientos');
  const lista = await admin.locator('#avisos-oportunidades').innerText();
  comprobar(lista.includes('Ana Vence') && lista.includes('vencen el'), `falta Ana en por vencer: ${lista}`);
  const enJuego = await admin.locator('#avisos-en-juego').textContent();
  comprobar(enJuego === '10 entradas pagadas en juego', `las entradas en juego no cuadran: ${enJuego}`);
  await capturar(admin, 'avisos-escritorio');
});

await paso('el botón de WhatsApp abre la conversación ya escrita y registra el contacto', async () => {
  await admin.locator('#avisos-grupos .pestana', { hasText: 'Quedan pocas' }).click();
  const fila = admin.locator('.recuperar', { hasText: 'Carlos Piloto' });
  const enlace = fila.locator('a', { hasText: 'WhatsApp' });
  const destino = await enlace.getAttribute('href');
  comprobar(destino.startsWith('https://wa.me/593991112233?text='), `número mal formado: ${destino}`);
  comprobar(decodeURIComponent(destino).includes('Te quedan 2 entradas'), 'el mensaje debería decir cuántas le quedan');

  const [conversacion] = await Promise.all([admin.context().waitForEvent('page'), enlace.click()]);
  await conversacion.close();
  await brindis(admin, 'Contacto con Carlos Piloto registrado');
  await admin.locator('.recuperar--contactado', { hasText: 'Carlos Piloto' }).waitFor({ timeout: 10000 });
  const texto = await admin.locator('.recuperar', { hasText: 'Carlos Piloto' }).innerText();
  comprobar(texto.includes('Último contacto: WhatsApp') && texto.includes('Ana Máster'), `falta el último contacto: ${texto}`);
});

await paso('encender los avisos pide confirmación y deja el estado a la vista', async () => {
  await admin.click('#btn-avisos-ajustes');
  const dialogo = admin.locator('dialog.dialogo-ancho[open]');
  await dialogo.waitFor();
  await dialogo.locator('#ajuste-activos').check();
  await dialogo.locator('#ajuste-desde').selectOption('0');
  await dialogo.locator('#ajuste-hasta').selectOption('24');
  await capturar(admin, 'avisos-ajustes');

  await dialogo.locator('button', { hasText: 'Enviarme una prueba' }).click();
  await dialogo.locator('.aviso--ok', { hasText: 'Prueba enviada a master@pista.ec' }).waitFor({ timeout: 10000 });
  comprobar(buzonDePrueba().some((c) => c.para === 'master@pista.ec' && c.asunto.startsWith('[Prueba]')), 'no llegó la prueba');

  await dialogo.locator('button', { hasText: 'Guardar' }).click();
  await admin.locator('dialog[open] button', { hasText: 'Encender' }).click();
  await brindis(admin, 'Ajustes de avisos guardados');
  await admin.locator('#avisos-estado', { hasText: 'Activados' }).waitFor({ timeout: 10000 });
  comprobar(await admin.isVisible('#btn-avisos-revisar'), 'ahora sí debería poder revisarse al momento');
});

await paso('revisar ahora envía lo que toca y lo deja en el historial', async () => {
  await admin.click('#btn-avisos-revisar');
  await brindis(admin, 'Revisado: 2 correos enviados');
  const destinatarios = buzonDePrueba().filter((c) => !c.asunto.startsWith('[Prueba]')).map((c) => c.para).sort();
  comprobar(
    JSON.stringify(destinatarios) === JSON.stringify(['ana@pista.ec', 'dora@pista.ec']),
    `solo Ana (vence) y Dora (no viene); lo anterior a encenderlos no se avisa: ${destinatarios}`,
  );
  await admin.locator('#tabla-avisos tbody tr').nth(2).waitFor({ timeout: 10000 });
  // textContent y no innerText: las etiquetas se ven en mayúsculas por CSS.
  const historial = await admin.locator('#tabla-avisos').textContent();
  comprobar((historial.match(/Enviado/g) || []).length === 2, `faltan los enviados: ${historial}`);
  comprobar(historial.includes('Registrado'), 'falta el contacto por WhatsApp');
});

await paso('el nombre lleva a la ficha, que muestra el contacto, y volver regresa a avisos', async () => {
  await admin.locator('.recuperar__nombre', { hasText: 'Carlos Piloto' }).click();
  await admin.waitForSelector('.ficha', { timeout: 10000 });
  comprobar(await admin.locator('.ficha__contacto a', { hasText: 'WhatsApp' }).count() === 1, 'la cabecera debería ofrecer WhatsApp');
  await admin.click('.ficha .pestana[data-pestana="actividad"]');
  await admin.locator('.tiempo__titulo', { hasText: 'Contactado por WhatsApp' }).first().waitFor({ timeout: 10000 });
  const detalle = await admin.locator('.tiempo__item', { hasText: 'Contactado por WhatsApp' }).first().innerText();
  comprobar(detalle.includes('Porque le quedaban pocas entradas') && detalle.includes('por Ana Máster'), `detalle incompleto: ${detalle}`);
});

await paso('desde la ficha se quitan los recordatorios de un cliente', async () => {
  await admin.click('.ficha .pestana[data-pestana="datos"]');
  await admin.locator('#ficha-recordatorios').uncheck();
  await admin.click('.ficha form button[type=submit]');
  await brindis(admin, 'Datos actualizados');
  comprobar(recordatoriosDe(cliente.id) === 0, 'la base debería tener los recordatorios desactivados');
  await admin.click('.ficha .pestana[data-pestana="datos"]');
  comprobar(!(await admin.locator('#ficha-recordatorios').isChecked()), 'la casilla debería seguir desmarcada');
});

await paso('volver de la ficha regresa a la sección de avisos', async () => {
  await admin.click('.ficha__volver');
  await admin.waitForSelector('#panel-avisos:not([hidden])', { timeout: 10000 });
});

await paso('en un teléfono la sección se lee sin desbordarse', async () => {
  const movil = await abrirPestana('móvil', { width: 390, height: 844 });
  await entrar(movil, 'master@pista.ec', CLAVES.master, '/admin');
  await abrirAvisos(movil);
  await movil.locator('#avisos-grupos .pestana', { hasText: 'No vienen' }).click();
  await movil.locator('.recuperar', { hasText: 'Dora Quieta' }).waitFor();
  const desborde = await movil.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  comprobar(desborde <= 1, `la página se desborda ${desborde}px a lo ancho`);
  await capturar(movil, 'avisos-movil');
  await movil.context().close();
});

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

const app = await abrirPestana('cliente', { width: 420, height: 860 });

await paso('«Mi cuenta» ofrece los recordatorios y los vuelve a activar', async () => {
  await entrar(app, 'cliente@pista.ec', CLAVES.cliente, '/app');
  await app.waitForSelector('#contenido:not([hidden])', { timeout: 15000 });
  await app.click('#btn-cuenta');
  await app.waitForSelector('#seccion-recordatorios:not([hidden])');
  comprobar(!(await app.locator('#perfil-recordatorios').isChecked()), 'administración los había desactivado');
  await app.locator('#perfil-recordatorios').check();
  await app.waitForSelector('#aviso-recordatorios.aviso--ok', { timeout: 10000 });
  comprobar(recordatoriosDe(cliente.id) === 1, 'la base debería tenerlos activados');
  await capturar(app, 'mi-cuenta-recordatorios');
});

const enlace = await abrirPestana('enlace de baja', { width: 420, height: 860 });

await paso('el enlace de un correo real abre la página, borra el token y no da de baja solo', async () => {
  const correo = buzonDePrueba().find((c) => c.para === 'dora@pista.ec');
  const direccion = /https:\/\/entradas\.example(\/recordatorios#t=[\w.-]+)/.exec(correo.texto)[1];
  await enlace.goto(`${B}${direccion}`, { waitUntil: 'domcontentloaded' });
  await enlace.waitForSelector('#preferencia:not([hidden])', { timeout: 10000 });
  comprobar(!enlace.url().includes('#'), `el token sigue en la barra: ${enlace.url()}`);
  const estado = await enlace.locator('#estado-recordatorios').innerText();
  comprobar(estado === 'Dora, ahora recibes recordatorios por correo.', `saludo inesperado: ${estado}`);
  comprobar(recordatoriosDe(dora.id) === 1, 'abrir la página no debería dar de baja');
  await capturar(enlace, 'recordatorios-baja');
});

await paso('darse de baja y deshacerlo desde la misma página', async () => {
  await enlace.click('#btn-baja');
  await enlace.waitForSelector('#aviso.aviso--ok', { timeout: 10000 });
  comprobar(recordatoriosDe(dora.id) === 0, 'debería quedar de baja');
  await enlace.click('#btn-alta');
  await enlace.locator('#aviso.aviso--ok', { hasText: 'te volveremos a avisar' }).waitFor({ timeout: 10000 });
  comprobar(recordatoriosDe(dora.id) === 1, 'debería volver a recibirlos');
});

await paso('un enlace alterado dice que no sirve', async () => {
  // Cambiar solo el fragmento no recarga la página: se sale antes de volver.
  await enlace.goto('about:blank');
  await enlace.goto(`${B}/recordatorios#t=${dora.id}.${'x'.repeat(43)}`, { waitUntil: 'domcontentloaded' });
  await enlace.waitForSelector('#aviso.aviso--error', { timeout: 10000 });
  comprobar(await enlace.isVisible('#acciones-final'), 'debería ofrecer ir a sus entradas');
  comprobar(await enlace.isHidden('#preferencia'), 'no debería ofrecer ningún cambio');
});

await navegador.close();
await bajarServidor();

console.log(`\n${totales - fallidos.length}/${totales} pasos correctos.`);
if (errores.length) {
  console.log('\nErrores de la página:');
  for (const e of errores) console.log('  ', e);
}
process.exit(fallidos.length || errores.length ? 1 : 0);
