/**
 * Comprobaciones estáticas de la interfaz.
 *
 * La interfaz no pasa por ningún compilador, así que un nombre mal escrito no
 * se descubre hasta que alguien abre esa pantalla. Estas pruebas hacen el
 * trabajo que haría un compilador: que las importaciones existan, que cada
 * `#identificador` que busca el JavaScript esté en el HTML, y que no se use una
 * clase de CSS que nadie definió.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const DIR_JS = 'public/js';
const PAGINAS = {
  'public/index.html': ['login.js'],
  'public/app.html': ['cliente.js'],
  'public/scan.html': ['escaner.js'],
  'public/admin.html': ['admin.js', 'ficha.js', 'avisos.js', 'fidelidad.js'],
  'public/recordatorios.html': ['recordatorios.js'],
  'public/restablecer.html': ['restablecer.js'],
  'public/cartera.html': ['cartera.js'],
  'public/posiciones.html': [],
};
/** Módulos que carga toda página autenticada. */
const COMUNES = ['shell.js', 'ui.js', 'api.js', 'realtime.js'];

const leer = (archivo) => fs.readFileSync(archivo, 'utf8');
const modulos = fs.readdirSync(DIR_JS).filter((f) => f.endsWith('.js'));

function exportacionesDe(archivo) {
  const src = leer(path.join(DIR_JS, archivo));
  const nombres = new Set(
    [...src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
  );
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const n of m[1].split(',')) nombres.add(n.trim().split(/\s+as\s+/).pop().trim());
  }
  return nombres;
}

