/**
 * Portada: la vuelta por sectores.
 *
 * El hilo que cose la página: leerla es dar una vuelta al circuito. El
 * semáforo da la salida, cada sección numerada es un sector (01 Recorrido …
 * 10 Acceso) y la última recta termina en la bandera a cuadros de «Tu pase».
 *
 * Un indicador fijo cuenta la vuelta: el número del sector rueda como un
 * marcador, cada sector se llena mientras se recorre y el nombre del que está
 * en curso se lee al lado. Es una regla vertical en el margen izquierdo de
 * las pantallas anchas; en las estrechas no hay margen, y la cuenta la lleva
 * la cinta de cronometraje de la cabecera (portada.js), que lee los mismos
 * sectores con `leerSectores`. Al cruzar la meta el número se convierte en la
 * bandera y el pie da el tiempo de la vuelta, contado desde que se apagó el
 * semáforo.
 *
 * En la regla vertical corre además el cronómetro de la vuelta, como el
 * rótulo de tiempo de una retransmisión: al cruzar cada sector se detiene un
 * instante en verde con el parcial de ese sector y sigue corriendo; en la
 * meta se queda fijo en el tiempo final.
 *
 * Es decorativo (`aria-hidden`): la navegación de la cabecera ya dice dónde
 * se está. Solo existe con movimiento permitido; sin él no hay vuelta que
 * contar y la página queda quieta.
 */
