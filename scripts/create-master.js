#!/usr/bin/env node
/**
 * Crea (o repara) una cuenta máster desde la terminal.
 *
 *   npm run create-master -- --email admin@racinghobbies.ec --nombre "Danilo"
 *   npm run create-master -- --email admin@racinghobbies.ec --password "..."
 *
 * Si la cuenta ya existe, se le restablece la contraseña y se le asegura el rol
 * máster: es la salida de emergencia cuando nadie puede entrar al panel.
 */
import { getDb, closeDb } from '../src/db/index.js';
import { randomToken } from '../src/lib/ids.js';
import { validatePasswordStrength } from '../src/lib/passwords.js';
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
      `  npm run create-master -- --email <correo> [--nombre "<nombre>"] [--password "<contraseña>"]\n\n` +
      `Sin --password se genera una contraseña segura y se muestra una sola vez.\n\n`,
  );
  process.exit(opciones.email ? 0 : 1);
}

getDb();

const email = String(opciones.email).trim().toLowerCase();
const nombre = typeof opciones.nombre === 'string' ? opciones.nombre : 'Administrador';

let password = typeof opciones.password === 'string' ? opciones.password : null;
let generada = false;
if (!password) {
  password = randomToken(12);
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
    if (typeof opciones.nombre === 'string' && nombre !== existente.full_name) cambios.fullName = nombre;
    if (Object.keys(cambios).length > 0) users.updateUser(existente.id, cambios);
    users.unlockUser(existente.id);
    audit.record({ actor: null, action: 'sistema.master_reparado', entityType: 'user', entityId: existente.id });
    process.stdout.write(`\n  Cuenta actualizada: ${email}\n  Rol: máster · Sesiones anteriores cerradas\n`);
  } else {
    const creado = await users.createUser({ email, password, fullName: nombre, role: 'master' });
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