function identificadoresDe(html) {
  return new Set([...leer(html).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
}

test('cada importación entre módulos del navegador existe', () => {
  const exportados = new Map(modulos.map((m) => [m, exportacionesDe(m)]));
  const fallos = [];

  for (const archivo of modulos) {
    const src = leer(path.join(DIR_JS, archivo));
    for (const m of src.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*'\.\/([\w.-]+)'/g)) {
      const destino = exportados.get(m[2]);
      if (!destino) {
        fallos.push(`${archivo} importa de ${m[2]}, que no existe`);
        continue;
      }
      for (const bruto of m[1].split(',')) {
        const nombre = bruto.trim().split(/\s+as\s+/)[0].trim();
        if (nombre && !destino.has(nombre)) fallos.push(`${archivo} importa "${nombre}" y ${m[2]} no lo exporta`);
      }
    }
  }
  assert.deepEqual(fallos, []);
});

test('no se usa nada de ui.js sin haberlo importado', () => {
  // El fallo típico de una interfaz sin compilador: añadir una llamada y
  // olvidar el `import`. Solo se ve al abrir esa pantalla concreta.
  const utilidades = exportacionesDe('ui.js');
  const fallos = [];

  for (const modulo of modulos.filter((m) => m !== 'ui.js')) {
    const src = leer(path.join(DIR_JS, modulo));
    const importados = new Set();
    for (const m of src.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*'\.\/[\w.-]+'/g)) {
      for (const bruto of m[1].split(',')) {
        const nombre = bruto.trim().split(/\s+as\s+/).pop().trim();
        if (nombre) importados.add(nombre);
      }
    }
    // Lo que el propio módulo declara tampoco necesita importarse.
    const propios = new Set(
      [...src.matchAll(/(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
    );

    const cuerpo = src.replace(/import[\s\S]*?from\s*'[^']+';/g, '');
    for (const utilidad of utilidades) {
      if (utilidad.length < 3) continue; // $ y $$ se comprueban aparte
      const usada = new RegExp(`\\b${utilidad}\\s*\\(`).test(cuerpo);
      if (usada && !importados.has(utilidad) && !propios.has(utilidad)) {
        fallos.push(`${modulo}: usa ${utilidad}() sin importarlo de ui.js`);
      }
    }
  }
  assert.deepEqual(fallos, []);
});

test('ninguna utilidad de ui.js se pasa sin llamarla', () => {
  // `el(..., icono)` en vez de `el(..., icono(nombre))` no rompe nada: el
  // elemento acaba mostrando el código fuente de la función como texto, y solo
  // se ve abriendo esa pantalla. Pasó al cambiar los emojis por iconos.
  const utilidades = [...exportacionesDe('ui.js')].filter((n) => n.length >= 3);
  const fallos = [];

  for (const modulo of modulos.filter((m) => m !== 'ui.js')) {
    const cuerpo = leer(path.join(DIR_JS, modulo)).replace(/import[\s\S]*?from\s*'[^']+';/g, '');
    for (const utilidad of utilidades) {
      // Como argumento suelto: precedido de coma o paréntesis y seguido de
      // coma o cierre, sin paréntesis de llamada ni punto de propiedad.
      if (new RegExp(`[,(]\\s*${utilidad}\\s*[,)]`).test(cuerpo)) {
        fallos.push(`${modulo}: pasa ${utilidad} sin llamarla`);
      }
    }
  }
  assert.deepEqual(fallos, []);
});

test('los identificadores que busca el JavaScript existen en su página', () => {
  const fallos = [];
  for (const [html, propios] of Object.entries(PAGINAS)) {
    const modulosDeLaPagina = [...propios, ...COMUNES];
    const ids = identificadoresDe(html);
    // Algunos elementos los crea el propio JavaScript; también cuentan.
    for (const modulo of modulosDeLaPagina) {
      for (const m of leer(path.join(DIR_JS, modulo)).matchAll(/\bid:\s*'([A-Za-z0-9_-]+)'/g)) ids.add(m[1]);
    }
    for (const modulo of modulosDeLaPagina) {
      const src = leer(path.join(DIR_JS, modulo));
      for (const m of src.matchAll(/\$\(\s*'#([A-Za-z0-9_-]+)'/g)) {
        if (!ids.has(m[1])) fallos.push(`${html} <- ${modulo}: #${m[1]} no existe ni en el HTML ni se crea desde el JavaScript`);
      }
    }
  }
  assert.deepEqual(fallos, []);
});

test('las referencias de accesibilidad apuntan a elementos reales', () => {
  const fallos = [];
  for (const html of [...Object.keys(PAGINAS), 'public/404.html']) {
    const ids = identificadoresDe(html);
    const src = leer(html);
    for (const m of src.matchAll(/aria-(controls|labelledby|describedby)="([^"]+)"/g)) {
      for (const ref of m[2].split(/\s+/)) {
        if (!ids.has(ref)) fallos.push(`${html}: aria-${m[1]} apunta a "${ref}", que no existe`);
      }
    }
    for (const m of src.matchAll(/<label[^>]*\sfor="([^"]+)"/g)) {
      if (!ids.has(m[1])) fallos.push(`${html}: <label for="${m[1]}"> no tiene destino`);
    }
  }
  assert.deepEqual(fallos, []);
});

test('todas las páginas usan el logo oficial como icono de pestaña', () => {
  const favicon = 'public/favicon.png';
  assert.ok(fs.existsSync(favicon), 'debe existir el favicon oficial en PNG');

  for (const html of [...Object.keys(PAGINAS), 'public/404.html']) {
    assert.match(
      leer(html),
      /<link rel="icon" href="(?:\/|\.\/)favicon\.png" type="image\/png">/,
      `${html} debe cargar el logo oficial en sus pestañas`,
    );
  }

  const manifest = JSON.parse(leer('public/manifest.webmanifest'));
  assert.deepEqual(manifest.icons[0], {
    src: '/favicon.png',
    sizes: '1254x1254',
    type: 'image/png',
    purpose: 'any',
  });
});

test('no hay identificadores repetidos en una misma página', () => {
  for (const html of [...Object.keys(PAGINAS), 'public/404.html']) {
    const vistos = new Set();
    const repetidos = [];
    for (const m of leer(html).matchAll(/\sid="([^"]+)"/g)) {
      if (vistos.has(m[1])) repetidos.push(m[1]);
      vistos.add(m[1]);
    }
    assert.deepEqual(repetidos, [], `${html} tiene identificadores repetidos`);
  }
});

test('toda clase usada en el HTML está definida en la hoja de estilos', () => {
  const fallos = [];
  for (const html of [...Object.keys(PAGINAS), 'public/404.html']) {
    const src = leer(html);
    const hojas = [...src.matchAll(/<link rel="stylesheet" href="\/css\/([\w.-]+\.css)">/g)].map((m) => leer(`public/css/${m[1]}`));
    const definidas = new Set(hojas.flatMap((css) => [...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1])));
    for (const m of src.matchAll(/class="([^"]+)"/g)) {
      for (const clase of m[1].split(/\s+/)) {
        if (clase && !definidas.has(clase)) fallos.push(`${html}: la clase .${clase} no está definida`);
      }
    }
  }
  assert.deepEqual(fallos, []);
});

