/**
 * Efectos de la portada: lo que hace que la página se sienta viva además de
 * moverse con el scroll.
 *
 * Las funciones puras de arriba están probadas y no tocan el documento. Los
 * `montar*` de abajo sí lo hacen, y solo se llaman desde portada.js:
 *   - con movimiento: `montarEfectos(motor)`
 *   - siempre (no mueven nada): `montarHorarioVivo()` y `montarVolverArriba()`
 *
 * Todo lo que anima cuelga de `.portada-motor` en portada-efectos.css: sin
 * movimiento la página queda completa y quieta.
 */
import { fase, limitar, progresoMaximo, suavizar } from './portada-motor.js';

const $ = (selector, base = document) => base.querySelector(selector);
const $$ = (selector, base = document) => [...base.querySelectorAll(selector)];
const punteroFino = () => Boolean(window.matchMedia?.('(hover: hover) and (pointer: fine)').matches);

// ---------------------------------------------------------------------------
// Funciones puras
// ---------------------------------------------------------------------------

/** Parte un texto en tokens de palabra y de espacio, sin perder ninguno. */
export function partirTexto(texto) {
  return String(texto).split(/(\s+)/).filter((t) => t !== '');
}

/** Relleno de una palabra dentro de una frase que se ilumina de corrido: 0..1. */
export function rellenoPalabra(progreso, indice, total, holgura = 2) {
  return limitar(progreso * (total + holgura) - indice);
}

/** Cuenta de 0 al valor final con frenada suave; `t` es 0..1 del tiempo total. */
export function valorContado(objetivo, t) {
  const q = limitar(t);
  return objetivo * (1 - (1 - q) ** 3);
}

export function tiempoEnTexto(valor, decimales = 2) {
  return Number(valor).toFixed(decimales);
}

/** Cuánto se desplaza un botón hacia el puntero: una fracción de la distancia al centro. */
export function magnetismo(puntero, centro, fuerza = 0.28, tope = 12) {
  return Math.max(-tope, Math.min(tope, (puntero - centro) * fuerza));
}

/** Ritmo de una cinta: 1 en reposo; con scroll rápido acelera y, al subir, gira al revés. */
export function ritmoCinta(velocidad, sentido = 1, ganancia = 9) {
  return sentido * (1 + velocidad * ganancia);
}

const DIAS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const quitarTildes = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** «Sábados» → 6. Devuelve -1 si no es un día. */
export function diaDeTexto(texto) {
  const limpio = quitarTildes(String(texto).trim().toLowerCase());
  if (limpio in DIAS) return DIAS[limpio];
  const singular = limpio.replace(/s$/, '');
  return singular in DIAS ? DIAS[singular] : -1;
}

/** «19:00 — 23:30» → [1140, 1410] minutos desde la medianoche. */
export function rangoDeTexto(texto) {
  const horas = [...String(texto).matchAll(/(\d{1,2}):(\d{2})/g)].map((m) => Number(m[1]) * 60 + Number(m[2]));
  return horas.length >= 2 ? [horas[0], horas[1]] : null;
}

/** Ecuador no cambia de hora: UTC−5 todo el año. */
export function horaEcuador(ahora = new Date()) {
  const local = new Date(ahora.getTime() - 5 * 3600 * 1000);
  return { dia: local.getUTCDay(), minutos: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/**
 * Estado de una jornada de la tabla de horarios respecto a `ahora`:
 * 'abierto' (dentro del rango), 'hoy' (es hoy pero fuera de horario) o ''.
 */
export function estadoJornada(dia, rango, ahora = new Date()) {
  if (dia < 0 || !rango) return '';
  const hora = horaEcuador(ahora);
  if (hora.dia !== dia) return '';
  return hora.minutos >= rango[0] && hora.minutos < rango[1] ? 'abierto' : 'hoy';
}

// ---------------------------------------------------------------------------
// Sin movimiento: no animan nada, solo dicen la verdad del momento
// ---------------------------------------------------------------------------

/** Marca en la tabla de horarios cuál es la jornada de hoy y si la pista está abierta. */
export function montarHorarioVivo(ahora = new Date()) {
  for (const fila of $$('.portada__horario')) {
    const dia = diaDeTexto($('span', fila)?.textContent ?? '');
    const rango = rangoDeTexto($('strong', fila)?.textContent ?? '');
    const estado = estadoJornada(dia, rango, ahora);
    if (estado) fila.dataset.estado = estado;
  }
}

export function montarVolverArriba() {
  const enlace = $('.entrada__arriba');
  if (!enlace) return;
  enlace.addEventListener('click', (evento) => {
    evento.preventDefault();
    const reducir = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reducir ? 'auto' : 'smooth' });
  });
}

