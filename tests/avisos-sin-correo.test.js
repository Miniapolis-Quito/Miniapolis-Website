/**
 * Una pista sin correo configurado: los avisos automáticos no se pueden
 * encender, pero la lista de clientes por recuperar funciona igual.
 */
import './env.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios, crearCliente } from './helpers.js';
import * as avisos from '../src/services/avisos.js';
import * as packsService from '../src/services/packs.js';
import * as redemptions from '../src/services/redemptions.js';

let u;
before(levantarServidor);
after(bajarServidor);
beforeEach(async () => {
  limpiarBase();
  u = await sembrarUsuarios();
});

test('no se pueden encender sin correo, y la interfaz lo sabe', async () => {
  const r = await u.cMaster.pedir('/api/admin/notifications/settings', { metodo: 'PUT', cuerpo: { enabled: true } });
  assert.equal(r.status, 409);
  assert.equal(r.datos.error.code, 'correo_no_configurado');

  const resumen = await u.cMaster.get('/api/admin/notifications/overview');
  assert.equal(resumen.datos.status.emailConfigured, false);
  assert.equal(resumen.datos.status.enabled, false);

  assert.equal((await crearCliente().get('/api/config')).datos.emailReminders, false);
  assert.equal((await u.cMaster.post('/api/admin/notifications/test', {})).status, 409);
});

test('los demás ajustes se guardan igual, para tenerlos listos', async () => {
  const r = await u.cMaster.pedir('/api/admin/notifications/settings', {
    metodo: 'PUT',
    cuerpo: { inactiveDays: 21, whatsappCountryCode: '57' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.datos.inactiveDays, 21);
  assert.equal(r.datos.whatsappCountryCode, '57');
});

test('la lista de clientes por recuperar funciona sin correo', async () => {
  const pack = packsService.issuePack({ userId: u.cliente.id, size: 3, actor: u.master });
  redemptions.redeemByCode({ code: pack.code, scanner: { id: u.staff.id, email: u.staff.email } });

  const r = await u.cMaster.get('/api/admin/notifications/overview');
  assert.deepEqual(r.datos.opportunities.groups.lowBalance.items.map((c) => c.fullName), ['Carlos Piloto']);

  const resultado = await avisos.ciclo();
  assert.equal(resultado.creados, 0);
});
