/**
 * Portada: del pack a la pista.
 *
 * Tres pasos que se leen a la izquierda y un teléfono que se queda a la
 * vista y enseña la pantalla del paso que se está leyendo: el pack que se
 * elige, el QR que se renueva solo y el saldo que baja al entrar.
 *
 * Cambiar de pantalla no es movimiento, es estado: funciona también con
 * movimiento reducido (la pantalla cambia sin transición). Con movimiento,
 * lo que llega a la pantalla sube y se enciende y el saldo rueda de 10 a 9.
 * Sin JavaScript el teléfono enseña la última pantalla y los tres pasos se
 * leen enteros.
 */
const $ = (selector, base = document) => base.querySelector(selector);
const $$ = (selector, base = document) => [...base.querySelectorAll(selector)];

/** El QR del cliente se renueva cada 30 segundos. */
const RENUEVA_S = 30;

export function montarFunciona({ gsap = null } = {}) {
  const seccion = $('.funciona');
  const celular = $('.funciona__telefono');
  const pasos = $$('.funciona__paso');
  if (!seccion || !celular || !pasos.length || typeof IntersectionObserver !== 'function') return;

  seccion.classList.add('funciona--guiado');
  let actual = 0;
  const saldo = $('.funciona__entradas', celular);

  const contarSaldo = () => {
    if (!saldo || !gsap) return;
    saldo.textContent = '10';
    gsap.timeline()
      .to(saldo, { yPercent: -40, opacity: 0, duration: 0.28, ease: 'power2.in', delay: 0.55 })
      .add(() => { saldo.textContent = '9'; })
      .fromTo(saldo, { yPercent: 40, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.7, ease: 'expo.out' });
  };

  const poner = (n) => {
    if (n === actual) return;
    actual = n;
    celular.dataset.paso = String(n);
    pasos.forEach((paso, i) => paso.classList.toggle('funciona__paso--activo', i === n - 1));
    if (!gsap) return;
    const pantalla = $(`.funciona__pantalla--${n}`, celular);
    if (pantalla) {
      gsap.fromTo(pantalla.children, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.8, stagger: 0.06, ease: 'expo.out', overwrite: true });
    }
    if (n === 3) contarSaldo();
  };
  poner(1);

  // Qué paso se lee: el que cruza la franja de lectura. En pantalla ancha es
  // el centro; en el teléfono, la parte de abajo, porque arriba está el teléfono.
  const estrecha = window.matchMedia?.('(max-width: 900px) and (orientation: portrait)');
  let observador = null;
  const observar = () => {
    observador?.disconnect();
    const margen = estrecha?.matches ? '-58% 0px -18% 0px' : '-46% 0px -46% 0px';
    observador = new IntersectionObserver((entradas) => {
      for (const entrada of entradas) {
        if (entrada.isIntersecting) poner(pasos.indexOf(entrada.target) + 1);
      }
    }, { rootMargin: margen });
    pasos.forEach((paso) => observador.observe(paso));
  };
  observar();
  estrecha?.addEventListener?.('change', observar);

  // La cuenta atrás del QR corre solo mientras la sección se ve.
  const qr = $('.funciona__qr', celular);
  const cuenta = $('.funciona__cuenta', celular);
  if (!qr || !cuenta) return;
  let restante = RENUEVA_S;
  let reloj = null;
  const latir = () => {
    restante -= 1;
    if (restante <= 0) {
      restante = RENUEVA_S;
      qr.classList.toggle('funciona__qr--renovado');
      if (gsap) gsap.fromTo(qr, { opacity: 0.2 }, { opacity: 1, duration: 0.6, ease: 'power2.out' });
    }
    cuenta.textContent = String(restante).padStart(2, '0');
  };
  new IntersectionObserver(([entrada]) => {
    if (entrada.isIntersecting && !reloj) reloj = setInterval(latir, 1000);
    if (!entrada.isIntersecting && reloj) {
      clearInterval(reloj);
      reloj = null;
    }
  }).observe(seccion);
}