// ---------------------------------------------------------------------------
// Titular del hero: letra a letra
// ---------------------------------------------------------------------------

function partirLetras() {
  const titular = $('.portada__salida h1');
  if (!titular) return;
  titular.setAttribute('aria-label', titular.textContent.replace(/\s+/g, ' ').trim());
  let indice = 0;
  $$('.portada__linea > span', titular).forEach((linea) => {
    const texto = linea.textContent;
    linea.textContent = '';
    linea.classList.add('con-letras');
    for (const caracter of texto) {
      if (/\s/.test(caracter)) {
        linea.append(document.createTextNode(' '));
        continue;
      }
      const letra = document.createElement('span');
      letra.className = 'letra';
      letra.setAttribute('aria-hidden', 'true');
      letra.style.setProperty('--l', String(indice++));
      letra.textContent = caracter;
      linea.append(letra);
    }
  });
}

// ---------------------------------------------------------------------------
// Titulares de escena: palabra a palabra, atadas al scroll
// ---------------------------------------------------------------------------

function envolverPalabras(raiz) {
  let indice = 0;
  const recorrer = (nodo) => {
    for (const hijo of [...nodo.childNodes]) {
      if (hijo.nodeType === Node.ELEMENT_NODE) { recorrer(hijo); continue; }
      if (hijo.nodeType !== Node.TEXT_NODE) continue;
      const piezas = partirTexto(hijo.textContent).map((token) => {
        if (/^\s+$/.test(token)) return document.createTextNode(token);
        const palabra = document.createElement('span');
        palabra.className = 'palabra';
        palabra.style.setProperty('--w', String(indice++));
        const interior = document.createElement('span');
        interior.className = 'palabra__i';
        interior.textContent = token;
        palabra.append(interior);
        return palabra;
      });
      hijo.replaceWith(...piezas);
    }
  };
  recorrer(raiz);
  raiz.style.setProperty('--n', String(indice));
  return indice;
}

function montarPalabras() {
  $$('.portada__info h2, .portada__intro h2, .portada__comunidad-cierre').forEach((titulo) => {
    titulo.classList.add('con-palabras');
    envolverPalabras(titulo);
  });
}

// ---------------------------------------------------------------------------
// Cintas: el scroll las empuja; al subir, giran al revés
// ---------------------------------------------------------------------------

