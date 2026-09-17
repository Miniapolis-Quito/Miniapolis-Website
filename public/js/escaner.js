/**
 * Puesto de control de acceso.
 *
 * Lee el QR con la API nativa `BarcodeDetector` cuando existe (más rápida y sin
 * coste de CPU) y con jsQR en cualquier otro navegador. Cada consumo lleva su
 * propia clave de idempotencia, de modo que un reintento tras un corte de red
 * nunca descuenta dos entradas.
 *
 * Si se cae la red, el puesto no se detiene: cada lectura se guarda en el
 * teléfono con su hora y su clave, y se cobra sola en cuanto vuelve la señal.
 * La página misma abre sin conexión gracias a un service worker, con el nombre
 * de quien trabajaba en ese teléfono.
 */
import { $, $$, el, render, icono, brindis, horaCorta, plural, METODOS, claveIdempotencia,
         mostrarAviso, mostrarErroresCampo, conCarga, vibrar } from './ui.js';
import { api, iniciarPagina, getUsuario, redirigirAlPerderSesion, ErrorRed, estaAutenticado,
         refrescarSesion, onSesion, usarSesionSinConexion } from './api.js';
import { ConexionEnVivo } from './realtime.js';
import { montarCabecera, aplicarMarca } from './shell.js';
import { AlmacenLecturas, ColaSinConexion } from './cola-sin-conexion.js';

const CLAVE_DISPOSITIVO = 'rh_puesto';
const ESPERA_MISMO_CODIGO_MS = 2500;

/** Lo que se espera a la red en la puerta antes de guardar la lectura para después. */
const ESPERA_EN_LINEA_MS = 6000;
/** Plazo de cada lectura guardada al enviarse. */
const ESPERA_ENVIO_MS = 10_000;
/** Cada cuánto se comprueba si volvió la red mientras no hay conexión. */
const SONDEO_MS = 10_000;
/** Cada cuánto se reintenta enviar lo guardado cuando sí hay conexión. */
const REENVIO_MS = 20_000;

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
  pendiente: null, // consumo que falló por red y se puede reintentar (modo sin conexión apagado)
  actividad: [],
  /** Configuración del servidor, o la última conocida si se arrancó sin red. */
  config: null,
  /** La red está caída: las lecturas se guardan sin esperar a que falle otra petición. */
  sinConexion: false,
  /** La página arrancó sin red y todavía no tiene sesión de verdad. */
  arranqueSinConexion: false,
  /** Hora del servidor menos la del teléfono, medida la última vez que hubo red. */
  desfaseMs: null,
  cantidadSeleccionada: 1,
};

let cabecera;
let bucle = null;
let lienzo = null;
let contexto = null;

const almacen = new AlmacenLecturas();
const cola = new ColaSinConexion({
  almacen,
  enviar: (ruta, cuerpo, clave) => api.post(ruta, cuerpo, { idempotencyKey: clave, señal: conPlazo(ESPERA_ENVIO_MS) }),
});

/** Señal que aborta una petición pasado un plazo. */
function conPlazo(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controlador = new AbortController();
  setTimeout(() => controlador.abort(new DOMException('Tiempo agotado', 'TimeoutError')), ms);
  return controlador.signal;
}

/** ¿El fallo significa que no se sabe si la petición llegó? */
function esFalloDeRed(error) {
  return error instanceof ErrorRed || error?.name === 'TimeoutError' || error?.name === 'AbortError';
}

function modoSinConexion() {
  return Boolean(estado.config?.offlineScan?.enabled);
}

// ---------------------------------------------------------------------------
// Sonido de confirmación (generado, sin archivos externos)
// ---------------------------------------------------------------------------

