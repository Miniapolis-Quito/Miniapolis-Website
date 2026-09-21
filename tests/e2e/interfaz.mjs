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
import * as users from '../../src/services/users.js';
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
const { cMaster, cliente: usuarioCliente } = await sembrarUsuarios();

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

const portada = await abrirPestana(1280, 900, 'portada');

await paso('el selector de acceso es simétrico y legible', async () => {
  await portada.goto(B, { waitUntil: 'domcontentloaded' });
  await portada.waitForSelector('.entrada__acceso-panel .pestanas');

  const datos = await portada.locator('.entrada__acceso-panel .pestana').evaluateAll((elementos) => {
    const contenedor = elementos[0].parentElement;
    const caja = contenedor.getBoundingClientRect();
    const cajas = elementos.map((elemento) => elemento.getBoundingClientRect());
    const estilo = getComputedStyle(elementos[0]);
    const activo = elementos.find((elemento) => elemento.getAttribute('aria-selected') === 'true');
    const estiloActivo = getComputedStyle(activo);
    const rgb = (valor) => valor.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) || [0, 0, 0];
    const lineal = (canal) => {
      const normalizado = canal / 255;
      return normalizado <= .03928 ? normalizado / 12.92 : ((normalizado + .055) / 1.055) ** 2.4;
    };
    const luminancia = (valor) => {
      const [rojo, verde, azul] = rgb(valor);
      return .2126 * lineal(rojo) + .7152 * lineal(verde) + .0722 * lineal(azul);
    };
    const fondo = luminancia(estiloActivo.backgroundColor);
    const texto = luminancia(estiloActivo.color);
    const contraste = (Math.max(fondo, texto) + .05) / (Math.min(fondo, texto) + .05);
    return {
      display: getComputedStyle(contenedor).display,
      diferenciasAncho: Math.abs(cajas[0].width - cajas[1].width),
      margenIzquierdo: cajas[0].left - caja.left,
      margenDerecho: caja.right - cajas[1].right,
      contraste,
      subrayado: getComputedStyle(activo, '::after').display,
      colorActivo: estiloActivo.color,
      fondoActivo: estiloActivo.backgroundColor,
      colorInactivo: estilo.color,
    };
  });

  if (datos.display !== 'grid') throw new Error(`las pestañas siguen en ${datos.display}, no en una cuadrícula simétrica`);
  if (datos.diferenciasAncho > 1) throw new Error(`anchos desiguales: ${datos.diferenciasAncho.toFixed(2)}px`);
  if (Math.abs(datos.margenIzquierdo - datos.margenDerecho) > 1) {
    throw new Error(`márgenes desiguales: ${datos.margenIzquierdo.toFixed(2)}px / ${datos.margenDerecho.toFixed(2)}px`);
  }
  if (datos.subrayado !== 'none') throw new Error('el estado activo todavía conserva el subrayado antiguo');
  if (datos.contraste < 4.5) throw new Error(`contraste insuficiente: ${datos.contraste.toFixed(2)}:1`);
});

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

await paso('un pack pagado no ofrece ponerle vencimiento', async () => {
  // Las entradas compradas no caducan: el botón solo existe en los packs de
  // cortesía. Que el servidor lo rechace no basta —si el panel lo ofreciera,
  // el máster pulsaría algo que siempre falla—, así que se mira la pantalla.
  const boton = admin.locator('#dialogo-detalle button', { hasText: /vencimiento/ });
  if ((await boton.count()) !== 0) throw new Error('un pack pagado no debería ofrecer vencimiento');
  const cuerpo = await admin.textContent('#detalle-cuerpo');
  if (/Vence el/.test(cuerpo)) throw new Error('un pack pagado no debería mostrar fecha de vencimiento');
});

