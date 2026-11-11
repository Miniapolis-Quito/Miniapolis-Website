#!/usr/bin/env node
/**
 * Prepara los archivos estáticos de public/ para su despliegue en GitHub Pages.
 * 
 * Copia el directorio public/ a _site/, ajusta rutas absolutas (/css, /js, /fonts, etc.)
 * a relativas para que funcionen correctamente tanto en la raíz de un dominio
 * como en un subdirectorio (ej. /miniapolis-tickets/).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateSeo } from './generar-seo.js';
import { site } from '../site.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const SITE_DIR = path.join(ROOT_DIR, '_site');

console.log('Preparando sitio para GitHub Pages...');
generateSeo();

// Limpiar y crear _site/
if (fs.existsSync(SITE_DIR)) {
  fs.rmSync(SITE_DIR, { recursive: true, force: true });
}
fs.mkdirSync(SITE_DIR, { recursive: true });

// Copiar todo el contenido de public/ a _site/
fs.cpSync(PUBLIC_DIR, SITE_DIR, { recursive: true });

// El alojamiento puede conservar CSS y módulos durante horas en el navegador.
// La portada y su escena cambian de URL juntas: incluso una visita repetida
// obtiene los estilos y el movimiento de esta publicación, sin vaciar la caché.
const portadaAssets = ['css/portada.css', 'js/portada.js', 'js/portada-escenas.js'];
const portadaHash = createHash('sha256');
for (const asset of portadaAssets) {
  portadaHash.update(asset).update('\0').update(fs.readFileSync(path.join(PUBLIC_DIR, asset))).update('\0');
}
const portadaVersion = portadaHash.digest('hex').slice(0, 12);
const portadaPath = path.join(SITE_DIR, 'js/portada.js');
fs.writeFileSync(portadaPath, fs.readFileSync(portadaPath, 'utf8')
  .replace("from './portada-escenas.js'", `from './portada-escenas.js?v=${portadaVersion}'`));

// Crear .nojekyll para evitar que Jekyll ignore archivos que empiecen con guion bajo o modifique assets
fs.writeFileSync(path.join(SITE_DIR, '.nojekyll'), '');

// Ajustar rutas en archivos HTML
const htmlFiles = fs.readdirSync(SITE_DIR).filter((f) => f.endsWith('.html'));
for (const file of htmlFiles) {
  const filePath = path.join(SITE_DIR, file);
  let html = fs.readFileSync(filePath, 'utf8');
  html = html.replace('<html ', '<html data-hosting-static="true" ');
  // La página 404 también se sirve para rutas anidadas inexistentes.
  if (file === '404.html') html = html.replace('</head>', `  <base href="${site.url}">\n</head>`);

  // Ajustar enlaces de recursos absolutos a relativos en la raíz de _site
  html = html
    .replace(/href="\/css\//g, 'href="./css/')
    .replace(/src="\/js\//g, 'src="./js/')
    .replace(/src="\/images\//g, 'src="./images/')
    .replace(/src="\/vendor\//g, 'src="./vendor/')
    .replace(/href="\/favicon\.png"/g, 'href="./favicon.png"')
    .replace(/href="\/manifest\.webmanifest"/g, 'href="./manifest.webmanifest"')
    .replace(/href="\/"/g, 'href="./index.html"')
    .replace(/((?:href|src)="\.\/(?:css\/portada\.css|js\/portada\.js))"/g, `$1?v=${portadaVersion}"`);

  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`✓ Procesado ${file}`);
}

// Ajustar fuentes en CSS
const cssPath = path.join(SITE_DIR, 'css', 'styles.css');
if (fs.existsSync(cssPath)) {
  let css = fs.readFileSync(cssPath, 'utf8');
  css = css.replace(/url\('\/fonts\//g, "url('../fonts/");
  css = css.replace(/url\("\/fonts\//g, 'url("../fonts/');
  fs.writeFileSync(cssPath, css, 'utf8');
  console.log('✓ Procesado css/styles.css (rutas de fuentes)');
}

// Ajustar manifest si tiene start_url o scope con barra absoluta
const manifestPath = path.join(SITE_DIR, 'manifest.webmanifest');
if (fs.existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.start_url = './';
    manifest.scope = './';
    if (Array.isArray(manifest.icons)) {
      manifest.icons = manifest.icons.map((icon) => ({
        ...icon,
        src: typeof icon.src === 'string' && icon.src.startsWith('/')
          ? `.${icon.src}`
          : icon.src,
      }));
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log('✓ Procesado manifest.webmanifest');
  } catch (err) {
    console.warn('No se pudo modificar el manifest:', err.message);
  }
}

console.log('¡Sitio listo en _site/ para despliegue en GitHub Pages!');
