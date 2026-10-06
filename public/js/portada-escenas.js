/**
 * Portada: las escenas ligadas al desplazamiento.
 *
 * Todo lo mueve GSAP con ScrollTrigger. Cada escena se monta dentro de
 * `gsap.matchMedia()`: al cambiar de formato (girar el teléfono, estrechar la
 * ventana) se deshace sola y se vuelve a montar la que toca, sin dejar estilos
 * en línea huérfanos.
 *
 * Tres formatos:
 *  - `ancho` (pantallas apaisadas de 900 px o más): las escenas fijas —la
 *    apertura que se aleja, la vuelta por sectores, el plano que se recorre y
 *    la galería que corre de lado—.
 *  - `estrecho` (el resto): las mismas ideas sin fijar nada, porque en un
 *    teléfono una escena fija se siente como si la página se trabara.
 *  - `fino` (ratón o trackpad): desplazamiento suave con Lenis.
 *
 * Solo se llama con movimiento permitido (portada.js lo decide). Las cuentas
 * puras viven en portada-calculos.js.
 */
import { cifrasRodando, formatoMiles, inclinacionPorVelocidad, posicionesEnRecorrido, tiempoEnTexto } from './portada-calculos.js';

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

export function montarEscenas({ gsap, ScrollTrigger, SplitText, MotionPathPlugin, ScrambleTextPlugin, Lenis }) {
  gsap.registerPlugin(ScrollTrigger, ...[SplitText, MotionPathPlugin, ScrambleTextPlugin].filter(Boolean));
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
    const lenis = new Lenis({ lerp: 0.105, wheelMultiplier: 1, anchors: { offset: -altoCabecera() }, autoRaf: false });
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
  // Apertura: el titular sale letra a letra; al bajar, la escena se aleja
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
      .from('.hero__cifras .cifra', { opacity: 0, y: 34, stagger: 0.08, duration: 1 }, 0.6);
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
    const salida = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: ancho
        ? { trigger: hero, start: 'top top', end: '+=70%', pin: true, scrub: 0.6, anticipatePin: 1 }
        : { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.4 },
    });
    // La apertura anima la foto, las letras y cada pieza suelta; la salida
    // mueve sus contenedores o propiedades distintas, y así nunca se pisan.
    salida
      .to('.hero__foto', { scale: 1.22, yPercent: ancho ? 4 : 12 }, 0)
      .to('.hero__sombra', { opacity: 0.82 }, 0)
      .to('.hero__semaforo', { autoAlpha: 0, y: -30 }, 0);
    if (ancho && letrasPorLinea.length === 2) {
      // «VEN A» se va a la izquierda y «RODAR.» a la derecha, letra a letra.
      salida
        .to(letrasPorLinea[0], { xPercent: (i) => -60 - i * 18, opacity: 0, stagger: 0.012 }, 0.05)
        .to(letrasPorLinea[1], { xPercent: (i, _, todas) => 60 + (todas.length - i) * 18, opacity: 0, stagger: { each: 0.012, from: 'end' } }, 0.05)
        .to('.hero__contenido', { y: -90 }, 0)
        .to('.hero__contenido', { opacity: 0, duration: 0.45 }, 0.45)
        .to('.hero__cifras', { y: -50, opacity: 0 }, 0.15);
    } else {
      salida.to('.hero__contenido', { y: -60, opacity: 0.15 }, 0);
    }
  });

  // -------------------------------------------------------------------------
  // Encabezados de sección: índice que se descifra, titular palabra a palabra
  // -------------------------------------------------------------------------

  for (const indice of $$('.seccion__indice')) {
    const numero = $('span', indice);
    gsap.from(indice, { opacity: 0, x: -24, duration: 0.9, scrollTrigger: alEntrar(indice, 'top 90%') });
    if (numero && ScrambleTextPlugin) {
      gsap.to(numero, {
        duration: 0.9,
        scrambleText: { text: numero.textContent, chars: '0123456789', speed: 0.6 },
        scrollTrigger: alEntrar(indice, 'top 90%'),
      });
    }
  }

  const titulares = $$('.seccion__cabeza h2, .acceso__intro h2');
  for (const titular of titulares) {
    partir(titular, {
      type: 'lines,words',
      mask: 'lines',
      linesClass: 'linea-split',
      wordsClass: 'palabra-split',
      onSplit: (self) => gsap.from(self.words, {
        yPercent: 120,
        rotate: 4,
        duration: 1.2,
        stagger: 0.07,
        scrollTrigger: alEntrar(titular, 'top 88%'),
      }),
    });
  }

  for (const lead of $$('.seccion__lead, .acceso__intro > .entrada__acceso-nota')) {
    partir(lead, {
      type: 'lines',
      mask: 'lines',
      linesClass: 'linea-split',
      onSplit: (self) => gsap.from(self.lines, {
        yPercent: 105,
        duration: 1.1,
        stagger: 0.08,
        delay: 0.15,
        scrollTrigger: alEntrar(lead, 'top 90%'),
      }),
    });
  }

  // -------------------------------------------------------------------------
  // 01 · La pista: cada foto se descubre desde un lado y flota al pasar
  // -------------------------------------------------------------------------

  const cortes = ['inset(100% 0% 0% 0%)', 'inset(0% 0% 0% 100%)', 'inset(0% 100% 0% 0%)', 'inset(0% 0% 100% 0%)'];
  $$('.mosaico__foto').forEach((foto, i) => {
    const img = $('img', foto);
    const pie = $('figcaption', foto);
    const tl = gsap.timeline({ scrollTrigger: alEntrar(foto, 'top 88%') });
    tl.fromTo(foto, { clipPath: cortes[i % cortes.length] }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.5, ease: 'expo.inOut' })
      .fromTo(img, { scale: 1.45 }, { scale: 1.08, duration: 2, ease: 'expo.out' }, 0.1);
    if (pie) tl.from(pie, { opacity: 0, x: -24, duration: 0.9 }, 0.8);
    gsap.fromTo(img, { yPercent: -7 }, {
      yPercent: 7,
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
        inclinar(inclinacionPorVelocidad(self.getVelocity()));
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
          .from($$('h3, p', disciplina), { y: 28, duration: 0.5, stagger: 0.1, ease: 'power2.out' }, i);
      });
      return () => pistaDisciplinas.classList.remove('disciplinas--vuelta');
    }
    disciplinas.forEach((disciplina) => {
      const tl = gsap.timeline({ scrollTrigger: alEntrar(disciplina, 'top 90%') });
      tl.fromTo($('.disciplina__sector', disciplina), { scaleX: 0 }, { scaleX: 1, duration: 1.2, ease: 'expo.inOut' })
        .from($$('.disciplina__num, h3, p', disciplina), { opacity: 0, y: 30, stagger: 0.08, duration: 1 }, 0.1);
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
    gsap.from(plano, { opacity: 0, y: 60, scale: 0.96, duration: 1.3, scrollTrigger: alEntrar(plano, 'top 85%') });
    gsap.from('.plano__cota', { opacity: 0, duration: 1, stagger: 0.2, scrollTrigger: alEntrar(plano, 'top 80%') });
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
      tl.fromTo(trazado, { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDasharray: 1, strokeDashoffset: 0, duration: 1 }, 0);
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
    gsap.fromTo(trazado, { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 2.4, ease: 'power2.inOut', scrollTrigger: unaVez(plano, 'top 75%') });
    if (MotionPathPlugin) {
      const vuelta = gsap.to(auto, { motionPath: { path: trazado, align: trazado, alignOrigin: [0.5, 0.5] }, duration: 7, ease: 'none', repeat: -1, paused: true });
      ScrollTrigger.create({ trigger: plano, start: 'top bottom', end: 'bottom top', onToggle: (self) => (self.isActive ? vuelta.play() : vuelta.pause()) });
    }
    gsap.from(filas, { opacity: 0, x: 40, stagger: 0.08, duration: 1, scrollTrigger: alEntrar('.ficha__lista', 'top 85%') });
    return undefined;
  });

  // -------------------------------------------------------------------------
  // 04 · Horarios: tablero de salidas que se descifra
  // -------------------------------------------------------------------------

  const horarios = $$('.horario');
  if (horarios.length) {
    gsap.from(horarios, { opacity: 0, x: 90, stagger: 0.12, duration: 1.2, scrollTrigger: alEntrar('.horarios__lista', 'top 85%') });
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
    gsap.from('.horarios__nota', { opacity: 0, y: 20, duration: 1, scrollTrigger: alEntrar('.horarios__nota', 'top 95%') });
  }

  // -------------------------------------------------------------------------
  // 05 · Récords: el tablero se abre y el cronómetro corre hasta el tiempo real
  // -------------------------------------------------------------------------

  const tablero = $('.tiempos');
  if (tablero) {
    const tl = gsap.timeline({ scrollTrigger: alEntrar(tablero, 'top 85%') });
    tl.from(tablero, { opacity: 0, rotationX: 24, y: 80, transformPerspective: 1400, transformOrigin: '50% 0%', duration: 1.4 })
      .from($$('.tiempo', tablero), { opacity: 0, x: -70, stagger: 0.12, duration: 1 }, 0.25)
      .from('.tiempos__cabeza > *', { opacity: 0, y: -10, stagger: 0.05, duration: 0.6 }, 0.2);
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
  // 06 · Eventos: las fechas suben girando y sus días se cuentan
  // -------------------------------------------------------------------------

  const eventos = $$('.evento');
  if (eventos.length) {
    gsap.from(eventos, {
      opacity: 0,
      y: 140,
      rotation: (i) => (i - 1) * 3,
      transformOrigin: '50% 100%',
      stagger: 0.14,
      duration: 1.4,
      scrollTrigger: alEntrar('.agenda', 'top 88%'),
    });
    for (const dia of $$('.evento__fecha b')) {
      const final = dia.textContent.trim();
      const cuenta = { v: 0 };
      gsap.to(cuenta, {
        v: Number(final),
        duration: 1.2,
        ease: 'power2.out',
        scrollTrigger: unaVez('.agenda', 'top 85%'),
        onUpdate: () => { dia.textContent = String(Math.round(cuenta.v)).padStart(final.length, '0'); },
        onComplete: () => { dia.textContent = final; },
      });
    }
    mm.add('(min-width: 861px)', () => {
      eventos.forEach((evento, i) => {
        gsap.fromTo(evento, { yPercent: (i - 1) * 8 }, {
          yPercent: (i - 1) * -8,
          ease: 'none',
          scrollTrigger: { trigger: '.agenda', start: 'top bottom', end: 'bottom top', scrub: true },
        });
      });
    });
    gsap.from('.agenda__accion', { opacity: 0, y: 30, duration: 1, scrollTrigger: alEntrar('.agenda__accion', 'top 95%') });
  }

  // -------------------------------------------------------------------------
  // Muy pronto: las letras se ensamblan, la foto se abre y la cinta corre
  // -------------------------------------------------------------------------

  const pronto = $('.pronto');
  if (pronto) {
    const titulo = $('h2', pronto);
    // Letras dentro de sus palabras: así una palabra nunca se parte entre dos líneas.
    const letras = partir(titulo, { type: 'words,chars', wordsClass: 'palabra-split', charsClass: 'letra-split', autoSplit: false, aria: 'auto' })?.chars ?? [titulo];
    gsap.fromTo(letras, {
      yPercent: (i) => ((i * 37) % 7 - 3) * 40,
      rotate: (i) => ((i * 53) % 9 - 4) * 9,
      opacity: 0,
    }, {
      yPercent: 0,
      rotate: 0,
      opacity: 1,
      ease: 'power3.out',
      stagger: { each: 0.03, from: 'random' },
      scrollTrigger: { trigger: pronto, start: 'top 85%', end: 'top 35%', scrub: 0.8 },
    });
    gsap.from($$('.seccion__indice, .seccion__lead', pronto), { opacity: 0, y: 30, stagger: 0.1, duration: 1, scrollTrigger: alEntrar(pronto, 'top 60%') });
    const foto = $('.pronto__foto', pronto);
    const img = $('img', foto ?? pronto);
    if (foto && img) {
      gsap.fromTo(foto, { clipPath: 'inset(0% 0% 0% 100%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.6, ease: 'expo.inOut', scrollTrigger: alEntrar(foto, 'top 80%') });
      gsap.fromTo(img, { scale: 1.35, yPercent: -8 }, { scale: 1.05, yPercent: 8, ease: 'none', scrollTrigger: { trigger: foto, start: 'top bottom', end: 'bottom top', scrub: true } });
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
      gsap.from(fotos, { opacity: 0, x: 80, stagger: 0.1, duration: 1.2, scrollTrigger: alEntrar(pista, 'top 85%') });
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
        y: 24,
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
  // 08 · Tienda: las tarjetas suben en abanico
  // -------------------------------------------------------------------------

  const productos = $$('.productos > li');
  if (productos.length) {
    gsap.from(productos, {
      opacity: 0,
      y: 130,
      rotationX: 22,
      transformPerspective: 1000,
      transformOrigin: '50% 100%',
      stagger: 0.09,
      duration: 1.3,
      scrollTrigger: alEntrar('.productos', 'top 90%'),
    });
    mm.add('(min-width: 1101px)', () => {
      productos.forEach((producto, i) => {
        gsap.fromTo(producto, { yPercent: i % 2 ? 10 : -4 }, {
          yPercent: i % 2 ? -10 : 4,
          ease: 'none',
          scrollTrigger: { trigger: '.productos', start: 'top bottom', end: 'bottom top', scrub: true },
        });
      });
    });
  }

  // -------------------------------------------------------------------------
  // Tu pase: la bandera ondea con el desplazamiento y el panel llega de frente
  // -------------------------------------------------------------------------

  const acceso = $('.acceso');
  if (acceso) {
    gsap.fromTo('.acceso__bandera', { backgroundPositionX: '0px' }, {
      backgroundPositionX: '-320px',
      ease: 'none',
      scrollTrigger: { trigger: acceso, start: 'top bottom', end: 'bottom top', scrub: true },
    });
    gsap.from('.ventaja', { opacity: 0, x: -50, stagger: 0.12, duration: 1.1, scrollTrigger: alEntrar('.ventajas', 'top 88%') });
    gsap.from('.ventaja__icono', { scale: 0, rotate: -90, transformOrigin: '50% 50%', stagger: 0.12, duration: 1, ease: 'back.out(2)', scrollTrigger: alEntrar('.ventajas', 'top 88%') });
    gsap.from('.entrada__acceso-panel', {
      opacity: 0,
      y: 110,
      rotationX: 14,
      transformPerspective: 1400,
      transformOrigin: '50% 100%',
      duration: 1.5,
      scrollTrigger: alEntrar('.entrada__acceso-panel', 'top 92%'),
    });
  }

  // -------------------------------------------------------------------------
  // Pie
  // -------------------------------------------------------------------------

  gsap.from('.sitio-pie__marca, .sitio-pie__columna', { opacity: 0, y: 40, stagger: 0.1, duration: 1.1, scrollTrigger: alEntrar('.sitio-pie', 'top 92%') });

  // Fotos y fuentes cambian medidas al llegar: se vuelve a medir todo.
  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  // En papel no hay nada que esperar: cada escena, en su estado final.
  window.addEventListener('beforeprint', () => {
    ScrollTrigger.getAll().forEach((t) => t.animation?.progress(1));
  });

  return escenas;
}
