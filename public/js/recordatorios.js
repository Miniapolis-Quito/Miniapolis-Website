/**
 * Página del enlace de baja de los recordatorios.
 *
 * No da de baja al abrirse: los filtros de correo abren los enlaces para
 * analizarlos, y una baja por visitar la página dejaría sin recordatorios a
 * quien nunca lo pidió. Se cambia al pulsar el botón, y se puede deshacer ahí
 * mismo.
 */
import { $, mostrarAviso, conCarga } from './ui.js';
import { aplicarMarca } from './shell.js';

const aviso = $('#aviso');
const comprobando = $('#comprobando');
const preferencia = $('#preferencia');
const botonBaja = $('#btn-baja');
const botonAlta = $('#btn-alta');

/**
 * Lee el token del fragmento y lo borra de la barra en el acto: no queda en el
 * historial ni se copia al compartir la dirección. El fragmento nunca llega al
 * servidor.
 */
function tomarToken() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('t');
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  return token && /^[A-Za-z0-9-]{1,64}\.[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

const token = tomarToken();
let nombre = null;

/** POST sin sesión: esta página no usa el token de acceso aunque haya uno. */
async function enviar(ruta) {
  let respuesta;
  try {
    respuesta = await fetch(ruta, {
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ token }),
    });
  } catch {
    throw new Error('No hay conexión con el servidor. Revisa tu Internet e intenta de nuevo.');
  }
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) throw new Error(datos?.error?.message || 'No pudimos completar la operación.');
  return datos;
}

function pintar(activos) {
  const saludo = nombre ? `${nombre}, ` : '';
  $('#estado-recordatorios').textContent = activos
    ? `${saludo}desde ahora recibirás recordatorios por correo.`
    : `${saludo}ya no te mandaremos recordatorios por correo.`;
  botonBaja.hidden = !activos;
  botonAlta.hidden = activos;
}

async function cambiar(boton, ruta, mensaje) {
  mostrarAviso(aviso, '');
  await conCarga(boton, async () => {
    try {
      const datos = await enviar(ruta);
      pintar(datos.emailReminders);
      mostrarAviso(aviso, mensaje, 'ok');
    } catch (error) {
      mostrarAviso(aviso, error.message, 'error');
    }
  });
}

botonBaja.addEventListener('click', () =>
  cambiar(botonBaja, '/api/notifications/unsubscribe', 'Listo: ya no te mandaremos recordatorios.'),
);
botonAlta.addEventListener('click', () =>
  cambiar(botonAlta, '/api/notifications/resubscribe', 'Listo: volveremos a avisarte por correo.'),
);

(async () => {
  fetch('/api/config')
    .then((r) => r.json())
    .then(aplicarMarca)
    .catch(() => {});

  comprobando.hidden = false;
  try {
    if (!token) throw new Error('Este enlace ya no sirve. Usa el del último correo que te enviamos o cambia la preferencia en «Mi cuenta».');
    const datos = await enviar('/api/notifications/preferences');
    nombre = datos.firstName;
    pintar(datos.emailReminders);
    preferencia.hidden = false;
  } catch (error) {
    mostrarAviso(aviso, error.message, 'error');
    $('#acciones-final').hidden = false;
  } finally {
    comprobando.hidden = true;
  }
})();