let audio = null;
function pitar(tipo, cantidad = 1) {
  if (!$('#chk-sonido').checked) return;
  const tonos =
    tipo === 'guardada'
      ? [{ frecuencia: 660, duracion: 0.09, retraso: 0 }, { frecuencia: 660, duracion: 0.09, retraso: 0.15 }]
      : !tipo
        ? [{ frecuencia: 240, duracion: 0.34, retraso: 0 }]
        : cantidad > 1
          ? [{ frecuencia: 880, duracion: 0.15, retraso: 0 }, { frecuencia: 1174, duracion: 0.16, retraso: 0.12 }]
          : [{ frecuencia: 880, duracion: 0.16, retraso: 0 }];
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    for (const { frecuencia, duracion, retraso } of tonos) {
      const inicio = audio.currentTime + retraso;
      const oscilador = audio.createOscillator();
      const ganancia = audio.createGain();
      oscilador.connect(ganancia);
      ganancia.connect(audio.destination);
      oscilador.type = 'sine';
      oscilador.frequency.value = frecuencia;
      ganancia.gain.setValueAtTime(0.0001, inicio);
      ganancia.gain.exponentialRampToValueAtTime(0.18, inicio + 0.01);
      ganancia.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);
      oscilador.start(inicio);
      oscilador.stop(inicio + duracion + 0.02);
    }
  } catch {
    /* el sonido es un extra: si el navegador lo bloquea, no pasa nada */
  }
}

// ---------------------------------------------------------------------------
// Panel de resultado
// ---------------------------------------------------------------------------

function mostrarResultado({ tipo, icono: nombreIcono, titulo, detalle, restantes, acciones }) {
  const nodo = $('#resultado');
  nodo.className = `resultado resultado--${tipo}`;
  render(
    nodo,
    el('div', { class: 'resultado__icono' }, nombreIcono ? icono(nombreIcono, { grande: true }) : null),
    restantes !== undefined && restantes !== null ? el('div', { class: 'resultado__restantes' }, String(restantes)) : null,
    restantes !== undefined && restantes !== null ? el('div', { class: 'tenue pequeno' }, 'entradas restantes') : null,
    el('div', { class: 'resultado__titulo' }, titulo),
    detalle ? el('div', { class: 'resultado__detalle' }, detalle) : null,
    acciones ? el('div', { class: 'fila mt centro-flex' }, acciones) : null,
  );

  // Un destello del color del estado recorre el panel. El contenido se vuelve
  // a crear en cada lectura, así que sus animaciones arrancan solas; el panel
  // no, porque el nodo es el mismo: hay que reiniciarla a mano o dos lecturas
  // seguidas del mismo tipo no destellarían.
  nodo.classList.remove('resultado--destello');
  void nodo.offsetWidth;
  nodo.classList.add('resultado--destello');

  const mira = $('#mira');
  mira.classList.remove('escaner__mira--ok', 'escaner__mira--error');
  if (tipo === 'ok' || tipo === 'guardada') mira.classList.add('escaner__mira--ok');
  if (tipo === 'error') mira.classList.add('escaner__mira--error');
  setTimeout(() => mira.classList.remove('escaner__mira--ok', 'escaner__mira--error'), 1400);
}

