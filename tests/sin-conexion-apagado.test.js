/**
 * Con `OFFLINE_SCAN_MAX_HOURS=0` el escáner no guarda lecturas para después,
 * y el servidor no acepta ninguna más vieja que un reintento de red.
 */
import './env-sin-conexion-apagado.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios } from './helpers.js';
import { buildQrPayload } from '../src/lib/qr.js';
import * as packsService from '../src/services/packs.js';

before(levantarServidor);
after(bajarServidor);
beforeEach(limpiarBase);

function diferida(campos, hace) {
  const ahora = Date.now();
  return { ...campos, capturedAt: new Date(ahora - hace).toISOString(), sentAt: new Date(ahora).toISOString() };
}

test('con el modo apagado, una lectura de hace minutos se rechaza', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const pack = packsService.findById(emitido.datos.pack.id);

  const r = await cStaff.post('/api/scan/manual', diferida({ code: pack.code }, 5 * 60_000));
  assert.equal(r.status, 409);
  assert.equal(r.datos.error.code, 'lectura_vencida');
  assert.equal(packsService.findById(pack.id).remaining, 5);
});

test('con el modo apagado, un reintento de red de segundos se sigue aceptando', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const emitido = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const pack = packsService.findById(emitido.datos.pack.id);

  const r = await cStaff.post('/api/scan', diferida({ payload: buildQrPayload(pack, { at: Date.now() - 20_000 }) }, 20_000));
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(packsService.findById(pack.id).remaining, 4);
});

test('con el modo apagado, la configuración pública lo dice', async () => {
  const { cStaff } = await sembrarUsuarios();
  const r = await cStaff.get('/api/config');
  assert.equal(r.datos.offlineScan.enabled, false);
});
