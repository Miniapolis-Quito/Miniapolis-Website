/**
 * Puesto de control de acceso.
 *
 * Lee el QR con la API nativa `BarcodeDetector` cuando existe (más rápida y sin
 * coste de CPU) y con jsQR en cualquier otro navegador. Cada consumo lleva su
 * propia clave de idempotencia, de modo que un reintento tras un corte de red
 * nunca descuenta dos entradas.
 */
import { $, el, render, brindis, horaCorta, METODOS, claveIdempotencia,
         mostrarAviso, mostrarErroresCampo, conCarga, vibrar } from './ui.js';
import { api, iniciarPagina, getUsuario, redirigirAlPerderSesion, ErrorRed } from './api.js';
import { ConexionEnVivo } from './realtime.js';
import { montarCabecera, aplicarMarca } from './shell.js';

const CLAVE_DISPOSITIVO = 'rh_puesto';
const ESPERA_MISMO_CODIGO_MS = 2500;

const estado = {
  camaraActiva: false,
  flujo: null,
  camaras: [],
  camaraIndice: 0,
  detector: null,
  motor: null,
  ultimoCodigo: null,
  ultimoCodigoEn: 0,
  procesando: false,
  pendiente: null, // consumo que falló por red y se puede reintentar
  actividad: [],
};

let cabecera;
let bucle = null;
let lienzo = null;
let contexto = null;

// ---------------------------------------------------------------------------
// Sonido de confirmación (generado, sin archivos externos)
// ---------------------------------------------------------------------------

let audio = null;
function pitar(exito) {
  if (!$('#chk-sonido').checked) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const oscilador = audio.createOscillator();
    const ganancia = audio.createGain();
    oscilador.connect(ganancia);
    ganancia.connect(audio.destination);
    oscilador.type = 'sine';
    oscilador.frequency.value = exito ? 880 : 240;
    ganancia.gain.setValueAtTime(0.0001, audio.currentTime);
    ganancia.gain.exponentialRampToValueAtTime(0.18, audio.currentTime + 0.01);
    ganancia.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + (exito ? 0.16 : 0.34));
    oscilador.start();
    oscilador.stop(audio.currentTime + (exito ? 0.18 : 0.36));
  } catch {
    /* el sonido es un extra: si el navegador lo bloquea, no pasa nada */
  }
}

// ---------------------------------------------------------------------------
// Panel de resultado
// ---------------------------------------------------------------------------

function mostrarResultado({ tipo, icono, titulo, detalle, restantes, acciones }) {
  const nodo = $('#resultado');
  nodo.className = `resultado resultado--${tipo}`;
  render(
    nodo,
    el('div', { class: 'resultado__icono' }, icono),
    restantes !== undefined && restantes !== null ? el('div', { class: 'resultado__restantes' }, String(restantes)) : null,
    restantes !== undefined && restantes !== null ? el('div', { class: 'tenue pequeno' }, 'entradas restantes') : null,
    el('div', { class: 'resultado__titulo' }, titulo),
    detalle ? el('div', { class: 'resultado__detalle' }, detalle) : null,
    acciones ? el('div', { class: 'fila mt centro-flex' }, acciones) : null,
  );

  const mira = $('#mira');
  mira.classList.remove('escaner__mira--ok', 'escaner__mira--error');
  if (tipo === 'ok') mira.classList.add('escaner__mira--ok');
  if (tipo === 'error') mira.classList.add('escaner__mira--error');
  setTimeout(() => mira.classList.remove('escaner__mira--ok', 'escaner__mira--error'), 1400);
}

function reposar() {
  mostrarResultado({
    tipo: 'neutro',
    icono: '🏁',
    titulo: 'Listo para escanear',
    detalle: 'Apunta la cámara al código del cliente.',
  });
}

// ---------------------------------------------------------------------------
// Consumo de entradas
// ---------------------------------------------------------------------------

