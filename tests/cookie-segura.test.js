/**
 * La cookie de refresco en una instalación con HTTPS.
 *
 * Con `COOKIE_SECURE` la cookie lleva el prefijo `__Host-`: el navegador solo
 * la acepta si llega por HTTPS, con `Secure`, sin `Domain` y con `Path=/`. Así
 * nadie en la red ni en un subdominio hermano puede plantar una propia para que
 * la víctima acabe usando la sesión del atacante.
 */
import './env-cookie-segura.js';
import './env.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios, crearCliente, CLAVES } from './helpers.js';

before(levantarServidor);
after(bajarServidor);
beforeEach(limpiarBase);

const NOMBRE = '__Host-rh_refresh';

test('con HTTPS la cookie de refresco lleva el prefijo __Host- y sus condiciones', async () => {
  await sembrarUsuarios();
  const cliente = crearCliente();
  const r = await cliente.post('/api/auth/login', { email: 'cliente@pista.ec', password: CLAVES.cliente });
  assert.equal(r.status, 200);

  const cookie = r.headers.getSetCookie().find((c) => c.startsWith(`${NOMBRE}=`));
  assert.ok(cookie, 'debe emitirse la cookie con prefijo');
  assert.match(cookie, /;\s*Path=\/(;|$)/i, 'el prefijo __Host- exige Path=/');
  assert.match(cookie, /;\s*Secure/i);
  assert.match(cookie, /;\s*HttpOnly/i);
  assert.match(cookie, /;\s*SameSite=Strict/i);
  assert.doesNotMatch(cookie, /Domain=/i, 'el prefijo __Host- prohíbe Domain');

  // Y con ella la sesión se renueva como siempre.
  const renovada = await cliente.post('/api/auth/refresh', {});
  assert.equal(renovada.status, 200, JSON.stringify(renovada.datos));
  assert.ok(cliente.leerCookie(NOMBRE), 'la renovación deja una cookie nueva con el mismo nombre');
});

test('una cookie plantada con el nombre sin prefijo no abre sesión', async () => {
  await sembrarUsuarios();
  const legitimo = crearCliente();
  await legitimo.entrar('cliente@pista.ec', CLAVES.cliente);
  const token = legitimo.leerCookie(NOMBRE);
  assert.ok(token);

  // Es lo que podría fijar alguien desde HTTP o desde otro subdominio.
  const plantada = await crearCliente().pedir('/api/auth/refresh', {
    metodo: 'POST',
    cabeceras: { Cookie: `rh_refresh=${token}` },
  });
  assert.equal(plantada.status, 401);
});

test('cerrar sesión borra la cookie con prefijo y la del nombre anterior', async () => {
  await sembrarUsuarios();
  const cliente = crearCliente();
  await cliente.entrar('cliente@pista.ec', CLAVES.cliente);

  const r = await cliente.post('/api/auth/logout', {});
  assert.equal(r.status, 200);
  const borradas = r.headers.getSetCookie().filter((c) => /Expires=Thu, 01 Jan 1970/i.test(c)).map((c) => c.split('=')[0]);
  assert.ok(borradas.includes(NOMBRE));
  // La de antes del prefijo, con su ruta de entonces, también se limpia.
  assert.ok(borradas.includes('rh_refresh'));
  assert.equal(cliente.leerCookie(NOMBRE), null);
});
