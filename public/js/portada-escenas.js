/**
 * Portada: las escenas ligadas al desplazamiento.
 *
 * La página se cuenta como una vuelta al circuito: el semáforo da la salida,
 * la pista sube como un telón sobre la apertura, cada sección numerada es un
 * sector (portada-vuelta.js lleva la cuenta) y la vuelta termina en la
 * bandera a cuadros de «Tu pase».
 *
 * Todo lo mueve GSAP con ScrollTrigger, con un vocabulario corto que se
 * repite en todas las secciones para que la página se lea como una sola pieza:
 *
 *  - Encabezados: primero el índice (el número sube como un marcador y su
 *    línea se traza), luego el titular palabra a palabra y al final la
 *    entradilla línea a línea. Un solo disparo por encabezado: la jerarquía
 *    se lee en el orden en que aparece.
 *  - Fotos: se descubren de abajo arriba mientras la imagen se asienta, y al
 *    pasar se desplazan un poco más despacio que la página.
 *  - Cajas (cifras, filas, tarjetas, paneles): la telemetría las fija
 *    (portada-mira.js). Un haz de lectura las imprime en el sentido de la
 *    marcha y una mira, la misma del cursor, se cierra sobre ellas. Donde se
 *    lee en orden, una sola mira sigue la lectura de caja en caja.
 *  - Datos: lo que se cuenta se cuenta como en la pista —foto finish en los
 *    récords (un reloj común, cada piloto cruza en su tiempo), las cifras que
 *    ruedan como en un tablero de salidas, fechas que se confirman—.
 *  - Escenas fijas (solo en pantallas anchas): la salida; la curva que entra
 *    a pantalla completa y vuelve a su casilla del mosaico; el complejo, que
 *    enciende su entradilla palabra a palabra y da la vuelta por sus cinco
 *    sectores; y la galería que corre de lado enfocando cada foto.
 *  - La marquesina corre sola y el desplazamiento le da gas; la meta ondea
 *    una bandera a cuadros de verdad (portada-bandera.js).
 *  - Ambiente: la nave que respira tras la apertura, el
 *    número de cada sector enorme y de contorno detrás de su encabezado y, al
 *    final, el nombre de la pista que se llena de verde al cruzar la meta.
 *
 * Cada escena se monta dentro de `gsap.matchMedia()`: al cambiar de formato
 * (girar el teléfono, estrechar la ventana) se deshace sola y se vuelve a
 * montar la que toca, sin dejar estilos en línea huérfanos.
 *
 * Solo se llama con movimiento permitido (portada.js lo decide). Las cuentas
 * puras viven en portada-calculos.js.
 */
import {
  cifrasRodando, empujePorVelocidad, enCarrera, enfoqueGaleria, formatoMiles, inclinacionPorVelocidad,
  momentosDeLlegada, posicionesEnRecorrido, salidaDeCarrera, tiempoEnTexto,
} from './portada-calculos.js';
import { montarBandera } from './portada-bandera.js';
import { cerrarEscuadras, fijarCaja, miraViajera, ponerMira } from './portada-mira.js';
import { montarVuelta } from './portada-vuelta.js';

const $ = (selector, base = document) => base.querySelector(selector);
const $$ = (selector, base = document) => [...base.querySelectorAll(selector)];

/*
 * Lo que espera a revelarse se apaga con `opacity` y nunca con `visibility`
 * (el `autoAlpha` de GSAP): un enlace o un campo invisible pero presente se
 * puede enfocar con el teclado, y al enfocarlo el navegador lo trae a la
 * vista y se revela. Con `visibility: hidden` el teclado se lo saltaría.
 */

/** Al entrar en pantalla se reproduce; al volver a salir por abajo, se deshace. */
const alEntrar = (trigger, start = 'top 86%') => ({ trigger, start, toggleActions: 'play none none reverse' });
/** Una sola vez: para lo que cuenta y no tiene sentido volver a contar. */
const unaVez = (trigger, start = 'top 82%') => ({ trigger, start, once: true });
/** Paso de la escalera entre piezas hermanas. */
const ESCALON = 0.08;
/** Lo que sube para aparecer: siempre la misma distancia y el mismo tiempo. */
const SUBIDA = { opacity: 0, y: 36, duration: 1.1 };