test('el HTML no usa el atributo style, que la política de seguridad prohíbe', () => {
  for (const html of [...Object.keys(PAGINAS), 'public/404.html']) {
    assert.ok(!/\sstyle="/.test(leer(html)), `${html} tiene estilos en línea y serían bloqueados`);
  }
});

test('cada página carga los módulos que sus scripts necesitan', () => {
  for (const [html, propios] of Object.entries(PAGINAS)) {
    const src = leer(html);
    for (const modulo of propios) {
      // El módulo puede cargarse directamente o importarse desde otro que sí lo esté.
      const cargadoDirecto = src.includes(`/js/${modulo}`);
      const importadoPorOtro = propios.some((otro) =>
        otro !== modulo && src.includes(`/js/${otro}`) && leer(path.join(DIR_JS, otro)).includes(`'./${modulo}'`),
      );
      assert.ok(cargadoDirecto || importadoPorOtro, `${html} no llega a cargar ${modulo}`);
    }
  }
});

/**
 * Todo el producto se pinta sobre el negro de la marca: portada, entradas,
 * puerta y administración. El `theme-color` de cada pantalla tiene que ser ese
 * negro, porque si declara otro color el teléfono pinta una franja ajena
 * encima de la página.
 */
const PORTADA = 'public/index.html';
const PAPEL = '#000000';

test('todas las pantallas se pintan sobre el negro de la marca', () => {
  for (const html of [...Object.keys(PAGINAS), 'public/404.html']) {
    const src = leer(html);
    assert.match(
      src,
      new RegExp(`<meta name="theme-color" content="${PAPEL}">`),
      `${html} debe declarar el negro que de verdad pinta`,
    );
    assert.match(src, /<link rel="stylesheet" href="\/css\/styles\.css">/, `${html} debe cargar los estilos de marca`);
  }
  const manifest = JSON.parse(leer('public/manifest.webmanifest'));
  assert.equal(manifest.background_color, PAPEL);
  assert.equal(manifest.theme_color, PAPEL);
});


test('la portada se marca como página de entrada', () => {
  assert.match(
    leer(PORTADA),
    /<body class="pagina-entrada">/,
    'la portada debe marcar su cuerpo como página de entrada',
  );
});

test('la portada no repite el mismo encuadre fotográfico en dos bloques', () => {
  const imagenes = [...leer(PORTADA).matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  const repetidas = imagenes.filter((src, indice) => imagenes.indexOf(src) !== indice);
  assert.deepEqual(repetidas, [], 'cada bloque visual debe tener una imagen principal distinta');
});

test('las referencias visuales de la portada apuntan a archivos existentes', () => {
  const src = leer(PORTADA);
  const rutas = new Set();
  for (const match of src.matchAll(/\b(?:src|href)="([./][^\"]+)"/g)) {
    if (match[1].includes('/images/')) rutas.add(match[1]);
  }
  for (const match of src.matchAll(/\bsrcset="([^"]+)"/g)) {
    for (const candidato of match[1].split(',')) {
      const ruta = candidato.trim().split(/\s+/)[0];
      if (ruta.includes('/images/')) rutas.add(ruta);
    }
  }
  const faltantes = [...rutas]
    .map((ruta) => ruta.replace(/^\.\//, '').replace(/^\//, ''))
    .filter((ruta) => !fs.existsSync(path.join('public', ruta)));
  assert.deepEqual(faltantes, []);
});

test('la portada no conserva capturas antiguas ni encuadres descartados', () => {
  const html = leer(PORTADA);
  const css = leer('public/css/portada.css');
  const fuentes = `${html}\n${css}`;
  assert.doesNotMatch(fuentes, /pista-real\//, 'la portada no debe volver a cargar el set de baja resolución');
  assert.doesNotMatch(fuentes, /miniapolis-(?:action|track-portrait)/, 'la portada no debe cargar fuentes visuales descartadas');
  assert.doesNotMatch(fuentes, /(?:-draft|-upscale)\.(?:webp|jpeg|jpg|png)/, 'la portada no debe cargar derivados de revisión');
});

test('el sistema visual comparte tokens y usa la capa operativa oscura', () => {
  const css = leer('public/css/styles.css');
  assert.match(css, /--fondo:\s*#000000/);
  assert.match(css, /--acento:\s*#93d241/);
  assert.match(css, /\.barra[\s\S]*\.tarjeta/);
});

test('la tipografía es Saira ancha para la voz de pista y Sora para el texto, servidas desde el dominio', () => {
  const css = leer('public/css/styles.css');
  for (const [familia, archivo] of [['Saira', 'saira-var.woff2'], ['Sora', 'sora-var.woff2']]) {
    assert.match(css, new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*'${familia}'[^}]*url\\('/fonts/${archivo}'\\)`, 's'));
    assert.ok(fs.existsSync(`public/fonts/${archivo}`), `${archivo} debe existir`);
    assert.ok(fs.existsSync(`public/fonts/OFL-${familia}.txt`), `la licencia de ${familia} viaja con la fuente`);
  }
  assert.match(css, /@font-face\s*\{[^}]*'Saira'[^}]*font-stretch:\s*100%\s+125%/s, 'Saira declara su eje de anchura');
  assert.match(css, /--fuente:\s*'Sora'/);
  assert.match(css, /--display:\s*'Saira'/);
  assert.doesNotMatch(css, /Archivo'/, 'la fuente anterior no debe quedar referenciada');
});

test('ningún texto lleva interletraje negativo: las letras nunca se tocan', () => {
  for (const hoja of ['public/css/styles.css', 'public/css/portada.css']) {
    const negativos = [...leer(hoja).matchAll(/letter-spacing:\s*-[\d.]+/g)].map((m) => `${hoja}: ${m[0]}`);
    assert.deepEqual(negativos, []);
  }
});

test('los botones tienen hover de pista (chasis inclinado con estelas) y los comentarios de la hoja cierran', () => {
  const css = leer('public/css/styles.css');
  assert.match(css, /\.boton:not\(\.boton--enlace\):not\(\.boton--nav\)::before\s*\{[^}]*transform:\s*skewX\(var\(--inclinacion\)\)/s);
  assert.match(css, /@keyframes estelas/);
  // Cada comentario de bloque abre y cierra: un `*/` huérfano se come la regla siguiente.
  const aperturas = (css.match(/\/\*/g) || []).length;
  const cierres = (css.match(/\*\//g) || []).length;
  assert.equal(aperturas, cierres, 'hay un comentario sin abrir o sin cerrar en la hoja');
});

test('el sistema de interacción cubre hovers, pulsación y superficies con una salida accesible', () => {
  const css = leer('public/css/styles.css');
  assert.match(css, /--t-hover:/, 'la interacción debe tener un ritmo propio');
  assert.match(css, /@media\s*\(hover:\s*hover\)/, 'los efectos intensos deben reservarse a dispositivos con hover real');
  assert.match(css, /\.boton:hover:not\(:disabled\)[\s\S]*transform:\s*translateY\(-2px\)/);
  assert.match(css, /\.boton:active:not\(:disabled\)[\s\S]*transform:\s*translateY\(1px\)/);
  assert.match(css, /\.pack:hover[\s\S]*transform:\s*translateY\(-4px\)/);
  assert.match(css, /\.opcion-pack:hover[\s\S]*box-shadow:/);
  assert.match(css, /\.pestana:hover[\s\S]*color:/);
  assert.match(css, /input:hover:not\(:disabled\)[\s\S]*box-shadow:/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*transition-duration:\s*\.01ms/);
});

test('las páginas operativas conservan el shell y la hoja de estilos compartida', () => {
  for (const html of ['public/app.html', 'public/scan.html', 'public/admin.html']) {
    const src = leer(html);
    assert.match(src, /<header[^>]+id="cabecera"|<header[^>]+class="barra"/);
    assert.match(src, /<link rel="stylesheet" href="\/css\/styles\.css">/);
  }
});

test('el escáner tiene guardado sin conexión todo lo que carga, y nada de la API', () => {
  const sw = leer('public/sw-escaner.js');
  const lista = sw.match(/const RECURSOS = \[([\s\S]*?)\];/);
  assert.ok(lista, 'no se encontró la lista de recursos del service worker');
  const guardados = new Set([...lista[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));

  // Lo que pide la página: sus enlaces, sus scripts, los módulos que estos
  // importan (y los que importan esos), y lo que la hoja de estilos y los
  // módulos cargan por su cuenta.
  const necesarios = new Set(['/escanear']);
  const html = leer('public/scan.html');
  for (const m of html.matchAll(/\s(?:href|src)="(\/[^"]+)"/g)) necesarios.add(m[1]);

  const pendientes = [...necesarios].filter((r) => r.startsWith('/js/'));
  const vistos = new Set();
  while (pendientes.length) {
    const ruta = pendientes.pop();
    if (vistos.has(ruta)) continue;
    vistos.add(ruta);
    const src = leer(`public${ruta}`);
    for (const m of src.matchAll(/from\s*'\.\/([\w.-]+)'/g)) {
      necesarios.add(`/js/${m[1]}`);
      pendientes.push(`/js/${m[1]}`);
    }
    for (const m of src.matchAll(/'(\/(?:images|fonts|vendor)\/[^']+)'/g)) necesarios.add(m[1]);
  }
  for (const m of leer('public/css/styles.css').matchAll(/url\('(\/[^']+)'\)/g)) necesarios.add(m[1]);

  const faltan = [...necesarios].filter((r) => !guardados.has(r));
  assert.deepEqual(faltan, [], 'el escáner no abriría sin conexión: faltan en sw-escaner.js');

  for (const recurso of guardados) {
    assert.ok(!recurso.startsWith('/api/'), `${recurso}: la API nunca se guarda en la caché`);
    const archivo = recurso === '/escanear' ? 'public/scan.html' : `public${recurso}`;
    assert.ok(fs.existsSync(archivo), `${recurso} está en la caché del escáner pero no existe`);
  }
});

test('la identidad para abrir el escáner sin red se olvida con la misma clave con que se guarda', () => {
  // api.js la borra al entrar, salir o perder la sesión; la cola la guarda como
  // dato «operador». Si las dos claves se separan, cerrar sesión dejaría de
  // impedir que el escáner abra sin red con esa identidad.
  const api = leer('public/js/api.js');
  const cola = leer('public/js/cola-sin-conexion.js');
  const escaner = leer('public/js/escaner.js');
  const prefijo = cola.match(/const PREFIJO_DATO = '([^']+)'/)[1];
  assert.ok(escaner.includes("almacen.recordar('operador'"), 'el escáner guarda la identidad como «operador»');
  assert.ok(api.includes(`'${prefijo}operador'`), `api.js debe olvidar ${prefijo}operador`);
});
