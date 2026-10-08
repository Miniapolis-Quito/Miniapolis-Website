import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leer = (f) => fs.readFileSync(f, 'utf8');
const HTML = leer('public/index.html');
const CSS = leer('public/css/portada.css');
const PUBLICO = leer('public/css/publico.css');
const JS = leer('public/js/portada.js');
const ARRANQUE = leer('public/js/portada-arranque.js');
const CALCULOS = leer('public/js/portada-calculos.js');
const ESCENAS = leer('public/js/portada-escenas.js');
const TACTO = leer('public/js/portada-tacto.js');
const VUELTA = leer('public/js/portada-vuelta.js');

const sinComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const reglas = (css) => [...sinComentarios(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ selector: m[1].trim(), cuerpo: m[2] }));

test('la portada carga los estilos compartidos, los públicos, los propios y sus módulos', () => {
  assert.match(HTML, /<link rel="stylesheet" href="\/css\/styles\.css">/);
  assert.match(HTML, /<link rel="stylesheet" href="\/css\/publico\.css">/);
  assert.match(HTML, /<link rel="stylesheet" href="\/css\/portada\.css">/);
  assert.match(HTML, /<script type="module" src="\/js\/login\.js">/);
  assert.match(HTML, /<script type="module" src="\/js\/portada\.js">/);
  assert.match(HTML, /<body class="pagina-entrada">/);
  assert.match(JS, /from '\.\/portada-calculos\.js'/);
});

