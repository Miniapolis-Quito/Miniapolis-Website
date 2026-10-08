/**
 * Portada: orquesta las escenas y la mira.
 *
 * Sin movimiento (preferencia del sistema o navegador sin soporte) no se añade
 * `.portada-motor` y la página queda estática y completa. La mira se monta
 * siempre que haya puntero fino.
 */
import { sinMovimiento } from './movimiento.js';
import {
  crearMotor, digitosDe, easeOutCubic, entradaPanel, fase, lucesEncendidas, progresoCifra, progresoMaximo,
} from './portada-motor.js';

const raiz = document.documentElement;
const reducir = sinMovimiento();
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
    let rafId = 0;
    let ultX = 0;
    let ultY = 0;
    const medir = () => { rect = pieza.getBoundingClientRect(); };
    const renderizar = () => {
      rafId = 0;
      if (!rect || !rect.width || !rect.height) return;
      const x = ((ultX - rect.left) / rect.width) * 100;
      const y = ((ultY - rect.top) / rect.height) * 100;
      pieza.style.setProperty('--spot-x', `${Math.max(0, Math.min(100, x)).toFixed(1)}%`);
      pieza.style.setProperty('--spot-y', `${Math.max(0, Math.min(100, y)).toFixed(1)}%`);
    };
    const actualizar = (evento) => {
      if (!rect) medir();
      ultX = evento.clientX;
      ultY = evento.clientY;
      if (!rafId) rafId = requestAnimationFrame(renderizar);
    };
    const limpiar = () => {
      rect = null;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
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

function arrancarSalida() {
  let repetida = false;
  try {
    repetida = sessionStorage.getItem('portada-salida') === '1';
    sessionStorage.setItem('portada-salida', '1');
  } catch { /* sin almacenamiento: la salida se ve completa */ }
  if (repetida) raiz.classList.add('portada-rapido');

  const listo = () => raiz.classList.add('portada-listos');
  const imagen = $('.portada__cielo img');
  const auto = $('.portada__auto img');
  const esperas = [document.fonts?.ready, imagen?.decode?.(), auto?.decode?.()].filter(Boolean);
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
  const ultRuedas = cifras.map(() => -1);
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
        const val = Number(progresoCifra(p, i).toFixed(3));
        if (val !== ultRuedas[i]) {
          ultRuedas[i] = val;
          cifra.style.setProperty('--rueda', val.toFixed(3));
        }
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

  const ajustar = () => {
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
    motor.medir();
  };

  const ultQ = paneles.map(() => -1);
  motor.registrar(seccion, {
    modo: 'fija',
    alActualizar: (p, { ancho }) => {
      if (!fija.matches) return;
      const x = p * recorrido;
      paneles.forEach((panel, i) => {
        const q = Number(entradaPanel(izquierdas[i] - x, ancho).toFixed(3));
        if (q !== ultQ[i]) {
          ultQ[i] = q;
          panel.style.setProperty('--q', q.toFixed(3));
        }
      });
    },
  });
  fija.addEventListener('change', ajustar);
  new ResizeObserver(ajustar).observe(riel);
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
  let ultCruce = -1;
  let ultEntra = -1;
  const escena = motor.registrar(seccion, {
    modo: 'vista',
    alActualizar: (p) => {
      const q = p / maximo;
      const cruce = Number(fase(q, 0.05, 0.55).toFixed(3));
      if (cruce !== ultCruce) {
        ultCruce = cruce;
        seccion.style.setProperty('--cruce', cruce.toFixed(3));
      }
      const entra = Number(easeOutCubic(fase(q, 0.15, 0.6)).toFixed(3));
      if (entra !== ultEntra) {
        ultEntra = entra;
        seccion.style.setProperty('--entra', entra.toFixed(3));
      }
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

function montarInformacion(motor) {
  const escenas = ['detalle', 'horario', 'records', 'eventos', 'galeria', 'comunidad'];
  const secciones = escenas.flatMap((escena) => $$(`[data-escena="${escena}"]`));
  if (!secciones.length) return;

  secciones.forEach((seccion) => {
    let ultP = -1;
    motor.registrar(seccion, {
      modo: 'vista',
      alActualizar: (p) => {
        const val = Number(fase(p, 0, 1).toFixed(3));
        if (val !== ultP) {
          ultP = val;
          seccion.style.setProperty('--info-p', val.toFixed(3));
        }
      },
    });
  });

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
// Precarga pasiva de texturas de fondo para scroll sin tirones
// ---------------------------------------------------------------------------

function precargarFondos() {
  const urls = [
    './images/pista/miniapolis-track-vertical.webp',
    './images/contenido/tarjetas/disciplina-crawling-fondo.webp',
    './images/contenido/tarjetas/disciplina-rally-fondo.webp',
    './images/contenido/tarjetas/disciplina-drones-fondo.webp',
    './images/contenido/tarjetas/disciplina-fpv-fondo.webp',
    './images/oficial/pista-circuito-panorama.webp',
    './images/oficial/pista-hangar-curva.webp',
    './images/oficial/pista-hangar-vertical.webp',
    './images/oficial/pista-senna-wide.webp',
    './images/oficial/pista-senna-vertical.webp',
    './images/pista/miniapolis-asphalt-detail.webp',
    './images/pista/miniapolis-curb-detail-vertical.webp',
    './images/pista/miniapolis-track-corner-wide.webp',
    './images/contenido/tarjetas/horario-miercoles-fondo.webp',
    './images/contenido/tarjetas/horario-sabado-fondo.webp',
    './images/contenido/tarjetas/horario-domingo-fondo.webp',
    './images/contenido/tarjetas/record-danilo-fondo.webp',
    './images/contenido/tarjetas/record-stalin-fondo.webp',
    './images/contenido/tarjetas/record-marco-fondo.webp',
    './images/contenido/tarjetas/evento-experiencia-fondo.webp',
    './images/contenido/tarjetas/evento-drift-fondo.webp',
    './images/contenido/tarjetas/evento-campeonato-fondo.webp',
    './images/landing/miniapolis-track-atmosphere.webp',
    './images/landing/miniapolis-track-portrait.webp',
    './images/pista/miniapolis-track-wide.webp',
    './images/contenido/tarjetas/promo-lancia-fondo.webp',
    './images/contenido/tarjetas/promo-amortiguadores-fondo.webp',
    './images/contenido/tarjetas/promo-llantas-fondo.webp',
    './images/contenido/tarjetas/promo-motor-fondo.webp',
    './images/contenido/tarjetas/promo-builder-fondo.webp',
    './images/contenido/tarjetas/recta-cabeza-fondo.webp',
    './images/oficial/miniapolis-bandera-hero.webp',
  ];
  const pedirSiguiente = (i) => {
    if (i >= urls.length) return;
    const img = new Image();
    img.decoding = 'async';
    img.src = urls[i];
    const paso = () => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => pedirSiguiente(i + 1), { timeout: 200 });
      } else {
        setTimeout(() => pedirSiguiente(i + 1), 30);
      }
    };
    img.decode?.().then(paso, paso) || paso();
  };
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => pedirSiguiente(0), { timeout: 1000 });
  } else {
    setTimeout(() => pedirSiguiente(0), 400);
  }
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
  const motor = crearMotor();
  const salida = $('[data-escena="salida"]');
  if (salida) motor.registrar(salida, { modo: 'fija' });
  montarTablero(motor);
  montarRecta(motor);
  montarInformacion(motor);
  montarBoxes(motor);
  motor.iniciar();
  arrancarSalida();
  precargarFondos();
}
