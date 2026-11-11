import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('cada cambio de estilo o escena publica URLs nuevas para visitantes con caché', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapolis-pages-cache-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.mkdirSync(path.join(root, 'public/css'), { recursive: true });
    fs.mkdirSync(path.join(root, 'public/js'));
    for (const file of ['scripts/preparar-pages.js', 'scripts/generar-seo.js', 'site.config.js']) {
      fs.copyFileSync(file, path.join(root, file));
    }
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    for (const file of ['index.html', 'posiciones.html', 'privacidad.html']) {
      fs.writeFileSync(path.join(root, 'public', file), '<html lang="es-EC"><head><title>Miniápolis</title><link rel="stylesheet" href="/css/portada.css"><script type="module" src="/js/portada.js"></script></head><body></body></html>');
    }
    const css = path.join(root, 'public/css/portada.css');
    const scenes = path.join(root, 'public/js/portada-escenas.js');
    fs.writeFileSync(css, '.ubicacion { display: grid; }');
    fs.writeFileSync(scenes, 'export function montarEscenas() {}');
    fs.writeFileSync(path.join(root, 'public/js/portada.js'), "import { montarEscenas } from './portada-escenas.js';\nmontarEscenas();\n");

    const build = () => {
      execFileSync(process.execPath, ['scripts/preparar-pages.js'], { cwd: root, stdio: 'pipe' });
      const html = fs.readFileSync(path.join(root, '_site/index.html'), 'utf8');
      const entry = fs.readFileSync(path.join(root, '_site/js/portada.js'), 'utf8');
      const urls = {
        css: html.match(/href="(\.\/css\/portada\.css[^"]*)"/)?.[1],
        entry: html.match(/src="(\.\/js\/portada\.js[^"]*)"/)?.[1],
        scenes: entry.match(/from '([^']+)'/)?.[1],
      };
      for (const url of Object.values(urls)) {
        assert.ok(new URL(url, 'https://example.org/pista/').searchParams.get('v'), `${url} necesita una versión para evitar la caché anterior`);
      }
      return urls;
    };

    const initial = build();
    assert.deepEqual(build(), initial, 'el mismo contenido mantiene las mismas URLs');
    fs.appendFileSync(css, '\n.ubicacion__mapa { width: 100%; }');
    const afterCss = build();
    for (const asset of Object.keys(initial)) assert.notEqual(afterCss[asset], initial[asset]);
    fs.appendFileSync(scenes, '\nexport const ubicacion = true;');
    const afterScenes = build();
    for (const asset of Object.keys(initial)) assert.notEqual(afterScenes[asset], afterCss[asset]);
    for (const url of Object.values(afterScenes)) {
      const parsed = new URL(url, 'https://example.org/pista/');
      assert.ok(parsed.pathname.startsWith('/pista/'), 'el despliegue sigue funcionando en un subdirectorio');
    }
    assert.match(fs.readFileSync(path.join(root, 'public/js/portada.js'), 'utf8'), /from '\.\/portada-escenas\.js'/, 'el código fuente queda intacto');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