function puesto() {
  return $('#dispositivo').value.trim() || undefined;
}

async function registrarConsumo({ payload, code, clave }) {
  estado.procesando = true;
  const idempotencyKey = clave || claveIdempotencia('scan');
  const cuerpo = payload
    ? { payload, deviceLabel: puesto() }
    : { code, deviceLabel: puesto() };

  try {
    const respuesta = await api.post(payload ? '/api/scan' : '/api/scan/manual', cuerpo, { idempotencyKey });
    estado.pendiente = null;
    pitar(true);
    vibrar(60);
    mostrarResultado({
      tipo: 'ok',
      icono: '✅',
      titulo: 'Entrada registrada',
      detalle: `${respuesta.customer.fullName} · ${respuesta.pack.code}`,
      restantes: respuesta.remaining,
    });
    if (respuesta.remaining === 0) {
      brindis(`${respuesta.pack.code} quedó sin entradas. Ofrécele un pack nuevo.`, 'error', 7000);
    } else if (respuesta.remaining <= 2) {
      brindis(`A ${respuesta.customer.fullName} le quedan ${respuesta.remaining} entradas.`, 'error', 6000);
    }
    return respuesta;
  } catch (error) {
    pitar(false);
    vibrar([70, 50, 70]);

    if (error instanceof ErrorRed) {
      // La entrada puede haberse descontado o no: se guarda el intento con su
      // clave para poder reintentar sin riesgo de descontar dos veces.
      estado.pendiente = { payload, code, clave: idempotencyKey };
      mostrarResultado({
        tipo: 'alerta',
        icono: '📶',
        titulo: 'Sin conexión',
        detalle: 'No pudimos confirmar el registro. Reintenta cuando vuelva la señal: no se descontará dos veces.',
        acciones: el(
          'button',
          { class: 'boton boton--principal', type: 'button', onClick: () => reintentarPendiente() },
          'Reintentar',
        ),
      });
      return null;
    }

    const esEspera = error.codigo === 'espera_activa';
    mostrarResultado({
      tipo: esEspera ? 'alerta' : 'error',
      icono: esEspera ? '⏳' : '⛔',
      titulo: esEspera ? 'Ya se registró hace un momento' : 'No se pudo registrar',
      detalle: error.message,
      restantes: error.detalles?.pack?.remaining,
    });
    return null;
  } finally {
    estado.procesando = false;
  }
}

async function reintentarPendiente() {
  if (!estado.pendiente) return;
  const intento = estado.pendiente;
  mostrarResultado({ tipo: 'neutro', icono: '⏳', titulo: 'Reintentando…', detalle: 'Confirmando con el servidor.' });
  await registrarConsumo(intento);
}

// ---------------------------------------------------------------------------
// Cámara y lectura
// ---------------------------------------------------------------------------

async function listarCamaras() {
  try {
    const dispositivos = await navigator.mediaDevices.enumerateDevices();
    estado.camaras = dispositivos.filter((d) => d.kind === 'videoinput');
    $('#btn-cambiar-camara').hidden = estado.camaras.length < 2;
  } catch {
    estado.camaras = [];
  }
}

