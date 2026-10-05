/**
 * Portada: lo que se mueve y lo que dice la verdad del momento.
 *
 * Siempre (no mueven nada): el avance de lectura de la cabecera, la sección
 * activa en la navegación, el estado de hoy en la tabla de horarios y los
 * botones de la galería.
 *
 * Solo con movimiento: la apertura con el semáforo, el revelado de bloques,
 * el trazado del plano, el cronómetro de los récords y la foto de la apertura
 * que se aleja al bajar. Sin movimiento (preferencia del sistema o navegador
 * sin IntersectionObserver) no se añade `.portada-animada` y la página queda
 * completa y quieta.
 */
import { sinMovimiento } from './movimiento.js';
import {
  diaDeTexto, estadoJornada, progresoLectura, rangoDeTexto, textoJornada, tiempoEnTexto, valorContado,
} from './portada-calculos.js';

const raiz = document.documentElement;
const $ = (selector, base = document) => base.querySelector(selector);
const $$ = (selector, base = document) => [...base.querySelectorAll(selector)];
const conMovimiento = !sinMovimiento() && typeof IntersectionObserver === 'function';

// ---------------------------------------------------------------------------
// Avance de lectura y foto de la apertura
// ---------------------------------------------------------------------------

function montarDesplazamiento() {
  const barra = $('.sitio-progreso span');
  const hero = $('.hero');
  const foto = conMovimiento ? $('.hero__foto') : null;
  let pendiente = false;
  let altoHero = hero?.offsetHeight ?? 0;

  const pintar = () => {
    pendiente = false;
    const y = window.scrollY;
    barra?.style.setProperty('--progreso', progresoLectura(y, raiz.scrollHeight, window.innerHeight).toFixed(4));
    // La foto solo se mueve mientras se ve: más abajo no hay nada que escribir.
    if (foto && y <= altoHero) foto.style.setProperty('--hero-desplazamiento', `${(y * 0.28).toFixed(1)}px`);
  };
  const programar = () => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(pintar);
  };
  window.addEventListener('scroll', programar, { passive: true });
  window.addEventListener('resize', () => { altoHero = hero?.offsetHeight ?? 0; programar(); }, { passive: true });
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
// Galería: avanzar y retroceder con los botones
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

function arrancarApertura() {
  let repetida = raiz.classList.contains('portada-rapida');
  try { sessionStorage.setItem('portada-vista', '1'); } catch { /* sin almacenamiento: la apertura completa */ }
  if (!raiz.classList.contains('portada-intro')) repetida = true;

  const salir = () => requestAnimationFrame(() => {
    raiz.classList.remove('portada-luces');
    raiz.classList.remove('portada-intro');
  });
  if (repetida) { salir(); return; }

  const imagen = $('.hero__foto img');
  const esperas = [document.fonts?.ready, imagen?.decode?.()].filter(Boolean);
  // El titular nunca espera más de un instante a la foto o a las fuentes.
  Promise.race([Promise.allSettled(esperas), new Promise((r) => setTimeout(r, 1200))]).then(() => {
    raiz.classList.add('portada-luces');
    setTimeout(salir, LUCES_FUERA_MS);
  });
}

// ---------------------------------------------------------------------------
// Revelado: cada bloque aparece al llegar, en orden
// ---------------------------------------------------------------------------

function montarRevelado() {
  const bloques = $$('.revela');
  const observador = new IntersectionObserver((entradas) => {
    // Los que llegan juntos se escalonan; el que llega solo no espera.
    let orden = 0;
    for (const entrada of entradas) {
      if (!entrada.isIntersecting) continue;
      const bloque = entrada.target;
      bloque.style.setProperty('--orden', String(orden++));
      bloque.classList.add('visto');
      observador.unobserve(bloque);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  bloques.forEach((bloque) => observador.observe(bloque));
  // En papel no hay nada que esperar.
  window.addEventListener('beforeprint', () => bloques.forEach((bloque) => bloque.classList.add('visto')));
}

// ---------------------------------------------------------------------------
// Plano: el trazado se dibuja y un punto lo recorre mientras se ve
// ---------------------------------------------------------------------------

function montarPlano() {
  const plano = $('.plano');
  const svg = plano && $('svg', plano);
  const recorrido = plano && $('animateMotion', plano);
  if (!svg || typeof recorrido?.beginElement !== 'function') return;

  let arrancado = false;
  const observador = new IntersectionObserver(([entrada]) => {
    if (!entrada.isIntersecting) {
      svg.pauseAnimations?.();
      return;
    }
    if (arrancado) {
      svg.unpauseAnimations?.();
      return;
    }
    arrancado = true;
    // Primero se dibuja la línea (portada.css); después sale el punto.
    setTimeout(() => {
      plano.classList.add('en-marcha');
      recorrido.beginElement();
    }, 2900);
  }, { threshold: 0.35 });
  observador.observe(plano);
}

// ---------------------------------------------------------------------------
// Récords: el cronómetro corre hasta el tiempo real
// ---------------------------------------------------------------------------

function montarCronometro() {
  const tablero = $('.tiempos');
  const celdas = $$('.tiempo__marca', tablero ?? document).map((el) => ({
    el,
    final: el.textContent.trim(),
    valor: Number.parseFloat(el.textContent),
  }));
  if (!tablero || !celdas.length || celdas.some((c) => !Number.isFinite(c.valor))) return;

  const correr = ({ el, final, valor }, retraso) => {
    // El valor real queda para los lectores de pantalla; lo que corre es solo visual.
    el.setAttribute('aria-label', final);
    const duracion = 1400;
    const inicio = performance.now() + retraso;
    const paso = (ahora) => {
      const t = (ahora - inicio) / duracion;
      if (t >= 1) {
        el.textContent = final;
        el.removeAttribute('aria-label');
        return;
      }
      el.textContent = tiempoEnTexto(valorContado(valor, Math.max(0, t)), 2, final.length);
      requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  };
  const observador = new IntersectionObserver(([entrada]) => {
    if (!entrada.isIntersecting) return;
    observador.disconnect();
    celdas.forEach((celda, i) => correr(celda, 350 + i * 180));
  }, { threshold: 0.4 });
  observador.observe(tablero);
}

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

montarDesplazamiento();
montarNavegacionActiva();
montarHorarioVivo();
setInterval(() => montarHorarioVivo(), 60_000);
montarGaleria();

if (conMovimiento) {
  raiz.classList.add('portada-animada');
  montarRevelado();
  montarPlano();
  montarCronometro();
  arrancarApertura();
} else {
  raiz.classList.remove('portada-intro', 'portada-luces');
}