import { cifrasRodando, progresosDeSectores, sectorEnCurso, tiempoDeVuelta, vueltaCompleta } from './portada-calculos.js';

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
export function leerSectores() {
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
  if (sectores.length < 2) return { darSalida() {}, desmontar() {} };
  const raiz = document.documentElement;

  const vuelta = crear('div', 'vuelta');
  vuelta.setAttribute('aria-hidden', 'true');
  // El marcador: una columna con todos los números y la bandera al final.
  const marcador = crear('span', 'vuelta__numero', vuelta);
  const pila = crear('span', 'vuelta__pila', marcador);
  for (const { numero } of sectores) crear('span', '', pila).textContent = numero;
  crear('i', 'vuelta__bandera', crear('span', '', pila));
  const crono = crear('span', 'vuelta__crono', vuelta);
  const tramos = crear('span', 'vuelta__sectores', vuelta);
  const rellenos = sectores.map(() => crear('b', '', crear('i', '', tramos)));
  const nombre = crear('span', 'vuelta__nombre', vuelta);
  const texto = crear('span', '', nombre);
  document.body.append(vuelta);
  raiz.classList.add('con-vuelta');

  const progresos = sectores.map(() => 0);
  const ultLlenados = sectores.map(() => '');
  // Cuánto se llenó cada tramo va en una variable: la hoja decide si crece a
  // lo alto (regla vertical) o a lo ancho (línea de arriba).
  const llenar = rellenos.map((relleno, i) => (valor) => {
    const str = valor.toFixed(4);
    if (str !== ultLlenados[i]) {
      ultLlenados[i] = str;
      relleno.style.setProperty('--llenado', str);
    }
  });
  const tramosVistos = [...tramos.children];
  let enCurso = -1;
  let meta = false;
  // El cronómetro arranca cuando se apaga el semáforo (darSalida); si la
  // apertura no llegara a darla, cuenta desde que se montó la vuelta.
  let salida = performance.now();
  let lectura = null;
  // El cronómetro: cuándo empezó el sector en curso y hasta cuándo se ve su parcial.
  let inicioSector = salida;
  let parcialHasta = 0;
  let tiempoFinal = '';
  let ultimoCrono = '';
  const escribirCrono = (valor) => {
    if (valor === ultimoCrono) return;
    ultimoCrono = valor;
    crono.textContent = valor;
  };
  const latir = () => {
    if (enCurso < 0) return;
    const ahora = performance.now();
    if (tiempoFinal) escribirCrono(tiempoFinal);
    else if (ahora >= parcialHasta) {
      crono.classList.remove('vuelta__crono--parcial');
      escribirCrono(tiempoDeVuelta(ahora - salida));
    }
  };
  gsap.ticker.add(latir);

  const rodar = (posicion) => gsap.to(pila, {
    yPercent: (-100 * posicion) / (sectores.length + 1),
    duration: 0.7,
    ease: 'expo.out',
    overwrite: true,
  });

  let transicionTexto = null;
  let rotuloActual = '';

  const rotular = (rotulo) => {
    if (rotuloActual === rotulo) return;
    rotuloActual = rotulo;
    transicionTexto?.kill();
    if (!texto.textContent) {
      texto.textContent = rotulo;
      transicionTexto = gsap.fromTo(texto, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.55, ease: 'expo.out' });
      return;
    }
    transicionTexto = gsap.timeline()
      .to(texto, { opacity: 0, y: -10, duration: 0.18, ease: 'power2.in' })
      .add(() => { texto.textContent = rotulo; })
      .fromTo(texto, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.55, ease: 'expo.out' });
  };

  // La meta: el tiempo de la vuelta se escribe en el pie, junto a «Volver
  // arriba» —que invita a dar otra—, y rueda como el tablero de salidas hasta
  // fijarse. Se anota la primera vez que se cruza la línea, como en la pista.
  const cronometrar = () => {
    const base = $('.sitio-pie__base');
    const tiempo = tiempoDeVuelta(performance.now() - salida);
    if (lectura || !base || !tiempo) return;
    tiempoFinal = tiempo;
    lectura = crear('p', 'sitio-vuelta');
    lectura.setAttribute('aria-hidden', 'true');
    crear('span', '', lectura).textContent = 'Tu vuelta';
    const cifras = crear('b', '', lectura);
    cifras.textContent = tiempo;
    base.insertBefore(lectura, $('.sitio-arriba', base));
    const rueda = { p: 0 };
    gsap.timeline()
      .from(lectura, { opacity: 0, y: 12, duration: 0.8, ease: 'expo.out' })
      .to(rueda, {
        p: 1,
        duration: 1.2,
        ease: 'power2.out',
        onUpdate: () => { cifras.textContent = cifrasRodando(tiempo, rueda.p); },
        onComplete: () => { cifras.textContent = tiempo; },
      }, 0);
  };

  // Al pasar a un sector nuevo, el parcial del que se deja se queda un
  // instante en el cronómetro, en verde.
  const marcarParcial = () => {
    const ahora = performance.now();
    const parcial = tiempoDeVuelta(ahora - inicioSector);
    inicioSector = ahora;
    if (!parcial || tiempoFinal) return;
    parcialHasta = ahora + 1600;
    crono.classList.add('vuelta__crono--parcial');
    escribirCrono(parcial);
    gsap.fromTo(crono, { opacity: 0.2, y: 6 }, { opacity: 1, y: 0, duration: 0.5, ease: 'expo.out', overwrite: true });
  };

  const actualizar = () => {
    const sector = sectorEnCurso(progresos);
    const llegada = vueltaCompleta(progresos);
    if (sector === enCurso && llegada === meta) return;
    if (sector > enCurso && enCurso >= 0) marcarParcial();
    else if (enCurso < 0) inicioSector = performance.now();
    enCurso = sector;
    meta = llegada;
    if (meta) cronometrar();
    vuelta.classList.toggle('vuelta--en-pista', sector >= 0);
    vuelta.classList.toggle('vuelta--meta', meta);
    tramosVistos.forEach((tramo, i) => tramo.classList.toggle('activo', i === sector));
    if (sector < 0) {
      rotuloActual = '';
      return;
    }
    rodar(meta ? sectores.length : sector);
    rotular(sectores[sector].nombre);
  };

  // Cada sector empieza cuando su sección cruza la mitad de la pantalla y
  // termina cuando la cruza la siguiente; el último, al final de la página.
  // Los límites se miden después de cada `refresh`, con las escenas fijas ya
  // en su sitio: una sección fija se mide por su envoltorio, que ocupa en la
  // página todo lo que dura la escena (ella misma puede estar clavada arriba).
  let inicios = [];
  let fin = 0;
  const medir = () => {
    const mitad = window.innerHeight / 2;
    inicios = sectores.map(({ seccion }) => {
      const ancla = seccion.parentElement?.classList.contains('pin-spacer') ? seccion.parentElement : seccion;
      return ancla.getBoundingClientRect().top + window.scrollY - mitad;
    });
    fin = ScrollTrigger.maxScroll(window);
  };
  // La posición manda, no el camino: un salto (un ancla, la tecla Fin) deja
  // cada sector recorrido o pendiente entero sin pasar por los de en medio.
  const pintar = (desplazado) => {
    // Las alturas fraccionarias se redondean: el final real de la página
    // puede quedar un píxel antes del medido, y la meta no se cruzaría nunca.
    const posicion = desplazado >= fin - 2 ? fin : desplazado;
    progresosDeSectores(posicion, inicios, fin).forEach((valor, i) => {
      if (valor === progresos[i]) return;
      progresos[i] = valor;
      llenar[i](valor);
    });
    actualizar();
  };
  const remedir = () => { medir(); pintar(window.scrollY); };
  ScrollTrigger.addEventListener('refresh', remedir);
  const seguimiento = ScrollTrigger.create({ start: 0, end: 'max', onUpdate: (self) => pintar(self.scroll()) });
  remedir();

  return {
    /** El semáforo se apagó: empieza a contar la vuelta. */
    darSalida() {
      salida = performance.now();
      inicioSector = salida;
    },
    desmontar() {
      gsap.ticker.remove(latir);
      ScrollTrigger.removeEventListener('refresh', remedir);
      seguimiento.kill();
      vuelta.remove();
      lectura?.remove();
      raiz.classList.remove('con-vuelta');
    },
  };
}
