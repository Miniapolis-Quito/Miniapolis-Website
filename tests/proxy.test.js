/**
 * La aplicación detrás de un proxy inverso.
 *
 * Es como se instala de verdad —Caddy o nginx delante, con el TLS— y es donde
 * una cabecera que falta convierte al sitio en sospechoso de sí mismo. Aquí se
 * comprueban las dos caras: que la petición legítima pasa, y que nadie puede
 * decir que viene de otro sitio.
 *
 * `./env-proxy.js` va primero: la configuración se lee al evaluar la
 * aplicación, y en ESM las importaciones se ejecutan antes que el código.
 */
import './env-proxy.js';
import './env.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios, CLAVES } from './helpers.js';
import { config } from '../src/config.js';

// `fetch` no deja fijar la cabecera Host —es de las que gobierna el navegador—,
// así que el "sitio" de estas pruebas es el propio servidor y lo que se simula
// es lo que sí aporta un proxy: el protocolo y la IP de quien llama.
let SITIO;
before(async () => {
  SITIO = new URL(await levantarServidor()).host;
});
after(bajarServidor);
beforeEach(limpiarBase);

test('solo se confía en los proxies declarados', () => {
  assert.deepEqual(config.security.trustedProxyIps, ['127.0.0.1', '::1']);
});

test('con el proxy bien configurado, el sitio se reconoce a sí mismo', async () => {
  const { cCliente } = await sembrarUsuarios();
  const r = await cCliente.post(
    '/api/auth/logout',
    {},
    {
      cabeceras: {
        Origin: `https://${SITIO}`,
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-For': '190.90.1.20',
      },
    },
  );
  assert.equal(r.status, 200, JSON.stringify(r.datos));
});

test('si el proxy no dice el protocolo, la petición del propio sitio se rechaza', async () => {
  // Es el fallo de instalación que documenta el README: nginx sin
  // X-Forwarded-Proto deja a la aplicación creyendo que sirve en claro, y
  // entonces su propio sitio en HTTPS parece venir de otro origen.
  const { cCliente } = await sembrarUsuarios();
  const r = await cCliente.post(
    '/api/auth/logout',
    {},
    { cabeceras: { Origin: `https://${SITIO}` } },
  );
  assert.equal(r.status, 403);
  assert.equal(r.datos.error.code, 'origen_no_permitido');
});

test('una petición desde otro sitio sigue sin pasar', async () => {
  const { cCliente } = await sembrarUsuarios();
  const r = await cCliente.post(
    '/api/auth/logout',
    {},
    {
      cabeceras: {
        Origin: 'https://sitio-ajeno.example',
        'X-Forwarded-Proto': 'https',
      },
    },
  );
  assert.equal(r.status, 403);
  assert.equal(r.datos.error.code, 'origen_no_permitido');
});

test('la IP del cliente es la que aporta el proxy, no la del proxy', async () => {
  const { cMaster, cCliente } = await sembrarUsuarios();
  await cCliente.post(
    '/api/auth/logout',
    {},
    {
      cabeceras: {
        Origin: `https://${SITIO}`,
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-For': '190.90.1.20, 127.0.0.1',
      },
    },
  );

  const bitacora = await cMaster.get('/api/admin/audit?limit=20');
  const salida = bitacora.datos.items.find((r) => r.action === 'logout');
  assert.ok(salida, 'la salida debería estar en la bitácora');
  assert.equal(salida.ip, '190.90.1.20', 'la auditoría tiene que guardar la IP de la persona');
});
