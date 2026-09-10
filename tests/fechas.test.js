/**
 * Días del calendario en la zona de la pista.
 *
 * `./env-utc.js` va primero y pone el proceso en UTC a propósito: es lo que
 * hace cualquier servidor alquilado, y es justo donde se rompía el panel —una
 * entrada usada a las siete de la tarde en Ecuador se contaba como del día
 * siguiente—. La prueba solo tiene sentido con el reloj del proceso desfasado
 * respecto a la pista.
 */
import './env-utc.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, bajarServidor, limpiarBase, sembrarUsuarios, crearCliente } from './helpers.js';
import { getDb } from '../src/db/index.js';
import { config } from '../src/config.js';
import * as fechas from '../src/lib/fechas.js';

before(levantarServidor);
after(bajarServidor);
beforeEach(limpiarBase);

const PISTA = 'America/Guayaquil';

test('el día del calendario es el de la pista, no el del servidor', () => {
  // Las 20:00 de un sábado en la pista ya son domingo en UTC.
  const tarde = new Date('2026-09-06T01:00:00Z');
  assert.equal(tarde.toISOString().slice(0, 10), '2026-09-06', 'en UTC ya es el día siguiente');
  assert.equal(fechas.diaLocal(tarde, PISTA), '2026-09-05', 'en la pista todavía es el día anterior');
  assert.equal(fechas.desplazamientoMinutos(tarde, PISTA), -300);
  assert.equal(fechas.inicioDelDia('2026-09-05', PISTA).toISOString(), '2026-09-05T05:00:00.000Z');
});

test('funciona al este de UTC y con horario de verano', () => {
  // Tokio va por delante: a las 16:00 UTC ya es el día siguiente.
  const t = new Date('2026-09-06T16:00:00Z');
  assert.equal(fechas.diaLocal(t, 'Asia/Tokyo'), '2026-09-07');
  assert.equal(fechas.inicioDelDia('2026-09-07', 'Asia/Tokyo').toISOString(), '2026-09-06T15:00:00.000Z');

  // Madrid adelanta el reloj la madrugada del 29 de marzo: ese día dura 23 h,
  // y aun así empieza cuando tiene que empezar.
  assert.equal(fechas.inicioDelDia('2026-03-29', 'Europe/Madrid').toISOString(), '2026-03-28T23:00:00.000Z');
  assert.equal(fechas.inicioDelDia('2026-03-30', 'Europe/Madrid').toISOString(), '2026-03-29T22:00:00.000Z');
  // Y lo atrasa el 25 de octubre, cuando dura 25 h.
  assert.equal(fechas.inicioDelDia('2026-10-25', 'Europe/Madrid').toISOString(), '2026-10-24T22:00:00.000Z');
  assert.equal(fechas.inicioDelDia('2026-10-26', 'Europe/Madrid').toISOString(), '2026-10-25T23:00:00.000Z');
});

test('la lista de días no se salta ninguno al cambiar el horario', () => {
  const dias = fechas.ultimosDias(4, 'Europe/Madrid', new Date('2026-03-30T10:00:00Z'));
  assert.deepEqual(dias, ['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30']);

  const enLaPista = fechas.ultimosDias(14, PISTA, new Date('2026-09-06T01:00:00Z'));
  assert.equal(enLaPista.length, 14);
  assert.equal(enLaPista[13], '2026-09-05', 'el último día es el de la pista');
  assert.equal(enLaPista[0], '2026-08-23');
  assert.equal(fechas.siguienteDia('2026-03-29'), '2026-03-30');
});

test('el día siguiente se calcula sobre el calendario, no sumando 24 horas', () => {
  assert.equal(fechas.siguienteDia('2026-09-06'), '2026-09-07');
  assert.equal(fechas.siguienteDia('2026-12-31'), '2027-01-01', 'cambio de año');
  assert.equal(fechas.siguienteDia('2028-02-28'), '2028-02-29', 'año bisiesto');
  assert.equal(fechas.siguienteDia('2026-02-28'), '2026-03-01');

  // El 25 de octubre en Madrid dura 25 horas: sumarle 24 se quedaría corto y
  // la última barra del gráfico perdería la última hora del día.
  const empieza = fechas.inicioDelDia('2026-10-25', 'Europe/Madrid');
  const acaba = fechas.inicioDelDia(fechas.siguienteDia('2026-10-25'), 'Europe/Madrid');
  assert.equal((acaba - empieza) / 3600_000, 25);
});

test('la interfaz sabe en qué zona horaria trabaja la pista', async () => {
  // La interfaz formatea fechas y horas con esta zona; si no la publicara,
  // pintaría el día del navegador de quien mira, que puede estar en otro país.
  const r = await crearCliente().get('/api/config');
  assert.equal(r.status, 200);
  assert.equal(r.datos.timezone, config.timezone);
  assert.ok(r.datos.timezone.includes('/'), `zona inesperada: ${r.datos.timezone}`);
});

test('una entrada usada por la tarde cuenta en el día de la pista', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const consumo = await cStaff.post('/api/scan/manual', { code: pack.datos.pack.code });
  assert.equal(consumo.status, 200);

  // Se antedata el consumo a las 20:00 de hoy en la pista, que en UTC es la
  // madrugada de mañana: es la hora punta de una pista de autos RC.
  const hoyEnLaPista = fechas.diaLocal(new Date(), config.timezone);
  const aLas20 = new Date(fechas.inicioDelDia(hoyEnLaPista, config.timezone).getTime() + 20 * 3600_000);
  assert.notEqual(aLas20.toISOString().slice(0, 10), hoyEnLaPista, 'en UTC debería caer en otro día');
  getDb()
    .prepare('UPDATE redemptions SET created_at = ? WHERE id = ?')
    .run(aLas20.toISOString(), consumo.datos.redemptionId);

  const panel = await cMaster.get('/api/admin/dashboard');
  assert.equal(panel.status, 200);
  assert.equal(panel.datos.redemptions.today, 1, 'se usó hoy en la pista, no mañana');
  assert.equal(panel.datos.redemptions.week, 1);

  // Y el gráfico la pone en la barra de hoy, que es la última de las catorce.
  const serie = panel.datos.dailySeries;
  assert.equal(serie.length, 14, 'la serie viene completa, con sus ceros');
  assert.equal(serie[13].date, hoyEnLaPista);
  assert.equal(serie[13].count, 1);
  assert.equal(
    serie.slice(0, 13).every((d) => d.count === 0),
    true,
    'ningún otro día debería tener actividad',
  );
});

test('la actividad de anoche no se cuenta como de hoy', async () => {
  const { cMaster, cStaff, cliente } = await sembrarUsuarios();
  const pack = await cMaster.post('/api/admin/packs', { userId: cliente.id, size: 5 });
  const consumo = await cStaff.post('/api/scan/manual', { code: pack.datos.pack.code });

  const dias = fechas.ultimosDias(14, config.timezone);
  const ayerALas21 = new Date(fechas.inicioDelDia(dias[12], config.timezone).getTime() + 21 * 3600_000);
  getDb()
    .prepare('UPDATE redemptions SET created_at = ? WHERE id = ?')
    .run(ayerALas21.toISOString(), consumo.datos.redemptionId);

  const panel = await cMaster.get('/api/admin/dashboard');
  assert.equal(panel.datos.redemptions.today, 0, 'fue ayer en la pista');
  assert.equal(panel.datos.redemptions.week, 1, 'pero sigue dentro de la semana');
  assert.equal(panel.datos.dailySeries[12].count, 1, 'y va en la barra de ayer');
  assert.equal(panel.datos.dailySeries[13].count, 0);
});
