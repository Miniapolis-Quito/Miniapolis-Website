/**
 * La salida de emergencia para recuperar el panel: `npm run create-master`.
 *
 * Lo que se comprueba aquí no es que cree la cuenta —eso ya lo cubren las
 * pruebas de usuarios— sino por dónde entra la contraseña. Escribirla en la
 * línea de órdenes la deja en el historial del intérprete y, mientras el
 * proceso vive, a la vista de cualquier otra cuenta de la máquina con un
 * `ps`. Por eso tiene que existir una forma de pasarla que no la exponga, y
 * la forma insegura tiene que avisar de que lo es.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const RAIZ = new URL('..', import.meta.url);
const CLAVE = 'Trazada-Veloz-7413';

function ejecutar(argumentos, { entrada = undefined } = {}) {
  return spawnSync(process.execPath, ['scripts/create-master.js', ...argumentos], {
    cwd: RAIZ,
    encoding: 'utf8',
    input: entrada,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'test',
      ENV_FILE: '/dev/null',
      DATABASE_FILE: ':memory:',
      LOG_LEVEL: 'silent',
      ACCESS_TOKEN_SECRET: `${'x'.repeat(40)}-acceso`,
      REFRESH_TOKEN_SECRET: `${'x'.repeat(40)}-refresco`,
      QR_SECRET: `${'x'.repeat(40)}-qr`,
    },
  });
}

test('la contraseña puede entrar por la entrada estándar, sin pasar por la línea de órdenes', () => {
  const resultado = ejecutar(['--email', 'jefe@pista.ec', '--password-stdin'], { entrada: `${CLAVE}\n` });

  assert.equal(resultado.status, 0, `no terminó bien: ${resultado.stderr}`);
  assert.match(resultado.stdout, /Cuenta máster creada/);
  // La contraseña la eligió quien ejecuta: no hace falta devolvérsela, y
  // repetirla en pantalla la deja en el registro de la terminal.
  assert.doesNotMatch(resultado.stdout, new RegExp(CLAVE), 'no debe imprimir la contraseña recibida');
  // Y sobre todo: tiene que haberla usado. Si la bandera se ignorase, el
  // script generaría una al azar y la anunciaría — que es justo lo que hacía
  // antes de existir esta opción, y lo que esta prueba impide que vuelva.
  assert.doesNotMatch(
    resultado.stdout,
    /Contraseña:/,
    'si recibió una contraseña no debe generar otra ni anunciarla',
  );
});

test('pasar la contraseña en la línea de órdenes funciona, pero avisa de que queda expuesta', () => {
  const resultado = ejecutar(['--email', 'jefe@pista.ec', '--password', CLAVE]);

  assert.equal(resultado.status, 0, `no terminó bien: ${resultado.stderr}`);
  assert.match(resultado.stdout, /Cuenta máster creada/);
  assert.match(
    resultado.stderr,
    /historial|ps\b|visible/i,
    'debe explicar por qué esa vía es insegura y cuál usar en su lugar',
  );
  assert.match(resultado.stderr, /--password-stdin/, 'debe señalar la alternativa concreta');
});

test('sin contraseña en la entrada estándar no se inventa una en silencio', () => {
  const resultado = ejecutar(['--email', 'jefe@pista.ec', '--password-stdin'], { entrada: '\n' });

  assert.notEqual(resultado.status, 0, 'una contraseña vacía no puede dar por buena la cuenta');
  assert.match(resultado.stderr, /contraseña/i);
});
