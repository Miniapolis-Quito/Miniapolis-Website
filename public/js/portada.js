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

function montarMiraPuntero() {
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

  const esObjetivo = (nodo) => nodo?.closest?.('a, button, input, select, textarea, .entrada__foto, .entrada__hero-foto');
  window.addEventListener('pointermove', (evento) => {
    root.style.setProperty('--puntero-x', `${evento.clientX}px`);
    root.style.setProperty('--puntero-y', `${evento.clientY}px`);
  }, { passive: true });
  window.addEventListener('pointerover', (evento) => {
    root.classList.toggle('mira-sobre-objetivo', Boolean(esObjetivo(evento.target)));
  }, { passive: true });
  window.addEventListener('pointerout', (evento) => {
    if (!esObjetivo(evento.relatedTarget)) root.classList.remove('mira-sobre-objetivo');
  }, { passive: true });
}

montarRevelado();
montarParallax();
montarProgreso();
montarMiraPuntero();
