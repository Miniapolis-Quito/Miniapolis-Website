import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leer = (archivo) => fs.readFileSync(archivo, 'utf8');
const portada = leer('public/index.html');
const app = leer('src/app.js');
const portadaCss = leer('public/css/portada.css');
const portadaJs = leer('public/js/portada.js');
const posicionesCss = () => leer('public/css/posiciones.css');

test('la portada contiene el contenido público completo de Miniápolis', () => {
  for (const [ancla, copy] of [
    ['complejo', 'COMPLEJO DE RADIO CONTROL INDOOR'],
    ['pista', '44 m × 22,5 m'],
    ['horarios', 'MIÉRCOLES'],
    ['records', 'DANILO M.'],
    ['eventos', 'Torneo del Recuerdo'],
    ['galeria', 'Más que una pista'],
  ]) {
    assert.match(portada, new RegExp(`id="${ancla}"`), `falta el ancla #${ancla}`);
    assert.match(portada, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `falta el contenido ${copy}`);
  }
  for (const copy of [
    'Pista de Crawling',
    'Circuito para drones',
    'Boxes para 60 pilotos',
    'AMB / MyLaps',
    'ALGO GRANDE SE ESTÁ CONSTRUYENDO PARA TI',
    'Racing Hobbies',
    'Lancia Delta Integrale',
  ]) assert.match(portada, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `falta ${copy}`);
});

test('la portada enlaza al campeonato y a la tienda sin enlaces ficticios', () => {
  assert.match(portada, /href="\.\/posiciones\.html"/);
  assert.match(portada, /href="https:\/\/racinghobbiesec\.com"[^>]*target="_blank"[^>]*rel="noreferrer"/);
  assert.doesNotMatch(portada, /href="#"/);
});

test('la página pública de posiciones existe y conserva los datos del campeonato', () => {
  assert.ok(fs.existsSync('public/posiciones.html'));
  const posiciones = leer('public/posiciones.html');
  for (const copy of [
    'TABLA DE POSICIONES',
    'TEMPORADA JULIO - AGOSTO 2026',
    'Danilo M.',
    'Ferrari',
    '152',
    'F1, Tamiya TT-01',
  ]) assert.match(posiciones, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `falta ${copy}`);
  assert.match(posiciones, /href="\.\/index\.html(?:#complejo)?"/);
  assert.match(posiciones, /href="https:\/\/racinghobbiesec\.com"[^>]*target="_blank"[^>]*rel="noreferrer"/);
});

test('Express sirve la página pública de posiciones', () => {
  assert.match(app, /app\.get\('\/posiciones', page\('posiciones\.html'\)\)/);
});

test('todas las imágenes locales nuevas existen y declaran tamaño y alt', () => {
  for (const archivo of ['public/index.html', 'public/posiciones.html']) {
    const html = leer(archivo);
    for (const etiqueta of html.matchAll(/<img\b[^>]*>/g)) {
      assert.match(etiqueta[0], /\swidth="\d+"/);
      assert.match(etiqueta[0], /\sheight="\d+"/);
      assert.match(etiqueta[0], /\salt="[^"]*"/);
    }
    const rutas = [...html.matchAll(/\bsrc="(\.\/images\/[^\"]+)"/g)].map((m) => m[1]);
    for (const ruta of rutas) {
      assert.ok(fs.existsSync(path.join('public', ruta.slice(2))), `${archivo}: falta ${ruta}`);
    }
  }
});

