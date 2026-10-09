/**
 * Portada: la mira. La telemetría fija cada caja de contenido.
 *
 * El cursor es una mira táctica, y las cajas de la página responden en el
 * mismo idioma. Al llegar a una caja, un haz de lectura la recorre en el
 * sentido de la marcha (de izquierda a derecha) y la va imprimiendo; después
 * cuatro escuadras se cierran sobre ella, como al fijar un objetivo, y se
 * retiran: el dato queda limpio.
 *
 * Donde se lee en orden (los sectores del complejo, las filas de la ficha)
 * una sola mira viaja de caja en caja siguiendo la lectura.
 *
 * Es decorativa (`aria-hidden`) y solo existe con movimiento: la monta
 * portada-escenas.js. Lo que esconde, lo esconde con `clip-path`, que no saca
 * nada del orden del teclado.
 */

/** Hacia dónde se abre cada escuadra antes de cerrarse: arriba a la izquierda, y en el sentido del reloj. */
const ESQUINAS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
/** Cuánto se abren las escuadras antes de cerrarse, en píxeles. */
const APERTURA = 14;

/** Pone la mira (cuatro escuadras y el haz) dentro de una caja. Una sola vez por caja. */
export function ponerMira(caja, { haz = true } = {}) {
  const puesta = caja.querySelector(':scope > .mira');
  if (puesta) return puesta;
  // La mira se sitúa sobre la caja: si la caja no es ya una referencia, pasa a serlo.
  if (getComputedStyle(caja).position === 'static') caja.classList.add('con-mira');
  const mira = document.createElement('span');
  mira.className = 'mira';
  mira.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < ESQUINAS.length; i += 1) mira.append(document.createElement('i'));
  if (haz) {
    const rayo = document.createElement('b');
    rayo.className = 'mira__haz';
    mira.append(rayo);
  }
  caja.append(mira);
  return mira;
}

/** Las escuadras se cierran sobre la caja; con `retirar`, se apartan después. */
export function cerrarEscuadras(gsap, mira, { retirar = true } = {}) {
  const esquinas = mira.querySelectorAll(':scope > i');
  const tl = gsap.timeline();
  tl.fromTo(esquinas, {
    x: (i) => ESQUINAS[i][0] * APERTURA,
    y: (i) => ESQUINAS[i][1] * APERTURA,
    opacity: 0,
  }, { x: 0, y: 0, opacity: 1, duration: 0.55, ease: 'expo.out' });
  if (retirar) tl.to(esquinas, { opacity: 0, duration: 0.6, ease: 'power2.out' }, '+=0.5');
  return tl;
}

/**
 * Fija una caja: el haz la recorre y la imprime, y la mira se cierra sobre
 * ella. Devuelve la línea de tiempo (con `scrollTrigger`, se dispara sola;
 * sin él, se añade a otra escena).
 */
export function fijarCaja(gsap, caja, { duracion = 0.9, retraso = 0, retirar = true, scrollTrigger } = {}) {
  const mira = ponerMira(caja);
  const haz = mira.querySelector('.mira__haz');
  const tl = gsap.timeline({ delay: retraso, scrollTrigger });
  tl.fromTo(caja, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: duracion, ease: 'power3.inOut' }, 0)
    .fromTo(haz, { left: '0%', opacity: 1 }, { left: '100%', duration: duracion, ease: 'power3.inOut' }, 0)
    .to(haz, { opacity: 0, duration: 0.3, ease: 'power1.out' }, duracion)
    // Impresa la caja, sin recorte: su sombra y lo que asoma del borde vuelven.
    .set(caja, { clipPath: 'none' }, duracion)
    .add(cerrarEscuadras(gsap, mira, { retirar }), duracion * 0.72);
  return tl;
}

/**
 * Una mira que viaja de caja en caja dentro de `contenedor`.
 * `apuntar(caja, margen)` da su destino (posición y tamaño relativos al
 * contenedor, abierto `margen` píxeles por cada lado), para animarlo en una
 * escena o con `gsap.to`.
 */
export function miraViajera(contenedor) {
  const mira = ponerMira(contenedor, { haz: false });
  mira.classList.add('mira--viajera');
  const apuntar = (caja, margen = 0) => {
    const a = caja.getBoundingClientRect();
    const b = contenedor.getBoundingClientRect();
    return { x: a.left - b.left - margen, y: a.top - b.top - margen, width: a.width + margen * 2, height: a.height + margen * 2 };
  };
  return { mira, apuntar };
}
