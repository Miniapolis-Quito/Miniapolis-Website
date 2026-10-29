/** Evidencia pública reproducible; no lee cuentas, cookies ni datos de clientes. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { site, publicPages } from '../site.config.js';

const targets = [site.url.replace('https:', 'http:'), new URL('/', site.url).href, new URL('/robots.txt', site.url).href,
  ...publicPages.map((p) => new URL(p.path, site.url).href),
  ...['index.html', 'robots.txt', 'sitemap.xml', 'app.html', 'admin.html', 'api/health', 'no-existe-seo-check'].map((p) => new URL(p, site.url).href)];

async function inspect(url) {
  const redirects = [];
  let current = url;
  for (let tries = 0; tries < 8; tries += 1) {
    const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.has('location')) {
      redirects.push({ url: current, status: response.status, location: response.headers.get('location') });
      current = new URL(response.headers.get('location'), current).href;
      continue;
    }
    const body = await response.text();
    const blocks = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    return { url, finalUrl: current, status: response.status, redirects,
      headers: Object.fromEntries(['content-type', 'cache-control', 'strict-transport-security', 'content-security-policy', 'x-robots-tag', 'last-modified'].map((key) => [key, response.headers.get(key)])),
      bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex'),
      title: body.match(/<title>([^<]*)<\/title>/)?.[1] || null,
      canonical: body.match(/rel="canonical" href="([^"]+)"/)?.[1] || null,
      robots: body.match(/name="robots" content="([^"]+)"/)?.[1] || null,
      siteName: body.match(/property="og:site_name" content="([^"]+)"/)?.[1] || null,
      structuredData: blocks.map(([, value]) => { try { return JSON.parse(value); } catch { return 'INVALID_JSON'; } }),
      ...(current.endsWith('/robots.txt') || current.endsWith('/sitemap.xml') ? { content: body.slice(0, 8000) } : {}),
    };
  }
  throw new Error('Demasiadas redirecciones');
}

const results = await Promise.all(targets.map(async (url) => { try { return await inspect(url); } catch (error) { return { url, error: error.message }; } }));
const output = { checkedAt: new Date().toISOString(), site: site.url, results };
const dest = process.argv[2];
if (dest) fs.writeFileSync(dest, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(results.map(({ url, status, canonical, robots, error }) => ({ url, status, canonical, robots, error })), null, 2));
