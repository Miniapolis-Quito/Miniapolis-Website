/**
 * Portada: la apertura se prepara antes del primer fotograma.
 *
 * `portada.js` es un módulo y llega cuando la página ya se pintó: sin esto,
 * el titular se vería quieto un instante y luego saltaría a su posición de
 * salida. Este script es clásico y va en el <head>: solo marca
 * `.portada-intro`, que deja el titular listo para subir.
 *
 * Misma condición que portada.js (movimiento permitido y observadores
 * disponibles). Si el módulo no llega a montarse, la marca se retira sola y
 * la página queda estática y completa. En la misma sesión, la apertura se
 * salta el semáforo (`.portada-rapida`).
 */
(() => {
  const raiz = document.documentElement;
  const reducir = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reducir || typeof IntersectionObserver !== 'function') return;
  raiz.classList.add('portada-intro');
  try {
    if (sessionStorage.getItem('portada-vista') === '1') raiz.classList.add('portada-rapida');
  } catch { /* sin almacenamiento: apertura completa */ }
  setTimeout(() => {
    if (!raiz.classList.contains('portada-animada')) raiz.classList.remove('portada-intro');
  }, 3000);
})();
