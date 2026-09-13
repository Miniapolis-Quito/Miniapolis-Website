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
  'public/admin.html': ['admin.js', 'ficha.js'],
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
  const css = leer('public/css/styles.css');
  const definidas = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
  const fallos = [];
  for (const html of [...Object.keys(PAGINAS), 'public/404.html']) {
    for (const m of leer(html).matchAll(/class="([^"]+)"/g)) {
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

test('las pantallas usan el lienzo negro de la identidad Racing Hobbies', () => {
  const paginas = [...Object.keys(PAGINAS), 'public/404.html'];
  for (const html of paginas) {
    const src = leer(html);
    assert.match(src, /<meta name="theme-color" content="#000000">/, `${html} debe declarar el negro de marca`);
    assert.match(src, /<link rel="stylesheet" href="\/css\/styles\.css">/, `${html} debe cargar los estilos de marca`);
  }
  const manifest = JSON.parse(leer('public/manifest.webmanifest'));
  assert.equal(manifest.background_color, '#000000');
  assert.equal(manifest.theme_color, '#000000');
});
