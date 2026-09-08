/** Utilidades de interfaz compartidas por todas las páginas. */

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

export const $ = (selector, raiz = document) => raiz.querySelector(selector);
export const $$ = (selector, raiz = document) => [...raiz.querySelectorAll(selector)];

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
 * Fecha 'YYYY-MM-DD' de un instante, en la zona de la pista.
 *
 * El servidor agrupa el gráfico diario por esa misma zona, así que las claves
 * del cliente tienen que calcularse igual: usar la zona del navegador
 * desalinearía las barras para quien mire el panel desde otro país.
 */
export function claveDia(valor = new Date()) {
  // 'en-CA' formatea justamente como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(valor instanceof Date ? valor : new Date(valor));
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

/** Formatea un día 'YYYY-MM-DD' tal cual, sin reinterpretarlo en otra zona. */
export function fechaDia(ymd) {
  const [anio, mes, dia] = String(ymd ?? '').split('-');
  return dia ? `${dia}/${mes}/${anio}` : '—';
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

/** Pide un texto (motivo de una anulación, por ejemplo). */
export function pedirTexto({ titulo, mensaje, etiqueta, valorInicial = '', textoAceptar = 'Guardar', minimo = 3 }) {
  return new Promise((resolver) => {
    const entrada = el('input', { type: 'text', value: valorInicial, maxlength: '300', required: true });
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
