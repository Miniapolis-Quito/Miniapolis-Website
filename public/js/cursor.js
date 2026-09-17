/**
 * Cursor propio: un punto que va pegado al ratón y un anillo que lo persigue
 * con retardo y reacciona a lo que hay debajo.
 *
 * Reglas que lo hacen seguro:
 *  - Solo en equipos con ratón de verdad. En un teléfono o una tableta no se
 *    monta nada: no hay puntero que seguir y el dedo tapa la pantalla.
 *  - Quien pide menos movimiento se queda con el cursor del sistema.
 *  - La clase que esconde el cursor nativo la pone este módulo, nunca el HTML:
 *    si el JavaScript no llega a ejecutarse, el ratón se ve con normalidad.
 *  - Sobre un campo de texto vuelve la barra del sistema, que es la que dice
 *    dónde se va a escribir.
 */

/** Qué se considera «algo con lo que se puede interactuar». */
const INTERACTIVO = 'a, button, [role="tab"], summary, label, select, input[type="checkbox"], .lista__item, .pack, .mini-pack, tbody tr, figure, .entrada__media-destacada';

/** Cuánto se acerca el anillo a su destino en cada cuadro: el retardo. */
const SEGUIMIENTO = 0.19;

/** Lo mismo para el halo, mucho más lento. */
const SEGUIMIENTO_HALO = 0.06;

export function montarCursor() {
  const conRaton = window.matchMedia?.('(hover: hover) and (pointer: fine)');
  const sinMovimiento = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (!conRaton?.matches || sinMovimiento?.matches) return;

  const halo = document.createElement('div');
  halo.className = 'cursor__halo';
  halo.setAttribute('aria-hidden', 'true');
  const punto = document.createElement('div');
  punto.className = 'cursor__punto';
  const anillo = document.createElement('div');
  anillo.className = 'cursor__anillo';
  punto.setAttribute('aria-hidden', 'true');
  anillo.setAttribute('aria-hidden', 'true');
  document.body.append(halo, punto, anillo);
  document.documentElement.classList.add('cursor-propio');

  let destinoX = window.innerWidth / 2;
  let destinoY = window.innerHeight / 2;
  let anilloX = destinoX;
  let anilloY = destinoY;
  let haloX = destinoX;
  let haloY = destinoY;
  let visible = false;

  const mover = (evento) => {
    destinoX = evento.clientX;
    destinoY = evento.clientY;
    punto.style.transform = `translate3d(${destinoX}px, ${destinoY}px, 0)`;
    if (!visible) {
      visible = true;
      punto.classList.add('cursor__punto--visible');
      anillo.classList.add('cursor__anillo--visible');
      halo.classList.add('cursor__halo--visible');
    }
  };

  const seguir = () => {
    anilloX += (destinoX - anilloX) * SEGUIMIENTO;
    anilloY += (destinoY - anilloY) * SEGUIMIENTO;
    anillo.style.transform = `translate3d(${anilloX}px, ${anilloY}px, 0)`;
    // El halo va bastante más atrás: se percibe como una luz de ambiente, no
    // como una pieza más del cursor.
    haloX += (destinoX - haloX) * SEGUIMIENTO_HALO;
    haloY += (destinoY - haloY) * SEGUIMIENTO_HALO;
    halo.style.transform = `translate3d(${haloX}px, ${haloY}px, 0)`;
    requestAnimationFrame(seguir);
  };
  requestAnimationFrame(seguir);

  document.addEventListener('mousemove', mover, { passive: true });

  // Al salir de la ventana el cursor desaparece; al volver, reaparece donde esté.
  document.addEventListener('mouseleave', () => {
    visible = false;
    punto.classList.remove('cursor__punto--visible');
    anillo.classList.remove('cursor__anillo--visible');
    halo.classList.remove('cursor__halo--visible');
  });

  document.addEventListener('mouseover', (evento) => {
    const objetivo = evento.target instanceof Element ? evento.target : null;
    anillo.classList.toggle('cursor__anillo--activo', Boolean(objetivo?.closest(INTERACTIVO)));
    // En un campo de texto manda la barra del sistema: dice dónde se escribe.
    const escribiendo = Boolean(objetivo?.closest('input:not([type="checkbox"]), textarea'));
    punto.classList.toggle('cursor__punto--oculto', escribiendo);
    anillo.classList.toggle('cursor__anillo--oculto', escribiendo);
  });

  document.addEventListener('mousedown', () => anillo.classList.add('cursor__anillo--pulsado'));
  document.addEventListener('mouseup', () => anillo.classList.remove('cursor__anillo--pulsado'));
}