async function encenderCamara() {
  if (!navigator.mediaDevices?.getUserMedia) {
    mostrarAviso(
      $('#aviso'),
      'Este navegador no permite usar la cámara. Usa el código manual, o abre la página en Chrome o Safari sobre HTTPS.',
      'alerta',
    );
    return;
  }

  try {
    const restricciones = {
      audio: false,
      video: estado.camaras.length
        ? { deviceId: { exact: estado.camaras[estado.camaraIndice % estado.camaras.length].deviceId } }
        : { facingMode: { ideal: 'environment' } },
    };
    estado.flujo = await navigator.mediaDevices.getUserMedia(restricciones);
  } catch (error) {
    const mensajes = {
      NotAllowedError: 'Diste "bloquear" al permiso de cámara. Habilítalo en el candado de la barra de direcciones.',
      NotFoundError: 'No encontramos ninguna cámara en este dispositivo.',
      NotReadableError: 'Otra aplicación está usando la cámara. Ciérrala e inténtalo de nuevo.',
      SecurityError: 'El navegador exige HTTPS para usar la cámara. Usa el código manual mientras tanto.',
    };
    mostrarAviso($('#aviso'), mensajes[error.name] || `No se pudo abrir la cámara: ${error.message}`, 'alerta');
    return;
  }

  const video = $('#video');
  video.srcObject = estado.flujo;
  await video.play().catch(() => {});

  await listarCamaras();

  estado.camaraActiva = true;
  $('#escaner').hidden = false;
  $('#escaner-apagado').hidden = true;
  $('#btn-camara').textContent = 'Apagar cámara';
  mostrarAviso($('#aviso'), '');

  // BarcodeDetector es nativo y mucho más eficiente; jsQR es el respaldo.
  if (!estado.detector && 'BarcodeDetector' in window) {
    try {
      const formatos = await window.BarcodeDetector.getSupportedFormats();
      if (formatos.includes('qr_code')) {
        estado.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        estado.motor = 'nativo';
      }
    } catch {
      estado.detector = null;
    }
  }
  if (!estado.detector) estado.motor = typeof window.jsQR === 'function' ? 'jsQR' : null;

  const etiqueta = $('#etiqueta-motor');
  if (estado.motor) {
    etiqueta.hidden = false;
    etiqueta.textContent = estado.motor === 'nativo' ? 'Lector nativo' : 'Lector jsQR';
  } else {
    mostrarAviso($('#aviso'), 'No se pudo cargar el lector de códigos. Usa el ingreso manual.', 'alerta');
  }

  reposar();
  bucle = requestAnimationFrame(analizarCuadro);
}

function apagarCamara() {
  estado.camaraActiva = false;
  cancelAnimationFrame(bucle);
  bucle = null;
  for (const pista of estado.flujo?.getTracks() ?? []) pista.stop();
  estado.flujo = null;
  $('#video').srcObject = null;
  $('#escaner').hidden = true;
  $('#escaner-apagado').hidden = false;
  $('#btn-camara').textContent = 'Encender cámara';
}

let ultimoAnalisis = 0;
async function analizarCuadro(marca) {
  if (!estado.camaraActiva) return;
  bucle = requestAnimationFrame(analizarCuadro);

  // ~8 análisis por segundo: suficiente para que se sienta instantáneo sin
  // calentar el teléfono ni agotar la batería en una jornada de pista.
  if (marca - ultimoAnalisis < 120) return;
  ultimoAnalisis = marca;

  const video = $('#video');
  if (video.readyState !== video.HAVE_ENOUGH_DATA || estado.procesando) return;

  let texto = null;
  try {
    if (estado.detector) {
      const codigos = await estado.detector.detect(video);
      texto = codigos[0]?.rawValue ?? null;
    } else if (typeof window.jsQR === 'function') {
      lienzo ||= document.createElement('canvas');
      contexto ||= lienzo.getContext('2d', { willReadFrequently: true });
      // Se reduce la resolución analizada: jsQR es mucho más rápido así y el QR
      // sigue siendo perfectamente legible.
      const ancho = Math.min(video.videoWidth, 640);
      const alto = Math.round((ancho / video.videoWidth) * video.videoHeight);
      if (!ancho || !alto) return;
      lienzo.width = ancho;
      lienzo.height = alto;
      contexto.drawImage(video, 0, 0, ancho, alto);
      const imagen = contexto.getImageData(0, 0, ancho, alto);
      texto = window.jsQR(imagen.data, ancho, alto, { inversionAttempts: 'dontInvert' })?.data ?? null;
    }
  } catch {
    return;
  }

  if (!texto) return;

  // El mismo código no se reenvía en ráfaga mientras siga delante de la cámara.
  const ahora = Date.now();
  if (texto === estado.ultimoCodigo && ahora - estado.ultimoCodigoEn < ESPERA_MISMO_CODIGO_MS) return;
  estado.ultimoCodigo = texto;
  estado.ultimoCodigoEn = ahora;

  await registrarConsumo({ payload: texto });

  if (!$('#chk-continuo').checked) apagarCamara();
}

