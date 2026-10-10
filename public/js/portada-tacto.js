/**
 * Portada: lo que responde al puntero.
 *
 * Solo con ratón o trackpad y movimiento permitido. Lo que sigue al puntero
 * con suavidad (imanes, tarjetas) se mueve con `gsap.quickTo`, que reutiliza
 * una sola interpolación por propiedad: el puntero cambia de objetivo cien
 * veces por segundo y la pieza lo sigue sin reiniciar una transición CSS en
 * cada evento (que es lo que hace que un hover se sienta a tirones).
 *
 *  - Cursor: dos hojas en una misma imagen nativa, con un solo punto de clic.
 *    El navegador las mueve juntas sin esperar al dibujo de la página.
 *    Solo cambia su estado: brotan sobre enlaces y se recogen al pulsar.
 *  - Imán: los botones grandes se acercan al puntero. Se mueven con la
 *    propiedad CSS `translate` (variables --mx/--my), que no pisa el
 *    `transform` con el que el botón sube al pasar por encima.
 *  - Tarjetas de tienda: se inclinan hacia el puntero, la foto se desplaza al
 *    revés y un brillo sigue la luz.
 *  - Apertura: la foto de la nave se desplaza unos píxeles al revés que el
 *    puntero, como se mueve el fondo cuando uno gira la cabeza.
 *  - «Cómo funciona»: el teléfono se inclina hacia el puntero, como uno que
 *    se tiene en la mano para enseñarlo en la puerta.
 */
import { atraccion, limitar } from './portada-calculos.js';

const $$ = (selector, base = document) => [...base.querySelectorAll(selector)];

/** Lo único que el cursor reconoce como objetivo: lo que se puede pulsar. */
const CLICABLES = 'a, button, [role="tab"], label, summary';
const ESCRIBIBLES = 'input, textarea, select';

function montarCursor() {
  const raiz = document.documentElement;
  raiz.classList.add('cursor-propio');

  const esEnlace = (nodo) => nodo instanceof Element
    && !nodo.closest(`${ESCRIBIBLES}, :disabled, [aria-disabled="true"]`)
    && Boolean(nodo.closest(CLICABLES));
  // La posición pertenece al cursor nativo. Estos eventos solo cambian la
  // forma; no hay pointermove, interpolación ni espera de otro fotograma.
  window.addEventListener('pointerover', (evento) => {
    if (evento.pointerType !== 'mouse') return;
    raiz.classList.toggle('cursor--enlace', esEnlace(evento.target));
  }, { passive: true });
  window.addEventListener('pointerout', (evento) => {
    if (evento.pointerType !== 'mouse') return;
    raiz.classList.toggle('cursor--enlace', esEnlace(evento.relatedTarget));
  }, { passive: true });
  window.addEventListener('pointerdown', (evento) => {
    if (evento.pointerType === 'mouse' && evento.button === 0) raiz.classList.add('cursor--pulsado');
  }, { passive: true });
  const soltar = () => raiz.classList.remove('cursor--pulsado');
  window.addEventListener('pointerup', soltar, { passive: true });
  window.addEventListener('pointercancel', soltar, { passive: true });
  const salir = () => raiz.classList.remove('cursor--pulsado', 'cursor--enlace');
  document.documentElement.addEventListener('pointerleave', salir);
  window.addEventListener('blur', salir);
}

function montarImanes(gsap) {
  const selector = [
    '.hero__acciones .boton',
    '.hero__acciones .enlace-flecha',
    '.sitio-accion',
    '.agenda__accion .boton',
    '.pronto__texto .boton',
    '.seccion__cabeza .boton',
    '.galeria__boton',
    '.sitio-arriba',
  ].join(', ');
  for (const boton of $$(selector)) {
    gsap.set(boton, { '--mx': '0px', '--my': '0px' });
    const x = gsap.quickTo(boton, '--mx', { duration: 0.55, ease: 'power3' });
    const y = gsap.quickTo(boton, '--my', { duration: 0.55, ease: 'power3' });
    let caja = null;
    boton.addEventListener('pointerenter', () => { caja = boton.getBoundingClientRect(); });
    boton.addEventListener('pointermove', (evento) => {
      if (evento.pointerType !== 'mouse') return;
      caja ??= boton.getBoundingClientRect();
      const rx = (evento.clientX - (caja.left + caja.width / 2)) / (caja.width / 2);
      const ry = (evento.clientY - (caja.top + caja.height / 2)) / (caja.height / 2);
      x(atraccion(rx, 10));
      y(atraccion(ry, 7));
    }, { passive: true });
    boton.addEventListener('pointerleave', () => {
      caja = null;
      // Al soltarlo vuelve a su sitio con un pequeño rebote.
      gsap.to(boton, { '--mx': '0px', '--my': '0px', duration: 0.9, ease: 'elastic.out(1, 0.45)', overwrite: true });
    });
  }
}

