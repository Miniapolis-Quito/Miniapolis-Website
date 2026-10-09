/**
 * Portada: estelas de velocidad en la apertura.
 *
 * Líneas de luz finas que salen del fondo de la nave —el punto de fuga de la
 * foto— hacia los bordes, como lo que se ve pasar a ras de pista. Quietas
 * casi no se notan; al bajar se alargan y se aceleran, y durante la salida
 * (la foto se acerca y el telón sube) la apertura entera acelera hacia la
 * pista.
 *
 * Un lienzo 2D, setenta líneas como mucho y nada que medir del documento en
 * cada fotograma: late con el reloj de GSAP y solo mientras la apertura se
 * ve. Las líneas viven en el lado de la foto: donde va el titular se apagan,
 * para que el texto se siga leyendo sobre su velo.
 *
 * Solo se monta con movimiento permitido (portada-escenas.js).
 */
const BLANCO = '244, 246, 243';
const VERDE = '147, 210, 65';

/** Paso suave entre `a` y `b`: 0 antes de `a`, 1 después de `b`. */
function paso(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function montarEstelas({ gsap, ScrollTrigger }) {
  const hero = document.querySelector('.hero');
  const sombra = hero?.querySelector('.hero__sombra');
  if (!hero || !sombra) return null;
  const lienzo = document.createElement('canvas');
  lienzo.className = 'hero__estelas';
  lienzo.setAttribute('aria-hidden', 'true');
  const ctx = lienzo.getContext?.('2d');
  if (!ctx) return null;
  sombra.after(lienzo);

  let ancho = 0;
  let alto = 0;
  let estrecha = false;
  let lineas = [];
  // Lo que acelera: el empuje de la rueda y el avance de la salida.
  let empuje = 0;
  let salida = 0;
  let ultimo = 0;

  const nueva = (lejos) => ({
    angulo: Math.random() * Math.PI * 2,
    // Distancia al punto de fuga, en fracción de la diagonal.
    r: lejos ? Math.random() : Math.random() * 0.12,
    rapidez: 0.05 + Math.random() * 0.09,
    grosor: 0.7 + Math.random() * 1.1,
    verde: Math.random() < 0.3,
  });

  const medir = () => {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    ancho = hero.clientWidth;
    alto = hero.clientHeight;
    estrecha = ancho < 760;
    lienzo.width = Math.round(ancho * dpr);
    lienzo.height = Math.round(alto * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cuantas = estrecha ? 34 : 70;
    lineas = Array.from({ length: cuantas }, () => nueva(true));
  };

  const pintar = (tiempo) => {
    const dt = Math.min(0.05, ultimo ? tiempo - ultimo : 0.016);
    ultimo = tiempo;
    // El empuje de la rueda se apaga solo en medio segundo.
    empuje *= Math.exp(-dt * 2.2);
    const intensidad = Math.min(1, 0.18 + Math.max(empuje, salida * 0.9));
    const fx = ancho * (estrecha ? 0.6 : 0.64);
    const fy = alto * (estrecha ? 0.4 : 0.47);
    const diagonal = Math.hypot(ancho, alto);
    ctx.clearRect(0, 0, ancho, alto);
    ctx.lineCap = 'round';
    for (const linea of lineas) {
      // Cuanto más lejos del fondo, más rápido pasa: perspectiva.
      linea.r += dt * linea.rapidez * (0.25 + linea.r * 2.4) * (0.6 + intensidad * 5);
      if (linea.r > 0.85) Object.assign(linea, nueva(false));
      const largo = (0.03 + linea.r * 0.2) * (0.5 + intensidad * 2.6);
      const cos = Math.cos(linea.angulo);
      const sen = Math.sin(linea.angulo);
      const x1 = fx + cos * linea.r * diagonal;
      const y1 = fy + sen * linea.r * diagonal;
      const x2 = fx + cos * (linea.r + largo) * diagonal;
      const y2 = fy + sen * (linea.r + largo) * diagonal;
      // Donde va el texto, las líneas se apagan.
      const zona = estrecha ? 1 - paso(0.45, 0.62, y2 / alto) : paso(0.38, 0.6, x2 / ancho);
      const alfa = Math.min(1, linea.r * 3) * zona * (0.16 + intensidad * 0.64);
      if (alfa < 0.01) continue;
      const color = linea.verde ? VERDE : BLANCO;
      const grosor = linea.grosor * (0.7 + linea.r) * (1 + intensidad * 0.8);
      // Dos pasadas: un halo ancho y tenue y el núcleo, fino y nítido. Se
      // lee como luz y no como una raya, sin el coste de un desenfoque.
      for (const [ancho, peso] of [[grosor * 4, 0.22], [grosor, 1]]) {
        const degradado = ctx.createLinearGradient(x1, y1, x2, y2);
        degradado.addColorStop(0, `rgba(${color}, 0)`);
        degradado.addColorStop(1, `rgba(${color}, ${Math.min(1, alfa * peso).toFixed(3)})`);
        ctx.strokeStyle = degradado;
        ctx.lineWidth = ancho;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
  };

  medir();
  let latiendo = false;
  const encender = (si) => {
    if (si === latiendo) return;
    latiendo = si;
    ultimo = 0;
    if (si) gsap.ticker.add(pintar);
    else gsap.ticker.remove(pintar);
  };
  ScrollTrigger.create({
    trigger: hero,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => encender(self.isActive),
    onUpdate: (self) => { empuje = Math.max(empuje, Math.min(1, Math.abs(self.getVelocity()) / 2600)); },
  });
  ScrollTrigger.addEventListener('refresh', medir);
  encender(ScrollTrigger.isInViewport(hero));

  return {
    /** La salida avanza (0..1): las estelas aceleran con ella. */
    acelerar(p) { salida = p; },
  };
}
