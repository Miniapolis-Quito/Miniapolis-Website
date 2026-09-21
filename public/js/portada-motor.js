/**
 * Motor de scroll de la portada.
 *
 * No secuestra el scroll: la página se desplaza de forma nativa y aquí solo se
 * suaviza lo que se pinta, para dar inercia. Publica variables CSS y el CSS
 * hace el resto:
 *
 *   :root   --scroll (0..1 de la página), --vel (-1..1), --vel-abs, --scroll-px
 *   escena  --p (0..1 de su recorrido)
 *
 * Las funciones de arriba son puras y están probadas. Nada de esto toca el
 * documento al importarse.
 */

export const limitar = (valor, minimo = 0, maximo = 1) => Math.min(maximo, Math.max(minimo, valor));

/** Acerca `actual` a `objetivo`; el resultado no depende de los fotogramas por segundo. */
export function suavizar(actual, objetivo, rigidez, dt) {
  return actual + (objetivo - actual) * (1 - Math.exp(-rigidez * dt));
}

/** Progreso de una escena fija (sticky): 0 al fijarse, 1 al soltarse. */
export function progresoFijo(scroll, inicio, largo) {
  if (largo <= 0) return scroll >= inicio ? 1 : 0;
  return limitar((scroll - inicio) / largo);
}

/** Progreso de una escena que cruza la pantalla: 0 al asomar por abajo, 1 al salir por arriba. */
export function progresoVista(scroll, altoVentana, top, alto) {
  return limitar((scroll + altoVentana - top) / (altoVentana + Math.max(alto, 1)));
}

export function normalizarVelocidad(pxPorSegundo, maximo = 2400) {
  return limitar(pxPorSegundo / maximo, -1, 1);
}

/** Un tramo [desde, hasta] de p convertido a 0..1. */
export function fase(p, desde, hasta) {
  if (hasta <= desde) return p >= desde ? 1 : 0;
  return limitar((p - desde) / (hasta - desde));
}

export const easeOutCubic = (t) => 1 - (1 - limitar(t)) ** 3;

/** Cuántas luces de cambio hay encendidas: enteras, y todas al llegar a 1. */
export function lucesEncendidas(p, total) {
  const q = limitar(p);
  if (q >= 1) return total;
  return Math.floor(q * total + 1e-9);
}

export function digitosDe(texto) {
  return [...String(texto)].filter((c) => c >= '0' && c <= '9').map(Number);
}

/** Cuánto ha entrado un panel del riel: 0 fuera por la derecha, 1 al pasar la mitad de la pantalla. */
export function entradaPanel(izquierdaEnPantalla, anchoVentana) {
  if (anchoVentana <= 0) return 1;
  return limitar((anchoVentana - izquierdaEnPantalla) / (anchoVentana * 0.5));
}
