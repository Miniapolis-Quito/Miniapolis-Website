/**
 * Portada: la bandera a cuadros de la meta, ondeando.
 *
 * La banda que abre «Tu pase» es la línea de llegada. Con movimiento deja de
 * ser una tira quieta y se dibuja como una bandera de verdad: una tela de
 * cuadros blancos y negros que ondea con el viento —una onda que la recorre de
 * lado a lado, con luz en las crestas y sombra en los valles— y que ondea más
 * fuerte cuanto más rápido se baja. Solo se dibuja mientras se ve.
 *
 * Es decorativa: la banda ya es `aria-hidden`. Sin movimiento, o si el lienzo
 * no está disponible, queda la tira de cuadros del CSS.
 */
import { onda } from './portada-calculos.js';

const BLANCO = [244, 246, 243];
const NEGRO = [6, 7, 8];

export function montarBandera({ gsap, ScrollTrigger }) {
  const banda = document.querySelector('.acceso__bandera');
  const lienzo = document.createElement('canvas');
  const ctx = lienzo.getContext?.('2d');
  if (!banda || !ctx) return () => {};
  lienzo.className = 'acceso__lienzo';
  banda.append(lienzo);
  banda.classList.add('acceso__bandera--viva');

  let ancho = 0;
  let alto = 0;
  const medir = () => {
    const caja = banda.getBoundingClientRect();
    const densidad = Math.min(2, window.devicePixelRatio || 1);
    ancho = caja.width;
    alto = caja.height;
    lienzo.width = Math.round(ancho * densidad);
    lienzo.height = Math.round(alto * densidad);
    ctx.setTransform(densidad, 0, 0, densidad, 0, 0);
  };

  let tiempo = 0;
  let viento = 0;
  const dibujar = () => {
    if (!ancho || !alto) return;
    ctx.clearRect(0, 0, ancho, alto);
    const filas = 3;
    const amplitud = alto * (0.07 + 0.07 * viento);
    const lado = (alto - amplitud * 2.4) / filas;
    const columnas = Math.ceil(ancho / lado) + 1;
    const arriba = (alto - lado * filas) / 2;
    // Cada vértice de la tela sube y baja con la onda; la columna 0 es el
    // mástil y apenas se mueve.
    const punto = (i, j) => {
      const { desplazamiento } = onda(i, j, tiempo, columnas);
      return [i * lado, arriba + j * lado + desplazamiento * amplitud];
    };
    for (let i = 0; i < columnas; i += 1) {
      for (let j = 0; j < filas; j += 1) {
        const a = punto(i, j);
        const b = punto(i + 1, j);
        const c = punto(i + 1, j + 1);
        const d = punto(i, j + 1);
        // Luz en las crestas y sombra en los valles: la pendiente de la onda.
        const { luz } = onda(i + 0.5, j + 0.5, tiempo, columnas);
        const base = (i + j) % 2 ? NEGRO : BLANCO;
        const k = 0.78 + 0.22 * luz;
        ctx.fillStyle = `rgb(${Math.round(base[0] * k + (1 - k) * 18)},${Math.round(base[1] * k + (1 - k) * 18)},${Math.round(base[2] * k + (1 - k) * 18)})`;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.lineTo(d[0], d[1]);
        ctx.closePath();
        ctx.fill();
        // Sin esta pasada fina quedaría una costura clara entre celdas vecinas.
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }
  };

  const latir = (_, delta) => {
    tiempo += (delta / 1000) * (1 + viento * 1.6);
    viento *= 0.94;
    dibujar();
  };
  const seguimiento = ScrollTrigger.create({
    trigger: banda,
    start: 'top bottom',
    end: 'bottom top',
    // Fuera de la pantalla no se dibuja nada.
    onToggle: (self) => (self.isActive ? gsap.ticker.add(latir) : gsap.ticker.remove(latir)),
  });
  // Bajar rápido es más viento, pero solo mientras se despliega (el mismo
  // tramo que el recorte de portada-escenas.js). Ya desplegada, el scroll no
  // la toca: el viento amaina y sigue ondeando sola.
  const despliegue = ScrollTrigger.create({
    trigger: banda,
    start: 'top bottom',
    end: 'top 40%',
    onUpdate: (self) => {
      if (!self.isActive) return;
      viento = Math.min(1, Math.max(viento, Math.abs(self.getVelocity()) / 2400));
    },
  });
  const alCambiar = () => { medir(); dibujar(); };
  ScrollTrigger.addEventListener('refresh', alCambiar);
  medir();
  dibujar();

  return () => {
    gsap.ticker.remove(latir);
    seguimiento.kill();
    despliegue.kill();
    ScrollTrigger.removeEventListener('refresh', alCambiar);
    lienzo.remove();
    banda.classList.remove('acceso__bandera--viva');
  };
}
