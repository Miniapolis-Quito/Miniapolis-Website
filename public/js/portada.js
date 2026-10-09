/**
 * Portada: el arranque.
 *
 * Siempre (no mueven nada): el avance de lectura de la cabecera, la sección
 * activa en la navegación, el estado de hoy en la tabla de horarios y en la
 * apertura, los botones de la galería, la telemetría de la vuelta récord (en
 * la meta) y el teléfono de «Cómo funciona».
 *
 * Con movimiento permitido y GSAP cargado: las escenas ligadas al
 * desplazamiento (portada-escenas.js), lo que responde al puntero
 * (portada-tacto.js) y la apertura con el semáforo. Sin movimiento, o si GSAP
 * no llega, no se añade `.portada-animada` y la página queda completa y quieta.
 */
import { sinMovimiento } from './movimiento.js';
import { diaDeTexto, estadoJornada, progresoLectura, proximaJornada, rangoDeTexto, textoJornada, textoProximaJornada } from './portada-calculos.js';
import { montarEscenas } from './portada-escenas.js';
import { montarFunciona } from './portada-funciona.js';
import { montarTacto } from './portada-tacto.js';
import { montarTelemetria } from './portada-telemetria.js';

const raiz = document.documentElement;
const $ = (selector, base = document) => base.querySelector(selector);
const $$ = (selector, base = document) => [...base.querySelectorAll(selector)];
const { gsap, ScrollTrigger } = window;
const conMovimiento = !sinMovimiento()
  && typeof IntersectionObserver === 'function'
  && typeof gsap?.registerPlugin === 'function'
  && typeof ScrollTrigger === 'function';

// ---------------------------------------------------------------------------
// Avance de lectura
// ---------------------------------------------------------------------------

function montarAvance() {
  const barra = $('.sitio-progreso span');
  if (!barra) return;
  let pendiente = false;
  const pintar = () => {
    pendiente = false;
    barra.style.setProperty('--progreso', progresoLectura(window.scrollY, raiz.scrollHeight, window.innerHeight).toFixed(4));
  };
  const programar = () => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(pintar);
  };
  window.addEventListener('scroll', programar, { passive: true });
  window.addEventListener('resize', programar, { passive: true });
  pintar();
}

// ---------------------------------------------------------------------------
// Navegación: qué sección se está leyendo
// ---------------------------------------------------------------------------

