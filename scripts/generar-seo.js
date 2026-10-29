import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { site, publicPages } from '../site.config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const absolute = (value) => new URL(value, site.url).href;
const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

/** Generación determinista: sin lastmod ficticio ni URLs que no existan. */
export function generateSeo() {
  const home = site.url;
  const organization = { '@type': 'Organization', '@id': `${home}#organizacion`, name: site.name, url: home, logo: absolute(site.logo) };
  for (const page of publicPages) {
    const filename = path.join(publicDir, page.file);
    let html = fs.readFileSync(filename, 'utf8');
    const canonical = absolute(page.path);
    html = html.replace(/<html lang="[^"]+"/, '<html lang="es-EC"')
      .replace(/<title>[^<]*<\/title>/, `<title>${escape(page.title)}</title>`)
      .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escape(page.description)}">`)
      .replace(/\n\s*<!-- SEO:inicio -->[\s\S]*?<!-- SEO:fin -->\s*/g, '\n');
    const graph = [organization, { '@type': 'WebPage', '@id': canonical, url: canonical, name: page.title, description: page.description, inLanguage: site.language, isPartOf: { '@id': `${home}#sitio` } }];
    if (page.path === '') graph.unshift({ '@type': 'WebSite', '@id': `${home}#sitio`, name: site.name, alternateName: site.alternateName, url: home, inLanguage: site.language, publisher: { '@id': organization['@id'] } });
    else graph.push({ '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: site.name, item: home }, { '@type': 'ListItem', position: 2, name: page.path.startsWith('posiciones') ? 'Tabla de posiciones' : 'Privacidad y cookies', item: canonical }] });
    const schema = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replaceAll('<', '\\u003c');
    const block = `\n  <!-- SEO:inicio -->
  <link rel="canonical" href="${canonical}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <meta name="google-site-verification" content="${site.googleVerification}">
  <meta property="og:site_name" content="${escape(site.name)}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="es_EC">
  <meta property="og:title" content="${escape(page.title)}">
  <meta property="og:description" content="${escape(page.description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${absolute(site.image)}">
  <meta property="og:image:width" content="1675">
  <meta property="og:image:height" content="939">
  <meta property="og:image:alt" content="Circuito indoor de asfalto de Miniápolis #3">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escape(page.title)}">
  <meta name="twitter:description" content="${escape(page.description)}">
  <meta name="twitter:image" content="${absolute(site.image)}">
  <script type="application/ld+json">${schema}</script>
  <link rel="stylesheet" href="/css/consentimiento.css">
  <script type="module" src="./js/medicion.js"></script>
  <!-- SEO:fin -->\n`;
    html = html.replace('</head>', `${block}</head>`);
    fs.writeFileSync(filename, html);
  }
  for (const file of fs.readdirSync(publicDir).filter((f) => f.endsWith('.html') && !publicPages.some((p) => p.file === f))) {
    const filename = path.join(publicDir, file);
    let html = fs.readFileSync(filename, 'utf8');
    if (!/name="robots"/.test(html)) html = html.replace('</head>', '  <meta name="robots" content="noindex, follow">\n</head>');
    fs.writeFileSync(filename, html);
  }
  fs.writeFileSync(path.join(publicDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${publicPages.map((p) => `  <url><loc>${escape(absolute(p.path))}</loc></url>`).join('\n')}\n</urlset>\n`);
  fs.writeFileSync(path.join(publicDir, 'robots.txt'), `# La portada es pública; las zonas de cuenta llevan noindex y requieren sesión.\nUser-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${absolute('sitemap.xml')}\n`);
  fs.writeFileSync(path.join(publicDir, 'js/medicion-config.js'), `// Generado por scripts/generar-seo.js a partir de site.config.js.\nexport const measurement = Object.freeze(${JSON.stringify({ id: site.measurementId, url: home, pages: publicPages.map((p) => ({ path: new URL(p.path, home).pathname, title: p.title })) }, null, 2)});\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) generateSeo();
