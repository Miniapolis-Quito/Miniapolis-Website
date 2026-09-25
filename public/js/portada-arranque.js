/**
 * Portada: el telón baja antes del primer fotograma.
 *
 * `portada.js` es un módulo y llega cuando la página ya se pintó: sin esto, la
 * portada se ve quieta un instante y luego la tapa el telón del semáforo.
 * Este script es clásico y va en el <head>: solo marca `.portada-telon`, que
 * cubre la salida con el telón apagado hasta que el motor toma el relevo.
 *
 * Misma condición que el motor (movimiento permitido y observadores
 * disponibles). Si el motor no llega a montarse, el telón se retira solo y la
 * página queda estática y completa.
 */
(() => {
  const raiz = document.documentElement;
  const reducir = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reducir || typeof IntersectionObserver !== 'function' || typeof ResizeObserver !== 'function') return;
  raiz.classList.add('portada-telon');
  setTimeout(() => {
    if (!raiz.classList.contains('portada-motor')) raiz.classList.remove('portada-telon');
  }, 3000);
})();
