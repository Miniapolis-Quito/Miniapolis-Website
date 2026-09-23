/**
 * La configuración que no dice lo que su autor cree es peor que la que falta:
 * el sistema arranca, parece bien puesto y no protege nada. Estas pruebas fijan
 * qué valores se rechazan al arrancar.
 *
 * Cada caso levanta un proceso aparte porque `config.js` se evalúa una sola vez
 * al importarlo: dentro de un mismo proceso no hay forma de volver a leerlo con
 * otras variables de entorno.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** ¿Arranca la configuración con esta variable puesta a este valor? */
function arrancaCon(variables) {
  const resultado = spawnSync(process.execPath, ['-e', "import('./src/config.js').then(() => process.exit(0))"], {
    cwd: RAIZ,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_FILE: ':memory:', ...variables },
    encoding: 'utf8',
  });
  return { ok: resultado.status === 0, salida: `${resultado.stdout}${resultado.stderr}` };
}

function arrancaEnProduccion(variables = {}) {
  return spawnSync(process.execPath, ['-e', "import('./src/config.js').then(() => process.exit(0))"], {
    cwd: RAIZ,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_FILE: ':memory:',
      ACCESS_TOKEN_SECRET: 'access-production-test-secret-unique-000000000000',
      REFRESH_TOKEN_SECRET: 'refresh-production-test-secret-unique-000000000000',
      QR_SECRET: 'qr-production-test-secret-unique-000000000000',
      COOKIE_SECURE: 'true',
      ...variables,
    },
    encoding: 'utf8',
  });
}

test('CORS_ORIGINS solo admite orígenes bien escritos', () => {
  for (const valor of ['https://pista.ec', 'https://pista.ec,http://localhost:3000', 'http://127.0.0.1:8080']) {
    assert.ok(arrancaCon({ CORS_ORIGINS: valor }).ok, `debería admitir "${valor}"`);
  }

  // Los dos errores típicos no avisan solos: uno con barra o con ruta no
  // coincide nunca con lo que manda el navegador, y "*" tampoco funciona aquí
  // porque se compara literalmente. En los dos casos alguien creería haber dado
  // un permiso que no existe.
  for (const valor of ['https://pista.ec/', '*', 'https://pista.ec/ruta', 'pista.ec', 'ftp://pista.ec', 'https://u:c@pista.ec']) {
    const { ok, salida } = arrancaCon({ CORS_ORIGINS: valor });
    assert.ok(!ok, `no debería admitir "${valor}"`);
    assert.match(salida, /CORS_ORIGINS/);
  }
});

test('APPLE_APNS_HOST solo admite un servidor, nunca una dirección con ruta', () => {
  for (const valor of ['api.push.apple.com', 'api.sandbox.push.apple.com', '127.0.0.1:34441', 'localhost:8080', '[::1]:8080']) {
    assert.ok(arrancaCon({ APPLE_APNS_HOST: valor }).ok, `debería admitir "${valor}"`);
  }

  // Este valor se pega dentro de la dirección a la que viaja un token firmado
  // con la clave del negocio: una ruta o unas credenciales ahí lo mandarían a
  // otra parte.
  for (const valor of ['api.push.apple.com/../@malicioso.ec', 'https://api.push.apple.com', 'usuario@malicioso.ec', 'api.push.apple.com:99999']) {
    const { ok, salida } = arrancaCon({ APPLE_APNS_HOST: valor });
    assert.ok(!ok, `no debería admitir "${valor}"`);
    assert.match(salida, /APPLE_APNS_HOST/);
  }
});

test('producción exige cookies seguras', () => {
  const resultado = arrancaEnProduccion({ COOKIE_SECURE: 'false' });
  assert.notEqual(resultado.status, 0);
  assert.match(`${resultado.stdout}${resultado.stderr}`, /COOKIE_SECURE/);
});

test('producción exige HTTPS para PUBLIC_URL', () => {
  const resultado = arrancaEnProduccion({ PUBLIC_URL: 'http://entradas.example' });
  assert.notEqual(resultado.status, 0);
  assert.match(`${resultado.stdout}${resultado.stderr}`, /PUBLIC_URL.*HTTPS/i);

  const seguro = arrancaEnProduccion({ PUBLIC_URL: 'https://entradas.example' });
  assert.equal(seguro.status, 0, `${seguro.stdout}${seguro.stderr}`);
});
