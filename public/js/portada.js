/**
 * Portada: orquesta las escenas y la mira.
 *
 * Sin movimiento (preferencia del sistema o navegador sin soporte) no se añade
 * `.portada-motor` y la página queda estática y completa. La mira se monta
 * siempre que haya puntero fino.
 */
import { sinMovimiento } from './movimiento.js';
import {
  crearMotor, digitosDe, easeOutCubic, entradaPanel, entradaPieza, fase, lucesEncendidas, progresoCifra,
  salidaPieza,
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
    raiz.style.setProperty('--puntero-x', `${evento.clientX}px`);
    raiz.style.setProperty('--puntero-y', `${evento.clientY}px`);
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
    const actualizar = (evento) => {
      const rect = pieza.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = ((evento.clientX - rect.left) / rect.width) * 100;
      const y = ((evento.clientY - rect.top) / rect.height) * 100;
      pieza.style.setProperty('--spot-x', `${Math.max(0, Math.min(100, x)).toFixed(1)}%`);
      pieza.style.setProperty('--spot-y', `${Math.max(0, Math.min(100, y)).toFixed(1)}%`);
    };
    const limpiar = () => {
      pieza.style.removeProperty('--spot-x');
      pieza.style.removeProperty('--spot-y');
    };
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
// Recta: recorrido horizontal fijo (≥ 900 px) o apilado con revelado
// ---------------------------------------------------------------------------

function montarRecta(motor) {
  const seccion = $('[data-escena="recta"]');
  const riel = seccion && $('.portada__riel', seccion);
  if (!riel) return;
  const paneles = $$('.portada__panel', riel);
  const fija = window.matchMedia('(min-width: 900px) and (min-height: 560px)');
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

  motor.registrar(seccion, {
    modo: 'fija',
    alActualizar: (p, { ancho }) => {
      if (!fija.matches) return;
      const x = p * recorrido;
      paneles.forEach((panel, i) => {
        panel.style.setProperty('--q', entradaPanel(izquierdas[i] - x, ancho).toFixed(3));
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
  motor.registrar(seccion, {
    modo: 'vista',
    alActualizar: (p) => {
      seccion.style.setProperty('--cruce', fase(p, 0.04, 0.4).toFixed(3));
      seccion.style.setProperty('--entra', easeOutCubic(fase(p, 0.2, 0.62)).toFixed(3));
    },
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

  $$(PIEZAS).forEach((pieza) => {
    columnas.set(pieza, 0);
    const escena = motor.registrar(pieza, {
      modo: 'vista',
      alActualizar: (p, { alto }) => {
        const arriba = alto - p * (alto + escena.alto);
        const retraso = columnas.get(pieza) * alto * 0.14;
        pieza.style.setProperty('--item-in', entradaPieza(arriba, alto, retraso).toFixed(3));
        pieza.style.setProperty('--item-out', salidaPieza(arriba, escena.alto, techo).toFixed(3));
      },
    });
  });
  medirPiezas();
  window.addEventListener('resize', medirPiezas, { passive: true });

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
}
