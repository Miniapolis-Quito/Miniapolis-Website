#!/usr/bin/env node
/**
 * Crea (o repara) una cuenta máster desde la terminal.
 *
 *   npm run create-master -- --email admin@racinghobbies.ec --nombre "Danilo"
 *   read -rs MASTER_PASSWORD; printf '\n'
 *   printf '%s\n' "$MASTER_PASSWORD" | npm run create-master -- --email admin@racinghobbies.ec --password-stdin
 *
 * Si la cuenta ya existe, se le restablece la contraseña y se le asegura el rol
 * máster: es la salida de emergencia cuando nadie puede entrar al panel.
 *
 * Sobre por dónde entra la contraseña: `--password` la deja escrita en el
 * historial del intérprete y, mientras el proceso vive, a la vista de
 * cualquier otra cuenta de la máquina que haga `ps`. `--password-stdin` evita
 * que viaje como argumento; las vías antiguas se mantienen por compatibilidad.
 */
import { readFileSync } from 'node:fs';
import { getDb, closeDb } from '../src/db/index.js';
import { validatePasswordStrength, generarPasswordTemporal } from '../src/lib/passwords.js';
import * as users from '../src/services/users.js';
import * as audit from '../src/services/audit.js';

function leerArgumentos(argv) {
  const opciones = {};
  for (let i = 0; i < argv.length; i += 1) {
    const actual = argv[i];
    if (!actual.startsWith('--')) continue;
    const clave = actual.slice(2);
    const siguiente = argv[i + 1];
    if (siguiente === undefined || siguiente.startsWith('--')) {
      opciones[clave] = true;
    } else {
      opciones[clave] = siguiente;
      i += 1;
    }
  }
  return opciones;
}

const opciones = leerArgumentos(process.argv.slice(2));

if (opciones.help || !opciones.email) {
  process.stdout.write(
    `\nCrea o repara la cuenta máster del sistema de entradas.\n\n` +
      `  npm run create-master -- --email <correo> [--nombre "<nombre>"] [--password-stdin]\n\n` +
      `Sin contraseña se genera una segura y se muestra una sola vez.\n` +
      `Para elegirla, introdúcela sin eco y pásala por la entrada estándar:\n\n` +
      `  read -rs MASTER_PASSWORD; printf '\\n'\n` +
      `  printf '%s\\n' "$MASTER_PASSWORD" | npm run create-master -- --email <correo> --password-stdin\n` +
      `  unset MASTER_PASSWORD\n\n` +
      `También se aceptan MASTER_PASSWORD y --password "<contraseña>" por compatibilidad;\n` +
      `ambos exponen más el secreto que --password-stdin.\n\n`,
  );
  process.exit(opciones.email ? 0 : 1);
}

getDb();

const email = String(opciones.email).trim().toLowerCase();
const nombre = typeof opciones.nombre === 'string' ? opciones.nombre : 'Administrador';

/**
 * Lee la contraseña de la entrada estándar. Se queda con el primer renglón,
 * descartando el salto final que suele añadir quien envía la tubería.
 */
function passwordDeLaEntrada() {
  if (process.stdin.isTTY) {
    process.stderr.write(
      `\n--password-stdin espera la contraseña por la entrada estándar.\n` +
        `Escríbela sin eco y pásala por una tubería; consulta --help para el ejemplo.\n\n`,
    );
    closeDb();
    process.exit(1);
  }
  let crudo = '';
  try {
    crudo = readFileSync(0, 'utf8');
  } catch {
    crudo = '';
  }
  return crudo.split('\n', 1)[0].replace(/\r$/, '');
}

let password = null;
let generada = false;

if (opciones['password-stdin'] && typeof opciones.password === 'string') {
  process.stderr.write('\nElige solo una fuente de contraseña: --password-stdin o --password.\n\n');
  closeDb();
  process.exit(1);
} else if (opciones['password-stdin']) {
  password = passwordDeLaEntrada();
  if (!password) {
    process.stderr.write('\nNo llegó ninguna contraseña por la entrada estándar.\n\n');
    closeDb();
    process.exit(1);
  }
} else if (typeof opciones.password === 'string') {
  password = opciones.password;
  process.stderr.write(
    `\n  Aviso: --password queda en el historial del intérprete y es visible\n` +
      `  con ps mientras el proceso vive. Usa --password-stdin en su lugar.\n\n`,
  );
} else if (process.env.MASTER_PASSWORD) {
  password = process.env.MASTER_PASSWORD;
  process.stderr.write(
    '\n  Aviso: MASTER_PASSWORD se conserva por compatibilidad, pero puede quedar expuesta\n' +
      '  a otros procesos. Usa --password-stdin en su lugar.\n\n',
  );
} else {
  password = generarPasswordTemporal(12);
  generada = true;
}

const fuerza = validatePasswordStrength(password, { email, fullName: nombre });
if (!fuerza.ok) {
  process.stderr.write(`\nLa contraseña no es segura:\n  - ${fuerza.errors.join('\n  - ')}\n\n`);
  closeDb();
  process.exit(1);
}

try {
  const existente = users.findByEmail(email);

  if (existente) {
    await users.setPassword(existente.id, password);
    // El nombre solo se toca si se indicó: repararla no debería renombrar a
    // nadie por omisión, pero pasar --nombre y que se ignore sería peor.
    const cambios = {};
    if (existente.role !== 'master') cambios.role = 'master';
    if (existente.status !== 'active') cambios.status = 'active';
    // Es la salida de emergencia: deja la cuenta capaz de administrar y de
    // abrir la puerta, que es justo lo que se necesita cuando se usa.
    if (!existente.scan_enabled) cambios.scanEnabled = true;
    if (typeof opciones.nombre === 'string' && nombre !== existente.full_name) cambios.fullName = nombre;
    if (Object.keys(cambios).length > 0) users.updateUser(existente.id, cambios);
    users.unlockUser(existente.id);
    audit.record({ actor: null, action: 'sistema.master_reparado', entityType: 'user', entityId: existente.id });
    process.stdout.write(
      `\n  Cuenta actualizada: ${email}\n  Rol: máster · Escáner habilitado · Sesiones anteriores cerradas\n`,
    );
  } else {
    const creado = await users.createUser({ email, password, fullName: nombre, role: 'master', scanEnabled: true });
    audit.record({ actor: null, action: 'sistema.master_creado', entityType: 'user', entityId: creado.id });
    process.stdout.write(`\n  Cuenta máster creada: ${email}\n`);
  }

  if (generada) {
    process.stdout.write(`  Contraseña: ${password}\n`);
    process.stdout.write(`\n  Anótala ahora: no se vuelve a mostrar. Cámbiala al entrar.\n\n`);
  } else {
    process.stdout.write(`\n  Listo. Ya puedes entrar con la contraseña indicada.\n\n`);
  }
} catch (error) {
  process.stderr.write(`\nNo se pudo completar: ${error.message}\n\n`);
  closeDb();
  process.exit(1);
}

closeDb();