export function montarEscenas({ gsap, ScrollTrigger, SplitText, MotionPathPlugin, Lenis }) {
  gsap.registerPlugin(ScrollTrigger, ...[SplitText, MotionPathPlugin].filter(Boolean));
  ScrollTrigger.config({ ignoreMobileResize: true });
  gsap.defaults({ ease: 'expo.out', duration: 1.1 });

  const cabecera = $('.sitio-barra');
  const altoCabecera = () => cabecera?.offsetHeight ?? 72;
  const partir = (el, vars) => (SplitText ? SplitText.create(el, { aria: 'auto', autoSplit: true, ...vars }) : null);
  /** La telemetría fija una caja (portada-mira.js): el haz la imprime y la mira se cierra sobre ella. */
  const fijar = (caja, opciones) => fijarCaja(gsap, caja, opciones);
  /**
   * Las cifras de un dato ruedan hasta su valor, como en el tablero de
   * salidas, una sola vez. Mientras ruedan se anuncia el valor real.
   */
  const rodarCifras = (el, { duracion = 1.1 } = {}) => {
    if (!el || el.dataset.rodado) return;
    const final = el.textContent;
    if (!/\d/.test(final)) return;
    el.dataset.rodado = 'si';
    const rueda = { p: 0 };
    gsap.to(rueda, {
      p: 1,
      duration: duracion,
      ease: 'power2.out',
      onStart: () => el.setAttribute('aria-label', final),
      onUpdate: () => { el.textContent = cifrasRodando(final, rueda.p); },
      onComplete: () => {
        el.textContent = final;
        el.removeAttribute('aria-label');
      },
    });
  };
  const escenas = { lenis: null, apertura: null, vuelta: null };


  // -------------------------------------------------------------------------
  // Desplazamiento suave (solo con ratón o trackpad)
  // -------------------------------------------------------------------------

  // Cada escena con dos versiones (pantalla ancha y estrecha) lleva además la
  // condición `todas: 'all'`: matchMedia solo llama a la función si alguna de
  // sus condiciones se cumple, y sin ella la versión estrecha nunca correría.
  const mm = gsap.matchMedia();
  mm.add('(hover: hover) and (pointer: fine)', () => {
    if (typeof Lenis !== 'function') return undefined;
    const lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1, anchors: { offset: -altoCabecera() }, autoRaf: false });
    const latir = (tiempo) => lenis.raf(tiempo * 1000);
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(latir);
    gsap.ticker.lagSmoothing(0);
    escenas.lenis = lenis;
    return () => {
      gsap.ticker.remove(latir);
      lenis.destroy();
      escenas.lenis = null;
    };
  });

  // -------------------------------------------------------------------------
  // Cabecera: se aparta al bajar y vuelve al subir
  // -------------------------------------------------------------------------

  if (cabecera) {
    const mover = gsap.quickTo(cabecera, 'yPercent', { duration: 0.45, ease: 'power3.out' });
    let visible = true;
    const poner = (ver) => {
      if (ver === visible) return;
      visible = ver;
      mover(ver ? 0 : -100);
    };
    ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate: (self) => {
        // Arriba del todo, al subir o con el foco dentro, la cabecera se ve.
        poner(self.scroll() < 140 || self.direction < 0 || cabecera.contains(document.activeElement));
      },
    });
    cabecera.addEventListener('focusin', () => poner(true));
  }

  // -------------------------------------------------------------------------
  // Salida: el titular sale letra a letra; al bajar, la pista sube como un telón
  // -------------------------------------------------------------------------

  const hero = $('.hero');
  const tituloHero = $('#titulo-entrada');
  const lineas = $$('.hero__linea > span');
  // El titular se anuncia entero; sus letras sueltas no.
  if (tituloHero && SplitText) {
    tituloHero.setAttribute('aria-label', tituloHero.textContent.replace(/\s+/g, ' ').trim());
    lineas.forEach((linea) => linea.setAttribute('aria-hidden', 'true'));
  }
  const letrasPorLinea = lineas.map((linea) => partir(linea, { type: 'chars', charsClass: 'letra-split', autoSplit: false, aria: 'none' })?.chars ?? [linea]);

  // El pórtico de salida: durante la cuenta atrás el semáforo va grande en el
  // centro de la pantalla, sobre la nave a media luz. Al apagarse vuelve a su
  // sitio mientras el titular arranca. Se mueve su caja (`.hero__portico`) y no
  // él: el `transform` del semáforo ya es de la salida, que lo aparta al bajar.
  const portico = $('.hero__portico');
  const fotoHero = $('.hero__foto img');
  let enPortico = false;
  escenas.cuentaAtras = () => {
    const caja = portico?.getBoundingClientRect();
    if (!caja?.width) return;
    enPortico = true;
    const escala = Math.min(3.4, (window.innerWidth * 0.7) / caja.width);
    gsap.set(portico, {
      x: window.innerWidth / 2 - (caja.left + caja.width / 2),
      y: window.innerHeight * 0.46 - (caja.top + caja.height / 2),
      scale: escala,
    });
    gsap.from(portico, { scale: escala * 0.8, duration: 0.5, ease: 'expo.out' });
    if (fotoHero) gsap.set(fotoHero, { filter: 'brightness(0.42)' });
  };

  // Después de la apertura la nave respira: un acercamiento lentísimo, de ida
  // y vuelta, para que la portada no se quede en una foto quieta. Se detiene
  // mientras la apertura no se ve.
  let respiro = null;
  const respirar = () => {
    if (!fotoHero || !hero || respiro) return;
    respiro = gsap.to(fotoHero, { scale: 1.06, duration: 18, ease: 'sine.inOut', repeat: -1, yoyo: true });
    ScrollTrigger.create({ trigger: hero, start: 'top bottom', end: 'bottom top', onToggle: (self) => respiro.paused(!self.isActive) });
  };

  escenas.apertura = () => {
    // Las luces se apagaron: es la salida y empieza a contar la vuelta.
    escenas.vuelta?.darSalida();
    // Primero se retira la clase que lo ocultaba antes del primer fotograma:
    // `from()` toma como destino el estado actual, y tiene que ser el visible.
    // Todo ocurre en la misma tarea, así que no llega a pintarse nada a medias.
    document.documentElement.classList.remove('portada-intro');
    const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
    if (enPortico) {
      // Luces fuera: el pórtico vuelve a su sitio y la nave se enciende
      // mientras sale el titular.
      enPortico = false;
      tl.to(portico, { x: 0, y: 0, scale: 1, duration: 0.95, ease: 'expo.inOut', clearProps: 'transform' }, 0);
      if (fotoHero) tl.to(fotoHero, { filter: 'brightness(1)', duration: 1.1, ease: 'power2.out', clearProps: 'filter' }, 0.05);
    }
    tl.set(lineas, { yPercent: 0 })
      .from(letrasPorLinea.flat(), { yPercent: 118, rotate: 6, duration: 1.25, stagger: 0.035 }, 0)
      .from('.hero__foto img', { scale: 1.16, duration: 2.6, ease: 'power3.out' }, 0)
      .call(respirar, null, 2.6)
      .from('.hero__kicker', { opacity: 0, x: -36, duration: 1 }, 0.15)
      .from('.hero__estado', { opacity: 0, x: -16, duration: 1 }, 0.3)
      .from('.hero__lead', { opacity: 0, y: 26, duration: 1 }, 0.4)
      // Los botones tienen sus propias transiciones de hover: se mueve su caja.
      .from('.hero__acciones', { opacity: 0, y: 26, duration: 1 }, 0.5)
      .from('.hero__guia', { opacity: 0, duration: 1.2 }, 1.1);
    // Las cifras se fijan una a una (el haz las imprime) mientras se cuentan desde cero.
    $$('.hero__cifras .cifra').forEach((cifra, i) => tl.add(fijar(cifra, { duracion: 0.8 }), 0.6 + i * ESCALON));
    for (const valor of $$('.hero__cifras .cifra__valor')) {
      const nodo = [...valor.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && /^\s*[\d.]+\s*$/.test(n.textContent));
      if (!nodo) continue;
      const final = Number(nodo.textContent.replace(/\./g, ''));
      const cuenta = { v: 0 };
      tl.to(cuenta, {
        v: final,
        duration: 1.6,
        ease: 'power2.out',
        onUpdate: () => { nodo.textContent = formatoMiles(Math.round(cuenta.v)); },
      }, 0.7);
    }
    return tl;
  };

  mm.add({ ancho: '(min-width: 900px) and (min-aspect-ratio: 1/1) and (min-height: 560px)', todas: 'all' }, (contexto) => {
    if (!hero) return;
    const { ancho } = contexto.conditions;
    // En pantalla ancha la apertura se queda quieta y la primera sección sube
    // por encima, como un telón: la salida se ve mientras la tapa la pista.
    // En el teléfono no se fija nada: la apertura se aleja con la página.
    const salida = gsap.timeline({
      // Todo se mide sobre una salida de duración 1: las posiciones son fracciones del recorrido.
      defaults: { ease: 'none', duration: 1 },
      scrollTrigger: ancho
        ? { trigger: hero, start: 'top top', end: 'bottom top', pin: true, pinSpacing: false, scrub: 0.6, anticipatePin: 1 }
        : { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.4 },
    });
    // La apertura anima la foto, las letras y cada pieza suelta; la salida
    // mueve sus contenedores o propiedades distintas, y así nunca se pisan.
    salida
      .to('.hero__foto', { scale: 1.2, yPercent: ancho ? -4 : 12 }, 0)
      .to('.hero__sombra', { opacity: 0.86 }, 0)
      .to('.hero__semaforo', { autoAlpha: 0, y: -30 }, 0)
      .to('.hero__guia', { opacity: 0, duration: 0.2 }, 0);
    if (ancho && letrasPorLinea.length === 2) {
      // Se acelera hacia la pista: «VEN A» se aparta a la izquierda y
      // «RODAR.» a la derecha, letra a letra, como lo que se deja atrás.
      // El texto se ha ido antes de que el telón llegue a su altura.
      salida
        .to(letrasPorLinea[0], { xPercent: (i) => -40 - i * 14, opacity: 0, duration: 0.42, stagger: 0.01 }, 0.02)
        .to(letrasPorLinea[1], { xPercent: (i, _, todas) => 40 + (todas.length - i) * 14, opacity: 0, duration: 0.42, stagger: { each: 0.01, from: 'end' } }, 0.02)
        .to('.hero__contenido', { y: -120 }, 0)
        .to('.hero__contenido', { opacity: 0, duration: 0.3 }, 0.14)
        .to('.hero__cifras', { y: 60, opacity: 0, duration: 0.3 }, 0);
    } else {
      salida.to('.hero__contenido', { y: -60, opacity: 0.15 }, 0);
    }
  });

  // -------------------------------------------------------------------------
  // Encabezados: índice, titular y entradilla, en ese orden y de un solo disparo
  // -------------------------------------------------------------------------

  for (const cabeza of $$('.seccion__cabeza, .acceso__intro, .pronto__texto')) {
    const disparo = () => alEntrar(cabeza, 'top 84%');
    const indice = $('.seccion__indice', cabeza);
    const numero = indice && $(':scope > span', indice);
    if (indice) gsap.from(indice, { opacity: 0, x: -20, duration: 1, scrollTrigger: disparo() });
    if (numero) {
      // El número sube por su ventana como el de un marcador y después se
      // traza la línea que lo separa del nombre.
      partir(numero, {
        type: 'words',
        mask: 'words',
        wordsClass: 'numero-split',
        autoSplit: false,
        aria: 'none',
        onSplit: (self) => gsap.from(self.words, { yPercent: 110, duration: 0.9, ease: 'expo.out', scrollTrigger: disparo() }),
      });
      gsap.fromTo(numero, { '--trazo': 0 }, { '--trazo': 1, duration: 1, delay: 0.25, ease: 'expo.inOut', scrollTrigger: disparo() });
    }
    // «Muy pronto» se arma letra a letra con su propia escena, más abajo.
    const titular = cabeza.classList.contains('pronto__texto') ? null : $('h2', cabeza);
    if (titular) {
      partir(titular, {
        type: 'lines,words',
        mask: 'lines',
        linesClass: 'linea-split',
        wordsClass: 'palabra-split',
        onSplit: (self) => gsap.from(self.words, {
          yPercent: 120,
          rotate: 3,
          duration: 1.2,
          stagger: 0.06,
          delay: 0.1,
          scrollTrigger: disparo(),
        }),
      });
    }
    const lead = $('.seccion__lead, :scope > .entrada__acceso-nota', cabeza);
    if (lead) {
      partir(lead, {
        // Las palabras van numeradas (--i): la escena del complejo las enciende
        // una a una moviendo una sola variable (--luz) en la entradilla, que
        // sobrevive a que SplitText vuelva a partir el texto al cambiar el ancho.
        type: 'lines,words',
        mask: 'lines',
        linesClass: 'linea-split',
        wordsClass: 'palabra-lead',
        onSplit: (self) => {
          self.words.forEach((palabra, i) => palabra.style.setProperty('--i', i));
          return gsap.from(self.lines, {
          yPercent: 105,
          duration: 1.1,
          stagger: ESCALON,
          delay: 0.32,
          scrollTrigger: disparo(),
          });
        },
      });
    }
    const acciones = $$(':scope > .boton, .galeria__controles', cabeza);
    if (acciones.length) gsap.from(acciones, { ...SUBIDA, y: 20, delay: 0.5, scrollTrigger: disparo() });
  }

  // -------------------------------------------------------------------------
  // Números fantasma: el dorsal de cada sector, detrás de su encabezado
  // -------------------------------------------------------------------------

  for (const seccion of $$('main section')) {
    const numero = $('.seccion__indice > span', seccion);
    if (!numero) continue;
    const fantasma = document.createElement('span');
    fantasma.className = 'seccion__fantasma';
    fantasma.setAttribute('aria-hidden', 'true');
    fantasma.textContent = numero.textContent.trim();
    seccion.prepend(fantasma);
    // Más despacio que la página: queda detrás, como un plano más lejano.
    gsap.fromTo(fantasma, { yPercent: 35 }, {
      yPercent: -35,
      ease: 'none',
      scrollTrigger: { trigger: seccion, start: 'top bottom', end: 'bottom top', scrub: true },
    });
    gsap.from(fantasma, { opacity: 0, x: 60, duration: 1.6, scrollTrigger: alEntrar(seccion, 'top 70%') });
  }

  // -------------------------------------------------------------------------
  // 01 · La pista: el circuito llena la pantalla y vuelve a su sitio en el mosaico
  // -------------------------------------------------------------------------

  const mosaico = $('.mosaico');
  const fotosMosaico = $$('.mosaico__foto');
  /** El revelado de siempre: de abajo arriba, con la imagen asentándose. */
  const revelarFoto = (foto, i) => {
    const img = $('img', foto);
    const pie = $('figcaption', foto);
    // Las dos de una misma fila llegan una detrás de otra.
    const tl = gsap.timeline({ delay: (i % 2) * 0.14, scrollTrigger: alEntrar(foto, 'top 90%') });
    tl.fromTo(foto, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.4, ease: 'expo.inOut' })
      .fromTo(img, { scale: 1.32 }, { scale: 1.08, duration: 2, ease: 'expo.out' }, 0.1);
    if (pie) tl.from(pie, { opacity: 0, y: 16, duration: 0.9 }, 0.8);
  };
  // Al pasar, cada foto se desplaza un poco más despacio que la página.
  for (const foto of fotosMosaico) {
    gsap.fromTo($('img', foto), { yPercent: -6 }, {
      yPercent: 6,
      ease: 'none',
      scrollTrigger: { trigger: foto, start: 'top bottom', end: 'bottom top', scrub: true },
    });
  }
  mm.add({ escena: '(min-width: 1100px) and (min-aspect-ratio: 1/1) and (min-height: 640px)', todas: 'all' }, (contexto) => {
    if (!mosaico || fotosMosaico.length < 2) return undefined;
    if (!contexto.conditions.escena) {
      fotosMosaico.forEach(revelarFoto);
      return undefined;
    }
    // Pantalla ancha: ya en la pista, como una toma aérea en tres tiempos.
    //  1. El trazado completo llena la pantalla y la cámara lo recorre de lado
    //     mientras se asienta.
    //  2. La cámara se aleja: la foto vuelve a su casilla y las otras tres se
    //     descubren alrededor, cada una desde su lado del mosaico.
    //  3. El recorrido: la cámara visita cada detalle en orden de lectura (la
    //     nave, el bordillo, la curva). El que se mira queda encendido, con su
    //     pie de foto y la mira cerrándose sobre él; los demás, en penumbra.
    //  4. Al final la nave entera se enciende y la escena se suelta.
    const [principal, ...resto] = fotosMosaico;
    const imgPrincipal = $('img', principal);
    const mira = ponerMira(principal, { haz: false });
    const miras = resto.map((foto) => ponerMira(foto, { haz: false }));
    const pies = fotosMosaico.map((foto) => $('figcaption', foto));
    gsap.set(fotosMosaico, { '--penumbra': 0 });
    // De qué lado del mosaico llega cada foto: el de su casilla respecto de la
    // principal. Se mide con offset*, que no ve los transform de la escena.
    /** El recorte con que se descubre una foto: abierto del lado de la principal. */
    const recorteDesde = ({ x, y }) => {
      if (Math.abs(x) >= Math.abs(y)) return x > 0 ? 'inset(0% 0% 0% 100%)' : 'inset(0% 100% 0% 0%)';
      return y > 0 ? 'inset(0% 0% 100% 0%)' : 'inset(100% 0% 0% 0%)';
    };
    const lado = (el) => {
      const dx = el.offsetLeft + el.offsetWidth / 2 - (principal.offsetLeft + principal.offsetWidth / 2);
      const dy = el.offsetTop + el.offsetHeight / 2 - (principal.offsetTop + principal.offsetHeight / 2);
      const largo = Math.hypot(dx, dy) || 1;
      return { x: (dx / largo) * 160, y: (dy / largo) * 120 };
    };
    mosaico.classList.add('mosaico--escena');
    // Dónde está la foto cuando el mosaico se fija arriba y cuánto hay que
    // agrandarla para cubrir la pantalla. Es la primera casilla: empieza en la
    // esquina del mosaico, que no se transforma (su caja vale tal cual). El
    // tamaño, de maquetación (offset*), no cambia con el transform de la
    // escena. No se usa offsetLeft: al fijar el mosaico, ScrollTrigger lo
    // envuelve y la cuenta empezaría en ese envoltorio, no en la pantalla.
    const casilla = () => ({
      izquierda: mosaico.getBoundingClientRect().left,
      arriba: 0,
      ancho: principal.offsetWidth,
      alto: principal.offsetHeight,
    });
    // Un 1 % de margen: al fijarse, el scrub ya la ha encogido un pelo y no
    // debe asomar ni una línea del fondo.
    const cubrir = () => {
      const c = casilla();
      return Math.max(window.innerWidth / c.ancho, window.innerHeight / c.alto) * 1.01;
    };
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: mosaico,
        start: 'top top',
        end: '+=300%',
        pin: true,
        scrub: 0.7,
        anticipatePin: 1,
        invalidateOnRefresh: true,
      },
    });
    // 1 · Pantalla completa: la foto se queda cubriendo la pantalla mientras
    // la cámara la recorre de derecha a izquierda y se asienta.
    tl.fromTo(imgPrincipal, { scale: 1.3, xPercent: 8 }, { scale: 1.04, xPercent: 0, duration: 1.45, ease: 'power1.inOut' }, 0)
      // 2 · La cámara se aleja hasta la casilla…
      .fromTo(principal, {
        x: () => window.innerWidth / 2 - (casilla().izquierda + casilla().ancho / 2),
        y: () => window.innerHeight / 2 - (casilla().arriba + casilla().alto / 2),
        scale: cubrir,
        borderRadius: 0,
      }, { x: 0, y: 0, scale: 1, borderRadius: 4, duration: 1, ease: 'power2.inOut' }, 0.45)
      // …y las demás se descubren alrededor, cada una desde su lado (el
      // recorte se abre hacia la principal) y con su propio fondo asentándose.
      .fromTo(resto, {
        clipPath: (i, el) => recorteDesde(lado(el)),
        x: (i, el) => lado(el).x * 0.35,
        y: (i, el) => lado(el).y * 0.35,
      }, { clipPath: 'inset(0% 0% 0% 0%)', x: 0, y: 0, duration: 0.7, stagger: 0.12, ease: 'power3.inOut' }, 0.8)
      .fromTo(resto.map((foto) => $('img', foto)), { scale: 1.3 }, { scale: 1.06, duration: 0.9, stagger: 0.12, ease: 'power2.out' }, 0.8)
      .from(pies, { opacity: 0, y: 14, duration: 0.3, stagger: 0.06 }, 1.35)
      // El trazado queda fijado: su mira se cierra y se aparta.
      .add(cerrarEscuadras(gsap, mira, { retirar: false }), 1.4)
      .to($$(':scope > i', mira), { opacity: 0, duration: 0.25, ease: 'power1.out' }, 1.85);
    // 3 · El recorrido por los detalles, en orden de lectura.
    const RECORRIDO = 2.05;
    const PASO = 0.62;
    resto.forEach((foto, k) => {
      const momento = RECORRIDO + k * PASO;
      fotosMosaico.forEach((otra) => {
        tl.to(otra, { '--penumbra': otra === foto ? 0 : 0.72, duration: 0.24, ease: 'power2.out' }, momento);
      });
      tl.fromTo($('img', foto), { scale: 1.06 }, { scale: 1.12, duration: PASO, ease: 'none' }, momento)
        .add(cerrarEscuadras(gsap, miras[k], { retirar: false }), momento + 0.05)
        .to($$(':scope > i', miras[k]), { opacity: 0, duration: 0.18, ease: 'power1.out' }, momento + PASO - 0.12);
    });
    // 4 · La nave entera, encendida: todo vuelve a su luz antes de soltarse.
    const final = RECORRIDO + resto.length * PASO;
    tl.to(fotosMosaico, { '--penumbra': 0, duration: 0.3, ease: 'power2.out' }, final)
      .to(resto.map((foto) => $('img', foto)), { scale: 1.06, duration: 0.3, ease: 'power2.out' }, final)
      .to({}, { duration: 0.25 });
    return () => {
      mosaico.classList.remove('mosaico--escena');
      mira.remove();
      miras.forEach((m) => m.remove());
    };
  });

  // -------------------------------------------------------------------------
  // Marquesina: corre sola y el desplazamiento le da gas y le cambia el sentido
  // -------------------------------------------------------------------------

  const marquesina = $('.marquesina');
  if (marquesina) {
    const filas = $$('.marquesina__fila', marquesina);
    // Cada fila lleva su texto dos veces: correr la mitad de su ancho la deja
    // como al empezar, y el bucle no tiene costura. Las filas van en sentidos
    // contrarios y a distinto paso, como dos carriles.
    const bucles = filas.map((fila, i) => {
      const alReves = i % 2 === 1;
      const bucle = gsap.fromTo(fila, { xPercent: alReves ? -50 : 0 }, {
        xPercent: alReves ? 0 : -50,
        duration: 34 + i * 8,
        ease: 'none',
        repeat: -1,
        paused: true,
      });
      // Se arranca lejos del principio: así también puede correr hacia atrás
      // sin toparse con el inicio del bucle.
      bucle.totalTime(bucle.duration() * 1000);
      return bucle;
    });
    let sentido = 1;
    const aCrucero = gsap.delayedCall(0.2, () => {
      bucles.forEach((bucle) => gsap.to(bucle, { timeScale: sentido, duration: 1.4, ease: 'power2.out', overwrite: true }));
    }).pause();
    // Se inclinan las filas, no la banda: la banda torcida asomaría por los lados.
    const inclinar = gsap.quickTo(filas, 'skewX', { duration: 0.6, ease: 'power3.out' });
    const enderezar = gsap.delayedCall(0.14, () => inclinar(0)).pause();
    ScrollTrigger.create({
      trigger: marquesina,
      start: 'top bottom',
      end: 'bottom top',
      // Fuera de la pantalla no gasta nada.
      onToggle: (self) => bucles.forEach((bucle) => (self.isActive ? bucle.play() : bucle.pause())),
      onUpdate: (self) => {
        const velocidad = self.getVelocity();
        sentido = self.direction;
        const empuje = empujePorVelocidad(velocidad) * sentido;
        bucles.forEach((bucle) => gsap.to(bucle, { timeScale: empuje, duration: 0.3, ease: 'power2.out', overwrite: true }));
        aCrucero.restart(true);
        inclinar(inclinacionPorVelocidad(velocidad, 6));
        enderezar.restart(true);
      },
    });
  }

  // -------------------------------------------------------------------------
  // 02 · Complejo: una vuelta por los cinco sectores
  // -------------------------------------------------------------------------

  const pistaDisciplinas = $('.disciplinas__pista');
  const disciplinas = $$('.disciplina');
  mm.add({ grande: '(min-width: 1100px) and (min-height: 640px)', todas: 'all' }, (contexto) => {
    if (!pistaDisciplinas || !disciplinas.length) return undefined;
    if (contexto.conditions.grande) {
      pistaDisciplinas.classList.add('disciplinas--vuelta');
      // El tablero de sectores: cinco tramos con su número y su nombre. Se
      // monta antes de medir si el bloque cabe en la pantalla.
      const indice = document.createElement('ol');
      indice.className = 'disciplinas__indice';
      indice.setAttribute('aria-hidden', 'true');
      const tramos = disciplinas.map((disciplina) => {
        const tramo = document.createElement('li');
        const numero = document.createElement('b');
        numero.textContent = $('.disciplina__num', disciplina)?.textContent ?? '';
        const nombre = document.createElement('span');
        nombre.textContent = $('h3', disciplina)?.textContent ?? '';
        tramo.append(numero, nombre, document.createElement('i'));
        indice.append(tramo);
        return tramo;
      });
      pistaDisciplinas.append(indice);
      // Si el titular y la lista caben juntos en la pantalla, se quedan los dos:
      // la vuelta se lee con su título. Si no, solo la lista.
      const bloque = pistaDisciplinas.closest('.marco');
      const fijo = bloque && bloque.offsetHeight < window.innerHeight * 0.86 ? bloque : pistaDisciplinas;
      // Con el titular a la vista, la escena empieza por leerlo: la entradilla
      // se enciende palabra a palabra, como una charla antes de salir a pista,
      // y después la vuelta recorre los cinco sectores.
      const lead = fijo === bloque ? $('.seccion__lead', bloque) : null;
      const palabras = lead ? lead.querySelectorAll('.palabra-lead').length : 0;
      const salida = palabras ? 1.4 : 0;
      if (palabras) lead.classList.add('seccion__lead--iluminada');
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: fijo, start: 'center center', end: palabras ? '+=340%' : '+=280%', pin: true, scrub: 0.6, anticipatePin: 1, invalidateOnRefresh: true },
      });
      if (palabras) tl.fromTo(lead, { '--luz': 0 }, { '--luz': palabras + 1, duration: salida }, 0);
      // La mira sigue la vuelta por el tablero: se fija en el sector que se
      // está corriendo y salta al siguiente cuando su tramo se completa.
      const { mira, apuntar } = miraViajera(pistaDisciplinas);
      const destino = (i) => ({
        x: () => apuntar(tramos[i], 10).x,
        y: () => apuntar(tramos[i], 10).y,
        width: () => apuntar(tramos[i], 10).width,
        height: () => apuntar(tramos[i], 10).height,
      });
      tl.set(mira, destino(0), salida)
        .fromTo(mira, { opacity: 0, scale: 1.12 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'expo.out' }, salida);
      // Cada sector toma el escenario en su turno: el anterior sube y se
      // apaga, el nuevo llega desde abajo, su número de contorno sube por su
      // ventana y su dibujo se traza línea a línea mientras se llena su tramo.
      const laminas = disciplinas.map((disciplina) => $('.disciplina__lamina', disciplina));
      disciplinas.forEach((disciplina, i) => {
        const momento = salida + i;
        const lamina = laminas[i];
        const trazos = $$('.trazo:not(.trazo--punteado)', lamina);
        const punteados = $$('.trazo--punteado', lamina);
        tl.call(() => tramos.forEach((tramo, k) => tramo.classList.toggle('activo', k === i)), null, momento);
        if (i > 0) {
          tl.to(laminas[i - 1], { opacity: 0, y: -48, duration: 0.3, ease: 'power2.in' }, momento - 0.12)
            .fromTo(lamina, { opacity: 0, y: 56 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }, momento + 0.1);
        } else {
          tl.fromTo(lamina, { opacity: 0, y: 56 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }, momento);
        }
        if (i > 0) tl.to(mira, { ...destino(i), duration: 0.3, ease: 'power3.inOut' }, momento - 0.15);
        tl.fromTo($('.disciplina__num', disciplina), { yPercent: 40, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.45, ease: 'expo.out' }, momento + 0.12)
          .fromTo(trazos, { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDasharray: 1, strokeDashoffset: 0, autoRound: false, duration: 0.65, stagger: 0.04, ease: 'power2.inOut' }, momento + 0.15)
          .fromTo(punteados, { opacity: 0 }, { opacity: 1, duration: 0.3 }, momento + 0.55)
          .fromTo($('i', tramos[i]), { scaleX: 0 }, { scaleX: 1, duration: 1 }, momento);
      });
      // El último sector se queda en escena un instante antes de soltarse.
      tl.to({}, { duration: 0.35 });
      return () => {
        pistaDisciplinas.classList.remove('disciplinas--vuelta');
        lead?.classList.remove('seccion__lead--iluminada');
        mira.remove();
        indice.remove();
      };
    }
    disciplinas.forEach((disciplina) => {
      fijar(disciplina, { scrollTrigger: alEntrar(disciplina, 'top 90%') })
        .fromTo($('.disciplina__sector', disciplina), { scaleX: 0 }, { scaleX: 1, duration: 1.2, ease: 'expo.inOut' }, 0.6)
        .fromTo($$('.trazo:not(.trazo--punteado)', disciplina), { strokeDasharray: 1, strokeDashoffset: 1 }, {
          strokeDasharray: 1, strokeDashoffset: 0, autoRound: false, duration: 1.2, stagger: 0.05, ease: 'power2.inOut',
        }, 0.4);
    });
    return undefined;
  });

  // -------------------------------------------------------------------------
  // 03 · Ficha técnica: el auto dibuja el circuito mientras se lee la ficha
  // -------------------------------------------------------------------------

  const ficha = $('.ficha');
  const plano = $('.plano');
  const trazado = $('#plano-trazado');
  const auto = $('.plano__auto');
  const filas = $$('.ficha__fila');
  if (plano && trazado && auto) {
    // El auto espera en la parrilla (el trazado empieza en la línea de
    // salida) y no en el origen del dibujo mientras nadie lo pone a andar.
    if (MotionPathPlugin) gsap.set(auto, { motionPath: { path: trazado, align: trazado, alignOrigin: [0.5, 0.5], end: 0 } });
    fijar(plano, { duracion: 1.2, scrollTrigger: alEntrar(plano, 'top 85%') });
    gsap.from('.plano__cota', { opacity: 0, duration: 1, stagger: 0.2, delay: 0.3, scrollTrigger: alEntrar(plano, 'top 85%') });
  }
  mm.add({ guiada: '(min-width: 961px)', todas: 'all' }, (contexto) => {
    if (!ficha || !trazado || !auto) return undefined;
    const curvas = $$('.plano__curvas text');
    if (contexto.conditions.guiada) {
      ficha.classList.add('ficha--guiada');
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: '.ficha__lista', start: 'top 62%', end: 'bottom 62%', scrub: 0.8 },
      });
      // `pathLength="1"`: el trazo entero mide 1. GSAP redondea los píxeles
      // a enteros y sin `autoRound: false` saltaría de nada a todo a mitad.
      tl.fromTo(trazado, { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDasharray: 1, strokeDashoffset: 0, autoRound: false, duration: 1 }, 0);
      if (MotionPathPlugin) {
        tl.to(auto, { motionPath: { path: trazado, align: trazado, alignOrigin: [0.5, 0.5] }, duration: 1 }, 0);
      }
      posicionesEnRecorrido(curvas.length).forEach((momento, i) => {
        tl.fromTo(curvas[i], { opacity: 0.15, scale: 0.4, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1, duration: 0.06, ease: 'back.out(3)' }, momento);
      });
      // La mira sigue la lectura: se fija en la fila que se lee y, al
      // llegar a una por primera vez, sus cifras ruedan hasta el dato.
      const { mira, apuntar } = miraViajera(ficha);
      const triggers = filas.map((fila) => ScrollTrigger.create({
        trigger: fila,
        start: 'top 62%',
        end: 'bottom 62%',
        toggleClass: 'activa',
        onToggle: (self) => {
          if (self.isActive) {
            gsap.to(mira, { ...apuntar(fila, 8), opacity: 1, duration: 0.5, ease: 'expo.out', overwrite: true });
            rodarCifras($('strong', fila));
          } else if (!filas.some((otra) => otra.classList.contains('activa'))) {
            gsap.to(mira, { opacity: 0, duration: 0.35, ease: 'power2.out', overwrite: 'auto' });
          }
        },
        onLeave: () => fila.classList.add('vista'),
        onEnterBack: () => fila.classList.remove('vista'),
      }));
      return () => {
        ficha.classList.remove('ficha--guiada');
        triggers.forEach((t) => t.kill());
        filas.forEach((fila) => fila.classList.remove('activa', 'vista'));
        mira.remove();
      };
    }
    // En el teléfono el trazado se dibuja al llegar y el auto da vueltas mientras se ve.
    gsap.fromTo(trazado, { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, autoRound: false, duration: 2.4, ease: 'power2.inOut', scrollTrigger: unaVez(plano, 'top 75%') });
    if (MotionPathPlugin) {
      const vuelta = gsap.to(auto, { motionPath: { path: trazado, align: trazado, alignOrigin: [0.5, 0.5] }, duration: 7, ease: 'none', repeat: -1, paused: true });
      ScrollTrigger.create({ trigger: plano, start: 'top bottom', end: 'bottom top', onToggle: (self) => (self.isActive ? vuelta.play() : vuelta.pause()) });
    }
    filas.forEach((fila) => {
      fijar(fila, { duracion: 0.8, scrollTrigger: alEntrar(fila, 'top 90%') })
        .add(() => rodarCifras($('strong', fila)), 0.25);
    });
    return undefined;
  });

  // -------------------------------------------------------------------------
  // 04 · Horarios: tablero de salidas que rueda hasta la hora
  // -------------------------------------------------------------------------

  const horarios = $$('.horario');
  if (horarios.length) {
    // Cada jornada se fija en escalera y, mientras el haz la imprime, su hora
    // rueda como en un tablero de salidas: solo ruedan las cifras; los dos
    // puntos y el guion se quedan quietos, así el ancho de la hora no baila.
    horarios.forEach((fila, i) => {
      fijar(fila, { retraso: i * 0.12, scrollTrigger: alEntrar('.horarios__lista', 'top 85%') })
        .add(() => rodarCifras($('.horario__horas', fila), { duracion: 1.3 }), 0.1);
    });
    gsap.from('.horarios__nota', { ...SUBIDA, y: 20, scrollTrigger: alEntrar('.horarios__nota', 'top 95%') });
  }

  // -------------------------------------------------------------------------
  // 05 · Récords: foto finish. Un solo reloj y cada piloto cruza en su tiempo
  // -------------------------------------------------------------------------

  const tablero = $('.tiempos');
  if (tablero) {
    const corredores = $$('.tiempo', tablero).map((fila) => {
      const celda = $('.tiempo__marca', fila);
      const final = celda ? celda.textContent.trim() : '';
      return { fila, celda, final, valor: Number.parseFloat(final), dif: $('.tiempo__dif', fila) };
    }).filter((c) => c.celda && Number.isFinite(c.valor));
    // La carrera se corre una vez: el tablero se fija y suena la salida.
    const tl = gsap.timeline({ scrollTrigger: unaVez(tablero, 'top 80%') });
    tl.add(fijar(tablero, { duracion: 1 }), 0)
      .from('.tiempos__cabeza > *', { opacity: 0, y: -8, stagger: 0.05, duration: 0.6 }, 0.35);
    if (corredores.length) {
      // Un reloj común corre a cámara lenta y cada piloto avanza hacia la
      // meta con su barra; cruza en su tiempo y su cifra se queda quieta. Las
      // llegadas se separan lo que separan sus marcas (+0.40 son 0,8 s): se
      // ve quién gana y por cuánto.
      const finales = corredores.map((c) => c.valor);
      const inicio = salidaDeCarrera(finales);
      const llegadas = momentosDeLlegada(finales, inicio);
      const mejor = Math.min(...finales);
      const SALIDA = 0.75;
      for (const c of corredores) {
        c.fila.classList.add('tiempo--en-carrera');
        c.barra = document.createElement('span');
        c.barra.className = 'tiempo__carrera';
        c.barra.setAttribute('aria-hidden', 'true');
        c.fila.prepend(c.barra);
        c.ancho = gsap.quickSetter(c.barra, 'width', '%');
        c.mira = ponerMira(c.fila, { haz: false });
      }
      const reloj = { t: inicio };
      const pintar = () => {
        for (const c of corredores) {
          const { tiempo, avance } = enCarrera(reloj.t, inicio, c.valor);
          c.celda.textContent = tiempoEnTexto(tiempo, 2, c.final.length);
          c.ancho(avance * 100);
        }
      };
      const llegar = (c) => {
        c.celda.textContent = c.final;
        c.celda.removeAttribute('aria-label');
        c.ancho(100);
        if (c.dif) gsap.to(c.dif, { opacity: 1, x: 0, duration: 0.7, ease: 'expo.out' });
        gsap.to(c.barra, { opacity: 0, duration: 1, delay: 0.3, ease: 'power2.out' });
        cerrarEscuadras(gsap, c.mira);
        if (c.valor === mejor) c.fila.classList.add('tiempo--destello');
      };
      // Mientras corren, se anuncia la marca real y no la del reloj.
      tl.call(() => {
        corredores.forEach((c) => c.celda.setAttribute('aria-label', c.final));
        pintar();
      }, null, 0)
        .set(corredores.map((c) => c.dif).filter(Boolean), { opacity: 0, x: 10 }, 0)
        .to(reloj, { t: Math.max(...finales), duration: Math.max(...llegadas), ease: 'none', onUpdate: pintar }, SALIDA);
      corredores.forEach((c, i) => tl.call(() => llegar(c), null, SALIDA + llegadas[i]));
    }
  }

  // -------------------------------------------------------------------------
  // 06 · Eventos: las fechas llegan en escalera y su marca se traza
  // -------------------------------------------------------------------------

  const eventos = $$('.evento');
  if (eventos.length) {
    // Cada fecha se fija en su turno y su cifra, que llega en contorno, se
    // rellena: la temporada se va confirmando fecha a fecha.
    eventos.forEach((evento, i) => {
      fijar(evento, { duracion: 1, retraso: i * 0.16, scrollTrigger: alEntrar('.agenda', 'top 88%') })
        .fromTo($('.evento__fecha b', evento), { '--relleno': 0 }, { '--relleno': 1, duration: 0.9, ease: 'power2.out' }, 0.8);
    });
    gsap.fromTo(eventos, { '--linea': 0 }, { '--linea': 1, stagger: 0.16, delay: 0.5, duration: 1, ease: 'expo.inOut', scrollTrigger: alEntrar('.agenda', 'top 88%') });
    // Una vez en su sitio las tarjetas se quedan alineadas: una rejilla que
    // se descuadra al leerla no cuenta nada.
    gsap.from('.agenda__accion', { ...SUBIDA, y: 24, scrollTrigger: alEntrar('.agenda__accion', 'top 95%') });
  }

  // -------------------------------------------------------------------------
  // Muy pronto: las letras se ensamblan, la foto se abre y la cinta corre
  // -------------------------------------------------------------------------

  const pronto = $('.pronto');
  if (pronto) {
    const titulo = $('h2', pronto);
    // Algo que todavía «toma forma»: las letras llegan sueltas y se ordenan
    // con el desplazamiento. Letras dentro de sus palabras, para que una
    // palabra nunca se parta entre dos líneas.
    const letras = partir(titulo, { type: 'words,chars', wordsClass: 'palabra-split', charsClass: 'letra-split', autoSplit: false, aria: 'auto' })?.chars ?? [titulo];
    gsap.fromTo(letras, {
      yPercent: (i) => ((i * 37) % 7 - 3) * 24,
      rotate: (i) => ((i * 53) % 9 - 4) * 3,
      opacity: 0,
    }, {
      yPercent: 0,
      rotate: 0,
      opacity: 1,
      ease: 'power3.out',
      stagger: { each: 0.03, from: 'random' },
      scrollTrigger: { trigger: pronto, start: 'top 85%', end: 'top 35%', scrub: 0.8 },
    });
    const foto = $('.pronto__foto', pronto);
    const img = $('img', foto ?? pronto);
    if (foto && img) {
      gsap.fromTo(foto, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.5, ease: 'expo.inOut', scrollTrigger: alEntrar(foto, 'top 85%') });
      gsap.fromTo(img, { scale: 1.3, yPercent: -6 }, { scale: 1.06, yPercent: 6, ease: 'none', scrollTrigger: { trigger: foto, start: 'top bottom', end: 'bottom top', scrub: true } });
      gsap.fromTo('.pronto__cinta', { backgroundPositionX: '0px' }, { backgroundPositionX: '480px', ease: 'none', scrollTrigger: { trigger: foto, start: 'top bottom', end: 'bottom top', scrub: true } });
    }
  }

  // -------------------------------------------------------------------------
  // 07 · Galería: la tira corre de lado mientras la sección se queda fija
  // -------------------------------------------------------------------------

  const galeria = $('#galeria');
  const pista = $('#galeria-pista');
  const fotos = $$('.galeria__foto');
  mm.add({ ancho: '(min-width: 900px) and (min-aspect-ratio: 1/1) and (min-height: 600px)', todas: 'all' }, (contexto) => {
    if (!galeria || !pista || !fotos.length) return undefined;
    if (!contexto.conditions.ancho) {
      // Se descubren como las del mosaico. Nada de desplazarlas de lado: en un
      // carrusel con anclaje, mover las fotos mueve sus puntos de anclaje y el
      // carrusel arrancaría ya empezado. El recorte no toca la maquetación.
      fotos.forEach(revelarFoto);
      return undefined;
    }
    galeria.classList.add('galeria-fija');
    // En la tira fija todas las fotos comparten el mismo plano vertical: la
    // carga diferida no sabe cuáles están lejos por el lado.
    $$('img', pista).forEach((imagen) => {
      imagen.loading = 'eager';
      imagen.decode?.().catch(() => {});
    });
    pista.scrollLeft = 0;
    const distancia = () => Math.max(0, pista.scrollWidth - document.documentElement.clientWidth);
    const contador = $('.galeria__contador b');
    // La tira enfoca: la foto que pasa por el centro de la pantalla se ve
    // entera y las demás esperan un poco más pequeñas y en penumbra.
    const enfoques = fotos.map((foto) => {
      const marco = $('.galeria__marco', foto);
      // `quickSetter` no admite el atajo `scale`: un ajuste por eje.
      const ancho = gsap.quickSetter(marco, 'scaleX');
      const alto = gsap.quickSetter(marco, 'scaleY');
      return { foto, escala: (valor) => { ancho(valor); alto(valor); }, luz: gsap.quickSetter(marco, 'opacity') };
    });
    const enfocar = () => {
      const centro = window.innerWidth / 2;
      for (const { foto, escala, luz } of enfoques) {
        const caja = foto.getBoundingClientRect();
        const lejos = enfoqueGaleria(caja.left + caja.width / 2, centro, window.innerWidth);
        escala(1 - 0.12 * lejos);
        luz(1 - 0.55 * lejos);
      }
    };
    const avance = gsap.to(pista, {
      x: () => -distancia(),
      ease: 'none',
      onUpdate: enfocar,
      scrollTrigger: {
        trigger: galeria,
        start: 'top top',
        end: () => `+=${distancia()}`,
        pin: true,
        scrub: 0.8,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          const n = Math.min(fotos.length, 1 + Math.floor(self.progress * fotos.length * 0.999));
          const texto = String(n).padStart(2, '0');
          if (contador && contador.textContent !== texto) contador.textContent = texto;
        },
      },
    });
    gsap.fromTo('.galeria__barra i', { scaleX: 0 }, {
      scaleX: 1,
      ease: 'none',
      scrollTrigger: { trigger: galeria, start: 'top top', end: () => `+=${distancia()}`, scrub: 0.8, invalidateOnRefresh: true },
    });
    fotos.forEach((foto) => {
      const img = $('img', foto);
      gsap.fromTo(img, { xPercent: -9, scale: 1.2 }, {
        xPercent: 9,
        scale: 1.2,
        ease: 'none',
        scrollTrigger: { trigger: foto, containerAnimation: avance, start: 'left right', end: 'right left', scrub: true, invalidateOnRefresh: true },
      });
      gsap.from($('figcaption', foto), {
        opacity: 0,
        y: 20,
        duration: 1,
        scrollTrigger: { trigger: foto, containerAnimation: avance, start: 'left 78%', toggleActions: 'play none none reverse' },
      });
    });
    enfocar();
    ScrollTrigger.addEventListener('refresh', enfocar);
    return () => {
      ScrollTrigger.removeEventListener('refresh', enfocar);
      galeria.classList.remove('galeria-fija');
      if (contador) contador.textContent = '01';
    };
  });

  // -------------------------------------------------------------------------
  // 08 · Tienda: las tarjetas se fijan en escalera, como autos que salen a pista
  // -------------------------------------------------------------------------

  const productos = $$('.productos .producto');
  // Se fijan en escalera y se quedan alineadas; mientras el haz las imprime,
  // la foto se asienta. El movimiento de la tarjeta es la respuesta al
  // puntero (portada-tacto.js), no el desplazamiento.
  productos.forEach((tarjeta, i) => {
    fijar(tarjeta, { duracion: 1, retraso: i * 0.12, scrollTrigger: alEntrar('.productos', 'top 88%') })
      .fromTo($('.producto__foto img', tarjeta), { scale: 1.3 }, { scale: 1, duration: 1.8, ease: 'expo.out' }, 0);
  });

  // -------------------------------------------------------------------------
  // 09 · Cómo funciona: el riel de los pasos se llena mientras se leen
  // -------------------------------------------------------------------------

  const pasosFunciona = $('.funciona__pasos');
  if (pasosFunciona) {
    gsap.fromTo(pasosFunciona, { '--avance': 0 }, {
      '--avance': 1,
      ease: 'none',
      scrollTrigger: { trigger: pasosFunciona, start: 'top 50%', end: 'bottom 50%', scrub: 0.4 },
    });
  }

  // -------------------------------------------------------------------------
  // 10 · Tu pase: la meta. La bandera a cuadros cruza la pantalla y el panel llega
  // -------------------------------------------------------------------------

  const acceso = $('.acceso');
  if (acceso) {
    // La línea de llegada: la bandera se despliega de lado a lado al llegar y
    // ondea (portada-bandera.js), más fuerte cuanto más rápido se baja.
    gsap.fromTo('.acceso__bandera', { clipPath: 'inset(0% 100% 0% 0%)' }, {
      clipPath: 'inset(0% 0% 0% 0%)',
      ease: 'power2.inOut',
      scrollTrigger: { trigger: acceso, start: 'top bottom', end: 'top 40%', scrub: 0.6 },
    });
    montarBandera({ gsap, ScrollTrigger });
    $$('.ventaja').forEach((ventaja, i) => fijar(ventaja, { retraso: i * 0.12, scrollTrigger: alEntrar('.ventajas', 'top 88%') }));
    // Cada icono se dibuja con un solo trazo, como se marca una línea en la pista.
    const trazos = $$('.ventaja__icono path');
    trazos.forEach((trazo) => trazo.setAttribute('pathLength', '1'));
    gsap.fromTo(trazos, { strokeDasharray: 1, strokeDashoffset: 1 }, {
      strokeDashoffset: 0,
      autoRound: false,
      duration: 1.4,
      ease: 'power2.inOut',
      stagger: 0.12,
      delay: 0.2,
      scrollTrigger: alEntrar('.ventajas', 'top 88%'),
    });
    // El pase: su borde se traza como una vuelta completa, desde la esquina
    // de salida y en el sentido de la marcha; al cerrarse, el pase se abre.
    const panel = $('.entrada__acceso-panel');
    if (panel) {
      // Un texto fijo: el analizador lo crea como SVG, con su espacio de nombres.
      const contenido = $$(':scope > *', panel);
      if (getComputedStyle(panel).position === 'static') panel.classList.add('con-mira');
      panel.insertAdjacentHTML('beforeend', '<svg class="panel-trazo" aria-hidden="true" focusable="false"><rect x="0" y="0" width="100%" height="100%" rx="10" pathLength="1"/></svg>');
      const borde = $('.panel-trazo rect', panel);
      const tl = gsap.timeline({ scrollTrigger: alEntrar(panel, 'top 88%') });
      tl.fromTo(borde, { strokeDasharray: 1, strokeDashoffset: 1, opacity: 1 }, { strokeDashoffset: 0, autoRound: false, duration: 1.5, ease: 'power2.inOut' }, 0)
        .from(contenido, { opacity: 0, y: 22, stagger: 0.1, duration: 1, ease: 'expo.out' }, 0.75)
        .to(borde, { opacity: 0, duration: 1, ease: 'power2.out' }, 1.7);
    }
  }

  // -------------------------------------------------------------------------
  // Pie
  // -------------------------------------------------------------------------

  $$('.sitio-pie__marca, .sitio-pie__columna').forEach((caja, i) => fijar(caja, { duracion: 0.8, retraso: i * 0.12, scrollTrigger: alEntrar('.sitio-pie', 'top 92%') }));
  // La línea de meta: el nombre de la pista se llena de verde en la última recta.
  const gigante = $('.sitio-pie__gigante');
  if (gigante) {
    // El recorte sube por encima de la caja: la tilde de la Á asoma sobre la línea.
    gsap.fromTo($('b', gigante), { clipPath: 'inset(-40% 100% -10% 0%)' }, {
      clipPath: 'inset(-40% 0% -10% 0%)',
      ease: 'none',
      scrollTrigger: { trigger: gigante, start: 'top bottom', end: 'max', scrub: 0.6 },
    });
    gsap.from($('span', gigante), { opacity: 0, yPercent: 30, duration: 1.4, scrollTrigger: alEntrar(gigante, 'top 98%') });
  }

  // -------------------------------------------------------------------------
  // La vuelta: al final, cuando las escenas fijas ya ocupan su sitio
  // -------------------------------------------------------------------------

  escenas.vuelta = montarVuelta({ gsap, ScrollTrigger });

  // Fotos y fuentes cambian medidas al llegar: se vuelve a medir todo.
  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  // En papel no hay nada que esperar: cada escena, en su estado final.
  window.addEventListener('beforeprint', () => {
    ScrollTrigger.getAll().forEach((t) => t.animation?.progress(1));
  });

  return escenas;
}
