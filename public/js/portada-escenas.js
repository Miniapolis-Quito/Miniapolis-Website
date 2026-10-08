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
 *  - Bloques (filas, tarjetas, paneles): suben y se encienden, en escalera.
 *  - Datos: lo que se cuenta se cuenta como en la pista —el cronómetro corre
 *    hasta el récord, el tablero de salidas rueda hasta la hora—.
 *  - Escenas fijas (solo en pantallas anchas): la salida, la vuelta por los
 *    cinco sectores del complejo y la galería que corre de lado.
 *
 * Cada escena se monta dentro de `gsap.matchMedia()`: al cambiar de formato
 * (girar el teléfono, estrechar la ventana) se deshace sola y se vuelve a
 * montar la que toca, sin dejar estilos en línea huérfanos.
 *
 * Solo se llama con movimiento permitido (portada.js lo decide). Las cuentas
 * puras viven en portada-calculos.js.
 */
import { cifrasRodando, formatoMiles, inclinacionPorVelocidad, posicionesEnRecorrido, tiempoEnTexto } from './portada-calculos.js';
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
  const escenas = { lenis: null, apertura: null };

  // -------------------------------------------------------------------------
  // Desplazamiento suave (solo con ratón o trackpad)
  // -------------------------------------------------------------------------

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

  escenas.apertura = () => {
    // Primero se retira la clase que lo ocultaba antes del primer fotograma:
    // `from()` toma como destino el estado actual, y tiene que ser el visible.
    // Todo ocurre en la misma tarea, así que no llega a pintarse nada a medias.
    document.documentElement.classList.remove('portada-intro');
    const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
    tl.set(lineas, { yPercent: 0 })
      .from(letrasPorLinea.flat(), { yPercent: 118, rotate: 6, duration: 1.25, stagger: 0.035 }, 0)
      .from('.hero__foto img', { scale: 1.16, duration: 2.6, ease: 'power3.out' }, 0)
      .from('.hero__kicker', { opacity: 0, x: -36, duration: 1 }, 0.15)
      .from('.hero__lead', { opacity: 0, y: 26, duration: 1 }, 0.4)
      // Los botones tienen sus propias transiciones de hover: se mueve su caja.
      .from('.hero__acciones', { opacity: 0, y: 26, duration: 1 }, 0.5)
      .from('.hero__cifras .cifra', { opacity: 0, y: 34, stagger: ESCALON, duration: 1 }, 0.6)
      .from('.hero__guia', { opacity: 0, duration: 1.2 }, 1.1);
    // Las cifras se cuentan desde cero mientras suben.
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

  mm.add({ ancho: '(min-width: 900px) and (min-aspect-ratio: 1/1) and (min-height: 560px)' }, (contexto) => {
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
        type: 'lines',
        mask: 'lines',
        linesClass: 'linea-split',
        onSplit: (self) => gsap.from(self.lines, {
          yPercent: 105,
          duration: 1.1,
          stagger: ESCALON,
          delay: 0.32,
          scrollTrigger: disparo(),
        }),
      });
    }
    const acciones = $$(':scope > .boton, .galeria__controles', cabeza);
    if (acciones.length) gsap.from(acciones, { ...SUBIDA, y: 20, delay: 0.5, scrollTrigger: disparo() });
  }

  // -------------------------------------------------------------------------
  // 01 · La pista: las fotos se descubren de abajo arriba y flotan al pasar
  // -------------------------------------------------------------------------

  $$('.mosaico__foto').forEach((foto, i) => {
    const img = $('img', foto);
    const pie = $('figcaption', foto);
    // Las dos de una misma fila llegan una detrás de otra.
    const tl = gsap.timeline({ delay: (i % 2) * 0.14, scrollTrigger: alEntrar(foto, 'top 90%') });
    tl.fromTo(foto, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.4, ease: 'expo.inOut' })
      .fromTo(img, { scale: 1.32 }, { scale: 1.08, duration: 2, ease: 'expo.out' }, 0.1);
    if (pie) tl.from(pie, { opacity: 0, y: 16, duration: 0.9 }, 0.8);
    gsap.fromTo(img, { yPercent: -6 }, {
      yPercent: 6,
      ease: 'none',
      scrollTrigger: { trigger: foto, start: 'top bottom', end: 'bottom top', scrub: true },
    });
  });

  // -------------------------------------------------------------------------
  // Marquesina: corre con el desplazamiento y se inclina con la velocidad
  // -------------------------------------------------------------------------

  const marquesina = $('.marquesina');
  if (marquesina) {
    const recorrido = { trigger: marquesina, start: 'top bottom', end: 'bottom top', scrub: 0.5 };
    gsap.fromTo('.marquesina__fila--llena', { xPercent: 0 }, { xPercent: -22, ease: 'none', scrollTrigger: recorrido });
    gsap.fromTo('.marquesina__fila--hueca', { xPercent: -22 }, { xPercent: 0, ease: 'none', scrollTrigger: { ...recorrido } });
    // Se inclinan las filas, no la banda: la banda torcida asomaría por los lados.
    const inclinar = gsap.quickTo($$('.marquesina__fila', marquesina), 'skewX', { duration: 0.6, ease: 'power3.out' });
    const enderezar = gsap.delayedCall(0.14, () => inclinar(0)).pause();
    ScrollTrigger.create({
      trigger: marquesina,
      start: 'top bottom',
      end: 'bottom top',
      onUpdate: (self) => {
        inclinar(inclinacionPorVelocidad(self.getVelocity(), 6));
        enderezar.restart(true);
      },
    });
  }

  // -------------------------------------------------------------------------
  // 02 · Complejo: una vuelta por los cinco sectores
  // -------------------------------------------------------------------------

  const pistaDisciplinas = $('.disciplinas__pista');
  const disciplinas = $$('.disciplina');
  mm.add({ grande: '(min-width: 1100px) and (min-height: 640px)' }, (contexto) => {
    if (!pistaDisciplinas || !disciplinas.length) return undefined;
    if (contexto.conditions.grande) {
      pistaDisciplinas.classList.add('disciplinas--vuelta');
      // Si el titular y la lista caben juntos en la pantalla, se quedan los dos:
      // la vuelta se lee con su título. Si no, solo la lista.
      const bloque = pistaDisciplinas.closest('.marco');
      const fijo = bloque && bloque.offsetHeight < window.innerHeight * 0.86 ? bloque : pistaDisciplinas;
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: fijo, start: 'center center', end: '+=150%', pin: true, scrub: 0.6, anticipatePin: 1 },
      });
      tl.fromTo('.disciplinas__vuelta span', { scaleX: 0 }, { scaleX: 1, duration: disciplinas.length }, 0);
      disciplinas.forEach((disciplina, i) => {
        tl.fromTo($('.disciplina__sector', disciplina), { scaleX: 0 }, { scaleX: 1, duration: 1 }, i)
          .fromTo(disciplina, { opacity: 0.22 }, { opacity: 1, duration: 0.3, ease: 'power1.out' }, i)
          .fromTo($('.disciplina__num', disciplina), { color: '#8b9296' }, { color: '#93d241', duration: 0.2 }, i)
          .from($$('h3, p', disciplina), { y: 24, duration: 0.5, stagger: 0.1, ease: 'power2.out' }, i);
      });
      return () => pistaDisciplinas.classList.remove('disciplinas--vuelta');
    }
    disciplinas.forEach((disciplina) => {
      const tl = gsap.timeline({ scrollTrigger: alEntrar(disciplina, 'top 90%') });
      tl.fromTo($('.disciplina__sector', disciplina), { scaleX: 0 }, { scaleX: 1, duration: 1.2, ease: 'expo.inOut' })
        .from($$('.disciplina__num, h3, p', disciplina), { opacity: 0, y: 24, stagger: ESCALON, duration: 1 }, 0.1);
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
    gsap.from(plano, { ...SUBIDA, y: 48, duration: 1.3, scrollTrigger: alEntrar(plano, 'top 85%') });
    gsap.from('.plano__cota', { opacity: 0, duration: 1, stagger: 0.2, delay: 0.3, scrollTrigger: alEntrar(plano, 'top 85%') });
  }
  mm.add({ guiada: '(min-width: 961px)' }, (contexto) => {
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
      const triggers = filas.map((fila) => ScrollTrigger.create({
        trigger: fila,
        start: 'top 62%',
        end: 'bottom 62%',
        toggleClass: 'activa',
        onLeave: () => fila.classList.add('vista'),
        onEnterBack: () => fila.classList.remove('vista'),
      }));
      return () => {
        ficha.classList.remove('ficha--guiada');
        triggers.forEach((t) => t.kill());
        filas.forEach((fila) => fila.classList.remove('activa', 'vista'));
      };
    }
    // En el teléfono el trazado se dibuja al llegar y el auto da vueltas mientras se ve.
    gsap.fromTo(trazado, { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, autoRound: false, duration: 2.4, ease: 'power2.inOut', scrollTrigger: unaVez(plano, 'top 75%') });
    if (MotionPathPlugin) {
      const vuelta = gsap.to(auto, { motionPath: { path: trazado, align: trazado, alignOrigin: [0.5, 0.5] }, duration: 7, ease: 'none', repeat: -1, paused: true });
      ScrollTrigger.create({ trigger: plano, start: 'top bottom', end: 'bottom top', onToggle: (self) => (self.isActive ? vuelta.play() : vuelta.pause()) });
    }
    gsap.from(filas, { ...SUBIDA, y: 24, stagger: ESCALON, scrollTrigger: alEntrar('.ficha__lista', 'top 85%') });
    return undefined;
  });

  // -------------------------------------------------------------------------
  // 04 · Horarios: tablero de salidas que rueda hasta la hora
  // -------------------------------------------------------------------------

  const horarios = $$('.horario');
  if (horarios.length) {
    gsap.from(horarios, { ...SUBIDA, stagger: 0.1, scrollTrigger: alEntrar('.horarios__lista', 'top 85%') });
    // Tablero de salidas: solo ruedan las cifras; los dos puntos y el guion
    // se quedan quietos, así el ancho de la hora no baila.
    horarios.forEach((fila, i) => {
      const horas = $('.horario__horas', fila);
      const final = horas.textContent;
      const rueda = { p: 0 };
      gsap.to(rueda, {
        p: 1,
        duration: 1.3,
        delay: 0.2 + i * 0.12,
        ease: 'power2.out',
        scrollTrigger: unaVez('.horarios__lista', 'top 85%'),
        onStart: () => horas.setAttribute('aria-label', final),
        onUpdate: () => { horas.textContent = cifrasRodando(final, rueda.p); },
        onComplete: () => {
          horas.textContent = final;
          horas.removeAttribute('aria-label');
        },
      });
    });
    gsap.from('.horarios__nota', { ...SUBIDA, y: 20, scrollTrigger: alEntrar('.horarios__nota', 'top 95%') });
  }

  // -------------------------------------------------------------------------
  // 05 · Récords: el tablero se enciende y el cronómetro corre hasta el récord
  // -------------------------------------------------------------------------

  const tablero = $('.tiempos');
  if (tablero) {
    const tl = gsap.timeline({ scrollTrigger: alEntrar(tablero, 'top 85%') });
    tl.from(tablero, { ...SUBIDA, y: 48, duration: 1.3 })
      .from('.tiempos__cabeza > *', { opacity: 0, y: -8, stagger: 0.05, duration: 0.6 }, 0.2)
      .from($$('.tiempo', tablero), { opacity: 0, y: 18, stagger: 0.12, duration: 1 }, 0.25);
    $$('.tiempo__marca', tablero).forEach((celda, i) => {
      const final = celda.textContent.trim();
      const valor = Number.parseFloat(final);
      if (!Number.isFinite(valor)) return;
      const cuenta = { v: 0 };
      gsap.to(cuenta, {
        v: valor,
        duration: 1.6,
        delay: 0.45 + i * 0.18,
        ease: 'power3.out',
        scrollTrigger: unaVez(tablero, 'top 80%'),
        onStart: () => celda.setAttribute('aria-label', final),
        onUpdate: () => { celda.textContent = tiempoEnTexto(cuenta.v, 2, final.length); },
        onComplete: () => {
          celda.textContent = final;
          celda.removeAttribute('aria-label');
          if (i === 0) celda.closest('.tiempo')?.classList.add('tiempo--destello');
        },
      });
    });
  }

  // -------------------------------------------------------------------------
  // 06 · Eventos: las fechas llegan en escalera y su marca se traza
  // -------------------------------------------------------------------------

  const eventos = $$('.evento');
  if (eventos.length) {
    gsap.from(eventos, { ...SUBIDA, y: 56, stagger: 0.12, duration: 1.3, scrollTrigger: alEntrar('.agenda', 'top 88%') });
    gsap.fromTo(eventos, { '--linea': 0 }, { '--linea': 1, stagger: 0.12, delay: 0.35, duration: 1, ease: 'expo.inOut', scrollTrigger: alEntrar('.agenda', 'top 88%') });
    mm.add('(min-width: 861px)', () => {
      eventos.forEach((evento, i) => {
        gsap.fromTo(evento, { yPercent: (i - 1) * 5 }, {
          yPercent: (i - 1) * -5,
          ease: 'none',
          scrollTrigger: { trigger: '.agenda', start: 'top bottom', end: 'bottom top', scrub: true },
        });
      });
    });
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
  mm.add({ ancho: '(min-width: 900px) and (min-aspect-ratio: 1/1) and (min-height: 600px)' }, (contexto) => {
    if (!galeria || !pista || !fotos.length) return undefined;
    if (!contexto.conditions.ancho) {
      gsap.from(fotos, { ...SUBIDA, y: 0, x: 64, stagger: ESCALON, scrollTrigger: alEntrar(pista, 'top 85%') });
      return undefined;
    }
    galeria.classList.add('galeria-fija');
    // En la tira fija todas las fotos comparten el mismo plano vertical: la
    // carga diferida no sabe cuáles están lejos por el lado.
    $$('img', pista).forEach((imagen) => { imagen.loading = 'eager'; });
    pista.scrollLeft = 0;
    const distancia = () => Math.max(0, pista.scrollWidth - document.documentElement.clientWidth);
    const contador = $('.galeria__contador b');
    const avance = gsap.to(pista, {
      x: () => -distancia(),
      ease: 'none',
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
        scrollTrigger: { trigger: foto, containerAnimation: avance, start: 'left right', end: 'right left', scrub: true },
      });
      gsap.from($('figcaption', foto), {
        opacity: 0,
        y: 20,
        duration: 1,
        scrollTrigger: { trigger: foto, containerAnimation: avance, start: 'left 78%', toggleActions: 'play none none reverse' },
      });
    });
    return () => {
      galeria.classList.remove('galeria-fija');
      if (contador) contador.textContent = '01';
    };
  });

  // -------------------------------------------------------------------------
  // 08 · Tienda: las tarjetas llegan en escalera
  // -------------------------------------------------------------------------

  const productos = $$('.productos > li');
  if (productos.length) {
    gsap.from(productos, { ...SUBIDA, y: 64, stagger: ESCALON, duration: 1.3, scrollTrigger: alEntrar('.productos', 'top 90%') });
    mm.add('(min-width: 1101px)', () => {
      productos.forEach((producto, i) => {
        gsap.fromTo(producto, { yPercent: i % 2 ? 6 : -2 }, {
          yPercent: i % 2 ? -6 : 2,
          ease: 'none',
          scrollTrigger: { trigger: '.productos', start: 'top bottom', end: 'bottom top', scrub: true },
        });
      });
    });
  }

  // -------------------------------------------------------------------------
  // 09 · Tu pase: la meta. La bandera a cuadros cruza la pantalla y el panel llega
  // -------------------------------------------------------------------------

  const acceso = $('.acceso');
  if (acceso) {
    // La bandera se tiende de lado a lado al llegar y después ondea con el desplazamiento.
    gsap.fromTo('.acceso__bandera', { scaleX: 0 }, {
      scaleX: 1,
      ease: 'power2.inOut',
      scrollTrigger: { trigger: acceso, start: 'top bottom', end: 'top 45%', scrub: 0.6 },
    });
    gsap.fromTo('.acceso__bandera', { backgroundPositionX: '0px' }, {
      backgroundPositionX: '-320px',
      ease: 'none',
      scrollTrigger: { trigger: acceso, start: 'top bottom', end: 'bottom top', scrub: true },
    });
    const ventajas = $$('.ventaja');
    gsap.from(ventajas, { ...SUBIDA, y: 24, stagger: 0.12, scrollTrigger: alEntrar('.ventajas', 'top 88%') });
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
    gsap.from('.entrada__acceso-panel', { ...SUBIDA, y: 72, duration: 1.4, scrollTrigger: alEntrar('.entrada__acceso-panel', 'top 92%') });
  }

  // -------------------------------------------------------------------------
  // Pie
  // -------------------------------------------------------------------------

  gsap.from('.sitio-pie__marca, .sitio-pie__columna', { ...SUBIDA, y: 32, stagger: 0.1, scrollTrigger: alEntrar('.sitio-pie', 'top 92%') });

  // -------------------------------------------------------------------------
  // La vuelta: al final, cuando las escenas fijas ya ocupan su sitio
  // -------------------------------------------------------------------------

  montarVuelta({ gsap, ScrollTrigger });

  // Fotos y fuentes cambian medidas al llegar: se vuelve a medir todo.
  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  // En papel no hay nada que esperar: cada escena, en su estado final.
  window.addEventListener('beforeprint', () => {
    ScrollTrigger.getAll().forEach((t) => t.animation?.progress(1));
  });

  return escenas;
}