await paso('el pase impreso sale solo, y solo él, en la hoja', async () => {
  // Imprimir de verdad abriría un diálogo del sistema: se sustituye la llamada
  // por una bandera y se mira lo que habría salido por la impresora.
  await admin.addInitScript(() => {
    window.__imprimio = false;
    window.print = () => { window.__imprimio = true; };
  });
  await admin.reload({ waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('#metricas .tarjeta', { timeout: 15000 });
  await admin.click('.pestana[data-panel=packs]');
  await admin.waitForSelector('#tabla-packs table', { timeout: 15000 });
  await admin.click('#tabla-packs tbody tr button');
  await admin.waitForSelector('#dialogo-detalle[open]', { timeout: 15000 });

  // El pase físico solo existe si el pack admite QR impreso.
  await admin.locator('#dialogo-detalle button', { hasText: 'Activar QR impreso' }).click();
  await admin.locator('#dialogo-detalle button', { hasText: 'Imprimir pase' }).waitFor({ timeout: 15000 });
  await admin.locator('#dialogo-detalle button', { hasText: 'Imprimir pase' }).click();

  await admin.waitForFunction(() => window.__imprimio === true, { timeout: 15000 });
  const pase = admin.locator('#pase-impreso .pase');
  const logo = pase.locator('img.pase__logo');
  if ((await logo.count()) !== 1) throw new Error('el pase no lleva el logo oficial');
  if (!(await logo.getAttribute('src'))?.endsWith('/images/miniapolis-logo-oficial.webp')) {
    throw new Error('el pase no usa el logo oficial de Miniápolis');
  }
  if (!(await pase.locator('svg').count())) throw new Error('el pase salió sin código QR');
  const texto = await pase.textContent();
  if (!texto.includes(codigo)) throw new Error('el pase no lleva el código del pack');
  if (!texto.includes('Carlos Piloto')) throw new Error('el pase no lleva el nombre del cliente');

  // Con los estilos de impresión, en la hoja no cabe nada más: ni la cabecera,
  // ni el panel, ni el diálogo desde el que se pidió.
  await admin.emulateMedia({ media: 'print' });
  if (await admin.locator('.barra').isVisible()) throw new Error('la cabecera saldría impresa');
  if (await admin.locator('#dialogo-detalle').isVisible()) throw new Error('el diálogo saldría impreso');
  if (!(await admin.locator('#pase-impreso').isVisible())) throw new Error('el pase no se vería en la hoja');
  await admin.emulateMedia({ media: 'screen' });
});

await paso('desde la ficha se entrega el pase de cartera con un QR en pantalla', async () => {
  // Las credenciales de Apple y de Google las emite el negocio; aquí se finge
  // lo que responde el servidor para poder ver la pantalla que verá el
  // mostrador. Lo que hace el servidor de verdad lo cubre la suite de API.
  await admin.route('**/api/admin/packs/*/wallet', async (ruta) => {
    await ruta.fulfill({
      json: { carteras: { apple: true, google: true }, guardado: false, telefonos: 0, google: false, alDia: true },
    });
  });
  await admin.route('**/api/admin/packs/*/wallet/invitacion', async (ruta) => {
    await ruta.fulfill({
      json: {
        url: 'https://entradas.example/cartera#p=11111111-2222-4333-8444-555555555555&t=1.aaa',
        qr: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
        validoMinutos: 10,
      },
    });
  });

  await admin.locator('#dialogo-detalle button', { hasText: 'Pase de cartera' }).click();
  const dialogo = admin.locator('dialog[open]').last();
  await dialogo.getByText('todavía no ha guardado', { exact: false }).waitFor({ timeout: 15000 });

  await dialogo.locator('button', { hasText: 'Entregar el pase' }).click();
  await dialogo.locator('.cartera-qr svg').waitFor({ timeout: 15000 });
  const texto = await dialogo.textContent();
  if (!/Este código sirve \d+:\d\d más/.test(texto)) {
    throw new Error(`el mostrador no ve hasta cuándo sirve el código: ${texto}`);
  }
  if (!(await dialogo.locator('button', { hasText: 'Copiar enlace' }).count())) {
    throw new Error('sin manera de mandarle el enlace al cliente que no está delante');
  }

  await dialogo.locator('button', { hasText: 'Cerrar' }).click();
  await admin.unroute('**/api/admin/packs/*/wallet');
  await admin.unroute('**/api/admin/packs/*/wallet/invitacion');
});

// ---------------------------------------------------------------------------
// Puesto de control
// ---------------------------------------------------------------------------

const staff = await abrirPestana(900, 1000, 'staff');

await paso('una cuenta sin permiso ve por qué no puede escanear, y no se le enciende la cámara', async () => {
  await users.createUser({
    email: 'sinpermiso@pista.ec', password: CLAVES.staff, fullName: 'Elena Boxes', role: 'staff',
  });
  const sinPermiso = await abrirPestana(900, 1000, 'sin-permiso');
  try {
    await entrar(sinPermiso, 'sinpermiso@pista.ec', CLAVES.staff, '/app');
    await sinPermiso.goto(`${B}/escanear`, { waitUntil: 'domcontentloaded' });

    await sinPermiso.waitForSelector('#sin-permiso:not([hidden])', { timeout: 10000 });
    if (await sinPermiso.isVisible('#puesto')) throw new Error('el puesto no debería verse');
    if (await sinPermiso.isVisible('#btn-camara')) throw new Error('no debería ofrecerse encender la cámara');
    // Y el enlace al escáner tampoco aparece en la barra de navegación.
    if (await sinPermiso.isVisible('.barra__nav a[href="/escanear"]')) {
      throw new Error('el escáner no debería estar en el menú');
    }
  } finally {
    await sinPermiso.close();
  }
});

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
    () => /Entrada (registrada|cobrada)/.test(document.querySelector('.resultado__titulo')?.textContent || ''),
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

await paso('un corte de red a mitad de un cobro no descuenta dos veces', async () => {
  // Un cliente aparte, para no mover el saldo del que se revisa más abajo.
  const otro = await cMaster.post('/api/admin/users', {
    email: 'corte@pista.ec', fullName: 'Piloto Del Corte', role: 'customer', password: 'Palanca-Cambios-55',
  });
  const emitido = await cMaster.post('/api/admin/packs', { userId: otro.datos.user.id, size: 5 });
  const codigoCorte = emitido.datos.pack.code;
  const packId = emitido.datos.pack.id;

  // El peor caso: la petición llega al servidor y descuenta, pero la respuesta
  // se pierde de vuelta. El escáner no sabe si cobró, así que guarda la lectura
  // para enviarla después, y lo único que evita el doble descuento es que la
  // guarda con la misma clave de idempotencia.
  await staff.route('**/api/scan/manual', async (ruta) => {
    await ruta.fetch();
    await ruta.abort('connectionfailed');
  });
  await staff.fill('#codigo-manual', codigoCorte);
  await staff.click('#form-manual button[type=submit]');
  await staff.waitForFunction(
    () => /Guardada sin (conexión|señal)/.test(document.querySelector('.resultado__titulo')?.textContent || ''),
    { timeout: 15000 },
  );
  await staff.unroute('**/api/scan/manual');

  // Vuelve la señal y el operador toca "Enviar ahora" (o espera: se envía sola).
  await staff.click('#btn-enviar-guardadas');
  await staff.waitForSelector('#tarjeta-sin-conexion', { state: 'hidden', timeout: 15000 });

  // Y en la base, un solo consumo: el envío repitió la respuesta, no el cobro.
  const consumos = redemptions.listRedemptions({ packId });
  if (consumos.total !== 1) throw new Error(`se registraron ${consumos.total} consumos, debería haber 1`);
  if (packsService.findById(packId).remaining !== 4) throw new Error('el saldo no cuadra con un único consumo');
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

await paso('la app ofrece guardar el pase cuando hay carteras configuradas', async () => {
  // Las credenciales de Apple y Google las emite el negocio, así que aquí se
  // finge la respuesta de configuración: lo que se comprueba es que la app
  // ofrece los botones justo cuando el sistema dice que puede.
  await cliente.route('**/api/config', async (ruta) => {
    const original = await ruta.fetch();
    const datos = await original.json();
    await ruta.fulfill({ json: { ...datos, wallet: { apple: true, google: true } } });
  });
  await cliente.reload({ waitUntil: 'domcontentloaded' });
  await cliente.waitForSelector('#seccion-qr:not([hidden]) svg', { timeout: 15000 });

  const zona = cliente.locator('#carteras');
  await zona.waitFor({ timeout: 15000 });
  const botones = await zona.locator('button').allTextContents();
  if (!botones.some((t) => /Apple/i.test(t))) throw new Error(`sin botón de Apple: ${botones.join(' | ')}`);
  if (!botones.some((t) => /Google/i.test(t))) throw new Error(`sin botón de Google: ${botones.join(' | ')}`);

  // La sección explica para qué sirve el pase, no solo enseña dos botones.
  const ayuda = await cliente.locator('#cartera-ayuda').textContent();
  if (!/se actualiza|baja solo/i.test(ayuda)) throw new Error(`la sección no explica nada: ${ayuda}`);

  // Y cada pack tiene el suyo, que es lo que se pulsa cuando hay varios.
  const enLaTarjeta = cliente.locator('#lista-packs button', { hasText: 'Añadir a la cartera' });
  if ((await enLaTarjeta.count()) === 0) throw new Error('la tarjeta del pack no ofrece guardarlo en la cartera');

  // Este navegador no es un teléfono, así que no hay cartera que adivinar: con
  // las dos configuradas, el botón tiene que preguntar en vez de no hacer nada.
  await enLaTarjeta.first().click();
  const eleccion = cliente.locator('dialog[open]', { hasText: '¿En qué cartera' });
  await eleccion.waitFor({ timeout: 15000 });
  const opciones = await eleccion.locator('.fila-acciones button').allTextContents();
  if (opciones.length !== 2) throw new Error(`el diálogo no ofrece las dos carteras: ${opciones.join(' | ')}`);
  await eleccion.locator('button', { hasText: 'Cancelar' }).click();

  await cliente.unroute('**/api/config');
});

await paso('la invitación del mostrador se explica sola cuando el código ya no sirve', async () => {
  const pagina = await abrirPestana(430, 900, 'cartera');
  await pagina.goto(`${B}/cartera#p=11111111-2222-4333-8444-555555555555&t=1.aaaaaaaaaaaaaaaaaaaaaaaa`);

  const aviso = pagina.locator('#aviso:not([hidden])');
  await aviso.waitFor({ timeout: 15000 });
  const texto = await aviso.textContent();
  if (!/caduc/i.test(texto)) throw new Error(`el cliente no entiende qué pasó: ${texto}`);

  // El permiso no puede quedarse en la barra: de ahí pasa al historial del
  // teléfono y a cualquier captura que la persona comparta.
  if (await pagina.evaluate(() => window.location.hash)) {
    throw new Error('el permiso sigue en la dirección después de leerlo');
  }
  // Y siempre queda una salida hacia su cuenta.
  if (!(await pagina.locator('#acciones-final a[href="/app"]').count())) {
    throw new Error('la página deja al cliente sin a dónde ir');
  }
});

await navegador.close();
await bajarServidor();

// El navegador registra como error de consola cualquier respuesta 4xx, y esta
// prueba provoca varias a propósito: el 401 de comprobar si hay sesión al
// cargar, el 409 del segundo escaneo dentro del tiempo de espera y la conexión
// que se corta adrede para comprobar el reintento.
const ESPERADOS = /favicon|manifest|status of (401|409)|ERR_CONNECTION_FAILED|ViewTransition/i;
const relevantes = errores.filter((e) => !ESPERADOS.test(e));

console.log('\n=== errores de consola/página ===');
console.log(relevantes.length ? relevantes.join('\n') : 'ninguno');
console.log(`\n${totales - fallidos.length}/${totales} pasos correctos.`);
process.exit(relevantes.length || fallidos.length ? 1 : 0);
