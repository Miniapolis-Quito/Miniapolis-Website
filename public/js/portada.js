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

function montarEscenasScroll() {
  const escenas = [...document.querySelectorAll('[data-scroll-scene]')];
  if (reducir || escenas.length === 0) return;

  let pendiente = false;
  const limitar = (valor, minimo = 0, maximo = 1) => Math.min(maximo, Math.max(minimo, valor));
  const actualizar = () => {
    pendiente = false;
    const alto = window.innerHeight || 1;

    for (const escena of escenas) {
      const rectangulo = escena.getBoundingClientRect();
      const progreso = limitar((alto - rectangulo.top) / (alto + Math.max(rectangulo.height, 1)));
      const distancia = .5 - progreso;
      const nombre = escena.dataset.scrollScene;
      const entrada = limitar((progreso - .08) / .42);

      escena.style.setProperty('--escena-progreso', progreso.toFixed(3));
      escena.style.setProperty('--escena-foto-y', `${(distancia * 54).toFixed(1)}px`);
      escena.style.setProperty('--escena-foto-scale', (1 + Math.abs(distancia) * .035).toFixed(3));
      escena.style.setProperty('--escena-foto-opacity', (.76 + entrada * .24).toFixed(3));
      escena.style.setProperty('--escena-copy-y', `${(distancia * 38).toFixed(1)}px`);
      escena.style.setProperty('--escena-copy-opacity', (.72 + entrada * .28).toFixed(3));

      if (nombre === 'hero') {
        escena.style.setProperty('--escena-copy-y', `${(distancia * 42).toFixed(1)}px`);
        escena.style.setProperty('--escena-copy-opacity', (1 - Math.max(0, progreso - .72) * 1.2).toFixed(3));
        escena.style.setProperty('--escena-car-y', `${(distancia * 78).toFixed(1)}px`);
        escena.style.setProperty('--escena-car-rotate', `${(3 + distancia * 3).toFixed(2)}deg`);
        escena.style.setProperty('--escena-car-scale', (1 + Math.abs(distancia) * .035).toFixed(3));
      }

      if (nombre === 'telemetria') {
        escena.style.setProperty('--escena-bloque-y', `${(distancia * 22).toFixed(1)}px`);
      }

      if (nombre === 'galeria') {
        escena.style.setProperty('--escena-galeria-rotate', `${(distancia * 1.6).toFixed(2)}deg`);
      }

      if (nombre === 'acceso') {
        escena.style.setProperty('--escena-panel-y', `${(distancia * 26).toFixed(1)}px`);
        escena.style.setProperty('--escena-panel-scale', (1 + Math.abs(distancia) * .015).toFixed(3));
      }
    }
  };

  const programar = () => {
    if (pendiente) return;
    pendiente = true;
    window.requestAnimationFrame(actualizar);
  };

  actualizar();
  window.addEventListener('scroll', programar, { passive: true });
  window.addEventListener('resize', programar, { passive: true });
}

function montarCoreografiaCarrera() {
  const movimientos = [...document.querySelectorAll('[data-scroll-motion]')];
  if (reducir || movimientos.length === 0) return;

  let pendiente = false;
  const limitar = (valor, minimo = 0, maximo = 1) => Math.min(maximo, Math.max(minimo, valor));
  const actualizar = () => {
    pendiente = false;
    const alto = window.innerHeight || 1;

    for (const movimiento of movimientos) {
      const rectangulo = movimiento.getBoundingClientRect();
      const centro = rectangulo.top + rectangulo.height / 2;
      const cercania = limitar(1 - Math.abs(centro - alto / 2) / (alto * .92));
      const progreso = limitar((alto - rectangulo.top) / (alto + Math.max(rectangulo.height, 1)));
      const energia = Math.sin(cercania * Math.PI);
      const deriva = (progreso - .5) * 42;

      movimiento.style.setProperty('--carrera-progreso', progreso.toFixed(3));
      movimiento.style.setProperty('--carrera-energia', energia.toFixed(3));
      movimiento.style.setProperty('--carrera-deriva', `${deriva.toFixed(1)}px`);
      movimiento.style.setProperty('--carrera-inclinacion', `${((progreso - .5) * -1.8).toFixed(2)}deg`);

      if (movimiento.dataset.scrollMotion === 'salida') {
        movimiento.style.setProperty('--carrera-ambiente-x', `${(progreso * -42).toFixed(1)}px`);
        movimiento.style.setProperty('--carrera-ambiente-y', `${(progreso * 26).toFixed(1)}px`);
        movimiento.style.setProperty('--carrera-linea-x', `${(progreso * 160).toFixed(1)}px`);
        movimiento.style.setProperty('--carrera-velocidad', `${(1 + energia * .18).toFixed(3)}`);
      }
    }
  };

  const programar = () => {
    if (pendiente) return;
    pendiente = true;
    window.requestAnimationFrame(actualizar);
  };

  actualizar();
  window.addEventListener('scroll', programar, { passive: true });
  window.addEventListener('resize', programar, { passive: true });
}

function montarProgreso() {
  const barra = document.querySelector('#progreso-pista');
  if (!barra) return;

  const actualizar = () => {
    const maximo = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
    barra.style.setProperty('--progreso', `${Math.min(1, window.scrollY / maximo)}`);
    document.body.classList.toggle('scrolleado', window.scrollY > 16);
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
    root.style.setProperty('--puntero-hilo-x', `${((evento.clientX - window.innerWidth / 2) * .035).toFixed(1)}px`);
    root.style.setProperty('--puntero-hilo-y', `${((evento.clientY - window.innerHeight / 2) * .025).toFixed(1)}px`);
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
montarEscenasScroll();
montarCoreografiaCarrera();
montarProgreso();
montarMiraPuntero();