function reposar() {
  mostrarResultado({
    tipo: 'neutro',
    icono: 'bandera',
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

/**
 * Registra un consumo. `clave`, `deviceLabel` y `cantidad` solo llegan en un reintento.
 *
 * Con el modo sin conexión, la lectura se guarda en vez de intentarse si ya se
 * sabe que no hay red, y también si el intento en línea falla por red: con la
 * misma clave, así que si el servidor llegó a cobrarla, al enviarla recibe la
 * respuesta original en lugar de descontar otra vez.
 */
async function registrarConsumo({ payload, code, clave, deviceLabel, cantidad }) {
  const capturadaEn = Date.now();
  const idempotencyKey = clave || claveIdempotencia('scan');
  const puestoUsado = deviceLabel ?? puesto();
  const cant = cantidad ?? estado.cantidadSeleccionada ?? 1;

  if (modoSinConexion() && !clave && (estado.sinConexion || !estaAutenticado() || navigator.onLine === false)) {
    return guardarSinConexion({ payload, code, clave: idempotencyKey, capturadaEn, puesto: puestoUsado, cantidad: cant });
  }

  estado.procesando = true;
  const cuerpo = payload
    ? { payload, deviceLabel: puestoUsado, quantity: cant }
    : { code, deviceLabel: puestoUsado, quantity: cant };

  try {
    const respuesta = await api.post(payload ? '/api/scan' : '/api/scan/manual', cuerpo, {
      idempotencyKey,
      // En la puerta no se espera a una red que no contesta: pasado el plazo,
      // la lectura se guarda y el cliente pasa.
      señal: modoSinConexion() ? conPlazo(ESPERA_EN_LINEA_MS) : undefined,
    });
    estado.pendiente = null;
    marcarEnLinea();
    pitar(true, cant);
    vibrar(cant > 1 ? [60, 40, 60] : 60);
    const titulo = cant > 1 ? `${cant} entradas registradas` : 'Entrada registrada';
    mostrarResultado({
      tipo: 'ok',
      icono: 'ok',
      titulo,
      detalle: `${respuesta.customer.fullName} · ${respuesta.pack.code}`,
      restantes: respuesta.remaining,
    });
    if (respuesta.remaining === 0) {
      brindis(`${respuesta.pack.code} quedó sin entradas. Ofrécele un pack nuevo.`, 'error', 7000);
    } else if (respuesta.remaining <= 2) {
      // Aviso, no error: al cliente le queda saldo; es el momento de ofrecerle
      // otro pack, no de alarmar a quien está en la puerta.
      brindis(`A ${respuesta.customer.fullName} le quedan ${respuesta.remaining} entradas.`, 'alerta', 6000);
    }
    return respuesta;
  } catch (error) {
    if (modoSinConexion() && esFalloDeRed(error)) {
      marcarSinConexion();
      return guardarSinConexion({ payload, code, clave: idempotencyKey, capturadaEn, puesto: puestoUsado, cantidad: cant });
    }

    pitar(false);
    vibrar([70, 50, 70]);

    if (error instanceof ErrorRed) {
      // La entrada puede haberse descontado o no: se guarda el intento con su
      // clave para poder reintentar sin riesgo de descontar dos veces.
      estado.pendiente = { payload, code, clave: idempotencyKey, deviceLabel: puestoUsado, cantidad: cant };
      mostrarResultado({
        tipo: 'alerta',
        icono: 'senal',
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
      icono: esEspera ? 'reloj' : 'prohibido',
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
  mostrarResultado({ tipo: 'neutro', icono: 'reloj', titulo: 'Reintentando…', detalle: 'Confirmando con el servidor.' });
  await registrarConsumo(intento);
}

// ---------------------------------------------------------------------------
// Sin conexión
// ---------------------------------------------------------------------------

let avisoNoPersistente = false;

/** Guarda una lectura para cobrarla al volver la señal y se lo dice al operador. */
function guardarSinConexion({ payload, code, clave, capturadaEn, puesto: puestoUsado, cantidad }) {
  const usuario = getUsuario();
  if (!usuario) return null; // la sesión se perdió: la página ya va hacia el acceso
  const resultado = cola.guardar(
    { tipo: payload ? 'qr' : 'codigo', payload, code, clave, capturadaEn, puesto: puestoUsado, operador: usuario, quantity: cantidad ?? 1 },
    {
      desfaseMs: estado.desfaseMs,
      ttlSeconds: estado.config.qr?.ttlSeconds ?? 120,
      cooldownSeconds: estado.config.offlineScan.cooldownSeconds ?? 0,
    },
  );

  if (!resultado.ok) {
    if (resultado.tono !== 'neutro') {
      pitar(false);
      vibrar([70, 50, 70]);
    }
    mostrarResultado({
      tipo: resultado.tono === 'neutro' ? 'neutro' : resultado.tono,
      icono: resultado.tono === 'alerta' ? 'reloj' : resultado.tono === 'neutro' ? 'descarga' : 'prohibido',
      titulo: resultado.tono === 'neutro' ? 'Ya estaba guardada' : 'No se guardó',
      detalle: resultado.mensaje,
    });
    return null;
  }

  pitar('guardada');
  vibrar([40, 50, 40]);
  // El nombre solo se conoce si este puesto vio ese pack hoy: el teléfono no
  // guarda datos de clientes, y sin red no hay a quién preguntar.
  const conocido = estado.actividad.find((item) => item.packCode === resultado.lectura.codigo)?.customerName;
  mostrarResultado({
    tipo: 'guardada',
    icono: 'descarga',
    titulo: 'Guardada sin conexión',
    detalle:
      `${resultado.lectura.codigo}${conocido ? ` · ${conocido}` : ''}. ` +
      'Puede pasar: la entrada se cobrará sola cuando vuelva la señal.',
  });
  if (!resultado.persistente && !avisoNoPersistente) {
    avisoNoPersistente = true;
    brindis('Este navegador no deja guardar datos: no cierres esta pestaña hasta que vuelva la señal.', 'alerta', 9000);
  }
  pintarSinConexion();
  return { guardada: true, lectura: resultado.lectura };
}

function marcarSinConexion() {
  if (!modoSinConexion()) return;
  if (!estado.sinConexion) {
    estado.sinConexion = true;
    pintarSinConexion();
  }
  programarSondeo();
}

function marcarEnLinea() {
  if (!estado.sinConexion) return;
  estado.sinConexion = false;
  clearTimeout(temporizadorSondeo);
  pintarSinConexion();
}

/**
 * Pregunta al servidor si está ahí y, de paso, mide la diferencia entre su
 * reloj y el de este teléfono. Con esa diferencia el teléfono sabe, sin red, si
 * un QR ya venció: el QR lleva la hora del servidor.
 */
async function medirServidor() {
  const antes = Date.now();
  try {
    const respuesta = await fetch('/api/health', { cache: 'no-store', signal: conPlazo(4000) });
    if (!respuesta.ok) return false;
    const { time } = await respuesta.json();
    const desfase = Date.parse(time) - (antes + Date.now()) / 2;
    if (Number.isFinite(desfase)) {
      estado.desfaseMs = desfase;
      almacen.recordar('desfase', desfase);
    }
    // Con sesión y servidor a la vista, la identidad para abrir sin red está al
    // día: el plazo cuenta desde la última vez que se supo que era válida.
    if (estaAutenticado()) recordarOperador();
    return true;
  } catch {
    return false;
  }
}

let temporizadorSondeo = null;
function programarSondeo(ms = SONDEO_MS) {
  clearTimeout(temporizadorSondeo);
  temporizadorSondeo = setTimeout(() => sondear(), ms);
}

let sondeando = false;
async function sondear() {
  if (sondeando || !modoSinConexion()) return;
  sondeando = true;
  clearTimeout(temporizadorSondeo);
  try {
    if (!(await medirServidor())) {
      marcarSinConexion();
      return;
    }
    if (!estaAutenticado()) {
      try {
        await refrescarSesion();
      } catch (error) {
        // Sin red todavía, se sigue esperando. Si la sesión ya no vale, el
        // vigilante de sesión lleva a la página de acceso; las lecturas se
        // quedan en el teléfono hasta que esa persona vuelva a entrar.
        if (error instanceof ErrorRed) marcarSinConexion();
        return;
      }
    }
    marcarEnLinea();
    await enviarGuardadas();
  } finally {
    sondeando = false;
  }
}

/** Envía lo que este operador dejó guardado y cuenta el resultado. */
async function enviarGuardadas() {
  const usuario = getUsuario();
  if (!usuario || !estaAutenticado() || !modoSinConexion()) return;
  if (cola.resumen(usuario.id).pendientes.length === 0) {
    pintarSinConexion();
    return;
  }

  const resultado = await cola.enviarPendientes(usuario.id);
  if (resultado.ocupada) return;

  if (resultado.confirmadas.length) {
    marcarEnLinea();
    brindis(
      `${plural(resultado.confirmadas.length, 'entrada guardada sin conexión ya se cobró', 'entradas guardadas sin conexión ya se cobraron')}.`,
      'ok',
      6000,
    );
    cargarActividad();
  }
  if (resultado.rechazadas.length) {
    pitar(false);
    vibrar([120, 60, 120]);
    brindis(
      `${plural(resultado.rechazadas.length, 'entrada guardada no se pudo cobrar', 'entradas guardadas no se pudieron cobrar')}. ` +
        'Revísalas en «Guardadas sin conexión» y avisa en recepción.',
      'error',
      10_000,
    );
  }
  if (resultado.detenidaPor === 'reintentar') marcarSinConexion();
  pintarSinConexion();
}

const horaDe = (ms) => horaCorta(new Date(ms).toISOString());

function filaGuardada(lectura) {
  const via = lectura.tipo === 'qr' ? 'QR' : 'Código manual';
  return el(
    'li',
    { class: 'lista__item' },
    el('span', { class: 'icono-lista--grande' }, icono('descarga')),
    el(
      'div',
      { class: 'crece' },
      el('div', { class: 'mono' }, lectura.codigo),
      el('div', { class: 'tenue-2 pequeno' }, [horaDe(lectura.capturadaEn), via, lectura.puesto].filter(Boolean).join(' · ')),
    ),
    el('span', { class: 'etiqueta etiqueta--alerta' }, 'Por cobrar'),
  );
}

function filaRechazada(lectura) {
  return el(
    'li',
    { class: 'lista__item lista__item--rechazada' },
    el('span', { class: 'icono-lista--grande' }, icono('prohibido')),
    el(
      'div',
      { class: 'crece' },
      el('div', {}, `No se cobró: `, el('span', { class: 'mono' }, lectura.codigo)),
      el('div', { class: 'pequeno' }, lectura.mensaje || 'El servidor rechazó la lectura.'),
      el(
        'div',
        { class: 'tenue-2 pequeno' },
        [`Leída a las ${horaDe(lectura.capturadaEn)}`, lectura.puesto].filter(Boolean).join(' · '),
      ),
    ),
    el(
      'button',
      {
        class: 'boton boton--chico boton--fantasma',
        type: 'button',
        onClick: () => {
          cola.descartar(lectura.id);
          pintarSinConexion();
        },
      },
      'Entendido',
    ),
  );
}

/** Aviso de modo sin conexión y tarjeta con lo que está guardado en el teléfono. */
function pintarSinConexion() {
  $('#estado-sin-conexion').hidden = !(modoSinConexion() && estado.sinConexion);

  const { pendientes, rechazadas, ajenas, nombresAjenos } = cola.resumen(getUsuario()?.id);
  const tarjeta = $('#tarjeta-sin-conexion');
  tarjeta.hidden = pendientes.length + rechazadas.length + ajenas.length === 0;
  if (tarjeta.hidden) return;

  const partes = [];
  if (pendientes.length) partes.push(`${pendientes.length} por cobrar`);
  if (rechazadas.length) partes.push(`${rechazadas.length} por revisar`);
  $('#contador-sin-conexion').textContent = partes.join(' · ') || 'De otro operador';
  $('#contador-sin-conexion').className = `etiqueta ${rechazadas.length ? 'etiqueta--error' : 'etiqueta--alerta'}`;
  $('#btn-enviar-guardadas').hidden = pendientes.length === 0;

  render(
    $('#lista-sin-conexion'),
    almacen.persistente
      ? null
      : el(
          'div',
          { class: 'aviso aviso--alerta' },
          'Este navegador no deja guardar datos: si se cierra la pestaña antes de que vuelva la señal, estas lecturas se pierden.',
        ),
    rechazadas.length
      ? el(
          'div',
          {},
          el('p', { class: 'tenue pequeno sin-margen' }, 'Estas personas entraron y su entrada no se pudo cobrar. Administración ya lo ve en su resumen.'),
          el('ul', { class: 'lista' }, rechazadas.map(filaRechazada)),
        )
      : null,
    pendientes.length ? el('ul', { class: 'lista' }, pendientes.map(filaGuardada)) : null,
    ajenas.length
      ? el(
          'p',
          { class: 'tenue pequeno' },
          `${plural(ajenas.length, 'lectura', 'lecturas')} de ${nombresAjenos.join(', ')} ` +
            `${ajenas.length === 1 ? 'espera' : 'esperan'} a que esa persona entre en este teléfono para enviarse.`,
        )
      : null,
  );
}

/** Quién trabaja en este teléfono, para poder abrir el escáner sin red. */
function recordarOperador() {
  const usuario = getUsuario();
  if (!usuario) return;
  almacen.recordar('operador', {
    usuario: { id: usuario.id, fullName: usuario.fullName, email: usuario.email, role: usuario.role },
    guardadoEn: Date.now(),
  });
}

/**
 * Sesión con la que abrir el escáner sin red: la de la última persona que
 * trabajó en este teléfono, si no salió con «Salir» y no pasó más tiempo del
 * que el servidor aceptaría para una lectura guardada.
 */
function sesionSinConexion() {
  const operador = almacen.recuperar('operador');
  const configuracion = almacen.recuperar('config');
  if (!operador?.usuario?.id || !configuracion?.offlineScan?.enabled) return null;
  if (!['staff', 'master'].includes(operador.usuario.role)) return null;
  if (Date.now() - operador.guardadoEn > configuracion.offlineScan.maxAgeSeconds * 1000) return null;
  usarSesionSinConexion(operador.usuario);
  return { user: operador.usuario, sinConexion: true };
}

function mostrarSinSesionGuardada() {
  montarCabecera($('#cabecera')).actualizarEstado('desconectado');
  render(
    $('main'),
    el(
      'section',
      { class: 'tarjeta mt-2' },
      el('h1', {}, 'Sin conexión'),
      el(
        'p',
        { class: 'tenue' },
        'No hay conexión con el servidor y este teléfono no tiene una sesión reciente para trabajar sin ella. ' +
          'Abre el escáner con señal al menos una vez al empezar el turno y podrás seguir escaneando aunque se caiga.',
      ),
      el('button', { class: 'boton boton--principal', type: 'button', onClick: () => window.location.reload() }, 'Reintentar'),
    ),
  );
}

/**
 * Registra (o retira) el service worker que permite abrir el escáner sin red.
 * Se retira si el modo está apagado, para no dejar una copia de la página que
 * ya no tiene sentido.
 */
function prepararServiceWorker() {
  if (!('serviceWorker' in navigator) || !estado.config) return;
  if (modoSinConexion()) {
    navigator.serviceWorker.register('/sw-escaner.js', { scope: '/escanear' }).catch(() => {});
  } else {
    navigator.serviceWorker
      .getRegistration('/escanear')
      .then((registro) => registro?.unregister())
      .then(() => globalThis.caches?.keys())
      .then((nombres) => Promise.all((nombres ?? []).filter((n) => n.startsWith('rh-escaner-')).map((n) => caches.delete(n))))
      .catch(() => {});
  }
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
    el('span', { class: 'icono-lista--grande' }, icono(anulada ? 'devolver' : 'ok')),
    el(
      'div',
      { class: 'crece' },
      el('div', {}, item.customerName || 'Cliente'),
      el(
        'div',
        { class: 'tenue-2 pequeno' },
        `${horaCorta(item.createdAt)} · ${item.packCode} · ${METODOS[item.method] || item.method}` +
          (item.deviceLabel ? ` · ${item.deviceLabel}` : '') +
          // Una entrada guardada sin conexión muestra la hora en que se leyó;
          // se indica para que no parezca que se cobró fuera de orden.
          (item.syncedAt ? ` · sin conexión, cobrada a las ${horaCorta(item.syncedAt)}` : ''),
      ),
    ),
    item.quantity > 1 ? el('span', { class: 'etiqueta etiqueta--info' }, `${item.quantity} entradas`) : null,
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
      render(
        contenedor,
        el(
          'div',
          { class: 'vacio' },
          el('div', { class: 'vacio__icono' }, icono('reloj', { grande: true })),
          el('p', { class: 'sin-margen' }, 'Sin escaneos todavía.'),
        ),
      );
      return;
    }
    render(contenedor, el('ul', { class: 'lista' }, items.map((item) => filaActividad(item))));
  } catch (error) {
    if (esFalloDeRed(error) && estado.actividad.length) return; // se conserva lo último que se vio
    render(contenedor, el('div', { class: 'aviso aviso--alerta' }, error.message));
  }
}

// ---------------------------------------------------------------------------
// Selector de cantidad (modo individual / grupo)
// ---------------------------------------------------------------------------

function montarSelectorCantidad() {
  const botones = $$('.btn-cantidad');
  const indicador = $('#indicador-modo-grupo');
  const btnManual = $('#btn-descontar-manual');

  botones.forEach((btn) => {
    btn.addEventListener('click', () => {
      botones.forEach((b) => b.classList.remove('activo'));
      btn.classList.add('activo');
      estado.cantidadSeleccionada = Number(btn.dataset.cantidad) || 1;
      const cant = estado.cantidadSeleccionada;
      if (indicador) {
        indicador.hidden = cant <= 1;
        if (cant > 1) {
          indicador.textContent = `Grupo: ${cant}`;
        }
      }
      if (btnManual) {
        btnManual.textContent = cant > 1 ? `Descontar ${cant} entradas` : 'Descontar entrada';
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Código manual
// ---------------------------------------------------------------------------

function mostrarConsultaSinConexion() {
  mostrarResultado({
    tipo: 'alerta',
    icono: 'senal',
    titulo: 'Sin conexión',
    detalle:
      'Sin red no se puede consultar el saldo. Si el cliente tiene que entrar, usa «Descontar entrada»: ' +
      'se guardará y se cobrará al volver la señal.',
  });
}

function montarManual() {
  const formulario = $('#form-manual');
  const entrada = $('#codigo-manual');

  /**
   * Da formato al código mientras se escribe: RHE-XXXX-XXXX.
   *
   * El prefijo no se añade solo: si se antepusiera al primer carácter, quien
   * teclee el código completo ("RHE-...") acabaría escribiendo su prefijo
   * dentro del cuerpo. Se agrupa lo que hay, con prefijo o sin él —el servidor
   * acepta las dos formas— y así lo que se ve es siempre lo que se tecleó.
   */
  function formatearCodigo(valor) {
    const limpio = valor.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const conPrefijo = limpio.startsWith('RHE');
    const cuerpo = (conPrefijo ? limpio.slice(3) : limpio).slice(0, 8);
    let formateado = conPrefijo ? 'RHE' : '';
    if (cuerpo.length) formateado += (conPrefijo ? '-' : '') + cuerpo.slice(0, 4);
    if (cuerpo.length > 4) formateado += '-' + cuerpo.slice(4);
    return formateado;
  }

  entrada.addEventListener('input', () => {
    // Reescribir el valor lleva el cursor al final, así que solo se da formato
    // cuando ya se está escribiendo ahí; corrigiendo en medio, no se estorba.
    const alFinal = entrada.selectionStart === entrada.value.length;
    const formateado = formatearCodigo(entrada.value);
    if (!alFinal || formateado === entrada.value) return;
    entrada.value = formateado;
  });

  $('#btn-consultar').addEventListener('click', async () => {
    const codigo = entrada.value.trim();
    if (!codigo) return;
    if (modoSinConexion() && (estado.sinConexion || !estaAutenticado())) {
      mostrarConsultaSinConexion();
      return;
    }
    await conCarga($('#btn-consultar'), async () => {
      try {
        const datos = await api.get(`/api/scan/lookup/${encodeURIComponent(codigo)}`, {
          señal: modoSinConexion() ? conPlazo(ESPERA_EN_LINEA_MS) : undefined,
        });
        marcarEnLinea();
        mostrarResultado({
          tipo: datos.usable ? 'ok' : 'alerta',
          icono: datos.usable ? 'buscar' : 'aviso',
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
                estado.cantidadSeleccionada > 1 ? `Descontar ${estado.cantidadSeleccionada} entradas` : 'Descontar entrada',
              )
            : null,
        });
      } catch (error) {
        if (modoSinConexion() && esFalloDeRed(error)) {
          marcarSinConexion();
          mostrarConsultaSinConexion();
          return;
        }
        mostrarResultado({ tipo: 'error', icono: 'prohibido', titulo: 'No encontrado', detalle: error.message });
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
    await conCarga($('#btn-descontar-manual'), async () => {
      const respuesta = await registrarConsumo({ code: codigo });
      if (respuesta) entrada.value = '';
    });
  });
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

/**
 * La página arrancó sin red y acaba de conseguir una sesión de verdad: se
 * completa lo que el arranque no pudo hacer y se envía lo guardado.
 */
async function alRecuperarSesion() {
  recordarOperador();
  cabecera = montarCabecera($('#cabecera'));
  $('#subtitulo').textContent = `Operador: ${getUsuario().fullName}`;
  marcarEnLinea();
  await cargarActividad();
  await enviarGuardadas();
}

(async () => {
  let sesion;
  try {
    sesion = await iniciarPagina({ rolesPermitidos: ['staff', 'master'] });
  } catch (error) {
    if (!(error instanceof ErrorRed)) throw error;
    sesion = sesionSinConexion();
    if (!sesion) {
      mostrarSinSesionGuardada();
      return;
    }
  }
  if (!sesion) return;
  estado.arranqueSinConexion = Boolean(sesion.sinConexion);

  // Sin red se trabaja con la última configuración conocida: es la que dice si
  // hay modo sin conexión y cuánto vale un QR.
  try {
    const respuesta = await fetch('/api/config');
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    estado.config = await respuesta.json();
    almacen.recordar('config', estado.config);
  } catch {
    estado.config = almacen.recuperar('config');
  }
  estado.desfaseMs = almacen.recuperar('desfase');

  cabecera = montarCabecera($('#cabecera'));
  if (estado.config) aplicarMarca(estado.config);

  $('#subtitulo').textContent = `Operador: ${getUsuario().fullName}`;

  // El nombre del puesto se recuerda en este dispositivo: no es información
  // sensible y ahorra escribirlo en cada turno. Si el navegador tiene el
  // almacenamiento bloqueado, acceder a él lanza: recordar el puesto es una
  // comodidad y no puede llevarse por delante el escáner entero.
  const recordado = (() => {
    try {
      return localStorage.getItem(CLAVE_DISPOSITIVO);
    } catch {
      return null;
    }
  })();
  if (recordado) $('#dispositivo').value = recordado;
  $('#dispositivo').addEventListener('change', (evento) => {
    try {
      localStorage.setItem(CLAVE_DISPOSITIVO, evento.target.value.trim());
    } catch {
      /* sin almacenamiento: el puesto solo dura lo que dure la pestaña */
    }
  });

  $('#btn-camara').addEventListener('click', () => (estado.camaraActiva ? apagarCamara() : encenderCamara()));
  $('#btn-cambiar-camara').addEventListener('click', async () => {
    estado.camaraIndice += 1;
    apagarCamara();
    await encenderCamara();
  });
  $('#btn-recargar').addEventListener('click', () => cargarActividad());
  $('#chk-todos').addEventListener('change', () => cargarActividad());
  $('#btn-enviar-guardadas').addEventListener('click', () =>
    conCarga($('#btn-enviar-guardadas'), async () => {
      await sondear();
      if (estado.sinConexion) brindis('Todavía no hay conexión. Se enviarán solas en cuanto vuelva.', 'alerta');
    }),
  );

  montarSelectorCantidad();
  montarManual();
  reposar();

  // Al cerrar o perder la sesión, api.js olvida la identidad con que se abre
  // sin red. Las lecturas guardadas no se borran: siguen siendo entradas por
  // cobrar, y se enviarán cuando esa persona vuelva a entrar.
  onSesion((usuario) => {
    if (usuario && estado.arranqueSinConexion && estaAutenticado()) {
      estado.arranqueSinConexion = false;
      alRecuperarSesion();
    }
  });

  prepararServiceWorker();
  pintarSinConexion();

  if (sesion.sinConexion) {
    marcarSinConexion();
    render(
      $('#actividad'),
      el(
        'div',
        { class: 'vacio' },
        el('div', { class: 'vacio__icono' }, icono('senal', { grande: true })),
        el('p', { class: 'sin-margen' }, 'La actividad se verá cuando vuelva la señal.'),
      ),
    );
  } else {
    recordarOperador();
    await cargarActividad();
    medirServidor();
    enviarGuardadas();
  }

  redirigirAlPerderSesion();

  window.addEventListener('online', () => sondear());
  window.addEventListener('offline', () => marcarSinConexion());
  // Otra pestaña del mismo teléfono guardó o envió lecturas.
  window.addEventListener('storage', (evento) => {
    if (AlmacenLecturas.esClaveDeLectura(evento.key)) pintarSinConexion();
  });
  setInterval(() => {
    if (!estado.sinConexion) enviarGuardadas();
  }, REENVIO_MS);

  const conexion = new ConexionEnVivo({
    onEstado: (nuevo) => {
      cabecera.actualizarEstado(nuevo);
      if (nuevo === 'conectado') {
        marcarEnLinea();
        enviarGuardadas();
        // Al recuperar la conexión, se reintenta lo que quedó pendiente.
        if (estado.pendiente) reintentarPendiente();
      }
    },
    onEvento: (tipo, datos) => {
      if (tipo === 'entrada.consumida' || tipo === 'entrada.anulada') {
        const lista = $('#actividad ul');
        if (lista && tipo === 'entrada.consumida') {
          const item = {
            customerName: datos.owner.fullName,
            createdAt: datos.at,
            packCode: datos.pack.code,
            // El evento trae el método y el puesto reales: darlos por
            // supuestos hacía que un canje manual apareciera como "QR app".
            method: datos.method,
            deviceLabel: datos.deviceLabel,
            quantity: datos.quantity ?? 1,
            remainingAfter: datos.remaining,
            syncedAt: datos.syncedAt,
            status: 'confirmed',
          };
          estado.actividad.unshift(item);
          lista.prepend(filaActividad(item, true));
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
