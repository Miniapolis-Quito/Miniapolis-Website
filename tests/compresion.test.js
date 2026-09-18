/** Pruebas del middleware de compresión nativa y protección de SSE. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { levantarServidor, bajarServidor, sembrarUsuarios } from './helpers.js';

let baseUrl;

before(async () => {
  baseUrl = await levantarServidor();
});

after(bajarServidor);

function pedirRaw(urlStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('los recursos estáticos grandes se entregan comprimidos con gzip si el cliente lo admite', async () => {
  const res = await pedirRaw(`${baseUrl}/css/styles.css`, {
    'accept-encoding': 'gzip',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-encoding'], 'gzip');
  assert.ok(res.headers['vary']?.includes('Accept-Encoding'));

  const descomprimido = zlib.gunzipSync(res.body).toString('utf8');
  assert.ok(descomprimido.includes('.pagina-entrada') || descomprimido.includes('var('));
});

test('si el cliente no envía Accept-Encoding compatible, se entrega sin compresión', async () => {
  const res = await pedirRaw(`${baseUrl}/css/styles.css`, {
    'accept-encoding': 'identity',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-encoding'], undefined);
});

test('el canal SSE nunca se comprime ni se almacena en búfer', async () => {
  const { cCliente } = await sembrarUsuarios();

  const controlador = new AbortController();
  const r = await fetch(`${baseUrl}/api/events`, {
    headers: {
      Authorization: `Bearer ${cCliente.token}`,
      Accept: 'text/event-stream',
      'Accept-Encoding': 'gzip, deflate',
    },
    signal: controlador.signal,
  });

  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-encoding'), null, 'SSE no debe comprimirse');
  assert.ok(r.headers.get('content-type')?.includes('text/event-stream'));

  controlador.abort();
});
