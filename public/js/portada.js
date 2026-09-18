import { sinMovimiento } from './movimiento.js';

const reducir = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) || sinMovimiento();
const root = document.documentElement;

root.classList.add('portada-js');

function montarRevelado() {
  const piezas = [...document.querySelectorAll('.entrada__hero-copy, .entrada__telemetria, .entrada__cifras, .entrada__seccion-cabeza, .entrada__media-destacada-copy, .entrada__acceso-intro, .entrada__acceso-panel')];
  if (piezas.length === 0) return;

  if (reducir || typeof IntersectionObserver !== 'function') {
    piezas.forEach((pieza) => pieza.classList.add('portada-revela--visible'));
    return;
  }

  piezas.forEach((pieza, indice) => {
    pieza.classList.add('portada-revela');
    pieza.style.setProperty('--portada-retraso', `${Math.min(indice * 55, 330)}ms`);
  });

  const observador = new IntersectionObserver(
    (entradas) => {
      entradas
        .filter((entrada) => entrada.isIntersecting)
        .forEach((entrada) => {
          entrada.target.classList.add('portada-revela--visible');
          observador.unobserve(entrada.target);
        });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );

  piezas.forEach((pieza) => observador.observe(pieza));
  window.setTimeout(() => piezas.forEach((pieza) => pieza.classList.add('portada-revela--visible')), 2800);
}

function montarParallax() {
  const piezas = [...document.querySelectorAll('[data-depth]')];
  if (reducir || piezas.length === 0) return;

  let pendiente = false;
  const actualizar = () => {
    pendiente = false;
    const alto = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
    const avance = window.scrollY / alto;
    for (const pieza of piezas) {
      const profundidad = Number(pieza.dataset.depth) || 0;
      const distancia = (window.scrollY - pieza.offsetTop) * profundidad;
      pieza.style.setProperty('--parallax-y', `${Math.max(-18, Math.min(18, distancia * -0.08))}px`);
      pieza.style.setProperty('--avance-pista', avance.toFixed(3));
    }
  };
  const alDesplazar = () => {
    if (pendiente) return;
    pendiente = true;
    window.requestAnimationFrame(actualizar);
  };

  actualizar();
  window.addEventListener('scroll', alDesplazar, { passive: true });
  window.addEventListener('resize', alDesplazar, { passive: true });
}

function montarProgreso() {
  const barra = document.querySelector('#progreso-pista');
  if (!barra) return;

  const actualizar = () => {
    const maximo = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
    barra.style.setProperty('--progreso', `${Math.min(1, window.scrollY / maximo)}`);
  };

  actualizar();
  window.addEventListener('scroll', actualizar, { passive: true });
  window.addEventListener('resize', actualizar, { passive: true });
}

function montarHaloPuntero() {
  if (reducir || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;

  const halo = document.createElement('span');
  halo.className = 'entrada__halo-puntero';
  halo.setAttribute('aria-hidden', 'true');
  document.body.append(halo);

  let x = -100;
  let y = -100;
  let raf = 0;
  const pintar = () => {
    raf = 0;
    root.style.setProperty('--puntero-x', `${x}px`);
    root.style.setProperty('--puntero-y', `${y}px`);
  };
  window.addEventListener('pointermove', (evento) => {
    x = evento.clientX;
    y = evento.clientY;
    if (!raf) raf = window.requestAnimationFrame(pintar);
  }, { passive: true });
}

montarRevelado();
montarParallax();
montarProgreso();
montarHaloPuntero();
