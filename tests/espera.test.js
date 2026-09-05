/**
 * Tiempo de espera entre consumos del mismo pack.
 * Vive en su propio archivo porque necesita una configuración distinta a la
 * del resto de la suite (node:test ejecuta cada archivo en su propio proceso).
 * `./env-espera.js` la fija antes de que se cargue la configuración.
 */
import './env-espera.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios } from './helpers.js';
import { buildQrPayload } from '../src/lib/qr.js';
import { getDb } from '../src/db/index.js';
import * as packsService from '../src/services/packs.js';

before(levantarServidor);
after(bajarServidor);
beforeEach(limpiarBase);

test('dos escaneos seguidos del mismo pack no descuentan dos entradas', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const pack = packsService.findById(emitido.datos.pack.id);

  const primero = await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });
  assert.equal(primero.status, 200);
  assert.equal(primero.datos.remaining, 4);

  // Un QR distinto (otro nonce), pero el mismo pack un instante después:
  // es el caso del doble disparo de la cámara o del operador que insiste.
  const segundo = await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });
  assert.equal(segundo.status, 409);
  assert.equal(segundo.datos.error.code, 'espera_activa');
  assert.ok(segundo.datos.error.details.waitSeconds > 0);
  assert.equal(segundo.datos.error.details.pack.remaining, 4);

  assert.equal(packsService.findById(pack.id).remaining, 4, 'solo debe haberse descontado una entrada');
});

test('pasado el tiempo de espera, el mismo pack vuelve a poder consumirse', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const pack = packsService.findById(emitido.datos.pack.id);

  await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });

  // Se envejece el consumo anterior en lugar de esperar 30 segundos reales.
  getDb()
    .prepare('UPDATE redemptions SET created_at = ? WHERE pack_id = ?')
    .run(new Date(Date.now() - 60_000).toISOString(), pack.id);

  const segundo = await cStaff.post('/api/scan', { payload: buildQrPayload(pack) });
  assert.equal(segundo.status, 200);
  assert.equal(segundo.datos.remaining, 3);
});

test('la espera es por pack, no global: otro cliente puede pasar de inmediato', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const otro = await cMaster.post('/api/admin/users', {
    email: 'cuarto@pista.ec', fullName: 'Cuarto Piloto', role: 'customer', password: 'Palanca-Cambios-55',
  });
  const packA = packsService.findById((await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 })).datos.pack.id);
  const packB = packsService.findById((await cMaster.post('/api/admin/packs', { userId: otro.datos.user.id, size: 5 })).datos.pack.id);

  assert.equal((await cStaff.post('/api/scan', { payload: buildQrPayload(packA) })).status, 200);
  const inmediato = await cStaff.post('/api/scan', { payload: buildQrPayload(packB) });
  assert.equal(inmediato.status, 200, 'la fila no debe frenarse por el cliente anterior');
});
