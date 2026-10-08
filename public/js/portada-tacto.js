/**
 * Portada: lo que responde al puntero.
 *
 * Solo con ratón o trackpad y movimiento permitido. Todo se mueve con
 * `gsap.quickTo`, que reutiliza una sola interpolación por propiedad: el
 * puntero cambia de objetivo cien veces por segundo y la pieza lo sigue con
 * suavidad, sin reiniciar una transición CSS en cada evento (que es lo que
 * hace que un hover se sienta a tirones).
 *
 *  - Cursor: un punto que va pegado al puntero y un aro sincronizado con él
 *    que se abre sobre lo que se puede pulsar.
 *  - Imán: los botones grandes se acercan al puntero. Se mueven con la
 *    propiedad CSS `translate` (variables --mx/--my), que no pisa el
 *    `transform` con el que el botón sube al pasar por encima.
 *  - Tarjetas de tienda: se inclinan hacia el puntero, la foto se desplaza al
 *    revés y un brillo sigue la luz.
 */
import { atraccion } from './portada-calculos.js';

const $$ = (selector, base = document) => [...base.querySelectorAll(selector)];

/** Lo único que el cursor reconoce como objetivo: lo que se puede pulsar. */
const CLICABLES = 'a, button, [role="tab"], label, summary';
const ESCRIBIBLES = 'input, textarea, select';

function montarCursor(gsap) {
  const cursor = document.createElement('div');
  cursor.className = 'cursor cursor--oculto';
  cursor.setAttribute('aria-hidden', 'true');
  const punto = document.createElement('span');
  punto.className = 'cursor__punto';
  const aro = document.createElement('span');
  aro.className = 'cursor__aro';
  cursor.append(aro, punto);
  document.body.append(cursor);
  document.documentElement.classList.add('cursor-propio');

  const xPunto = gsap.quickTo(punto, 'x', { duration: 0.08, ease: 'power3' });
  const yPunto = gsap.quickTo(punto, 'y', { duration: 0.08, ease: 'power3' });
  const xAro = gsap.quickTo(aro, 'x', { duration: 0.08, ease: 'power3' });
  const yAro = gsap.quickTo(aro, 'y', { duration: 0.08, ease: 'power3' });

  let dentro = false;
  window.addEventListener('pointermove', (evento) => {
    if (evento.pointerType !== 'mouse') return;
    if (!dentro) {
      // La primera vez el aro aparece donde está el puntero, sin viajar desde la esquina.
      gsap.set([punto, aro], { x: evento.clientX, y: evento.clientY });
      dentro = true;
    }
    xPunto(evento.clientX);
    yPunto(evento.clientY);
    xAro(evento.clientX);
    yAro(evento.clientY);
    const objetivo = evento.target instanceof Element ? evento.target : null;
    cursor.classList.toggle('cursor--enlace', Boolean(objetivo?.closest(CLICABLES)));
    cursor.classList.toggle('cursor--oculto', Boolean(objetivo?.closest(ESCRIBIBLES)));
  }, { passive: true });
  document.addEventListener('pointerleave', () => { cursor.classList.add('cursor--oculto'); dentro = false; });
  document.documentElement.addEventListener('pointerleave', () => { cursor.classList.add('cursor--oculto'); dentro = false; });
  window.addEventListener('pointerdown', () => cursor.classList.add('cursor--pulsado'), { passive: true });
  window.addEventListener('pointerup', () => cursor.classList.remove('cursor--pulsado'), { passive: true });
  window.addEventListener('blur', () => cursor.classList.add('cursor--oculto'));
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
      tarjeta.style.setProperty('--brillo-x', `${((px + 0.5) * 100).toFixed(1)}%`);
      tarjeta.style.setProperty('--brillo-y', `${((py + 0.5) * 100).toFixed(1)}%`);
    }, { passive: true });
    tarjeta.addEventListener('pointerleave', () => {
      caja = null;
      rx(0);
      ry(0);
      sube(0);
      fx(0);
      fy(0);
      escala(1);
    });
  }
}

export function montarTacto(gsap) {
  if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
  montarCursor(gsap);
  montarImanes(gsap);
  montarInclinacion(gsap);
}
