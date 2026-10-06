import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leer = (archivo) => fs.readFileSync(archivo, 'utf8');
const portada = leer('public/index.html');
const app = leer('src/app.js');
const portadaCss = leer('public/css/portada.css');
const publicoCss = leer('public/css/publico.css');
const posicionesCss = () => leer('public/css/posiciones.css');

test('la portada contiene el contenido público completo de Miniápolis', () => {
  for (const [ancla, copy] of [
    ['complejo', 'COMPLEJO DE RADIO CONTROL INDOOR'],
    ['pista', '44 m × 22,5 m'],
    ['horarios', 'MIÉRCOLES'],
    ['records', 'DANILO M.'],
    ['eventos', 'Torneo del Recuerdo'],
    ['galeria', 'Galería del circuito'],
  ]) {
    assert.match(portada, new RegExp(`id="${ancla}"`), `falta el ancla #${ancla}`);
    assert.match(portada, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `falta el contenido ${copy}`);
  }
  for (const copy of [
    'Pista de Crawling',
    'Circuito para drones',
    'Boxes para 60 pilotos',
    'AMB / MyLaps',
    'En construcción',
    'Racing Hobbies',
    'Lancia Delta Integrale',
  ]) assert.match(portada, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `falta ${copy}`);
});

test('la portada enlaza al campeonato y a la tienda sin enlaces ficticios', () => {
  assert.match(portada, /href="\.\/posiciones\.html"/);
  assert.match(portada, /href="https:\/\/racinghobbies\.net\/catalogo" target="_blank" rel="noreferrer">Tienda Racing Hobbies</);
  assert.doesNotMatch(portada, /href="#"/);
  assert.doesNotMatch(portada, /racinghobbiesec\.com/);
});