test('los nuevos bloques tienen sistema visual, responsive y salida accesible', () => {
  for (const selector of ['.portada__info', '.portada__disciplinas', '.portada__spec-grid', '.portada__horarios', '.portada__records', '.portada__eventos-lista', '.portada__galeria', '.portada__promos']) {
    assert.match(portadaCss, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(portadaCss, /\.portada-motor[\s\S]*\.portada__info/);
  assert.match(portadaCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.portada__info/);
  assert.match(portadaCss, /@media\s*\(max-width:\s*700px\)[\s\S]*\.portada__disciplinas/);
  const css = posicionesCss();
  for (const selector of ['.pagina-posiciones', '.posiciones__hero', '.posiciones__tabla', '.posiciones__carrera', '.posiciones__galeria-grid']) {
    assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
});

test('el motor de portada monta las escenas informativas y conserva el fallback', () => {
  for (const escena of ['detalle', 'horario', 'records', 'eventos', 'galeria', 'comunidad']) {
    assert.match(portada, new RegExp(`data-escena="${escena}"`));
    assert.match(portadaJs, new RegExp(`['"]${escena}['"]`), `portada.js no monta ${escena}`);
  }
  assert.match(portadaJs, /IntersectionObserver/);
  assert.match(portadaJs, /prefers-reduced-motion|sinMovimiento/);
});

test('las secciones informativas consumen el progreso del motor para animarse con el scroll', () => {
  assert.match(portadaCss, /var\(--info-p/);
  for (const selector of ['.portada__info--complejo', '.portada__info--datos', '.portada__info--records', '.portada__info--eventos', '.portada__info--galeria', '.portada__info--comunidad']) {
    assert.match(portadaCss, new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')}[^}]*var\\(--info-p`), `falta movimiento ligado al scroll en ${selector}`);
  }
});

test('los titulares largos y las tarjetas con imagen conservan el texto dentro del layout móvil', () => {
  const posiciones = leer('public/css/posiciones.css');
  const portada = leer('public/css/portada.css');

  assert.match(
    posiciones,
    /@media\s*\(max-width:\s*760px\)[\s\S]*\.posiciones__hero h1\s*\{[^}]*max-width:\s*(?:none|12ch)/,
    'el título de posiciones no debe dejar una palabra huérfana en móvil',
  );
  assert.match(
    portada,
    /\.portada__info--pronto\s* >\s*\*\s*\{[^}]*min-width:\s*0/,
    'el bloque de muy pronto debe permitir que sus textos se encojan dentro de la rejilla',
  );
  assert.match(
    portada,
    /\.portada__promo\s*\{[^}]*min-width:\s*0/,
    'las promociones no deben forzar overflow cuando el texto ocupa varias líneas',
  );
});

test('las secciones nuevas usan fotos reales distintas y animan sus visuales con el scroll', () => {
  const fotos = [
    'pista-amplia.jpeg',
    'coche-salida.jpeg',
    'curva-ventanas.jpeg',
    'hangar-ancho.jpeg',
    'pista-lateral.jpeg',
    'boxes-curva.jpeg',
  ];
  const galeria = portada.match(/<section id="galeria"[\s\S]*?<\/section>/)?.[0] ?? '';

  assert.equal(
    new Set([...galeria.matchAll(/src="\.\/images\/pista-real\/([^"]+)"/g)].map(([, archivo]) => archivo)).size,
    fotos.length,
    'la galería debe mostrar seis fotos reales sin repetir encuadres',
  );
  for (const foto of fotos) {
    assert.match(galeria, new RegExp(`pista-real/${foto}`), `falta la foto ${foto} en la galería`);
    assert.ok(fs.existsSync(path.join('public/images/pista-real', foto)), `falta el archivo ${foto}`);
  }
  assert.match(portada, /pista-real\/pista-baja\.jpeg/);
  assert.match(portadaCss, /\.portada-motor[\s\S]*\.portada__pronto-visual img[\s\S]*var\(--info-p/);
  assert.match(portadaCss, /\.portada-motor[\s\S]*\.portada__info--galeria \.portada__galeria-card[\s\S]*var\(--info-p/);
  assert.match(portadaCss, /prefers-reduced-motion[\s\S]*\.portada__pronto-visual img[\s\S]*\.portada__info--galeria img/);
  assert.doesNotMatch(portada, /images\/contenido\/muy-pronto\.png/);
  assert.doesNotMatch(portadaCss, /images\/contenido\/eventos-fondo\.png/);
});

test('la tabla pública conserva una entrada animada y legible', () => {
  const css = posicionesCss();
  assert.match(css, /@keyframes\s+posicionesEntrada/);
  assert.match(css, /\.posiciones__hero[^}]*animation/);
  assert.match(css, /\.posiciones__tabla tbody tr[^}]*animation/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});
