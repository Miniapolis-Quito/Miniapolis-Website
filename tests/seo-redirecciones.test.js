import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';

test('Cloudflare consolida www y el host principal pages.dev conservando ruta y campaña', async () => {
  for (const host of ['www.racinghobbiesec.com', 'miniapolis-website.pages.dev']) {
    const response = await onRequest({ request: new Request(`https://${host}/posiciones?utm_source=boletin`), next: () => { throw new Error('No debe servir el duplicado'); } });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), 'https://racinghobbiesec.com/posiciones?utm_source=boletin');
  }
});

test('producción y previews conservan la respuesta original, incluido su noindex', async () => {
  for (const host of ['racinghobbiesec.com', 'preview.miniapolis-website.pages.dev']) {
    const expected = new Response('contenido', { headers: { 'x-robots-tag': 'noindex' } });
    const response = await onRequest({ request: new Request(`https://${host}/`), next: () => expected });
    assert.equal(response, expected);
  }
});
