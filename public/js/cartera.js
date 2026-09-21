/**
 * Página de la invitación del mostrador.
 *
 * El personal le enseña un QR al cliente, este lo escanea con la cámara y llega
 * aquí. Desde aquí guarda su pase en Apple Wallet o en Google Wallet sin tener
 * que iniciar sesión delante de la cola, que es justo lo que hacía que nadie
 * llegara a guardarlo.
 *
 * El permiso viaja en el fragmento de la dirección y se borra de la barra en
 * cuanto se lee: el fragmento nunca llega al servidor, así que no queda en sus
 * registros, y borrarlo lo saca del historial del teléfono. Dura unos minutos,
 * los que tarda alguien en sacar el teléfono y pulsar un botón.
 */
import { $, el, render, mostrarAviso, conCarga, plural } from './ui.js';
import { aplicarMarca } from './shell.js';

const aviso = $('#aviso');
const comprobando = $('#comprobando');
const pase = $('#pase');

const NOMBRE_DE_CARTERA = { apple: 'Apple Wallet', google: 'Google Wallet' };

/**
 * Lee el permiso del fragmento y lo borra de la barra en el acto.
 * Se comprueba la forma antes de mandarlo: lo que no la tenga no es un permiso
 * nuestro y no hay por qué gastar una petición en averiguarlo.
 */
function tomarPermiso() {
  const parametros = new URLSearchParams(window.location.hash.slice(1));
  const packId = parametros.get('p') || '';
  const token = parametros.get('t') || '';
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);

  const packValido = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(packId);
  const tokenValido = /^\d{1,12}\.[A-Za-z0-9_-]{20,120}$/.test(token);
  return packValido && tokenValido ? { packId, token } : null;
}

const permiso = tomarPermiso();

/** POST sin sesión: esta página no usa el token de acceso aunque haya uno. */
async function enviar(ruta) {
  let respuesta;
  try {
    respuesta = await fetch(ruta, {
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify(permiso),
    });
  } catch {
    throw new Error('No hay conexión con el servidor. Revisa tu Internet e intenta de nuevo.');
  }
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) throw new Error(datos?.error?.message || 'No pudimos preparar tu pase.');
  return datos;
}

/**
 * Qué cartera le corresponde a este teléfono. Solo decide el orden y cuál se
 * resalta: reconocer un teléfono por su navegador nunca es exacto, y quedarse
 * sin botón por un modelo raro sería mucho peor que ver uno de más.
 */
function carteraDelTelefono() {
  const agente = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(agente)) return 'apple';
  if (/Macintosh/i.test(agente) && (navigator.maxTouchPoints ?? 0) > 1) return 'apple';
  if (/Android/i.test(agente)) return 'google';
  if (/Macintosh/i.test(agente) && /Safari/i.test(agente) && !/Chrome|Chromium|Edg/i.test(agente)) return 'apple';
  return null;
}

async function guardar(cual, boton) {
  mostrarAviso(aviso, '');
  await conCarga(boton, async () => {
    try {
      const { url } = await enviar(`/api/wallet/invitacion/${cual}`);
      window.location.href = url;
    } catch (error) {
      mostrarAviso(aviso, error.message, 'error');
    }
  });
}

function pintar(datos) {
  const { pack, titular, carteras } = datos;
  const opciones = ['apple', 'google'].filter((cual) => carteras[cual]);
  const preferida = opciones.includes(carteraDelTelefono()) ? carteraDelTelefono() : null;
  const ordenadas = preferida ? [preferida, ...opciones.filter((c) => c !== preferida)] : opciones;

  $('#resumen').textContent = titular
    ? `${titular}: pack ${pack.code}, ${plural(pack.remaining, 'entrada disponible', 'entradas disponibles')}.`
    : `Pack ${pack.code}, ${plural(pack.remaining, 'entrada disponible', 'entradas disponibles')}.`;

  $('#detalle').textContent = pack.usable
    ? 'Elige dónde guardarlo. Te quedará en el teléfono y podrás ver tu saldo sin abrir nada.'
    : 'Este pack ya no está activo, así que el pase solo te servirá para consultar su historial.';

  render(
    $('#botones'),
    ordenadas.map((cual) =>
      el(
        'button',
        {
          class: `boton boton--bloque boton--grande ${cual === preferida ? 'boton--principal' : 'boton--fantasma'}`,
          type: 'button',
          onClick: (evento) => guardar(cual, evento.currentTarget),
        },
        `Guardar en ${NOMBRE_DE_CARTERA[cual]}`,
      ),
    ),
  );

  pase.hidden = false;
  $('#acciones-final').hidden = false;
}

(async () => {
  fetch('/api/config')
    .then((r) => r.json())
    .then(aplicarMarca)
    .catch(() => {});

  comprobando.hidden = false;
  try {
    if (!permiso) {
      throw new Error('Este código ya caducó. Pídele al personal de la pista que te lo muestre de nuevo.');
    }
    pintar(await enviar('/api/wallet/invitacion'));
  } catch (error) {
    mostrarAviso(aviso, error.message, 'error');
    $('#acciones-final').hidden = false;
  } finally {
    comprobando.hidden = true;
  }
})();