function montarCintas(motor) {
  const cintas = $$('.portada__cinta').map((cinta) => {
    const pista = $('.portada__cinta-pista', cinta);
    if (!pista || typeof pista.animate !== 'function') return null;
    const original = [...pista.children];
    const sentido = cinta.classList.contains('portada__cinta--inversa') ? -1 : 1;
    const estado = { cinta, pista, animacion: null, ritmo: sentido, sentido, visible: true };

    const armar = () => {
      estado.animacion?.cancel();
      [...pista.children].slice(original.length).forEach((nodo) => nodo.remove());
      const juego = () => original.map((nodo) => nodo.cloneNode(true));
      // Un «medio» tiene que cubrir la pantalla entera: la cinta se desplaza uno y salta al otro.
      let repeticiones = 1;
      while (repeticiones < 12 && pista.scrollWidth * repeticiones < window.innerWidth * 1.15) repeticiones += 1;
      const mitad = pista.scrollWidth * repeticiones;
      for (let i = 1; i < repeticiones * 2; i++) pista.append(...juego());
      const duracion = Math.max(18000, mitad * 22);
      estado.animacion = pista.animate(
        [{ transform: 'translate3d(0, 0, 0)' }, { transform: `translate3d(${-mitad}px, 0, 0)` }],
        { duration: duracion, iterations: Infinity, easing: 'linear' },
      );
      // Una animación infinita no puede retroceder desde el instante cero: se
      // arranca lejos de él para que la cinta gire al revés sin acabarse nunca.
      estado.animacion.currentTime = duracion * 200;
      estado.animacion.playbackRate = estado.ritmo;
    };
    armar();
    estado.armar = armar;
    return estado;
  }).filter(Boolean);
  if (!cintas.length) return;

  const observador = new IntersectionObserver((entradas) => {
    for (const entrada of entradas) {
      const estado = cintas.find((c) => c.cinta === entrada.target);
      if (!estado) continue;
      estado.visible = entrada.isIntersecting;
      if (entrada.isIntersecting) {
        estado.animacion?.play();
      } else if (estado.animacion) {
        // Fuera de pantalla vuelve a su ritmo base: no se queda a mil por hora.
        estado.ritmo = estado.sentido;
        estado.animacion.updatePlaybackRate?.(estado.sentido);
        estado.animacion.pause();
      }
    }
  }, { rootMargin: '120px 0px' });
  cintas.forEach((c) => observador.observe(c.cinta));

  // Un ritmo suave: el cambio de velocidad nunca es un tirón. El motor deja de
  // llamar cuando la página se queda quieta, así que el regreso al ritmo base
  // lo termina un bucle propio.
  let relajando = false;
  const acercar = (velocidad, dt) => {
    let pendiente = false;
    for (const estado of cintas) {
      if (!estado.visible || !estado.animacion) continue;
      const objetivo = ritmoCinta(velocidad, estado.sentido);
      estado.ritmo = suavizar(estado.ritmo, objetivo, 6, dt);
      if (Math.abs(estado.ritmo - objetivo) < 0.01) estado.ritmo = objetivo;
      else pendiente = true;
      estado.animacion.updatePlaybackRate?.(estado.ritmo);
    }
    return pendiente;
  };
  const relajar = () => {
    let ultimo = performance.now();
    const paso = (ahora) => {
      const dt = Math.min(.1, (ahora - ultimo) / 1000);
      ultimo = ahora;
      if (!relajando) return; // el motor volvió a mandar
      if (acercar(0, dt)) requestAnimationFrame(paso);
      else relajando = false;
    };
    requestAnimationFrame(paso);
  };
  motor.alCuadro(({ velocidad, dt }) => {
    if (relajando && velocidad !== 0) relajando = false; // el motor vuelve a mandar
    const pendiente = acercar(velocidad, dt);
    if (velocidad === 0 && pendiente && !relajando) {
      relajando = true;
      relajar();
    }
  });

  let ancho = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === ancho) return;
    ancho = window.innerWidth;
    cintas.forEach((c) => c.armar());
  }, { passive: true });
}

// ---------------------------------------------------------------------------
// Cabecera: en qué capítulo de la vuelta vamos
// ---------------------------------------------------------------------------

function montarCapitulos() {
  const secciones = $$('[data-capitulo]');
  const num = $('.entrada__capitulo-num');
  const nombre = $('.entrada__capitulo-nombre');
  const rotulo = $('.entrada__capitulo');
  if (!secciones.length || !num || !nombre || !rotulo) return;

  let actual = -1;
  const poner = (indice) => {
    if (indice === actual) return;
    actual = indice;
    num.textContent = String(indice).padStart(2, '0');
    nombre.textContent = secciones[indice].dataset.capitulo;
    rotulo.classList.remove('cambia');
    void rotulo.offsetWidth; // reinicia la animación de entrada
    rotulo.classList.add('cambia');
  };
  const observador = new IntersectionObserver((entradas) => {
    for (const entrada of entradas) {
      if (entrada.isIntersecting) poner(secciones.indexOf(entrada.target));
    }
  }, { rootMargin: '-46% 0px -53% 0px' });
  secciones.forEach((seccion) => observador.observe(seccion));
  poner(0);
}

// ---------------------------------------------------------------------------
// Hero: foco de luz, inclinación del auto y chispas
// ---------------------------------------------------------------------------

