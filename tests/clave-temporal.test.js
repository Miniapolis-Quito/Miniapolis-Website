/**
 * Contraseñas temporales con una longitud mínima configurada alta.
 *
 * Las temporales se generaban con un número fijo de bytes; con un mínimo por
 * encima de lo que daban, el alta sin contraseña fallaba su propia validación.
 */
import './env-clave-larga.js';
import './env.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios } from './helpers.js';
import { generarPasswordTemporal, validatePasswordStrength } from '../src/lib/passwords.js';

before(levantarServidor);
after(bajarServidor);
beforeEach(limpiarBase);

test('la contraseña temporal nunca es más corta que el mínimo configurado', () => {
  for (const bytes of [undefined, 9, 12]) {
    const clave = generarPasswordTemporal(bytes);
    assert.ok(clave.length >= 40, `"${clave}" tiene ${clave.length} caracteres`);
    assert.equal(validatePasswordStrength(clave).ok, true);
  }
});

test('el máster da de alta y restablece cuentas sin indicar contraseña', async () => {
  const { cMaster, cliente } = await sembrarUsuarios();

  const alta = await cMaster.post('/api/admin/users', { email: 'nuevo@pista.ec', fullName: 'Nora Nueva' });
  assert.equal(alta.status, 201, JSON.stringify(alta.datos));
  assert.ok(alta.datos.temporaryPassword.length >= 40);

  const restablecer = await cMaster.post(`/api/admin/users/${cliente.id}/reset-password`, {});
  assert.equal(restablecer.status, 200, JSON.stringify(restablecer.datos));
  assert.ok(restablecer.datos.temporaryPassword.length >= 40);
});
