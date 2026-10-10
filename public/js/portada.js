/**
 * Portada: el arranque.
 *
 * Siempre (no mueven nada): la cinta de cronometraje de la cabecera, la sección
 * activa en la navegación, el estado de hoy en la tabla de horarios y en la
 * apertura, los botones de la galería y el teléfono de «Cómo funciona».
 *
 * Con movimiento permitido y GSAP cargado: las escenas ligadas al
 * desplazamiento (portada-escenas.js), lo que responde al puntero
 * (portada-tacto.js) y la apertura con el semáforo. Sin movimiento, o si GSAP
 * no llega, no se añade `.portada-animada` y la página queda completa y quieta.
 */
import { sinMovimiento } from './movimiento.js';
import {
  diaDeTexto, estadoJornada, estelaSiguiente, limitar, posicionLectura, progresoLectura, proximaJornada, rangoDeTexto,
  sectorEnAvance, textoJornada, textoProximaJornada,
} from './portada-calculos.js';
import { montarEscenas } from './portada-escenas.js';
import { montarFunciona } from './portada-funciona.js';
import { montarTacto } from './portada-tacto.js';
import { leerSectores } from './portada-vuelta.js';

const raiz = document.documentElement;
const $ = (selector, base = document) => base.querySelector(selector);
const $$ = (selector, base = document) => [...base.querySelectorAll(selector)];
const { gsap, ScrollTrigger } = window;
const conMovimiento = !sinMovimiento()
  && typeof IntersectionObserver === 'function'
  && typeof gsap?.registerPlugin === 'function'
  && typeof ScrollTrigger === 'function';

// ---------------------------------------------------------------------------
// Avance de lectura: la cinta de cronometraje
// ---------------------------------------------------------------------------

/**
 * La cinta cuelga bajo la cabecera y lee la página como una vuelta: una marca
 * por sección numerada (los sectores de portada-vuelta.js), que se enciende
 * al pasarla y destella al cruzarla; la cabeza incandescente, con una estela
 * que se estira con la velocidad y apunta hacia donde se viene; y, mientras
 * se desplaza, una lectura de telemetría con el sector, su nombre y el
 * porcentaje. En la meta, bandera a cuadros.
 *
 * Todo se pinta en un solo fotograma por cambio y se compone (transformación
 * y variables): nada reescribe el layout. Sin movimiento no hay estela ni
 * destellos, pero la cinta sigue contando.
 */