test('el sitio público anula lo que la app le pondría por defecto', () => {
  assert.match(PUBLICO, /\.pagina-entrada main,\s*\.pagina-posiciones main\s*\{\s*padding:\s*0/, 'el `main` compartido trae relleno propio');
  assert.match(PUBLICO, /\.pagina-entrada::before,\s*\.pagina-posiciones::before\s*\{\s*display:\s*none/, 'la rejilla de body::before no es del sitio público');
  assert.match(PUBLICO, /\.pagina-entrada main > \.revelar,[\s\S]*?\{[^}]*opacity:\s*1;[^}]*animation:\s*none/, 'el revelado genérico de shell.js no debe tocar las secciones');
});

test('la cabecera queda fija, con la marca, la navegación y la acción de entrar', () => {
  assert.match(HTML, /<header class="sitio-barra">/);
  assert.match(HTML, /class="sitio-marca"[^>]*>\s*<img src="\.\/images\/miniapolis-logo-oficial-400\.webp" srcset="[^"]*miniapolis-logo-oficial\.webp 1000w"/);
  assert.match(HTML, /class="sitio-accion boton boton--principal[^"]*" href="#acceso"/);
  assert.match(PUBLICO, /\.sitio-barra\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0\s+0\s+auto;/s);
  assert.match(PUBLICO, /\.sitio-barra\s*\{[^}]*border-bottom:\s*1px\s+solid/s);
  assert.match(HTML, /<a class="sitio-saltar" href="#contenido">/, 'quien navega con teclado puede saltarse la cabecera');
  assert.match(HTML, /<main id="contenido">/);
});

test('cada ancla interna lleva a una sección que existe', () => {
  const ids = new Set([...HTML.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const anclas = [...HTML.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(anclas.length > 10);
  assert.deepEqual(anclas.filter((ancla) => !ids.has(ancla)), []);
  assert.doesNotMatch(HTML, /href="#"/);
});

test('cada sección se nombra con su propio titular', () => {
  const secciones = [...HTML.matchAll(/<section\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(secciones.length >= 10);
  for (const seccion of secciones) {
    const id = seccion.match(/aria-labelledby="([^"]+)"/)?.[1];
    assert.ok(id, `sección sin nombre accesible: ${seccion}`);
    assert.match(HTML, new RegExp(`<h[12] id="${id}"`), `${id} debe ser el titular de su sección`);
  }
  assert.equal((HTML.match(/<h1\b/g) ?? []).length, 1, 'un solo titular principal');
});

test('los índices de sección van en orden, sin saltos ni repeticiones', () => {
  const indices = [...HTML.matchAll(/class="seccion__indice"><span>(\d{2})<\/span>/g)].map((m) => Number(m[1]));
  assert.deepEqual(indices, indices.map((_, i) => i + 1));
  assert.ok(indices.length >= 8);
});

test('la portada mantiene un copy breve, natural y sin ruido', () => {
  for (const frase of ['Ven a', 'rodar.', 'Pista indoor', 'La pista', 'Especificaciones del circuito', 'Horarios', 'Mejores tiempos', 'Tu pase.', 'Entra y guarda tu pase.']) {
    assert.ok(HTML.includes(frase), `falta «${frase}»`);
  }
  for (const frase of ['Asfalto, curvas y control.', 'Rectas, curvas y asfalto.', 'A tu ritmo.', 'Una pista para sentir cada vuelta.', 'READY TO RACE', 'FRAME / 01']) {
    assert.ok(!HTML.includes(frase) && !CSS.includes(frase), `sigue presente el texto decorativo «${frase}»`);
  }
  assert.doesNotMatch(HTML, /·/, 'sin puntos medios como separadores');
  assert.doesNotMatch(HTML, /Track\s+\d+/i, 'sin identificadores artificiales de pista');
  assert.doesNotMatch(HTML, /0°\d+|\d+°\d+['’]/, 'sin coordenadas decorativas');
  assert.doesNotMatch(HTML, /césped|cesped|grass/i, 'la pista es de asfalto');
  assert.doesNotMatch(HTML, /para disfrutar de verdad|dar tus primeras vueltas|buscar tu mejor tiempo|desde cualquier celular/);
});

test('las cifras de la pista no se contradicen entre secciones', () => {
  assert.doesNotMatch(HTML, /400\s*m²/, 'el asfalto mide 1.000 m² en toda la portada');
  assert.ok((HTML.match(/1\.000\s*(?:<small>)?m²/g) ?? []).length >= 2);
});

test('cada imagen declara su tamaño y su alt, y todas las rutas existen', () => {
  for (const [etiqueta] of HTML.matchAll(/<img\b[^>]*>/g)) {
    assert.match(etiqueta, /\swidth="\d+"/, `sin width: ${etiqueta.slice(0, 80)}`);
    assert.match(etiqueta, /\sheight="\d+"/, `sin height: ${etiqueta.slice(0, 80)}`);
    assert.match(etiqueta, /\salt="/, `sin alt: ${etiqueta.slice(0, 80)}`);
  }
  assert.match(HTML, /<img[^>]*miniapolis-track-wide\.webp[^>]*fetchpriority="high"/, 'la foto de la apertura es lo primero que se pide');
  assert.match(HTML, /<link rel="preload" as="image"[^>]*imagesrcset="[^"]*miniapolis-track-wide-960\.webp/, 'la precarga pide el mismo tamaño que usará la foto');
  const rutas = new Set();
  for (const m of HTML.matchAll(/\b(?:src|href)="(\.[^"]*\/images\/[^"]+)"/g)) rutas.add(m[1]);
  for (const m of HTML.matchAll(/\b(?:srcset|imagesrcset)="([^"]+)"/g)) {
    for (const candidato of m[1].split(',')) rutas.add(candidato.trim().split(/\s+/)[0]);
  }
  const faltan = [...rutas].filter((r) => !fs.existsSync(path.join('public', r.replace(/^\.\//, ''))));
  assert.deepEqual(faltan, []);
  // Solo la foto de la apertura y el logotipo de la cabecera se piden al abrir.
  const sinDiferir = [...HTML.matchAll(/<img\b[^>]*>/g)].map((m) => m[0])
    .filter((img) => !/fetchpriority="high"/.test(img) && !/loading="lazy"/.test(img));
  assert.equal(sinDiferir.length, 1);
  assert.match(sinDiferir[0], /miniapolis-logo-oficial\.webp/);
});

test('las hojas y el JS no dependen de rutas absolutas ni de terceros', () => {
  for (const hoja of [CSS, PUBLICO]) assert.doesNotMatch(hoja, /url\(\s*["']?\/(?!\/)/, 'las url() del CSS deben ser relativas o data:');
  assert.doesNotMatch(JS + ARRANQUE + CALCULOS + ESCENAS + TACTO + VUELTA, /https?:\/\//, 'sin CDN ni recursos externos');
  assert.doesNotMatch(HTML, /<script[^>]+src="(?:https?:)?\/\//, 'ningún script se pide a otro dominio');
  assert.doesNotMatch(HTML, /\sstyle="/, 'la política de seguridad prohíbe estilos en línea');
  assert.doesNotMatch(HTML, /<script>(?!<\/script>)/, 'sin scripts en línea');
});

test('solo lo clicable tiene :hover', () => {
  const CLICABLE = /^(?:a|button|input|select|textarea|label|summary)(?![\w-])|\.(?:boton(?:--[\w-]+)?|sitio-[\w-]+|enlace-flecha|producto|galeria__boton|pestana)(?![\w-])|\[role="tab"\]/;
  const fallos = [];
  for (const hoja of [CSS, PUBLICO]) {
    for (const { selector } of reglas(hoja)) {
      if (selector.startsWith('@') || !selector.includes(':hover')) continue;
      for (const uno of selector.split(',')) {
        if (!uno.includes(':hover')) continue;
        const compuestos = uno.trim().split(/\s*[>+~]\s*|\s+/).filter((c) => c.includes(':hover'));
        for (const compuesto of compuestos) {
          if (!CLICABLE.test(compuesto)) fallos.push(uno.trim());
        }
      }
    }
  }
  assert.deepEqual(fallos, [], 'estos selectores dan hover a algo que no se puede pulsar');
  assert.doesNotMatch(JS, /mouse(?:enter|over)/, 'el movimiento no depende de eventos de hover');
});

test('lo que se oculta para animarse solo se oculta bajo .portada-intro o .portada-animada', () => {
  // Velos y brillos decorativos empiezan apagados: no son contenido.
  const DECORADO = /^(?:\.hero__sombra|\.producto::after|\.cursor[\w-]*|\.cursor--[\w-]+ \.cursor__[\w-]+|\.disciplinas__vuelta)$/;
  const ocultan = /(?:^|[;\s])opacity:\s*0\s*(?:;|$)|clip-path:\s*inset\(|visibility:\s*hidden|translate3d\(0,\s*1\d\d%/;
  const fallos = reglas(CSS)
    .filter(({ selector }) => !selector.startsWith('@') && !/^(?:\d|from|to)/.test(selector))
    .filter(({ cuerpo }) => ocultan.test(cuerpo))
    .filter(({ selector }) => !/\.portada-(?:intro|animada)/.test(selector))
    .filter(({ selector }) => !selector.split(',').every((uno) => DECORADO.test(uno.trim())))
    .map(({ selector }) => selector);
  assert.deepEqual(fallos, [], 'sin movimiento, todo el contenido debe verse');
  assert.doesNotMatch(HTML, /class="[^"]*\brevela\b/, 'el revelado lo hace GSAP; no quedan marcas de un sistema anterior');
});

test('sin movimiento o sin GSAP no se anima nada y la página queda completa y quieta', () => {
  assert.match(JS, /import \{ sinMovimiento \} from '\.\/movimiento\.js'/);
  assert.match(JS, /const conMovimiento = !sinMovimiento\(\)\s*&& typeof IntersectionObserver === 'function'\s*&& typeof gsap\?\.registerPlugin === 'function'\s*&& typeof ScrollTrigger === 'function'/s,
    'las escenas exigen movimiento permitido y GSAP cargado');
  assert.match(JS, /if \(conMovimiento\) \{\s*raiz\.classList\.add\('portada-animada'\);\s*try \{[\s\S]*montarEscenas\(window\)[\s\S]*\} catch \(error\) \{[\s\S]*quedarseQuieta\(\);\s*\}\s*\} else \{\s*quedarseQuieta\(\);\s*\}/,
    'si algo falla al montar las escenas, la portada queda quieta y completa');
  assert.match(JS, /function quedarseQuieta\(\) \{\s*raiz\.classList\.remove\('portada-intro', 'portada-luces', 'portada-animada'\);/);
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(TACTO, /matchMedia\?\.\('\(hover: hover\) and \(pointer: fine\)'\)/, 'el cursor y los imanes solo existen con ratón o trackpad');
});

test('la apertura se prepara antes del primer fotograma y se retira sola si algo no llega', () => {
  const cabeza = HTML.slice(0, HTML.indexOf('</head>'));
  assert.match(cabeza, /<script src="\/js\/portada-arranque\.js"><\/script>/, 'script clásico en el <head>, no módulo diferido');
  assert.match(ARRANQUE, /prefers-reduced-motion: reduce/, 'sin movimiento no hay apertura');
  assert.match(ARRANQUE, /classList\.add\('portada-intro'\)/);
  assert.doesNotMatch(ARRANQUE, /classList\.add\('portada-animada'\)/, 'la animación solo la monta portada.js');
  assert.match(ARRANQUE, /setTimeout\([\s\S]*classList\.remove\('portada-intro'\)[\s\S]*3000/, 'si el módulo no llega, la página queda estática y completa');
  assert.match(ARRANQUE, /setTimeout\(\(\) => raiz\.classList\.remove\('portada-intro'\), 6000\)/, 'y si la apertura se atasca, el titular sale igual');
  assert.match(JS, /Promise\.race\(\[Promise\.allSettled\(esperas\), new Promise\(\(r\) => setTimeout\(r, \d+\)\)\]\)/, 'el titular nunca espera indefinidamente a la foto');
  const apertura = ESCENAS.slice(ESCENAS.indexOf('escenas.apertura = () => {'));
  assert.ok(
    apertura.indexOf("classList.remove('portada-intro')") < apertura.indexOf('gsap.timeline('),
    'la clase que oculta se retira antes de crear los from(): si no, toman como destino el estado oculto',
  );
});

test('el semáforo enciende cinco luces de una en una', () => {
  assert.equal((HTML.match(/<div class="hero__semaforo" aria-hidden="true">(?:<span><\/span>){5}<\/div>/g) ?? []).length, 1);
  for (let n = 2; n <= 5; n += 1) {
    assert.match(CSS, new RegExp(`\\.portada-luces \\.hero__semaforo span:nth-child\\(${n}\\) \\{ animation-delay: ${(n - 1) * 200}ms; \\}`));
  }
});

test('las cajas de contenido permanecen nítidas', () => {
  for (const hoja of [CSS, PUBLICO]) {
    assert.doesNotMatch(hoja, /(^|[;\s])filter:\s*blur\(/, 'el movimiento puede desplazar u ocultar suavemente, pero nunca desenfocar el contenido');
  }
  assert.doesNotMatch(ESCENAS + TACTO, /filter:\s*['"]?blur/, 'ninguna escena desenfoca');
  assert.doesNotMatch(sinComentarios(CSS), /backdrop-filter/, 'un desenfoque sobre un fondo que se mueve se recalcula en cada fotograma');
  const estiran = reglas(CSS + PUBLICO).filter(({ selector, cuerpo }) => selector.includes(':hover') && /letter-spacing/.test(cuerpo));
  assert.deepEqual(estiran.map((r) => r.selector), [], 'un hover no cambia el ancho del texto');
});

test('fluidez: GSAP y el CSS nunca animan la misma propiedad del mismo elemento', () => {
  // Una transición CSS sobre `transform` en algo que GSAP mueve hace que cada
  // fotograma arranque una transición nueva: el movimiento llega tarde y a
  // tirones. Estos son los elementos que mueven las escenas y el puntero.
  const MOVIDOS = ['.hero__foto', '.hero__contenido', '.hero__cifras', '.hero__acciones', '.cifra', '.mosaico__foto', '.marquesina',
    '.marquesina__fila', '.disciplina', '.plano', '.horario', '.tiempos', '.tiempo', '.evento', '.galeria', '.galeria__foto',
    '.productos > li', '.producto', '.ventaja', '.entrada__acceso-panel', '.sitio-barra'];
  const pisan = reglas(CSS + PUBLICO)
    .filter(({ selector }) => selector.split(',').some((uno) => MOVIDOS.includes(uno.trim())))
    .filter(({ cuerpo }) => /transition:[^;]*\b(?:transform|all)\b/.test(cuerpo))
    .map(({ selector }) => selector);
  assert.deepEqual(pisan, []);
  assert.match(CSS, /\.producto\s*\{[^}]*transition:\s*border-color 200ms ease-out;/s, 'la tarjeta solo transiciona su borde: la inclinación es de GSAP');
  assert.doesNotMatch(CSS, /\.producto:hover\s*\{[^}]*transform/, 'el hover de la tarjeta no pisa su inclinación');
});

test('fluidez: el puntero se sigue con quickTo y el imán no pisa el transform del botón', () => {
  assert.match(TACTO, /gsap\.quickTo\(punto, 'x'/);
  assert.match(TACTO, /gsap\.quickTo\(aro, 'x'/);
  assert.match(TACTO, /gsap\.quickTo\(boton, '--mx'/);
  assert.match(TACTO, /gsap\.quickTo\(tarjeta, 'rotationX'/);
  assert.match(CSS, /\.hero__acciones \.boton,[\s\S]*?\{\s*translate:\s*var\(--mx, 0px\) var\(--my, 0px\);\s*\}/,
    'el imán va por `translate`, independiente del `transform` del hover y del clic');
  assert.doesNotMatch(TACTO, /mouse(?:enter|over)/, 'los eventos de puntero cubren ratón, lápiz y táctil por igual');
  assert.match(TACTO, /evento\.pointerType !== 'mouse'/, 'con el dedo no hay imán ni inclinación');
});

test('fluidez: el avance de lectura se pinta una vez por fotograma y el desplazamiento suave alimenta a ScrollTrigger', () => {
  assert.match(JS, /window\.addEventListener\('scroll', programar, \{ passive: true \}\)/);
  assert.match(JS, /if \(pendiente\) return;\s*pendiente = true;\s*requestAnimationFrame\(pintar\)/);
  assert.match(PUBLICO, /transform:\s*scaleX\(var\(--progreso, 0\)\)/, 'el avance de lectura se compone, no reescribe el layout');
  assert.match(ESCENAS, /lenis\.on\('scroll', ScrollTrigger\.update\)/);
  assert.match(ESCENAS, /gsap\.ticker\.add\(latir\)/, 'Lenis late con el mismo reloj que GSAP: un solo bucle por fotograma');
  assert.match(ESCENAS, /mm\.add\('\(hover: hover\) and \(pointer: fine\)'/, 'en táctil el desplazamiento es el nativo del sistema');
  assert.match(CSS, /html\.lenis \{ scroll-behavior: auto; \}/, 'el scroll suave del CSS y el de Lenis no se suman');
});

test('las escenas fijas solo existen en pantallas anchas y se deshacen al cambiar de formato', () => {
  assert.match(ESCENAS, /const mm = gsap\.matchMedia\(\);/);
  const fijas = (ESCENAS.match(/pin: true/g) ?? []).length;
  assert.equal(fijas, 3, 'apertura, vuelta por sectores y galería');
  assert.match(ESCENAS, /scrollTrigger: ancho\s*\?\s*\{ trigger: hero, start: 'top top', end: 'bottom top', pin: true, pinSpacing: false/,
    'la apertura solo se fija en pantallas anchas, y sin reservar espacio: la pista sube por encima como un telón');
  assert.match(ESCENAS, /if \(contexto\.conditions\.grande\) \{[\s\S]*?pin: true/, 'la vuelta por sectores solo se fija en pantallas grandes');
  assert.match(ESCENAS, /if \(!contexto\.conditions\.ancho\) \{[\s\S]*?return undefined;\s*\}\s*galeria\.classList\.add\('galeria-fija'\)/, 'la galería solo corre de lado en pantallas anchas');
  assert.match(ESCENAS, /return \(\) => \{\s*galeria\.classList\.remove\('galeria-fija'\)/, 'al salir del formato se retira la clase y vuelve la tira deslizable');
  assert.match(CSS, /\.galeria-fija \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s, 'la columna mide la pantalla y no la tira entera');
});

test('en táctil lo que se pulsa mide al menos 44 px', () => {
  const tactil = (hoja) => hoja.slice(hoja.indexOf('@media (pointer: coarse)'));
  assert.match(tactil(PUBLICO), /\.sitio-accion[^{]*\{\s*min-height:\s*44px/);
  assert.match(tactil(CSS), /\.hero__acciones \.enlace-flecha\s*\{\s*min-height:\s*48px/);
  assert.match(CSS, /\.galeria__boton\s*\{[^}]*width:\s*52px;[^}]*height:\s*52px/s);
  assert.match(PUBLICO, /\.sitio-nav a\s*\{[^}]*min-height:\s*44px/s);
});

test('la galería se recorre con botones nombrados y con el teclado', () => {
  for (const sentido of ['atras', 'adelante']) {
    assert.match(HTML, new RegExp(`<button class="galeria__boton" type="button" data-galeria="${sentido}" aria-label="[^"]+" aria-controls="galeria-pista">`));
  }
  assert.match(HTML, /<div class="galeria" id="galeria-pista" tabindex="0" role="region" aria-label="[^"]+">/);
  assert.match(JS, /atras\.disabled = /);
  assert.match(JS, /behavior: sinMovimiento\(\) \? 'auto' : 'smooth'/);
});

test('el plano del circuito es decorativo, dice que es un esquema y el auto lo dibuja con el desplazamiento', () => {
  assert.match(HTML, /<svg class="plano__dibujo"[^>]*aria-hidden="true"/);
  assert.match(HTML, /<figcaption>Esquema ilustrativo del recinto/);
  assert.doesNotMatch(HTML, /<animateMotion/, 'el auto lo mueve GSAP, que respeta el movimiento reducido');
  assert.match(ESCENAS, /motionPath: \{ path: trazado, align: trazado, alignOrigin: \[0\.5, 0\.5\] \}/);
  assert.match(ESCENAS, /scrollTrigger: \{ trigger: '\.ficha__lista', start: 'top 62%', end: 'bottom 62%', scrub: 0\.8 \}/, 'en pantalla ancha el auto avanza con la lectura de la ficha');
  assert.match(ESCENAS, /onToggle: \(self\) => \(self\.isActive \? vuelta\.play\(\) : vuelta\.pause\(\)\)/, 'en el teléfono da vueltas solo mientras se ve');
  assert.match(CSS, /\.plano__auto\s*\{\s*display:\s*none/, 'sin movimiento no hay auto: solo la marca de salida');
});

test('el horario dice la verdad del momento y lo que rueda no engaña a los lectores de pantalla', () => {
  assert.match(JS, /montarHorarioVivo\(\);\s*setInterval\(\(\) => montarHorarioVivo\(\), 60_000\)/);
  assert.match(JS, /etiqueta\.textContent = textoJornada\(estado, rango\)/, 'el estado se escribe como texto, no solo como color');
  // Cronómetro de récords y tablero de horarios: mientras ruedan, se anuncia el valor real.
  assert.equal((ESCENAS.match(/setAttribute\('aria-label', final\)/g) ?? []).length, 2);
  assert.match(ESCENAS, /tiempoEnTexto\(cuenta\.v, 2, final\.length\)/, 'la cifra que corre no cambia de ancho');
  assert.match(ESCENAS, /cifrasRodando\(final, rueda\.p\)/, 'en las horas solo ruedan las cifras');
  assert.match(ESCENAS, /tituloHero\.setAttribute\('aria-label'/, 'el titular partido en letras se anuncia entero');
  assert.match(ESCENAS, /aria: 'auto'/, 'los titulares partidos conservan su texto accesible');
});

test('los rótulos de las hojas están en español', () => {
  const rotulos = [...sinComentarios(CSS + PUBLICO).matchAll(/content:\s*'([^']*[A-Za-z][^']*)'/g)].map((m) => m[1]);
  for (const ingles of ['READY', 'ACCESS', 'FACILITIES', 'TELEMETRY', 'TIMING', 'CALENDAR', 'OPEN', 'NIGHT', 'RACE', 'FRAME', 'LIVE', 'NEW']) {
    assert.ok(!rotulos.some((r) => new RegExp(`\\b${ingles}\\b`).test(r)), `rótulo en inglés: ${ingles}`);
  }
});

test('las hojas del sitio público cierran cada bloque y cada comentario', () => {
  for (const archivo of ['public/css/portada.css', 'public/css/publico.css', 'public/css/posiciones.css']) {
    const hoja = leer(archivo);
    assert.equal((hoja.match(/\/\*/g) || []).length, (hoja.match(/\*\//g) || []).length, `${archivo}: comentario sin cerrar`);
    let profundidad = 0;
    for (const caracter of sinComentarios(hoja)) {
      if (caracter === '{') profundidad += 1;
      if (caracter === '}') profundidad -= 1;
      assert.ok(profundidad >= 0, `${archivo}: llave de cierre de más`);
    }
    assert.equal(profundidad, 0, `${archivo}: bloque sin cerrar`);
  }
});

test('el motor de escenas anterior ya no se carga', () => {
  for (const archivo of ['public/js/portada-motor.js', 'public/js/portada-efectos.js', 'public/css/portada-efectos.css']) {
    assert.ok(!fs.existsSync(archivo), `${archivo} debería haberse retirado`);
  }
  assert.doesNotMatch(HTML, /portada-(?:motor|efectos)/);
  assert.doesNotMatch(HTML, /entrada__mira|portada__chispas|portada__cinta/);
});

test('las librerías de animación se sirven desde el dominio, con versión en el nombre y en orden', () => {
  const pkg = JSON.parse(leer('package.json'));
  const gsapVersion = JSON.parse(leer('node_modules/gsap/package.json')).version;
  const lenisVersion = JSON.parse(leer('node_modules/lenis/package.json')).version;
  assert.ok(pkg.devDependencies.gsap && pkg.devDependencies.lenis, 'gsap y lenis son el origen declarado de las copias');
  const scripts = [...HTML.matchAll(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g)].map((m) => m[0]);
  const esperados = ['gsap', 'ScrollTrigger', 'SplitText', 'MotionPathPlugin'].map((n) => `/vendor/${n}-${gsapVersion}.min.js`);
  esperados.push(`/vendor/lenis-${lenisVersion}.min.js`);
  for (const ruta of esperados) {
    const etiqueta = scripts.find((s) => s.includes(`src="${ruta}"`));
    assert.ok(etiqueta, `falta ${ruta}`);
    assert.match(etiqueta, /\sdefer\b/, `${ruta} no debe bloquear la primera pintura`);
    assert.ok(fs.existsSync(path.join('public', ruta)), `no existe public${ruta}`);
  }
  // Lo servido es exactamente lo instalado (Lenis, sin la línea del mapa de fuentes).
  for (const nombre of ['gsap', 'ScrollTrigger', 'SplitText', 'MotionPathPlugin']) {
    assert.equal(leer(`public/vendor/${nombre}-${gsapVersion}.min.js`), leer(`node_modules/gsap/dist/${nombre}.min.js`), `${nombre} no coincide con la versión instalada`);
  }
  // Solo se sirve lo que alguna escena usa.
  assert.doesNotMatch(HTML, /ScrambleTextPlugin/);
  assert.ok(!fs.existsSync(`public/vendor/ScrambleTextPlugin-${gsapVersion}.min.js`), 'el plugin de texto revuelto ya no se usa');
  const lenisInstalado = leer('node_modules/lenis/dist/lenis.min.js').replace(/\n?\/\/# sourceMappingURL=.*\n?$/, '\n');
  assert.equal(leer(`public/vendor/lenis-${lenisVersion}.min.js`).trim(), lenisInstalado.trim());
  // Los clásicos diferidos se ejecutan antes que los módulos que los usan.
  assert.ok(HTML.indexOf('gsap-') < HTML.indexOf('src="/js/portada.js"'));
  assert.match(leer('public/vendor/README.md'), /gsap\.com\/standard-license/);
  assert.match(leer('public/vendor/README.md'), /Lenis[\s\S]*MIT/);
});

test('el contenido decorativo repetido no se lee dos veces', () => {
  assert.match(HTML, /<div class="marquesina" aria-hidden="true">/);
  assert.match(HTML, /<div class="hero__sombra" aria-hidden="true">/);
  assert.match(HTML, /<span class="pronto__cinta" aria-hidden="true">/);
  assert.match(HTML, /<div class="galeria__avance marco" aria-hidden="true">/);
  assert.match(HTML, /<div class="disciplinas__vuelta" aria-hidden="true">/);
  assert.match(HTML, /<span class="hero__guia" aria-hidden="true">/);
  assert.match(TACTO, /cursor\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(VUELTA, /vuelta\.setAttribute\('aria-hidden', 'true'\)/);
});

test('la página se cuenta como una vuelta: un sector por sección numerada y la meta en «Tu pase»', () => {
  assert.match(ESCENAS, /import \{ montarVuelta \} from '\.\/portada-vuelta\.js'/);
  assert.ok(
    ESCENAS.lastIndexOf('montarVuelta({ gsap, ScrollTrigger })') > ESCENAS.lastIndexOf('pin: true'),
    'la vuelta se mide después de montar las escenas fijas, que alargan la página',
  );
  assert.match(VUELTA, /from '\.\/portada-calculos\.js'/, 'qué sector está en curso lo deciden funciones puras y probadas');
  // Los sectores salen de los índices de la página: sin textos inventados.
  assert.match(VUELTA, /\$\$\('main section'\)/, 'también la galería, que va dentro del envoltorio de ScrollTrigger');
  assert.match(VUELTA, /\$\('\.seccion__indice', seccion\)/);
  // Los tramos son contiguos y salen de la posición, no del camino: un salto
  // con un ancla deja cada sector recorrido o pendiente entero.
  assert.match(VUELTA, /progresosDeSectores\(posicion, inicios, fin\)/);
  assert.match(VUELTA, /ScrollTrigger\.addEventListener\('refresh', remedir\)/, 'los límites se vuelven a medir cuando cambia la página');
  // Una sección fija se mide por su envoltorio: si no, su sector terminaría
  // antes que la escena (la galería corre dos pantallas más).
  assert.match(VUELTA, /seccion\.parentElement\?\.classList\.contains\('pin-spacer'\) \? seccion\.parentElement : seccion/);
  assert.match(VUELTA, /vuelta--meta/);
  // Sin movimiento no hay vuelta: todo lo que la esconde cuelga de .portada-animada.
  assert.match(CSS, /\.portada-animada \.vuelta \{[^}]*opacity: 0;/s);
  assert.match(CSS, /\.con-vuelta \.sitio-progreso \{ display: none; \}/, 'la vuelta reemplaza a la línea de avance, no se suma');
  assert.match(CSS, /@media \(min-width: 900px\) and \(min-height: 560px\) \{\s*\.portada-animada \.vuelta \{/, 'regla vertical solo donde hay margen');
});

test('el telón: la primera sección sube por encima de la apertura fija', () => {
  assert.match(HTML, /<section id="pista" class="seccion seccion--telon"/);
  assert.match(CSS, /\.seccion--telon \{[^}]*z-index: 1;[^}]*background: linear-gradient\(180deg, rgba\(0, 0, 0, 0\), var\(--fondo\)/s,
    'va un plano por delante y su borde de arriba se funde con la foto');
  assert.doesNotMatch(sinComentarios(CSS), /\.hero \+ \.seccion/,'al fijar la apertura ScrollTrigger la envuelve y deja de ser la hermana de la sección');
});

test('una sola gramática de movimiento: el encabezado se lee en orden y nada gira para aparecer', () => {
  assert.match(ESCENAS, /for \(const cabeza of \$\$\('\.seccion__cabeza, \.acceso__intro, \.pronto__texto'\)\) \{\s*const disparo = \(\) => alEntrar\(cabeza, 'top 84%'\);/,
    'índice, titular y entradilla comparten un único disparo por encabezado');
  // El orden de lectura: índice, titular (0,1 s) y entradilla (0,32 s).
  const cabezas = ESCENAS.slice(ESCENAS.indexOf("for (const cabeza of"), ESCENAS.indexOf('// 01 · La pista'));
  assert.ok(cabezas.indexOf('delay: 0.1') < cabezas.indexOf('delay: 0.32'));
  // Ni tarjetas que giran en 3D ni fechas que se inclinan: se sube y se enciende.
  assert.doesNotMatch(ESCENAS, /rotationX|transformPerspective/, 'los bloques no giran para entrar');
  assert.doesNotMatch(ESCENAS, /rotation: \(i\)/);
  // Las rejillas (fechas, tienda) no se descuadran mientras se leen.
  assert.doesNotMatch(ESCENAS, /trigger: '\.(?:agenda|productos)', start: 'top bottom', end: 'bottom top', scrub: true/);
  assert.doesNotMatch(ESCENAS, /scrambleText/);
  assert.match(ESCENAS, /const SUBIDA = \{ opacity: 0, y: 36, duration: 1\.1 \};/);
  assert.ok((ESCENAS.match(/\.\.\.SUBIDA/g) ?? []).length >= 10, 'los bloques comparten la misma subida');
  // Las fotos del recorrido se descubren todas en el mismo sentido.
  assert.match(ESCENAS, /\$\$\('\.mosaico__foto'\)\.forEach[\s\S]*?clipPath: 'inset\(100% 0% 0% 0%\)'/);
  assert.doesNotMatch(ESCENAS, /const cortes = /);
});

test('el cursor propio nunca esconde dónde se escribe', () => {
  assert.match(CSS, /html\.cursor-propio input,\s*html\.cursor-propio textarea,\s*html\.cursor-propio select \{ cursor: text; \}/);
  assert.match(TACTO, /cursor\.classList\.toggle\('cursor--oculto', Boolean\(objetivo\?\.closest\(ESCRIBIBLES\)\)\)/);
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.cursor \{ display: none; \}/);
});

test('lo que espera a revelarse se puede enfocar con el teclado', () => {
  // `autoAlpha` pone `visibility: hidden`, que saca el elemento del orden de
  // tabulación: un enlace o un campo sin revelar sería inalcanzable con el
  // teclado. Solo el semáforo, que es decorativo, puede desaparecer del todo.
  const codigo = ESCENAS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const usos = [...codigo.matchAll(/^.*autoAlpha.*$/gm)].map((m) => m[0].trim());
  assert.equal(usos.length, 1, 'sin autoAlpha en el contenido');
  assert.match(usos[0], /^\.to\('\.hero__semaforo', \{ autoAlpha: 0, y: -30 \}, 0\);?$/, 'solo el semáforo, que es decorativo');
  assert.doesNotMatch(codigo + TACTO, /visibility:\s*['"]?hidden/);
  assert.match(ESCENAS, /cabecera\.addEventListener\('focusin', \(\) => poner\(true\)\)/, 'la cabecera escondida vuelve en cuanto el foco entra en ella');
});
