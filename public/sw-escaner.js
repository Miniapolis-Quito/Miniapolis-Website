/**
 * Service worker del escáner.
 *
 * Existe para una sola cosa: que `/escanear` abra aunque no haya Internet en la
 * pista. Si el teléfono del puesto se reinicia o alguien recarga la página
 * durante un corte, sin esto el navegador mostraría su página de error y el
 * puesto quedaría inservible justo cuando más falta hace.
 *
 * Reglas:
 * - Solo guarda la página del escáner y los archivos que necesita para
 *   funcionar. Nada de la API pasa por aquí: saldos, sesiones y datos de
 *   clientes nunca se guardan en la caché.
 * - Red primero. Con conexión, el teléfono siempre usa la versión publicada y
 *   de paso renueva la copia; la caché solo se usa si la red falla o tarda.
 */
const CACHE = 'rh-escaner-v1';

/** Todo lo que carga el escáner. Una prueba comprueba que no falte nada. */
const RECURSOS = [
  '/escanear',
  '/css/styles.css',
  '/js/escaner.js',
  '/js/sin-conexion.js',
  '/js/cola-sin-conexion.js',
  '/js/ui.js',
  '/js/api.js',
  '/js/realtime.js',
  '/js/shell.js',
  '/js/cuenta.js',
  '/vendor/jsQR.js',
  '/fonts/anton-400.woff2',
  '/fonts/archivo-var.woff2',
  '/images/racing-hobbies-logo-oficial.png',
  '/images/racing-hobbies-pista-rc.webp',
  '/favicon.svg',
  '/manifest.webmanifest',
];

/** Cuánto se espera a la red antes de servir la copia guardada. */
const ESPERA_RED_MS = 4000;

const RUTAS = new Set(RECURSOS);

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE)
      // `reload` salta la caché HTTP del navegador: la copia sin conexión
      // tiene que ser la versión publicada, no una anterior que quedó guardada.
      .then((cache) => cache.addAll(RECURSOS.map((ruta) => new Request(ruta, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nombres) =>
        Promise.all(nombres.filter((n) => n.startsWith('rh-escaner-') && n !== CACHE).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

async function redPrimero(peticion, ruta) {
  const cache = await caches.open(CACHE);

  const desdeLaRed = fetch(peticion).then((respuesta) => {
    // Solo se guarda una respuesta buena y completa del propio sitio.
    if (respuesta.ok && respuesta.type === 'basic') cache.put(ruta, respuesta.clone());
    return respuesta;
  });

  let temporizador;
  const plazo = new Promise((resolver) => {
    temporizador = setTimeout(resolver, ESPERA_RED_MS, null);
  });

  try {
    // Con señal lenta no se hace esperar al puesto: pasado el plazo se sirve la
    // copia, y la respuesta de la red, si llega, renueva la caché igual.
    const respuesta = await Promise.race([desdeLaRed, plazo]);
    if (respuesta) return respuesta;
    const copia = await cache.match(ruta);
    return copia ?? (await desdeLaRed);
  } catch (error) {
    const copia = await cache.match(ruta);
    if (copia) return copia;
    throw error;
  } finally {
    clearTimeout(temporizador);
    desdeLaRed.catch(() => {});
  }
}

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (!RUTAS.has(url.pathname)) return;

  evento.respondWith(redPrimero(peticion, url.pathname));
});
