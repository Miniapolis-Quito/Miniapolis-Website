/** Utilidades de interfaz compartidas por todas las páginas. */

// Silenciar abortos benignos de ViewTransition del navegador en redirecciones o navegaciones rápidas
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    if (event?.message && /ViewTransition/i.test(event.message)) {
      event.preventDefault();
    }
  });
  window.addEventListener('unhandledrejection', (event) => {
    const msg = String(event?.reason?.message || event?.reason || '');
    if (/ViewTransition/i.test(msg)) {
      event.preventDefault();
    }
  });
}

/**
 * Aplica estilos usando el modelo de objetos CSS en vez del atributo `style`.
 * La política de seguridad de contenido prohíbe `style="..."`, pero sí permite
 * escribir propiedades desde JavaScript, que es lo que se hace aquí. Solo se
 * usa para valores calculados (anchos de barra, alturas de gráfico); todo lo
 * estático vive en la hoja de estilos.
 */
function aplicarEstilo(nodo, estilo) {
  if (!estilo) return;
  if (typeof estilo === 'object') {
    for (const [propiedad, valor] of Object.entries(estilo)) {
      nodo.style.setProperty(propiedad, String(valor));
    }
    return;
  }
  for (const declaracion of String(estilo).split(';')) {
    const corte = declaracion.indexOf(':');
    if (corte === -1) continue;
    const propiedad = declaracion.slice(0, corte).trim();
    const valor = declaracion.slice(corte + 1).trim();
    if (propiedad) nodo.style.setProperty(propiedad, valor);
  }
}

/** Crea un elemento con atributos e hijos. Los textos se insertan como texto,
 *  nunca como HTML, así que ningún dato del servidor puede inyectar marcado. */
export function el(etiqueta, atributos = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (clave === 'class') nodo.className = valor;
    else if (clave === 'dataset') Object.assign(nodo.dataset, valor);
    else if (clave === 'style') aplicarEstilo(nodo, valor);
    else if (clave.startsWith('on') && typeof valor === 'function') {
      nodo.addEventListener(clave.slice(2).toLowerCase(), valor);
    } else if (clave === 'html') nodo.innerHTML = valor; // solo para marcado propio (SVG del QR)
    else if (valor === true) nodo.setAttribute(clave, '');
    else nodo.setAttribute(clave, String(valor));
  }
  for (const hijo of hijos.flat(Infinity)) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    nodo.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return nodo;
}

/**
 * Bloque de espera: unas barras del alto de una fila que laten mientras llega
 * la respuesta del servidor. Sin esto, una tabla aparece de golpe y la página
 * pega un salto; con esto se ve desde el principio cuánto va a ocupar.
 *
 * Es decorativo: lleva `aria-hidden` porque quien usa un lector de pantalla ya
 * sabe que la página está cargando por el propio flujo de la aplicación.
 */
export function esqueleto(filas = 4) {
  return el(
    'div',
    { class: 'esqueleto', 'aria-hidden': 'true' },
    Array.from({ length: filas }, () => el('div', { class: 'esqueleto__linea' })),
  );
}

export const $ = (selector, raiz = document) => raiz.querySelector(selector);
export const $$ = (selector, raiz = document) => [...raiz.querySelectorAll(selector)];

// ---------------------------------------------------------------------------
// Iconografía
// ---------------------------------------------------------------------------

/**
 * Iconos propios, de un solo trazo, dibujados sobre una retícula de 24×24.
 *
 * Antes se usaban emojis. Cada sistema operativo los dibuja a su manera —con
 * su color, su grosor y su estilo—, así que la misma pantalla se veía distinta
 * en cada teléfono y ninguno combinaba con la identidad de la pista. Estos
 * heredan el color del texto y pesan unos pocos cientos de bytes.
 */
const TRAZO_SVG = 'http://www.w3.org/2000/svg';