function montarNavegacionActiva() {
  if (typeof IntersectionObserver !== 'function') return;
  const enlaces = $$('.sitio-nav a[href^="#"]');
  const porId = new Map(enlaces.map((enlace) => [enlace.getAttribute('href').slice(1), enlace]));
  const secciones = [...porId.keys()].map((id) => document.getElementById(id)).filter(Boolean);
  if (!secciones.length) return;

  const marcar = (id) => {
    for (const [clave, enlace] of porId) {
      if (clave === id) enlace.setAttribute('aria-current', 'location');
      else enlace.removeAttribute('aria-current');
    }
  };
  const observador = new IntersectionObserver((entradas) => {
    for (const entrada of entradas) {
      if (entrada.isIntersecting) marcar(entrada.target.id);
      else if (porId.get(entrada.target.id)?.hasAttribute('aria-current')) marcar('');
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  secciones.forEach((seccion) => observador.observe(seccion));
}

// ---------------------------------------------------------------------------
// Horarios: qué jornada es hoy y si la pista está abierta
// ---------------------------------------------------------------------------

/**
 * Junto al semáforo, la próxima jornada: si la pista está abierta, hasta
 * cuándo; si no, cuándo abre. Sale de la misma tabla de horarios.
 */
function montarEstadoPista(ahora = new Date()) {
  const semaforo = $('.hero__semaforo');
  if (!semaforo) return;
  const jornadas = $$('.horario').map((fila) => ({
    dia: diaDeTexto($('.horario__dia', fila)?.textContent ?? ''),
    rango: rangoDeTexto($('.horario__horas', fila)?.textContent ?? ''),
  }));
  const proxima = proximaJornada(jornadas, ahora);
  let rotulo = $('.hero__estado');
  if (!proxima) {
    rotulo?.remove();
    return;
  }
  if (!rotulo) {
    rotulo = document.createElement('p');
    rotulo.className = 'hero__estado';
    semaforo.after(rotulo);
  }
  rotulo.classList.toggle('hero__estado--abierta', proxima.abierta);
  rotulo.textContent = textoProximaJornada(proxima);
}

function montarHorarioVivo(ahora = new Date()) {
  for (const fila of $$('.horario')) {
    const rango = rangoDeTexto($('.horario__horas', fila)?.textContent ?? '');
    const estado = estadoJornada(diaDeTexto($('.horario__dia', fila)?.textContent ?? ''), rango, ahora);
    let etiqueta = $('.horario__estado', fila);
    if (!estado) {
      delete fila.dataset.estado;
      etiqueta?.remove();
      continue;
    }
    fila.dataset.estado = estado;
    if (!etiqueta) {
      etiqueta = document.createElement('span');
      etiqueta.className = 'horario__estado';
      fila.append(etiqueta);
    }
    etiqueta.textContent = textoJornada(estado, rango);
  }
}

// ---------------------------------------------------------------------------
// Galería: avanzar y retroceder con los botones (cuando no corre sola)
// ---------------------------------------------------------------------------

function montarGaleria() {
  const pista = $('#galeria-pista');
  const atras = $('[data-galeria="atras"]');
  const adelante = $('[data-galeria="adelante"]');
  if (!pista || !atras || !adelante) return;

  const actualizar = () => {
    const maximo = pista.scrollWidth - pista.clientWidth;
    atras.disabled = pista.scrollLeft <= 4;
    adelante.disabled = pista.scrollLeft >= maximo - 4;
  };
  const mover = (sentido) => {
    pista.scrollBy({ left: sentido * pista.clientWidth * 0.72, behavior: sinMovimiento() ? 'auto' : 'smooth' });
  };
  atras.addEventListener('click', () => mover(-1));
  adelante.addEventListener('click', () => mover(1));
  pista.addEventListener('scroll', () => requestAnimationFrame(actualizar), { passive: true });
  window.addEventListener('resize', actualizar, { passive: true });
  window.addEventListener('load', actualizar, { once: true });
  actualizar();
}

// ---------------------------------------------------------------------------
// Apertura: el semáforo se enciende, se apaga y el titular sale
// ---------------------------------------------------------------------------

/** Las cinco luces tardan 0,8 s en encenderse; se apagan un instante después. */
const LUCES_FUERA_MS = 1250;

function arrancarApertura(salir) {
  const repetida = raiz.classList.contains('portada-rapida') || !raiz.classList.contains('portada-intro');
  try { sessionStorage.setItem('portada-vista', '1'); } catch { /* sin almacenamiento: la apertura completa */ }

  const arrancar = () => requestAnimationFrame(() => {
    raiz.classList.remove('portada-luces');
    salir();
  });
  if (repetida) { arrancar(); return; }

  const imagen = $('.hero__foto img');
  const esperas = [document.fonts?.ready, imagen?.decode?.()].filter(Boolean);
  // El titular nunca espera más de un instante a la foto o a las fuentes.
  Promise.race([Promise.allSettled(esperas), new Promise((r) => setTimeout(r, 1200))]).then(() => {
    raiz.classList.add('portada-luces');
    setTimeout(arrancar, LUCES_FUERA_MS);
  });
}

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

montarAvance();
montarNavegacionActiva();
montarHorarioVivo();
setInterval(() => montarHorarioVivo(), 60_000);
montarEstadoPista();
setInterval(() => montarEstadoPista(), 60_000);
montarGaleria();
montarTelemetria();

/** Sin escenas: todo a la vista y en su sitio. */
function quedarseQuieta() {
  raiz.classList.remove('portada-intro', 'portada-luces', 'portada-animada');
}

function precargarImagenes() {
  const fotos = $$('main img[loading="lazy"]');
  if (!fotos.length) return;
  const pedir = (i) => {
    if (i >= fotos.length) return;
    const img = fotos[i];
    const siguiente = () => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => pedir(i + 1), { timeout: 300 });
      } else {
        setTimeout(() => pedir(i + 1), 50);
      }
    };
    img.decode?.().then(siguiente, siguiente) || siguiente();
  };
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => pedir(0), { timeout: 1200 });
  } else {
    setTimeout(() => pedir(0), 400);
  }
}

// El teléfono de «Cómo funciona» cambia de pantalla con o sin movimiento;
// con él, además, lo que llega a la pantalla sube y se enciende.
montarFunciona({ gsap: conMovimiento ? gsap : null });

if (conMovimiento) {
  raiz.classList.add('portada-animada');
  try {
    const escenas = montarEscenas(window);
    montarTacto(gsap);
    arrancarApertura(escenas.apertura);
    precargarImagenes();
  } catch (error) {
    // Un adorno nunca puede esconder el contenido: si algo falla al montar las
    // escenas, se deshace lo hecho y la portada queda quieta y completa.
    console.error(error);
    ScrollTrigger.getAll().forEach((t) => t.kill(true));
    gsap.set('.hero *, main [style]', { clearProps: 'all' });
    quedarseQuieta();
  }
} else {
  quedarseQuieta();
}