function montarPunteroDelHero() {
  if (!punteroFino()) return;
  const marco = $('.portada__salida-marco');
  if (!marco) return;
  window.addEventListener('pointermove', (evento) => {
    const r = marco.getBoundingClientRect();
    if (evento.clientY > r.bottom || evento.clientY < r.top) return;
    const x = (evento.clientX - r.left) / Math.max(r.width, 1);
    const y = (evento.clientY - r.top) / Math.max(r.height, 1);
    marco.style.setProperty('--foco-x', `${(x * 100).toFixed(1)}%`);
    marco.style.setProperty('--foco-y', `${(y * 100).toFixed(1)}%`);
    marco.style.setProperty('--foco-on', '1');
    marco.style.setProperty('--inclina-x', `${((.5 - y) * 9).toFixed(2)}deg`);
    marco.style.setProperty('--inclina-y', `${((x - .5) * 12).toFixed(2)}deg`);
  }, { passive: true });
  window.addEventListener('pointerout', (evento) => {
    if (!evento.relatedTarget) marco.style.setProperty('--foco-on', '0');
  }, { passive: true });
}

/** Motas de polvo y chispas verdes que suben por el hangar; se pausan fuera de pantalla. */
function montarChispas(motor) {
  const lienzo = $('.portada__chispas');
  const ctx = lienzo?.getContext?.('2d');
  if (!ctx) return;

  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 32;
  const sctx = sprite.getContext('2d');
  const halo = sctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  halo.addColorStop(0, 'rgba(214, 255, 150, 1)');
  halo.addColorStop(.35, 'rgba(147, 210, 65, .55)');
  halo.addColorStop(1, 'rgba(147, 210, 65, 0)');
  sctx.fillStyle = halo;
  sctx.fillRect(0, 0, 32, 32);

  let ancho = 0;
  let alto = 0;
  let motas = [];
  let visible = true;
  let corriendo = false;
  let ultimo = 0;
  let empuje = 0;

  const nueva = (arriba = false) => ({
    x: Math.random() * ancho,
    y: arriba ? alto + 20 : Math.random() * alto,
    r: 3 + Math.random() * 9,
    vy: 6 + Math.random() * 20,
    vx: (Math.random() - .3) * 9,
    fase: Math.random() * Math.PI * 2,
    alfa: .12 + Math.random() * .45,
  });
  const medir = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    ancho = lienzo.clientWidth;
    alto = lienzo.clientHeight;
    lienzo.width = Math.round(ancho * dpr);
    lienzo.height = Math.round(alto * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cantidad = Math.round(Math.min(70, Math.max(22, (ancho * alto) / 26000)));
    motas = Array.from({ length: cantidad }, () => nueva());
  };

  const cuadro = (ahora) => {
    if (!visible || document.hidden) { corriendo = false; return; }
    const dt = Math.min(.05, (ahora - ultimo) / 1000 || .016);
    ultimo = ahora;
    ctx.clearRect(0, 0, ancho, alto);
    for (const m of motas) {
      m.y -= (m.vy + empuje * 140) * dt;
      m.x += (m.vx + Math.sin(ahora / 900 + m.fase) * 6) * dt;
      if (m.y < -20 || m.x < -20 || m.x > ancho + 20) Object.assign(m, nueva(true));
      const parpadeo = .65 + Math.sin(ahora / 600 + m.fase * 3) * .35;
      ctx.globalAlpha = m.alfa * parpadeo;
      ctx.drawImage(sprite, m.x - m.r, m.y - m.r, m.r * 2, m.r * 2);
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(cuadro);
  };
  const despertar = () => {
    if (corriendo || !visible || document.hidden) return;
    corriendo = true;
    ultimo = performance.now();
    requestAnimationFrame(cuadro);
  };

  medir();
  new ResizeObserver(medir).observe(lienzo);
  new IntersectionObserver(([entrada]) => {
    visible = entrada.isIntersecting;
    if (visible) despertar();
  }).observe(lienzo);
  document.addEventListener('visibilitychange', despertar);
  motor.alCuadro(({ velocidad }) => { empuje = Math.abs(velocidad); });
  despertar();
}

// ---------------------------------------------------------------------------
// Botones magnéticos
// ---------------------------------------------------------------------------

function montarMagneticos() {
  if (!punteroFino()) return;
  const selector = '.portada__acciones .boton, .entrada__accion, .portada__enlace, .portada__info .boton, .entrada__arriba';
  $$(selector).forEach((el) => {
    let objetivo = { x: 0, y: 0 };
    let actual = { x: 0, y: 0 };
    let raf = 0;
    const pintar = () => {
      actual = { x: suavizar(actual.x, objetivo.x, 14, .016), y: suavizar(actual.y, objetivo.y, 14, .016) };
      el.style.translate = `${actual.x.toFixed(2)}px ${actual.y.toFixed(2)}px`;
      const reposo = Math.abs(actual.x - objetivo.x) < .05 && Math.abs(actual.y - objetivo.y) < .05;
      if (reposo && objetivo.x === 0 && objetivo.y === 0) { el.style.removeProperty('translate'); raf = 0; return; }
      raf = requestAnimationFrame(pintar);
    };
    const mover = (x, y) => { objetivo = { x, y }; if (!raf) raf = requestAnimationFrame(pintar); };
    el.addEventListener('pointermove', (evento) => {
      const r = el.getBoundingClientRect();
      mover(magnetismo(evento.clientX, r.left + r.width / 2), magnetismo(evento.clientY, r.top + r.height / 2, .34, 9));
    }, { passive: true });
    el.addEventListener('pointerleave', () => mover(0, 0), { passive: true });
  });
}

// ---------------------------------------------------------------------------
// Récords: el cronómetro cuenta hasta el tiempo real
// ---------------------------------------------------------------------------

function montarTiempos() {
  const celdas = $$('.portada__record b').map((el) => ({ el, final: el.textContent.trim(), valor: parseFloat(el.textContent) }));
  if (!celdas.length || celdas.some((c) => !Number.isFinite(c.valor))) return;
  const contar = ({ el, final, valor }, retraso) => {
    const duracion = 1500;
    const inicio = performance.now() + retraso;
    const paso = (ahora) => {
      const t = (ahora - inicio) / duracion;
      if (t >= 1) { el.textContent = final; return; }
      // Antes de arrancar enseña ceros: nunca una cifra falsa a medias.
      el.textContent = tiempoEnTexto(valorContado(valor, Math.max(0, t)));
      requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  };
  const seccion = $('.portada__records')?.closest('section');
  if (!seccion) return;
  const observador = new IntersectionObserver(([entrada]) => {
    if (!entrada.isIntersecting) return;
    observador.disconnect();
    celdas.forEach((celda, i) => contar(celda, 250 + i * 220));
  }, { threshold: 0.35 });
  observador.observe(seccion);
}

// ---------------------------------------------------------------------------
// Pie: el nombre se llena de verde al llegar al final
// ---------------------------------------------------------------------------

function montarPie(motor) {
  const gigante = $('.entrada__pie-gigante');
  if (!gigante) return;
  let maximo = 1;
  const escena = motor.registrar(gigante, {
    modo: 'vista',
    alActualizar: (p) => gigante.style.setProperty('--llena', fase(p / maximo, 0.1, 0.92).toFixed(3)),
  });
  motor.alMedir(() => {
    const restante = document.documentElement.scrollHeight - (escena.top + escena.alto);
    maximo = progresoMaximo(escena.alto, restante, window.innerHeight);
  });
}

// ---------------------------------------------------------------------------
// Pulso al pulsar: la mira suelta un anillo
// ---------------------------------------------------------------------------

function montarPulsoDeClic() {
  const mira = $('.entrada__mira');
  if (!mira) return;
  window.addEventListener('pointerdown', () => {
    mira.classList.remove('pulsa');
    void mira.offsetWidth;
    mira.classList.add('pulsa');
  }, { passive: true });
}

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

export function montarEfectos(motor) {
  partirLetras();
  montarPalabras();
  montarCintas(motor);
  montarCapitulos();
  montarPunteroDelHero();
  montarChispas(motor);
  montarMagneticos();
  montarTiempos();
  montarPie(motor);
  montarPulsoDeClic();
}