test('cada tarjeta de la tienda abre su producto en el catálogo de Racing Hobbies', () => {
  const tienda = portada.match(/<ul class="productos[\s\S]*?<\/ul>/)?.[0] ?? '';
  const tarjetas = [...tienda.matchAll(/<a class="producto[^"]*" href="([^"]+)"[^>]*>[\s\S]*?<strong>([^<]+)<\/strong>/g)]
    .map(([, href, nombre]) => [nombre, href.replaceAll('&amp;', '&')]);
  // El catálogo filtra con ?cat= y ?q= al cargar; no tiene una dirección por producto.
  assert.deepEqual(tarjetas, [
    ['Lancia Delta Integrale', 'https://racinghobbies.net/catalogo?q=lancia'],
    ['Amortiguadores de alto rendimiento', 'https://racinghobbies.net/catalogo?cat=louis&q=shock'],
    ['Llantas de competición', 'https://racinghobbies.net/catalogo?q=tires'],
    ['Motores de competición', 'https://racinghobbies.net/catalogo?q=motor%20de%20competici%C3%B3n'],
    ['RC Builder', 'https://racinghobbies.net/catalogo'],
  ]);
  assert.equal([...tienda.matchAll(/target="_blank" rel="noreferrer"/g)].length, 5, 'todas abren en otra pestaña');
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
  assert.match(posiciones, /href="https:\/\/racinghobbies\.net\/catalogo" target="_blank" rel="noreferrer">Tienda Racing Hobbies</);
});

test('las fichas de tienda de posiciones abren el mismo producto que la portada', () => {
  const posiciones = leer('public/posiciones.html');
  const fichas = [...posiciones.matchAll(/<a class="posiciones__promo" href="([^"]+)"[^>]*>[\s\S]*?<strong>([^<]+)<\/strong>/g)]
    .map(([, href, nombre]) => [nombre, href]);
  assert.deepEqual(fichas, [
    ['Lancia Delta Integrale', 'https://racinghobbies.net/catalogo?q=lancia'],
    ['Motor brushless', 'https://racinghobbies.net/catalogo?q=motor%20de%20competici%C3%B3n'],
  ]);
  assert.doesNotMatch(posiciones, /racinghobbiesec\.com/);
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

test('cada bloque de la portada tiene su sistema visual, responsive y salida accesible', () => {
  for (const selector of ['.hero', '.mosaico', '.disciplinas', '.ficha', '.plano', '.horarios__lista', '.tiempos', '.agenda', '.pronto', '.galeria', '.productos', '.acceso']) {
    assert.match(portadaCss, new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`), `falta ${selector}`);
  }
  for (const selector of ['.marco', '.sitio-barra', '.sitio-pie', '.seccion__cabeza', '.seccion__indice']) {
    assert.match(publicoCss, new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`), `falta ${selector} en publico.css`);
  }
  assert.match(portadaCss, /@media\s*\(max-width:\s*760px\)[\s\S]*\.mosaico/);
  assert.match(portadaCss, /@media\s*\(max-width:\s*700px\)[\s\S]*\.disciplinas/);
  assert.match(portadaCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  const css = posicionesCss();
  for (const selector of ['.pagina-posiciones', '.posiciones__hero', '.posiciones__tabla', '.posiciones__carrera', '.posiciones__galeria-grid']) {
    assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
});

test('ninguna foto se usa como fondo detrás de un texto, salvo la apertura con su velo', () => {
  assert.doesNotMatch(portadaCss, /--(?:scene|card|caption|local)-fondo/, 'las fichas no llevan fotos de fondo');
  assert.doesNotMatch(portadaCss, /url\(['"]?\.\.\/images/, 'las fotos van en el HTML, con su alt y su carga diferida');
  assert.match(portadaCss, /\.hero__foto::after\s*\{[^}]*linear-gradient\(90deg, rgba\(0, 0, 0, \.9\)/s, 'el titular de la apertura se lee sobre un velo denso');
});

test('las fotos de la tienda están optimizadas y comparten formato', () => {
  const tienda = portada.match(/<ul class="productos[\s\S]*?<\/ul>/)?.[0] ?? '';
  const fotos = [...tienda.matchAll(/src="\.\/images\/(tienda\/[^"]+)"/g)].map(([, ruta]) => ruta);
  assert.equal(fotos.length, 5);
  for (const foto of fotos) {
    const ruta = path.join('public/images', foto);
    assert.ok(fs.existsSync(ruta), `falta ${foto}`);
    assert.match(foto, /\.webp$/);
    assert.ok(fs.statSync(ruta).size < 120 * 1024, `${foto} pesa demasiado para una tarjeta`);
  }
  assert.doesNotMatch(portada, /images\/contenido\/[\w-]+\.png/, 'los PNG originales de varios MB no se sirven en la portada');
  assert.match(tienda, /class="producto producto--pronto"[\s\S]*Próximamente/, 'RC Builder se presenta como próximamente');
});

test('ninguna imagen de la portada pesa más de lo que aporta', () => {
  const rutas = new Set([...portada.matchAll(/\bsrc="\.\/(images\/[^"]+)"/g)].map(([, ruta]) => ruta));
  for (const ruta of rutas) {
    const peso = fs.statSync(path.join('public', ruta)).size;
    assert.ok(peso < 420 * 1024, `${ruta} pesa ${Math.round(peso / 1024)} KB`);
  }
});

test('los titulares largos caben enteros en el teléfono', () => {
  assert.match(
    publicoCss,
    /@media\s*\(max-width:\s*600px\)\s*\{\s*\.seccion__cabeza h2\s*\{[^}]*font-stretch:\s*104%;[^}]*overflow-wrap:\s*normal/s,
    '«Especificaciones» no puede partirse a mitad de palabra',
  );
  assert.match(
    posicionesCss(),
    /@media\s*\(max-width:\s*760px\)[\s\S]*\.posiciones__hero h1\s*\{[^}]*max-width:\s*(?:none|12ch|100%)/,
    'el título de posiciones no debe dejar una palabra huérfana en móvil',
  );
  assert.match(portadaCss, /\.productos > li\s*\{\s*min-width:\s*0/, 'las tarjetas de tienda no fuerzan desbordes con textos largos');
  assert.match(portadaCss, /\.pronto__texto\s*\{\s*min-width:\s*0/);
});

test('la galería muestra seis fotos reales sin repetir encuadres', () => {
  const fotos = [
    'miniapolis-track-side-wide.webp',
    'miniapolis-gallery-curb-vertical.webp',
    'miniapolis-pit-corner-vertical.webp',
    'miniapolis-gallery-wide.webp',
    'miniapolis-gallery-curb-wide.webp',
    'miniapolis-gallery-car-vertical.webp',
  ];
  const galeria = portada.match(/<section id="galeria"[\s\S]*?<\/section>/)?.[0] ?? '';
  const fotosGaleria = [...galeria.matchAll(/src="\.\/images\/pista\/([^"]+)"/g)].map(([, archivo]) => archivo);
  assert.equal(new Set(fotosGaleria).size, fotos.length, 'la galería debe mostrar seis fotos reales sin repetir encuadres');
  assert.doesNotMatch(galeria, /pista-real|track-portrait|action/, 'la galería no debe volver a cargar fuentes descartadas');
  for (const foto of fotos) {
    assert.match(galeria, new RegExp(`pista/${foto}`), `falta la foto ${foto} en la galería`);
    assert.ok(fs.existsSync(path.join('public/images/pista', foto)), `falta el archivo ${foto}`);
  }
  assert.match(portada, /pista\/miniapolis-asphalt-detail\.webp/);
  assert.doesNotMatch(portada, /images\/contenido\/muy-pronto\.png/);
  assert.doesNotMatch(portada + portadaCss, /images\/contenido\/eventos-fondo\.png/);
});

test('la tabla pública conserva una entrada animada y legible', () => {
  const css = posicionesCss();
  const posiciones = leer('public/posiciones.html');
  assert.match(css, /@keyframes\s+posicionesEntrada/);
  assert.match(css, /\.posiciones__hero\s*\{[^}]*animation/);
  assert.match(css, /\.posiciones__fila\s*\{[^}]*animation/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.posiciones__fila\s*\{\s*animation:\s*none/);
  assert.equal((posiciones.match(/class="posiciones__fila[^"]*"/g) ?? []).length, 5);
  assert.doesNotMatch(posiciones, /🥇|🥈|🥉/, 'las posiciones se escriben con cifras, no con emojis');
  assert.match(posiciones, /<link rel="stylesheet" href="\/css\/publico\.css">/, 'la tabla comparte cabecera y pie con la portada');
  assert.match(posiciones, /<a href="\.\/posiciones\.html" aria-current="page">/);
});