const ICONOS = {
  ok: ['M4 12.5 9.5 18 20 6.5'],
  devolver: ['M9 14 4 9l5-5', 'M4 9h10a5 5 0 0 1 0 10h-3'],
  entrada: ['M3 9.5V7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2.5a2.5 2.5 0 0 0 0 5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2.5a2.5 2.5 0 0 0 0-5Z', 'M15 7v10'],
  bandera: ['M5 21V4', 'M5 5h13l-2.5 4L18 13H5'],
  reloj: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7.5V12l3 2'],
  aviso: ['M12 4 2.5 20h19L12 4Z', 'M12 10v4', 'M12 17.4v.2'],
  prohibido: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M6.5 6.5l11 11'],
  balanza: ['M12 4v16', 'M6 8h12', 'M6 8 3 14h6L6 8Z', 'M18 8l-3 6h6l-3-6Z'],
  restaurar: ['M4 12a8 8 0 0 1 13.7-5.7L20 8', 'M20 4v4h-4', 'M20 12a8 8 0 0 1-13.7 5.7L4 16', 'M4 20v-4h4'],
  llave: ['M8 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M11.9 11h9.1', 'M18.4 11v3.2', 'M15.4 11v2.2'],
  puerta: ['M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4', 'M10 8l-4 4 4 4', 'M6 12h9'],
  candado: ['M6 11h12v9H6z', 'M9 11V8a3 3 0 0 1 6 0v3'],
  'candado-abierto': ['M6 11h12v9H6z', 'M9 11V8a3 3 0 0 1 5.9-.8'],
  correo: ['M3 6h18v12H3z', 'm3 7 9 6 9-6'],
  chat: ['M20 15a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z'],
  telefono: ['M7 3h3l2 5-2.5 1.5a12 12 0 0 0 5 5L16 12l5 2v3a2 2 0 0 1-2.2 2A16 16 0 0 1 5 5.2 2 2 0 0 1 7 3Z'],
  lapiz: ['M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16v4Z', 'M14.5 5.5l4 4'],
  nuevo: ['M12 3l2.3 5.7L20 11l-5.7 2.3L12 19l-2.3-5.7L4 11l5.7-2.3L12 3Z'],
  movil: ['M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z', 'M11 17.8h2'],
  registro: ['M9 5h11', 'M9 12h11', 'M9 19h11', 'M4.5 5h.2', 'M4.5 12h.2', 'M4.5 19h.2'],
  calendario: ['M4 6h16v15H4z', 'M4 10.5h16', 'M8 3v4', 'M16 3v4'],
  campana: ['M6 16.5V11a6 6 0 1 1 12 0v5.5l2 2.5H4l2-2.5Z', 'M10 21h4'],
  'campana-muda': ['M6 16.5V11a6 6 0 0 1 8.4-5.5', 'M18 11.5v5l2 2.5H4l2-2.5', 'M10 21h4', 'M4 3.5l16 17'],
  camara: ['M4 8h3l2-3h6l2 3h3v12H4z', 'M12 16.5a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z'],
  senal: ['M3.5 9.2a14 14 0 0 1 17 0', 'M7 12.6a9 9 0 0 1 10 0', 'M10.2 16a4.5 4.5 0 0 1 3.6 0', 'M12 19.6v.2'],
  descarga: ['M12 4v10.5', 'm7.5 10.5 4.5 4.5 4.5-4.5', 'M4.5 20h15'],
  enviar: ['M12 20V5.5', 'm6.5 6.5-6.5-6.5-6.5 6.5', 'M4.5 20.5h15'],
  recibir: ['M12 4v14.5', 'm6.5-6.5-6.5 6.5-6.5-6.5', 'M4.5 3.5h15'],
  buscar: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'm16.2 16.2 4.8 4.8'],
  pack: ['M12 3 4 7.2v9.6L12 21l8-4.2V7.2L12 3Z', 'M4 7.2 12 11.5l8-4.3', 'M12 11.5V21'],
  persona: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4.5 20.5a7.5 7.5 0 0 1 15 0'],
  flecha: ['M5 12h13', 'm12.5 6 6 6-6 6'],
};