// ---------------------------------------------------------------------------
// Actividad
// ---------------------------------------------------------------------------

function filaActividad(item, nuevo = false) {
  const anulada = item.status === 'voided';
  return el(
    'li',
    { class: `lista__item ${nuevo ? 'lista__item--nuevo' : ''}` },
    el('span', { class: 'icono-lista--grande' }, anulada ? '↩️' : '✅'),
    el(
      'div',
      { class: 'crece' },
      el('div', {}, item.customerName || 'Cliente'),
      el(
        'div',
        { class: 'tenue-2 pequeno' },
        `${horaCorta(item.createdAt)} · ${item.packCode} · ${METODOS[item.method] || item.method}` +
          (item.deviceLabel ? ` · ${item.deviceLabel}` : ''),
      ),
    ),
    el('span', { class: `etiqueta ${item.remainingAfter === 0 ? 'etiqueta--error' : ''}` }, `Quedan ${item.remainingAfter}`),
  );
}

async function cargarActividad() {
  const contenedor = $('#actividad');
  try {
    const alcance = $('#chk-todos').checked ? '&scope=todos' : '';
    const { items } = await api.get(`/api/scan/history?limit=25${alcance}`);
    estado.actividad = items;
    if (items.length === 0) {
      render(contenedor, el('div', { class: 'vacio' }, el('div', { class: 'vacio__icono' }, '🕐'), el('p', { class: 'sin-margen' }, 'Sin escaneos todavía.')));
      return;
    }
    render(contenedor, el('ul', { class: 'lista' }, items.map((item) => filaActividad(item))));
  } catch (error) {
    render(contenedor, el('div', { class: 'aviso aviso--alerta' }, error.message));
  }
}

// ---------------------------------------------------------------------------
// Código manual
// ---------------------------------------------------------------------------

function montarManual() {
  const formulario = $('#form-manual');
  const entrada = $('#codigo-manual');

  // Da formato al código mientras se escribe: RHE-XXXX-XXXX.
  entrada.addEventListener('input', () => {
    const limpio = entrada.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const cuerpo = limpio.startsWith('RHE') ? limpio.slice(3) : limpio;
    let formateado = 'RHE';
    if (cuerpo.length) formateado += '-' + cuerpo.slice(0, 4);
    if (cuerpo.length > 4) formateado += '-' + cuerpo.slice(4, 8);
    entrada.value = cuerpo.length ? formateado : limpio;
  });

  $('#btn-consultar').addEventListener('click', async () => {
    const codigo = entrada.value.trim();
    if (!codigo) return;
    await conCarga($('#btn-consultar'), async () => {
      try {
        const datos = await api.get(`/api/scan/lookup/${encodeURIComponent(codigo)}`);
        mostrarResultado({
          tipo: datos.usable ? 'ok' : 'alerta',
          icono: datos.usable ? '🔎' : '⚠️',
          titulo: datos.customer?.fullName || 'Pack encontrado',
          detalle: `${datos.pack.code} · ${datos.message}`,
          restantes: datos.pack.remaining,
          acciones: datos.usable
            ? el(
                'button',
                {
                  class: 'boton boton--principal',
                  type: 'button',
                  onClick: async () => {
                    await registrarConsumo({ code: datos.pack.code });
                    entrada.value = '';
                  },
                },
                'Descontar una entrada',
              )
            : null,
        });
      } catch (error) {
        mostrarResultado({ tipo: 'error', icono: '⛔', titulo: 'No encontrado', detalle: error.message });
      }
    });
  });

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarErroresCampo(formulario, {});
    const codigo = entrada.value.trim();
    if (!codigo) {
      mostrarErroresCampo(formulario, { code: 'Ingresa el código del pack.' });
      return;
    }
    await conCarga(formulario.querySelector('button[type="submit"]'), async () => {
      const respuesta = await registrarConsumo({ code: codigo });
      if (respuesta) entrada.value = '';
    });
  });
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

