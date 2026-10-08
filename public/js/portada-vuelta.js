/**
 * Portada: la vuelta por sectores.
 *
 * El hilo que cose la página: leerla es dar una vuelta al circuito. El
 * semáforo da la salida, cada sección numerada es un sector (01 Recorrido …
 * 09 Acceso) y la última recta termina en la bandera a cuadros de «Tu pase».
 *
 * Un indicador fijo cuenta la vuelta: el número del sector rueda como un
 * marcador, cada sector se llena mientras se recorre y el nombre del que está
 * en curso se lee al lado. En pantallas anchas es una regla vertical en el
 * margen izquierdo; en las estrechas, una línea partida en sectores arriba
 * del todo. Al cruzar la meta el número se convierte en la bandera.
 *
 * Es decorativo (`aria-hidden`): la navegación de la cabecera ya dice dónde
 * se está. Solo existe con movimiento permitido; sin él no hay vuelta que
 * contar y la página queda quieta.
 */
import { sectorEnCurso, vueltaCompleta } from './portada-calculos.js';

const $ = (selector, base = document) => base.querySelector(selector);
const $$ = (selector, base = document) => [...base.querySelectorAll(selector)];

function crear(etiqueta, clase, padre) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  padre?.append(nodo);
  return nodo;
}

/**
 * Los sectores son las secciones con número, en el orden de la página. Se
 * buscan en todo `main` y no solo entre sus hijas: una sección fija (la
 * galería) va dentro del envoltorio que le pone ScrollTrigger.
 */
function leerSectores() {
  return $$('main section').flatMap((seccion) => {
    const indice = $('.seccion__indice', seccion);
    const numero = indice && $(':scope > span', indice);
    if (!numero) return [];
    const nombre = indice.textContent.replace(numero.textContent, '').replace(/\s+/g, ' ').trim();
    return [{ seccion, numero: numero.textContent.trim(), nombre }];
  });
}

export function montarVuelta({ gsap, ScrollTrigger }) {
  const sectores = leerSectores();
  if (sectores.length < 2) return () => {};
  const raiz = document.documentElement;

  const vuelta = crear('div', 'vuelta');
  vuelta.setAttribute('aria-hidden', 'true');
  // El marcador: una columna con todos los números y la bandera al final.
  const marcador = crear('span', 'vuelta__numero', vuelta);
  const pila = crear('span', 'vuelta__pila', marcador);
  for (const { numero } of sectores) crear('span', '', pila).textContent = numero;
  crear('i', 'vuelta__bandera', crear('span', '', pila));
  const tramos = crear('span', 'vuelta__sectores', vuelta);
  const rellenos = sectores.map(() => crear('b', '', crear('i', '', tramos)));
  const nombre = crear('span', 'vuelta__nombre', vuelta);
  const texto = crear('span', '', nombre);
  document.body.append(vuelta);
  raiz.classList.add('con-vuelta');

  const progresos = sectores.map(() => 0);
  // Cuánto se llenó cada tramo va en una variable: la hoja decide si crece a
  // lo alto (regla vertical) o a lo ancho (línea de arriba).
  const llenar = rellenos.map((relleno) => (valor) => relleno.style.setProperty('--llenado', valor.toFixed(4)));
  const tramosVistos = [...tramos.children];
  let enCurso = -1;
  let meta = false;

  const rodar = (posicion) => gsap.to(pila, {
    yPercent: (-100 * posicion) / (sectores.length + 1),
    duration: 0.7,
    ease: 'expo.out',
    overwrite: true,
  });

  const rotular = (rotulo) => {
    if (texto.textContent === rotulo) return;
    gsap.killTweensOf(texto);
    gsap.timeline()
      .to(texto, { opacity: 0, y: -10, duration: 0.18, ease: 'power2.in' })
      .add(() => { texto.textContent = rotulo; })
      .fromTo(texto, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.55, ease: 'expo.out' });
  };

  const actualizar = () => {
    const sector = sectorEnCurso(progresos);
    const llegada = vueltaCompleta(progresos);
    if (sector === enCurso && llegada === meta) return;
    enCurso = sector;
    meta = llegada;
    vuelta.classList.toggle('vuelta--en-pista', sector >= 0);
    vuelta.classList.toggle('vuelta--meta', meta);
    tramosVistos.forEach((tramo, i) => tramo.classList.toggle('activo', i === sector));
    if (sector < 0) return;
    rodar(meta ? sectores.length : sector);
    rotular(sectores[sector].nombre);
  };

  // Cada sector va de que su sección cruza la mitad de la pantalla a que la
  // cruza la siguiente; el último, hasta el final de la página. Así los
  // tramos son contiguos y siempre hay uno, y solo uno, en curso.
  const triggers = sectores.map(({ seccion }, i) => {
    const siguiente = sectores[i + 1]?.seccion;
    return ScrollTrigger.create({
      trigger: seccion,
      start: 'top center',
      ...(siguiente ? { endTrigger: siguiente, end: 'top center' } : { end: 'max' }),
      onUpdate: (self) => {
        progresos[i] = self.progress;
        llenar[i](self.progress);
        actualizar();
      },
      // Un salto (un ancla, la tecla Fin) cruza sectores sin pasar por ellos:
      // se dan por recorridos o por pendientes enteros.
      onLeave: () => { progresos[i] = 1; llenar[i](1); actualizar(); },
      onLeaveBack: () => { progresos[i] = 0; llenar[i](0); actualizar(); },
    });
  });

  return () => {
    triggers.forEach((t) => t.kill());
    vuelta.remove();
    raiz.classList.remove('con-vuelta');
  };
}