function montarInclinacion(gsap) {
  for (const tarjeta of $$('.producto')) {
    const foto = tarjeta.querySelector('.producto__foto img');
    gsap.set(tarjeta, { transformPerspective: 900 });
    const rx = gsap.quickTo(tarjeta, 'rotationX', { duration: 0.5, ease: 'power3' });
    const ry = gsap.quickTo(tarjeta, 'rotationY', { duration: 0.5, ease: 'power3' });
    const sube = gsap.quickTo(tarjeta, 'y', { duration: 0.5, ease: 'power3' });
    const fx = foto ? gsap.quickTo(foto, 'xPercent', { duration: 0.6, ease: 'power3' }) : () => {};
    const fy = foto ? gsap.quickTo(foto, 'yPercent', { duration: 0.6, ease: 'power3' }) : () => {};
    const escala = foto ? gsap.quickTo(foto, 'scale', { duration: 0.6, ease: 'power3' }) : () => {};
    let caja = null;
    let ultBx = '';
    let ultBy = '';
    tarjeta.addEventListener('pointerenter', () => {
      caja = tarjeta.getBoundingClientRect();
      sube(-6);
      escala(1.07);
    });
    tarjeta.addEventListener('pointermove', (evento) => {
      if (evento.pointerType !== 'mouse') return;
      caja ??= tarjeta.getBoundingClientRect();
      const px = (evento.clientX - caja.left) / caja.width - 0.5;
      const py = (evento.clientY - caja.top) / caja.height - 0.5;
      ry(px * 12);
      rx(-py * 10);
      fx(-px * 5);
      fy(-py * 5);
      const bx = `${((px + 0.5) * 100).toFixed(1)}%`;
      const by = `${((py + 0.5) * 100).toFixed(1)}%`;
      if (bx !== ultBx) {
        ultBx = bx;
        tarjeta.style.setProperty('--brillo-x', bx);
      }
      if (by !== ultBy) {
        ultBy = by;
        tarjeta.style.setProperty('--brillo-y', by);
      }
    }, { passive: true });
    tarjeta.addEventListener('pointerleave', () => {
      caja = null;
      ultBx = '';
      ultBy = '';
      rx(0);
      ry(0);
      sube(0);
      fx(0);
      fy(0);
      escala(1);
    });
  }
}

function montarFondoApertura(gsap) {
  const hero = document.querySelector('.hero');
  const foto = hero?.querySelector('.hero__foto img');
  if (!hero || !foto) return;
  // `x` e `y` de GSAP y no `translate` del CSS: GSAP, que escala esta foto en
  // la apertura, absorbe `translate` en su propio `transform` y lo anula.
  const x = gsap.quickTo(foto, 'x', { duration: 1.4, ease: 'power3' });
  const y = gsap.quickTo(foto, 'y', { duration: 1.4, ease: 'power3' });
  hero.addEventListener('pointermove', (evento) => {
    if (evento.pointerType !== 'mouse') return;
    const rx = evento.clientX / window.innerWidth - 0.5;
    const ry = evento.clientY / window.innerHeight - 0.5;
    x(Math.round(-rx * 360) / 10);
    y(Math.round(-ry * 240) / 10);
  }, { passive: true });
  hero.addEventListener('pointerleave', () => {
    x(0);
    y(0);
  });
}

function montarTelefono(gsap) {
  const escena = document.querySelector('.funciona__escena');
  const marco = escena?.querySelector('.funciona__marco');
  if (!escena || !marco) return;
  gsap.set(marco, { transformPerspective: 1100 });
  const rx = gsap.quickTo(marco, 'rotationX', { duration: 0.8, ease: 'power3' });
  const ry = gsap.quickTo(marco, 'rotationY', { duration: 0.8, ease: 'power3' });
  escena.addEventListener('pointermove', (evento) => {
    if (evento.pointerType !== 'mouse') return;
    const caja = marco.getBoundingClientRect();
    const px = limitar((evento.clientX - (caja.left + caja.width / 2)) / window.innerWidth, -1, 1);
    const py = limitar((evento.clientY - (caja.top + caja.height / 2)) / window.innerHeight, -1, 1);
    ry(px * 16);
    rx(-py * 10);
  }, { passive: true });
  escena.addEventListener('pointerleave', () => {
    rx(0);
    ry(0);
  });
}

export function montarTacto(gsap) {
  if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
  montarCursor();
  montarImanes(gsap);
  montarInclinacion(gsap);
  montarFondoApertura(gsap);
  montarTelefono(gsap);
}