/**
 * Icono como elemento SVG. Decorativo por definición: lo que significa siempre
 * está escrito al lado, así que se esconde del lector de pantalla.
 * @param {string} nombre clave de `ICONOS`
 * @param {{grande?: boolean, clase?: string}} opciones
 */
export function icono(nombre, { grande = false, clase = '' } = {}) {
  const svg = document.createElementNS(TRAZO_SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icono${grande ? ' icono--grande' : ''}${clase ? ` ${clase}` : ''}`);
  for (const d of ICONOS[nombre] ?? ICONOS.pack) {
    const trazo = document.createElementNS(TRAZO_SVG, 'path');
    trazo.setAttribute('d', d);
    svg.append(trazo);
  }
  return svg;
}

export function vaciar(nodo) {
  while (nodo.firstChild) nodo.removeChild(nodo.firstChild);
  return nodo;
}

export function render(nodo, ...hijos) {
  vaciar(nodo);
  for (const hijo of hijos.flat(Infinity)) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    nodo.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return nodo;
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

// Zona horaria y moneda vienen de la configuración del servidor; estos valores
// son solo el punto de partida hasta que `configurarFormato` los reemplaza.
let ZONA = 'America/Guayaquil';
let MONEDA = 'USD';

/** La llama `aplicarMarca` con lo que responde /api/config. */
export function configurarFormato({ timezone, currency } = {}) {
  if (timezone) ZONA = timezone;
  if (currency) MONEDA = currency;
}

export function fecha(iso, { conHora = true } = {}) {
  if (!iso) return '—';
  const valor = new Date(iso);
  if (Number.isNaN(valor.getTime())) return '—';
  return valor.toLocaleString('es-EC', {
    timeZone: ZONA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(conHora ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

/**
 * Instante (ISO) en que termina un día 'YYYY-MM-DD' en la zona de la pista.
 *
 * Un vencimiento elegido en el calendario significa "hasta el final de ese día
 * en la pista", no en la zona horaria de quien tenga abierto el panel.
 */
export function finDelDiaIso(ymd) {
  const comoUtc = new Date(`${ymd}T23:59:59Z`);
  // Se despeja el desfase de la zona comparando cómo se ve ese instante en ella.
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(comoUtc);
  const p = {};
  for (const parte of partes) if (parte.type !== 'literal') p[parte.type] = Number(parte.value);
  if (p.hour === 24) p.hour = 0;
  const desfaseMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - comoUtc.getTime();
  return new Date(comoUtc.getTime() - desfaseMs).toISOString();
}

export function horaCorta(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-EC', { timeZone: ZONA, hour: '2-digit', minute: '2-digit' });
}

/** "hace 3 minutos", "ayer", etc. */
export function relativo(iso) {
  if (!iso) return '—';
  const diferencia = Date.now() - new Date(iso).getTime();
  const segundos = Math.round(diferencia / 1000);
  if (segundos < 45) return 'hace un momento';
  const formato = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  const unidades = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['month', 2592000],
    ['year', 31536000],
  ];
  let elegida = ['minute', 60];
  for (const unidad of unidades) {
    if (Math.abs(segundos) >= unidad[1]) elegida = unidad;
  }
  return formato.format(-Math.round(segundos / elegida[1]), elegida[0]);
}

export function dinero(centavos, moneda = MONEDA) {
  const valor = Number(centavos || 0) / 100;
  try {
    return new Intl.NumberFormat('es-EC', { style: 'currency', currency: moneda }).format(valor);
  } catch {
    return `$${valor.toFixed(2)}`;
  }
}

/**
 * Agrupa un teléfono para que se pueda leer de un vistazo.
 * Con el prefijo de Ecuador queda "+593 99 111 2233"; cualquier otro formato se
 * devuelve tal cual antes que arriesgarse a maquillarlo mal.
 */
export function telefono(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return '';
  const ecuador = /^\+593(\d{9})$/.exec(texto.replace(/[\s-]/g, ''));
  if (ecuador) {
    const [, digitos] = ecuador;
    return `+593 ${digitos.slice(0, 2)} ${digitos.slice(2, 5)} ${digitos.slice(5)}`;
  }
  return texto;
}

/** Tarjeta con un número grande y su etiqueta; la usan el panel y la ficha. */
export function metrica(valor, etiqueta, modificador = '') {
  return el(
    'div',
    { class: 'tarjeta' },
    el(
      'div',
      { class: `metrica ${modificador}` },
      el('div', { class: 'metrica__valor', 'data-contar': '' }, valor),
      el('div', { class: 'metrica__etiqueta' }, etiqueta),
    ),
  );
}

export function plural(cantidad, singular, pluralForma) {
  return `${cantidad} ${cantidad === 1 ? singular : pluralForma}`;
}

// ---------------------------------------------------------------------------
// Avisos flotantes
// ---------------------------------------------------------------------------

function zonaBrindis() {
  let zona = document.querySelector('.brindis-zona');
  if (!zona) {
    zona = el('div', { class: 'brindis-zona', role: 'status', 'aria-live': 'polite' });
    document.body.append(zona);
  }
  return zona;
}

export function brindis(mensaje, tipo = 'info', duracion = 4200) {
  const nodo = el('div', { class: `brindis brindis--${tipo}` }, mensaje);
  zonaBrindis().append(nodo);
  const quitar = () => {
    nodo.classList.add('brindis--saliendo');
    setTimeout(() => nodo.remove(), 220);
  };
  const temporizador = setTimeout(quitar, duracion);
  nodo.addEventListener('click', () => {
    clearTimeout(temporizador);
    quitar();
  });
  return quitar;
}

// ---------------------------------------------------------------------------
// Formularios
// ---------------------------------------------------------------------------

/** Pinta los errores por campo devueltos por la API. */
export function mostrarErroresCampo(formulario, campos = {}) {
  for (const nodo of formulario.querySelectorAll('.campo__error')) nodo.textContent = '';
  for (const control of formulario.querySelectorAll('[name]')) control.removeAttribute('aria-invalid');
  for (const [nombre, mensaje] of Object.entries(campos)) {
    const control = formulario.querySelector(`[name="${CSS.escape(nombre)}"]`);
    if (!control) continue;
    control.setAttribute('aria-invalid', 'true');
    const destino = control.closest('.campo')?.querySelector('.campo__error');
    if (destino) destino.textContent = mensaje;
  }
}

export function datosFormulario(formulario) {
  const datos = {};
  for (const [clave, valor] of new FormData(formulario).entries()) {
    datos[clave] = typeof valor === 'string' ? valor.trim() : valor;
  }
  return datos;
}

/** Deshabilita un botón y muestra un indicador mientras dura una acción. */
export async function conCarga(boton, accion) {
  if (!boton) return accion();
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  render(boton, el('span', { class: 'cargando', 'aria-hidden': 'true' }), ' Procesando…');
  try {
    return await accion();
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

export function mostrarAviso(nodo, mensaje, tipo = 'error') {
  if (!nodo) return;
  nodo.className = `aviso aviso--${tipo}`;
  nodo.textContent = mensaje || '';
  nodo.hidden = !mensaje;
}

// ---------------------------------------------------------------------------
// Diálogos
// ---------------------------------------------------------------------------

/** Confirmación accesible; sustituye a window.confirm. */
export function confirmar({ titulo, mensaje, textoAceptar = 'Confirmar', peligro = false }) {
  return new Promise((resolver) => {
    const dialogo = el(
      'dialog',
      {},
      el(
        'div',
        { class: 'modal__cuerpo' },
        el('h2', {}, titulo),
        el('p', { class: 'tenue sin-margen' }, mensaje),
      ),
      el(
        'div',
        { class: 'modal__pie' },
        el('button', { class: 'boton boton--fantasma', type: 'button', onClick: () => cerrar(false) }, 'Cancelar'),
        el(
          'button',
          { class: `boton ${peligro ? 'boton--peligro' : 'boton--principal'}`, type: 'button', onClick: () => cerrar(true) },
          textoAceptar,
        ),
      ),
    );
    function cerrar(valor) {
      dialogo.close();
      dialogo.remove();
      resolver(valor);
    }
    dialogo.addEventListener('cancel', (evento) => {
      evento.preventDefault();
      cerrar(false);
    });
    document.body.append(dialogo);
    dialogo.showModal();
  });
}

/**
 * Pide un dato (el motivo de una anulación, una fecha…).
 * Devuelve el texto escrito, o `null` si se canceló: con `minimo: 0` esos dos
 * casos son distintos, y vaciar el campo a propósito es una respuesta válida.
 */
export function pedirTexto({ titulo, mensaje, etiqueta, valorInicial = '', textoAceptar = 'Guardar', minimo = 3, tipo = 'text' }) {
  return new Promise((resolver) => {
    const entrada = el('input', { type: tipo, value: valorInicial, maxlength: '300', required: minimo > 0 });
    const error = el('div', { class: 'campo__error' });
    const dialogo = el(
      'dialog',
      {},
      el(
        'form',
        {
          method: 'dialog',
          onSubmit: (evento) => {
            evento.preventDefault();
            const valor = entrada.value.trim();
            if (valor.length < minimo) {
              error.textContent = `Escribe al menos ${minimo} caracteres.`;
              return;
            }
            cerrar(valor);
          },
        },
        el(
          'div',
          { class: 'modal__cuerpo' },
          el('h2', {}, titulo),
          mensaje ? el('p', { class: 'tenue' }, mensaje) : null,
          el('div', { class: 'campo' }, el('label', {}, etiqueta), entrada, error),
        ),
        el(
          'div',
          { class: 'modal__pie' },
          el('button', { class: 'boton boton--fantasma', type: 'button', onClick: () => cerrar(null) }, 'Cancelar'),
          el('button', { class: 'boton boton--principal', type: 'submit' }, textoAceptar),
        ),
      ),
    );
    function cerrar(valor) {
      dialogo.close();
      dialogo.remove();
      resolver(valor);
    }
    dialogo.addEventListener('cancel', (evento) => {
      evento.preventDefault();
      cerrar(null);
    });
    document.body.append(dialogo);
    dialogo.showModal();
    entrada.focus();
  });
}

// ---------------------------------------------------------------------------
// Varios
// ---------------------------------------------------------------------------

/** Vibración breve como confirmación táctil (si el dispositivo la soporta). */
export function vibrar(patron) {
  try {
    navigator.vibrate?.(patron);
  } catch {
    /* no soportado */
  }
}

export function estadoPack(pack) {
  if (pack.status === 'cancelled') return { texto: 'Anulado', clase: 'error' };
  if (pack.status === 'suspended') return { texto: 'Suspendido', clase: 'alerta' };
  if (pack.status === 'expired') return { texto: 'Vencido', clase: 'error' };
  if (pack.status === 'depleted' || pack.remaining === 0) return { texto: 'Agotado', clase: 'error' };
  if (pack.expiresAt) {
    const dias = (new Date(pack.expiresAt) - Date.now()) / 86400000;
    if (dias <= 7) return { texto: `Vence en ${Math.max(0, Math.ceil(dias))} d`, clase: 'alerta' };
  }
  if (pack.remaining <= 2) return { texto: 'Quedan pocas', clase: 'alerta' };
  return { texto: 'Activo', clase: 'ok' };
}

export const METODOS = {
  qr_dynamic: 'QR app',
  qr_static: 'QR impreso',
  manual_code: 'Código manual',
  admin: 'Administración',
};

/** Identificador único para claves de idempotencia. */
export function claveIdempotencia(prefijo = 'op') {
  const aleatorio =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefijo}-${aleatorio}`.slice(0, 80);
}

/** Copia texto al portapapeles con respaldo para navegadores antiguos. */
export async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = el('textarea', { class: 'oculto-visual' });
    area.value = texto;
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