function montarAvance() {
  const cinta = $('.sitio-progreso');
  const lectura = $('.sitio-progreso__lectura', cinta ?? document);
  if (!cinta || !lectura) return;
  const [numero, nombre, cifra] = lectura.children;
  const sectores = leerSectores();
  const pista = $('.sitio-progreso__sectores', cinta);
  const marcas = sectores.map(() => pista?.appendChild(document.createElement('i'))).filter(Boolean);
  const conEstela = !sinMovimiento();

  let inicios = [];
  const medir = () => {
    const recorrible = raiz.scrollHeight - window.innerHeight;
    const mitad = window.innerHeight / 2;
    // Como en la vuelta: un sector empieza cuando su sección cruza la mitad
    // de la pantalla, y una sección fija se mide por su envoltorio.
    inicios = sectores.map(({ seccion }) => {
      const ancla = seccion.parentElement?.classList.contains('pin-spacer') ? seccion.parentElement : seccion;
      return recorrible > 0 ? limitar((ancla.getBoundingClientRect().top + window.scrollY - mitad) / recorrible) : 0;
    });
    marcas.forEach((marca, i) => marca.style.setProperty('--en', inicios[i].toFixed(4)));
  };

  let enCurso = -2;
  let meta = false;
  let anchoLectura = 0;
  let ultimaCifra = '';
  let cruce = 0;
  // Al entrar en un sector nuevo su marca suelta una onda y la lectura se enciende.
  const cruzar = (marca) => {
    marca.classList.remove('destello');
    cinta.classList.add('sitio-progreso--cruce');
    requestAnimationFrame(() => marca.classList.add('destello'));
    clearTimeout(cruce);
    cruce = setTimeout(() => cinta.classList.remove('sitio-progreso--cruce'), 260);
  };
  const rotular = (sector, llegada) => {
    if (enCurso !== -2 && sector > enCurso && sector >= 0 && conEstela) cruzar(marcas[sector]);
    enCurso = sector;
    meta = llegada;
    marcas.forEach((marca, i) => marca.classList.toggle('pasada', i <= sector));
    cinta.classList.toggle('sitio-progreso--meta', llegada);
    numero.textContent = sector >= 0 ? sectores[sector].numero : '00';
    nombre.textContent = llegada ? 'Meta' : sector >= 0 ? sectores[sector].nombre : 'Parrilla';
    anchoLectura = lectura.offsetWidth;
  };

  let estela = 0;
  let sentido = 1;
  let ultimoY = window.scrollY;
  let ultimoT = performance.now();
  let pendiente = false;
  const pintar = (ahora = performance.now()) => {
    pendiente = false;
    const y = window.scrollY;
    const avance = progresoLectura(y, raiz.scrollHeight, window.innerHeight);
    const lapso = limitar(ahora - ultimoT, 8, 50);
    if (y !== ultimoY) sentido = y > ultimoY ? 1 : -1;
    estela = conEstela ? estelaSiguiente(estela, (y - ultimoY) / lapso) : 0;
    ultimoY = y;
    ultimoT = ahora;

    const sector = sectorEnAvance(inicios, avance);
    const llegada = avance >= 0.995;
    if (sector !== enCurso || llegada !== meta) rotular(sector, llegada);
    const texto = `${Math.round(avance * 100)}%`;
    if (texto !== ultimaCifra) {
      ultimaCifra = texto;
      cifra.textContent = texto;
      anchoLectura = lectura.offsetWidth;
    }

    cinta.style.setProperty('--progreso', avance.toFixed(4));
    cinta.style.setProperty('--estela', estela.toFixed(3));
    cinta.style.setProperty('--sentido', String(sentido));
    cinta.style.setProperty('--lectura-x', `${posicionLectura(avance, cinta.clientWidth, anchoLectura)}px`);
    // La estela se recoge sola, fotograma a fotograma, hasta apagarse.
    if (estela > 0) programar();
  };
  const programar = () => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(pintar);
  };

  // La lectura se enciende al desplazarse y se apaga al quedarse quieto.
  let reposo = 0;
  const despertar = () => {
    cinta.classList.add('sitio-progreso--rodando');
    clearTimeout(reposo);
    reposo = setTimeout(() => cinta.classList.remove('sitio-progreso--rodando'), 1200);
  };
  const remedir = () => {
    medir();
    programar();
  };

  window.addEventListener('scroll', programar, { passive: true });
  window.addEventListener('scroll', despertar, { passive: true });
  window.addEventListener('resize', remedir, { passive: true });
  // Las escenas fijas, las fotos y las fuentes cambian el largo de la página.
  if (typeof ResizeObserver === 'function') new ResizeObserver(remedir).observe(document.body);
  medir();
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
    ($('.hero__portico') ?? semaforo).after(rotulo);
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

function arrancarApertura(escenas) {
  const repetida = raiz.classList.contains('portada-rapida') || !raiz.classList.contains('portada-intro');
  try { sessionStorage.setItem('portada-vista', '1'); } catch { /* sin almacenamiento: la apertura completa */ }

  const arrancar = () => requestAnimationFrame(() => {
    raiz.classList.remove('portada-luces');
    escenas.apertura();
  });
  if (repetida) { arrancar(); return; }

  const imagen = $('.hero__foto img');
  const esperas = [document.fonts?.ready, imagen?.decode?.()].filter(Boolean);
  // El titular nunca espera más de un instante a la foto o a las fuentes.
  Promise.race([Promise.allSettled(esperas), new Promise((r) => setTimeout(r, 1200))]).then(() => {
    // El semáforo pasa al centro, como el pórtico de salida, y se encienden las luces.
    escenas.cuentaAtras?.();
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
    arrancarApertura(escenas);
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
