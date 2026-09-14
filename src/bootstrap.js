/**
 * Arranque de datos: crea la cuenta máster inicial la primera vez que se
 * levanta el sistema, para que nunca quede una instalación sin administrador.
 */
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { validatePasswordStrength, generarPasswordTemporal } from './lib/passwords.js';
import * as users from './services/users.js';
import * as audit from './services/audit.js';

export async function ensureMasterAccount() {
  if (users.countByRole('master') > 0) return null;

  const email = config.bootstrap.masterEmail;
  if (!email) {
    logger.warn(
      'No hay ningún usuario máster todavía. Crea uno con: npm run create-master -- --email tu@correo.com',
    );
    return null;
  }

  let password = config.bootstrap.masterPassword;
  let generated = null;
  if (!password) {
    generated = generarPasswordTemporal(12);
    password = generated;
  }

  const strength = validatePasswordStrength(password, { email, fullName: config.bootstrap.masterName });
  if (!strength.ok) {
    throw new Error(`La contraseña de MASTER_PASSWORD no es segura: ${strength.errors.join(' ')}`);
  }

  const user = await users.createUser({
    email,
    password,
    fullName: config.bootstrap.masterName,
    role: 'master',
  });

  audit.record({ actor: null, action: 'sistema.master_inicial', entityType: 'user', entityId: user.id });

  if (generated) {
    logger.warn('Cuenta máster creada con una contraseña generada. Anótala y cámbiala al entrar.', {
      email,
    });
    // La contraseña se imprime una única vez, fuera del logger, para que no
    // quede registrada en un archivo de log estructurado.
    process.stdout.write(`\n  Usuario máster: ${email}\n  Contraseña temporal: ${generated}\n\n`);
  } else {
    logger.info('Cuenta máster inicial creada.', { email });
  }

  return user;
}

export default ensureMasterAccount;
