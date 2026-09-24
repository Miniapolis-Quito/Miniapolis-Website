/**
 * Portada: orquesta las escenas y la mira.
 *
 * Sin movimiento (preferencia del sistema o navegador sin soporte) no se añade
 * `.portada-motor` y la página queda estática y completa. La mira se monta
 * siempre que haya puntero fino.
 */
import { sinMovimiento } from './movimiento.js';
import {
  crearMotor, desfaseCinta, digitosDe, easeOutCubic, entradaPanel, entradaPieza, fase, interpolarCifras,
  lucesEncendidas, progresoCifra, progresoMaximo, salidaPieza, sectorActual,
} from './portada-motor.js';

const raiz = document.documentElement;
const reducir = sinMovimiento();
const punteroFino = () => Boolean(window.matchMedia?.('(hover: hover) and (pointer: fine)').matches);
const $ = (selector, base = document) => base.querySelector(selector);
const $$ = (selector, base = document) => [...base.querySelectorAll(selector)];

/** Lo único que la mira reconoce como objetivo: lo que se puede pulsar. */
const CLICABLES = 'a, button, input, select, textarea, label, summary, [role="tab"]';

// ---------------------------------------------------------------------------
// Mira del puntero
// ---------------------------------------------------------------------------

function montarMira() {
  if (reducir || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;

  document.body.classList.add('mira-activa');
  const mira = document.createElement('span');
  mira.className = 'entrada__mira';
  mira.setAttribute('aria-hidden', 'true');
  const segmento = document.createElement('span');
  segmento.className = 'entrada__mira--segmento';
  const centro = document.createElement('span');
  centro.className = 'entrada__mira-centro';
  mira.append(segmento, centro);
  document.body.append(mira);

  const esObjetivo = (nodo) => nodo?.closest?.(CLICABLES);
  window.addEventListener('pointermove', (evento) => {
    mira.style.setProperty('--puntero-x', `${evento.clientX}px`);
    mira.style.setProperty('--puntero-y', `${evento.clientY}px`);
  }, { passive: true });
  window.addEventListener('pointerover', (evento) => {
    raiz.classList.toggle('mira-sobre-objetivo', Boolean(esObjetivo(evento.target)));
  }, { passive: true });
  window.addEventListener('pointerout', (evento) => {
    if (!esObjetivo(evento.relatedTarget)) raiz.classList.remove('mira-sobre-objetivo');
  }, { passive: true });
}

// ---------------------------------------------------------------------------
// Micro-interacciones de superficie
// ---------------------------------------------------------------------------

/**
 * Mueve el halo de cada ficha según el puntero. No cambia el layout ni el
 * contenido: solo hace que las superficies respondan como paneles físicos.
 * Se desactiva por completo en touch y con movimiento reducido.
 */
function montarHalos() {
  if (reducir || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;

  const selectores = [
    '.portada__disciplina',
    '.portada__spec',
    '.portada__evento',
    '.portada__pronto-visual',
    '.portada__promo',
  ];

  $$(selectores.join(',')).forEach((pieza) => {
    let rect = null;
    const medir = () => { rect = pieza.getBoundingClientRect(); };
    const actualizar = (evento) => {
      if (!rect) medir();
      if (!rect.width || !rect.height) return;
      const x = ((evento.clientX - rect.left) / rect.width) * 100;
      const y = ((evento.clientY - rect.top) / rect.height) * 100;
      pieza.style.setProperty('--spot-x', `${Math.max(0, Math.min(100, x)).toFixed(1)}%`);
      pieza.style.setProperty('--spot-y', `${Math.max(0, Math.min(100, y)).toFixed(1)}%`);
    };
    const limpiar = () => {
      rect = null;
      pieza.style.removeProperty('--spot-x');
      pieza.style.removeProperty('--spot-y');
    };
    pieza.addEventListener('pointerenter', medir, { passive: true });
    pieza.addEventListener('pointermove', actualizar, { passive: true });
    pieza.addEventListener('pointerleave', limpiar, { passive: true });
  });
}

// ---------------------------------------------------------------------------
// Progreso de la cabecera cuando no hay motor
// ---------------------------------------------------------------------------

function montarProgresoSimple() {
  let pendiente = false;
  const pintar = () => {
    pendiente = false;
    const maximo = Math.max(raiz.scrollHeight - window.innerHeight, 1);
    raiz.style.setProperty('--scroll', Math.min(1, window.scrollY / maximo).toFixed(4));
  };
  const programar = () => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(pintar);
  };
  pintar();
  window.addEventListener('scroll', programar, { passive: true });
  window.addEventListener('resize', programar, { passive: true });
}

// ---------------------------------------------------------------------------
// Salida: semáforo y titular
// ---------------------------------------------------------------------------

/** El semáforo apaga sus luces a los 1,1 s: el titular arranca justo detrás. */
const LUCES_FUERA_MS = 1150;

function arrancarSalida() {
  const inicio = performance.now();
  let repetida = false;
  try {
    repetida = sessionStorage.getItem('portada-salida') === '1';
    sessionStorage.setItem('portada-salida', '1');
  } catch { /* sin almacenamiento: la salida se ve completa */ }
  if (repetida) raiz.classList.add('portada-rapido');

  const listo = () => {
    // El semáforo corre desde que se monta el motor: si la foto tardó, el
    // titular no vuelve a esperar la secuencia entera.
    const espera = repetida ? 0 : Math.max(0, LUCES_FUERA_MS - (performance.now() - inicio));
    raiz.style.setProperty('--espera', `${Math.round(espera)}ms`);
    raiz.classList.add('portada-listos');
  };
  const imagen = $('.portada__cielo img');
  const esperas = [document.fonts?.ready, imagen?.decode?.()].filter(Boolean);
  // Red de seguridad: el titular nunca se queda esperando a un recurso.
  Promise.race([Promise.allSettled(esperas), new Promise((r) => setTimeout(r, 1800))]).then(listo);
}

// ---------------------------------------------------------------------------
// Tablero: luces de cambio y cuentakilómetros
// ---------------------------------------------------------------------------

function pieza(clase, texto) {
  const nodo = document.createElement('span');
  nodo.className = clase;
  nodo.textContent = texto;
  nodo.setAttribute('aria-hidden', 'true');
  return nodo;
}

function armarCifras() {
  return $$('.cifra__num[data-cifra]').map((el) => {
    const lectura = document.createElement('span');
    lectura.className = 'portada__lectura';
    lectura.textContent = el.textContent.trim();
    const ruedas = digitosDe(el.dataset.cifra).map((digito) => {
      const rueda = document.createElement('span');
      rueda.className = 'rueda';
      rueda.setAttribute('aria-hidden', 'true');
      const tira = document.createElement('span');
      tira.className = 'rueda__tira';
      tira.style.setProperty('--d', String(digito));
      for (let n = 0; n < 10; n++) {
        const numero = document.createElement('i');
        numero.textContent = String(n);
        tira.append(numero);
      }
      rueda.append(tira);
      return rueda;
    });
    const partes = [];
    if (el.dataset.prefijo) partes.push(pieza('cifra__afijo cifra__afijo--pre', el.dataset.prefijo));
    partes.push(...ruedas);
    if (el.dataset.sufijo) partes.push(pieza('cifra__afijo cifra__afijo--suf', el.dataset.sufijo));
    el.replaceChildren(lectura, ...partes);
    return el;
  });
}

function montarTablero(motor) {
  const seccion = $('[data-escena="tablero"]');
  if (!seccion) return;
  const cifras = armarCifras();
  const luces = $$('.portada__luces span', seccion);
  let encendidas = -1;
  motor.registrar(seccion, {
    modo: 'vista',
    alActualizar: (p) => {
      // La barra debe completar su secuencia mientras el tablero sigue visible,
      // no esperar a que la sección ya esté terminando de salir de pantalla.
      const n = lucesEncendidas(fase(p, 0.08, 0.48), luces.length);
      if (n !== encendidas) {
        luces.forEach((luz, i) => luz.classList.toggle('on', i < n));
        encendidas = n;
      }
      cifras.forEach((cifra, i) => {
        cifra.style.setProperty('--rueda', progresoCifra(p, i).toFixed(3));
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Recta: recorrido horizontal fijo (≥ 900 px y apaisado) o apilado con revelado
// ---------------------------------------------------------------------------

function montarRecta(motor) {
  const seccion = $('[data-escena="recta"]');
  const riel = seccion && $('.portada__riel', seccion);
  if (!riel) return;
  const paneles = $$('.portada__panel', riel);
  const fija = window.matchMedia('(min-width: 900px) and (min-height: 560px) and (min-aspect-ratio: 1/1)');
  let recorrido = 0;
  let izquierdas = [];

  // Las fotos del riel están lejos de la pantalla: se cargan ya para que no
  // lleguen en blanco.
  const cargarTodo = () => $$('img', riel).forEach((img) => { img.loading = 'eager'; });
  if (document.readyState === 'complete') cargarTodo();
  else window.addEventListener('load', cargarTodo, { once: true });

  // Marcador de fotos: «02 / 05» y una barra que se llena con el recorrido.
  const fotos = paneles.filter((panel) => panel.tagName === 'FIGURE');
  const hud = document.createElement('div');
  hud.className = 'portada__recta-hud';
  hud.setAttribute('aria-hidden', 'true');
  const actual = document.createElement('b');
  const barra = document.createElement('span');
  barra.className = 'portada__recta-barra';
  const total = document.createElement('span');
  total.textContent = String(fotos.length).padStart(2, '0');
  hud.append(actual, barra, total);
  $('.portada__recta-marco', seccion)?.append(hud);
  let vistas = -1;

  /** Solo escribe variables: medir aquí dentro volvería a llamar a este mismo ajuste. */
  const calcular = () => {
    raiz.classList.toggle('portada-fija', fija.matches);
    if (fija.matches) {
      recorrido = Math.max(0, riel.scrollWidth - window.innerWidth);
      izquierdas = paneles.map((panel) => panel.offsetLeft);
      seccion.style.setProperty('--recorrido', String(recorrido));
      seccion.style.setProperty('--alto-recta', `${Math.round(recorrido + window.innerHeight)}px`);
    } else {
      seccion.style.removeProperty('--recorrido');
      seccion.style.removeProperty('--alto-recta');
    }
  };
  const ajustar = () => {
    calcular();
    motor.medir();
  };

  motor.registrar(seccion, {
    modo: 'fija',
    alActualizar: (p, { ancho }) => {
      if (!fija.matches) return;
      const x = p * recorrido;
      let dentro = 0;
      paneles.forEach((panel, i) => {
        const q = entradaPanel(izquierdas[i] - x, ancho);
        panel.style.setProperty('--q', q.toFixed(3));
        if (panel.tagName === 'FIGURE' && q > 0.5) dentro += 1;
      });
      const n = Math.max(1, dentro);
      if (n !== vistas) {
        vistas = n;
        actual.textContent = String(n).padStart(2, '0');
      }
    },
  });
  fija.addEventListener('change', ajustar);
  new ResizeObserver(ajustar).observe(riel);
  // Con la página ya medida (fuentes, fotos, cambios de tamaño) el recorrido se
  // recalcula: un riel medido antes de hora dejaba la recta sin desplazamiento.
  motor.alMedir(calcular);
  ajustar();

  // Apilado: cada foto se descubre al llegar.
  const observador = new IntersectionObserver((entradas) => {
    for (const entrada of entradas) {
      if (!entrada.isIntersecting) continue;
      entrada.target.classList.add('visto');
      observador.unobserve(entrada.target);
    }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
  paneles.forEach((panel) => observador.observe(panel));
  setTimeout(() => paneles.forEach((panel) => panel.classList.add('visto')), 8000);
}

// ---------------------------------------------------------------------------
// Boxes: la bandera cruza y el panel entra frenando
// ---------------------------------------------------------------------------

function montarBoxes(motor) {
  const seccion = $('[data-escena="boxes"]');
  if (!seccion) return;
  // Es la última escena: en pantallas altas la página no da para que p llegue a
  // 1. Se normaliza contra lo que de verdad se puede recorrer, y así la bandera
  // se va y el panel queda asentado al llegar al final.
  let maximo = 1;
  const escena = motor.registrar(seccion, {
    modo: 'vista',
    alActualizar: (p) => {
      const q = p / maximo;
      seccion.style.setProperty('--cruce', fase(q, 0.05, 0.55).toFixed(3));
      seccion.style.setProperty('--entra', easeOutCubic(fase(q, 0.15, 0.6)).toFixed(3));
    },
  });
  motor.alMedir(() => {
    const restante = document.documentElement.scrollHeight - (escena.top + escena.alto);
    maximo = progresoMaximo(escena.alto, restante, window.innerHeight);
  });
}

// ---------------------------------------------------------------------------
// Información: la ficha entra como un tablero de boxes, bloque a bloque.
// ---------------------------------------------------------------------------

/** Piezas con reloj propio: entran al asomar, se leen quietas y salen bajo la cabecera. */
const PIEZAS = [
  '.portada__info-cabeza',
  '.portada__disciplina',
  '.portada__spec',
  '.portada__horarios',
  '.portada__horario',
  '.portada__record',
  '.portada__record-meta',
  '.portada__evento',
  '.portada__pronto-visual',
  '.portada__pronto-copy',
  '.portada__galeria figure',
  '.portada__promo',
  '.portada__comunidad-cierre',
].join(', ');

/**
 * Las cifras de telemetría y los tiempos se cuentan al entrar, como una
 * lectura que se estabiliza. El valor final queda siempre en una copia para
 * lectores de pantalla; la cifra que corre es solo visual.
 */
function prepararConteos() {
  const conteos = new Map();
  const preparar = (pieza, el, opciones) => {
    const final = el.textContent.trim();
    if (!/\d/.test(final)) return;
    const lectura = document.createElement('span');
    lectura.className = 'portada__lectura';
    lectura.textContent = final;
    const visible = document.createElement('i');
    visible.className = 'portada__conteo';
    visible.setAttribute('aria-hidden', 'true');
    visible.textContent = final;
    el.replaceChildren(lectura, visible);
    let ultimo = final;
    conteos.set(pieza, (t) => {
      const texto = interpolarCifras(final, t > 0.995 ? 1 : t, opciones);
      if (texto === ultimo) return;
      ultimo = texto;
      visible.textContent = texto;
    });
  };
  $$('.portada__spec').forEach((spec) => { const el = $('strong', spec); if (el) preparar(spec, el, {}); });
  $$('.portada__record').forEach((fila) => { const el = $('b', fila); if (el) preparar(fila, el, { rellenar: true }); });
  return conteos;
}

function montarInformacion(motor) {
  const escenas = ['detalle', 'horario', 'records', 'eventos', 'galeria', 'comunidad'];
  const secciones = escenas.flatMap((escena) => $$(`[data-escena="${escena}"]`));
  if (!secciones.length) return;

  secciones.forEach((seccion) => {
    motor.registrar(seccion, {
      modo: 'vista',
      alActualizar: (p) => seccion.style.setProperty('--info-p', fase(p, 0, 1).toFixed(3)),
    });
  });

  // La columna y el techo se miden al montar y al cambiar el tamaño, nunca
  // dentro del fotograma: leer el layout mientras se escriben variables lo
  // forzaría una vez por pieza.
  const cabecera = $('.entrada__barra');
  let techo = 82;
  const columnas = new Map();
  const medirPiezas = () => {
    techo = cabecera?.offsetHeight || 82;
    for (const pieza of columnas.keys()) {
      const padre = pieza.parentElement;
      const ancho = padre?.clientWidth || 1;
      const izquierda = pieza.getBoundingClientRect().left - (padre?.getBoundingClientRect().left ?? 0);
      columnas.set(pieza, Math.max(0, Math.min(1, izquierda / ancho)));
    }
  };

  const conteos = prepararConteos();
  $$(PIEZAS).forEach((pieza) => {
    columnas.set(pieza, 0);
    const conteo = conteos.get(pieza);
    const escena = motor.registrar(pieza, {
      modo: 'vista',
      alActualizar: (p, { alto }) => {
        const arriba = alto - p * (alto + escena.alto);
        const retraso = columnas.get(pieza) * alto * 0.14;
        const entrada = entradaPieza(arriba, alto, retraso);
        pieza.style.setProperty('--item-in', entrada.toFixed(3));
        pieza.style.setProperty('--item-out', salidaPieza(arriba, escena.alto, techo).toFixed(3));
        conteo?.(entrada);
      },
    });
  });
  motor.alMedir(medirPiezas);

  const observador = new IntersectionObserver((entradas) => {
    for (const entrada of entradas) {
      if (!entrada.isIntersecting) continue;
      entrada.target.classList.add('visto');
      observador.unobserve(entrada.target);
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
  secciones.forEach((seccion) => observador.observe(seccion));
  setTimeout(() => secciones.forEach((seccion) => seccion.classList.add('visto')), 9000);
}

// ---------------------------------------------------------------------------
// Tipografía en movimiento: letras del titular y palabras de cada rótulo
// ---------------------------------------------------------------------------

/**
 * Parte el titular de la salida en letras. El `h1` conserva su nombre accesible
 * entero y las letras quedan ocultas a los lectores de pantalla.
 */
function partirTitular() {
  const h1 = $('#titulo-entrada');
  if (!h1) return;
  h1.setAttribute('aria-label', h1.textContent.replace(/\s+/g, ' ').trim());
  let c = 0;
  $$('.portada__linea > span', h1).forEach((linea) => {
    const nodos = [];
    for (const parte of linea.textContent.split(/(\s+)/)) {
      if (!parte) continue;
      if (/^\s+$/.test(parte)) { nodos.push(document.createTextNode(' ')); continue; }
      const palabra = document.createElement('span');
      palabra.className = 'portada__letras';
      for (const caracter of parte) {
        const letra = document.createElement('span');
        letra.className = 'portada__letra';
        letra.textContent = caracter;
        letra.style.setProperty('--c', String(c));
        // Cada letra sale a su ritmo: una lluvia ordenada, nunca aleatoria.
        letra.style.setProperty('--dy', `${45 + ((c * 53) % 110)}%`);
        letra.style.setProperty('--giro', `${((c * 7) % 5) * 5 - 10}deg`);
        palabra.append(letra);
        c += 1;
      }
      nodos.push(palabra);
    }
    linea.setAttribute('aria-hidden', 'true');
    linea.replaceChildren(...nodos);
  });
}

/**
 * Envuelve cada palabra de un rótulo en una máscara. El CSS las levanta una a
 * una con el reloj de su pieza (`--item-in`) o, en las escenas que no tienen
 * reloj propio, con `--revela`.
 */
function partirPalabras(elemento, clase = 'portada__palabra') {
  if (!elemento) return [];
  const palabras = [];
  const recorrer = (nodo) => {
    for (const hijo of [...nodo.childNodes]) {
      if (hijo.nodeType === Node.ELEMENT_NODE) { recorrer(hijo); continue; }
      if (hijo.nodeType !== Node.TEXT_NODE || !hijo.textContent.trim()) continue;
      const trozos = hijo.textContent.split(/(\s+)/).filter(Boolean).map((parte) => {
        if (/^\s+$/.test(parte)) return document.createTextNode(' ');
        const mascara = document.createElement('span');
        mascara.className = clase;
        const interior = document.createElement('span');
        interior.textContent = parte;
        mascara.append(interior);
        palabras.push(mascara);
        return mascara;
      });
      hijo.replaceWith(...trozos);
    }
  };
  recorrer(elemento);
  palabras.forEach((palabra, i) => palabra.style.setProperty('--w', String(i)));
  elemento.style.setProperty('--nw', String(palabras.length));
  elemento.classList.add('portada__rotulo');
  return palabras;
}

function montarRotulos() {
  $$('.portada__info-cabeza h2, .portada__pronto-copy h2').forEach((h2) => partirPalabras(h2));
  partirPalabras($('.portada__comunidad-cierre'), 'portada__luz-palabra');

  // La recta y los boxes no tienen reloj por pieza: sus rótulos se levantan al asomar.
  const sueltos = $$('.portada__recta-cabeza, .portada__intro');
  sueltos.forEach((bloque) => partirPalabras($('h2', bloque)));
  const observador = new IntersectionObserver((entradas) => {
    for (const entrada of entradas) {
      if (!entrada.isIntersecting) continue;
      entrada.target.classList.add('revelado');
      observador.unobserve(entrada.target);
    }
  }, { rootMargin: '0px 0px -15% 0px', threshold: 0.2 });
  sueltos.forEach((bloque) => observador.observe(bloque));
  setTimeout(() => sueltos.forEach((bloque) => bloque.classList.add('revelado')), 9000);
}

// ---------------------------------------------------------------------------
// Cintas: dos bandas que cruzan la pista y corren con la velocidad del scroll
// ---------------------------------------------------------------------------

function montarCintas(motor) {
  const zona = $('[data-escena="cintas"]');
  if (!zona) return;
  const cintas = $$('.portada__cinta-pista', zona).map((pista, i) => {
    // Dos copias seguidas: al envolver el desfase nunca asoma un hueco.
    pista.append(...[...pista.children].map((nodo) => nodo.cloneNode(true)));
    return { pista, sentido: i % 2 ? 1 : -1, periodo: 0, x: 0 };
  });
  motor.alMedir(() => cintas.forEach((cinta) => { cinta.periodo = cinta.pista.scrollWidth / 2; }));
  motor.registrar(zona, { modo: 'vista' });

  let visible = false;
  let pedido = 0;
  let ultimo = 0;
  let rumbo = 1;
  const cuadro = (ahora) => {
    const dt = Math.min(0.05, Math.max(0, (ahora - ultimo) / 1000));
    ultimo = ahora;
    const { velocidad } = motor.estado();
    // Al subir, las cintas invierten el sentido; al bajar vuelven. El empujón
    // del scroll se suma a una marcha lenta que nunca se detiene.
    if (Math.abs(velocidad) > 0.015) rumbo = Math.sign(velocidad);
    const rapidez = 48 + Math.abs(velocidad) * 1600;
    for (const cinta of cintas) {
      cinta.x += cinta.sentido * rumbo * rapidez * dt;
      cinta.pista.style.setProperty('--cinta-x', `${desfaseCinta(cinta.x, cinta.periodo).toFixed(1)}px`);
    }
    pedido = visible ? requestAnimationFrame(cuadro) : 0;
  };
  new IntersectionObserver(([entrada]) => {
    visible = entrada.isIntersecting;
    if (visible && !pedido) {
      ultimo = performance.now();
      pedido = requestAnimationFrame(cuadro);
    }
  }, { rootMargin: '120px 0px' }).observe(zona);
}

// ---------------------------------------------------------------------------
// Vuelta en la cabecera: un minimapa del circuito que se recorre con el scroll
// ---------------------------------------------------------------------------

const TRAZADO = 'M70 186H318q46 0 46-46v-8q0-34-34-34h-58q-24 0-36-20l-14-24q-12-20-36-20H92q-50 0-50 50v56q0 46 28 46z';
const NOMBRES_SECTOR = {
  salida: 'Salida', tablero: 'Tablero', pista: 'La pista', complejo: 'Complejo', 'pista-datos': 'Telemetría',
  horarios: 'Horarios', records: 'Tiempos', eventos: 'Eventos', 'muy-pronto': 'Muy pronto', galeria: 'Galería',
  comunidad: 'Comunidad', acceso: 'Tu pase',
};

function montarVuelta(motor) {
  const interior = $('.entrada__barra-interior');
  const secciones = $$('main > section');
  if (!interior || !secciones.length) return;

  // El analizador de HTML ya coloca el <svg> en su espacio de nombres.
  const plantilla = document.createElement('template');
  plantilla.innerHTML = `<div class="entrada__vuelta" aria-hidden="true">
    <svg class="entrada__vuelta-mapa" viewBox="28 14 350 188">
      <path class="entrada__vuelta-base" d="${TRAZADO}"/>
      <path class="entrada__vuelta-traza" d="${TRAZADO}" pathLength="1"/>
      <circle class="entrada__vuelta-auto" r="12"/>
    </svg>
    <span class="entrada__vuelta-rotulo"><b></b><span></span></span>
    <span class="entrada__vuelta-avance"></span>
  </div>`;
  const vuelta = plantilla.content.firstElementChild;
  const base = $('.entrada__vuelta-base', vuelta);
  const traza = $('.entrada__vuelta-traza', vuelta);
  const auto = $('.entrada__vuelta-auto', vuelta);
  const rotulo = $('.entrada__vuelta-rotulo', vuelta);
  const numero = $('b', rotulo);
  const nombre = $('span', rotulo);
  const avance = $('.entrada__vuelta-avance', vuelta);
  interior.insertBefore(vuelta, $('.entrada__accion', interior));

  const nombres = secciones.map((s) => NOMBRES_SECTOR[s.id] ?? NOMBRES_SECTOR[s.dataset.escena] ?? '');
  let largo = 0;
  let visible = false;
  let inicios = [];
  let sector = -1;
  let ultimoAvance = '';
  motor.alMedir(() => {
    // En pantallas estrechas la vuelta no se pinta: tampoco se calcula.
    visible = vuelta.getClientRects().length > 0;
    if (visible && !largo) largo = base.getTotalLength();
    if (!visible) sector = -1;
    inicios = secciones.map((s) => s.getBoundingClientRect().top + window.scrollY);
  });
  motor.alPintar(({ scroll, fraccion, alto }) => {
    if (!visible) return;
    const punto = base.getPointAtLength(fraccion * largo);
    auto.setAttribute('cx', punto.x.toFixed(1));
    auto.setAttribute('cy', punto.y.toFixed(1));
    traza.style.setProperty('stroke-dashoffset', (1 - fraccion).toFixed(4));
    const texto = `${String(Math.round(fraccion * 100)).padStart(3, '0')}%`;
    if (texto !== ultimoAvance) { avance.textContent = texto; ultimoAvance = texto; }
    const nuevo = sectorActual(scroll + alto * 0.45, inicios);
    if (nuevo === sector) return;
    const sube = nuevo > sector;
    sector = nuevo;
    numero.textContent = `S${String(nuevo + 1).padStart(2, '0')}`;
    nombre.textContent = nombres[nuevo];
    rotulo.animate?.([
      { transform: `translate3d(0, ${sube ? 80 : -80}%, 0)`, opacity: 0 },
      { transform: 'none', opacity: 1 },
    ], { duration: 460, easing: 'cubic-bezier(.16, 1, .3, 1)' });
  });
}

// ---------------------------------------------------------------------------
// Imanes y fichas inclinables: solo lo que se puede pulsar responde al puntero
// ---------------------------------------------------------------------------

function montarImanes() {
  if (!punteroFino()) return;
  // Los botones ya tienen sus transiciones: el imán se suaviza aquí y escribe
  // solo `translate`, que no pisa ninguna de ellas.
  const activos = new Set();
  let pedido = 0;
  const paso = () => {
    for (const iman of activos) {
      iman.x += (iman.objetivoX - iman.x) * 0.2;
      iman.y += (iman.objetivoY - iman.y) * 0.2;
      if (!iman.dentro && Math.abs(iman.x) < 0.05 && Math.abs(iman.y) < 0.05) {
        iman.el.style.removeProperty('translate');
        activos.delete(iman);
        continue;
      }
      iman.el.style.setProperty('translate', `${iman.x.toFixed(2)}px ${iman.y.toFixed(2)}px`);
    }
    pedido = activos.size ? requestAnimationFrame(paso) : 0;
  };
  const despertar = (iman) => {
    activos.add(iman);
    if (!pedido) pedido = requestAnimationFrame(paso);
  };

  const selector = '.portada__acciones .boton, .portada__enlace, .entrada__accion, .portada__info .boton';
  $$(selector).forEach((el) => {
    const iman = { el, x: 0, y: 0, objetivoX: 0, objetivoY: 0, dentro: false, rect: null };
    el.addEventListener('pointerenter', () => {
      iman.rect = el.getBoundingClientRect();
      iman.dentro = true;
    }, { passive: true });
    el.addEventListener('pointermove', (evento) => {
      if (!iman.rect) iman.rect = el.getBoundingClientRect();
      const { left, top, width, height } = iman.rect;
      iman.objetivoX = (evento.clientX - (left + width / 2)) * 0.26;
      iman.objetivoY = (evento.clientY - (top + height / 2)) * 0.36;
      despertar(iman);
    }, { passive: true });
    el.addEventListener('pointerleave', () => {
      iman.rect = null;
      iman.dentro = false;
      iman.objetivoX = 0;
      iman.objetivoY = 0;
      despertar(iman);
    }, { passive: true });
  });

  $$('a.portada__promo').forEach((ficha) => {
    let rect = null;
    ficha.addEventListener('pointerenter', () => { rect = ficha.getBoundingClientRect(); }, { passive: true });
    ficha.addEventListener('pointermove', (evento) => {
      if (!rect) rect = ficha.getBoundingClientRect();
      const x = (evento.clientX - rect.left) / rect.width - 0.5;
      const y = (evento.clientY - rect.top) / rect.height - 0.5;
      ficha.style.setProperty('--incl-x', `${(-y * 14).toFixed(2)}deg`);
      ficha.style.setProperty('--incl-y', `${(x * 16).toFixed(2)}deg`);
    }, { passive: true });
    ficha.addEventListener('pointerleave', () => {
      rect = null;
      ficha.style.removeProperty('--incl-x');
      ficha.style.removeProperty('--incl-y');
    }, { passive: true });
  });
}

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

montarMira();
montarHalos();

if (reducir || typeof IntersectionObserver !== 'function' || typeof ResizeObserver !== 'function') {
  montarProgresoSimple();
} else {
  raiz.classList.add('portada-motor');
  partirTitular();
  montarRotulos();
  const motor = crearMotor();
  const salida = $('[data-escena="salida"]');
  if (salida) motor.registrar(salida, { modo: 'fija' });
  montarCintas(motor);
  montarTablero(motor);
  montarRecta(motor);
  montarInformacion(motor);
  montarBoxes(motor);
  montarVuelta(motor);
  montarImanes();
  motor.iniciar();
  arrancarSalida();
}