(async () => {
  const sesion = await iniciarPagina({ rolesPermitidos: ['staff', 'master'] });
  if (!sesion) return;

  cabecera = montarCabecera($('#cabecera'));
  try {
    aplicarMarca(await fetch('/api/config').then((r) => r.json()));
  } catch {
    /* opcional */
  }

  $('#subtitulo').textContent = `Operador: ${getUsuario().fullName}`;

  // El nombre del puesto se recuerda en este dispositivo: no es información
  // sensible y ahorra escribirlo en cada turno.
  const puestoGuardado = localStorage.getItem(CLAVE_DISPOSITIVO);
  if (puestoGuardado) $('#dispositivo').value = puestoGuardado;
  $('#dispositivo').addEventListener('change', (evento) => {
    localStorage.setItem(CLAVE_DISPOSITIVO, evento.target.value.trim());
  });

  $('#btn-camara').addEventListener('click', () => (estado.camaraActiva ? apagarCamara() : encenderCamara()));
  $('#btn-cambiar-camara').addEventListener('click', async () => {
    estado.camaraIndice += 1;
    apagarCamara();
    await encenderCamara();
  });
  $('#btn-recargar').addEventListener('click', () => cargarActividad());
  $('#chk-todos').addEventListener('change', () => cargarActividad());

  montarManual();
  reposar();
  await cargarActividad();

  redirigirAlPerderSesion();

  const conexion = new ConexionEnVivo({
    onEstado: (nuevo) => {
      cabecera.actualizarEstado(nuevo);
      // Al recuperar la conexión, se reintenta lo que quedó pendiente.
      if (nuevo === 'conectado' && estado.pendiente) reintentarPendiente();
    },
    onEvento: (tipo, datos) => {
      if (tipo === 'entrada.consumida' || tipo === 'entrada.anulada') {
        const lista = $('#actividad ul');
        if (lista && tipo === 'entrada.consumida') {
          lista.prepend(
            filaActividad(
              {
                customerName: datos.owner.fullName,
                createdAt: datos.at,
                packCode: datos.pack.code,
                // El evento trae el método y el puesto reales: darlos por
                // supuestos hacía que un canje manual apareciera como "QR app".
                method: datos.method,
                deviceLabel: datos.deviceLabel,
                remainingAfter: datos.remaining,
                status: 'confirmed',
              },
              true,
            ),
          );
          while (lista.children.length > 25) lista.lastElementChild.remove();
        } else {
          cargarActividad();
        }
      }
    },
  }).iniciar();

  // Mantener la pantalla encendida durante el turno, si el navegador lo permite.
  let bloqueoPantalla = null;
  async function pedirBloqueo() {
    if (bloqueoPantalla) return;
    try {
      bloqueoPantalla = (await navigator.wakeLock?.request('screen')) ?? null;
      // El navegador lo libera solo al ocultar la pestaña. Sin marcarlo como
      // suelto, la comprobación de más abajo lo daría por vigente y la pantalla
      // volvería a apagarse sola durante el resto del turno.
      bloqueoPantalla?.addEventListener('release', () => {
        bloqueoPantalla = null;
      });
    } catch {
      bloqueoPantalla = null; // no soportado o denegado
    }
  }
  pedirBloqueo();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pedirBloqueo();
  });

  window.addEventListener('pagehide', () => {
    conexion.detener();
    apagarCamara();
  });
})();
