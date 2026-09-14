/**
 * Lo que decide el teléfono del personal cuando no hay conexión: qué lectura
 * se guarda, en qué orden se envía y qué se hace con cada respuesta.
 *
 * Son módulos del navegador sin DOM ni red, así que se prueban aquí igual que
 * el servidor. El almacenamiento es un `localStorage` de mentira y la red, una
 * función que responde lo que cada prueba necesita.
 */
import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  leerQr, normalizarCodigo, evaluarLectura, clasificarRespuesta, envioDe, repartir,
} from '../public/js/sin-conexion.js';
import { AlmacenLecturas, ColaSinConexion } from '../public/js/cola-sin-conexion.js';
import { buildQrPayload } from '../src/lib/qr.js';
import { normalizePackCode, newPackCode } from '../src/lib/ids.js';

const TTL = 120;
const ESPERA = 20;
const operador = { id: 'op-1', fullName: 'Beto Pista' };
const otroOperador = { id: 'op-2', fullName: 'Dana Puerta' };
const pack = { code: 'RHE-ABCD-EFGH', secret: 'secreto-del-pack' };

/** `localStorage` en memoria, con la misma interfaz. */
function almacenFalso() {
  const datos = new Map();
  return {
    datos,
    get length() { return datos.size; },
    key: (i) => [...datos.keys()][i] ?? null,
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => datos.set(k, String(v)),
    removeItem: (k) => datos.delete(k),
  };
}

/** Error como los que lanza el cliente de la API. */
function errorApi(status, codigo, message = 'Rechazada') {
  return Object.assign(new Error(message), { status, codigo });
}

const sinBloqueo = (tarea) => tarea();

function colaCon({ enviar = async () => ({ ok: true }), almacen = new AlmacenLecturas(almacenFalso()), reloj } = {}) {
  return new ColaSinConexion({ almacen, enviar, bloquear: sinBloqueo, reloj });
}

let secuencia = 0;
function guardarQr(cola, { at = Date.now(), capturadaEn = at, quien = operador, puesto = 'Puerta 1', desfaseMs = 0, qr } = {}) {
  secuencia += 1;
  return cola.guardar(
    { tipo: 'qr', payload: qr ?? buildQrPayload(pack, { at }), clave: `scan-${secuencia}`, capturadaEn, puesto, operador: quien },
    { desfaseMs, ttlSeconds: TTL, cooldownSeconds: ESPERA },
  );
}

// ---------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------

test('el teléfono reconoce un QR de la pista sin necesitar su firma', () => {
  const qr = leerQr(buildQrPayload(pack, { at: 1_700_000_000_000 }));
  assert.equal(qr.ok, true);
  assert.equal(qr.codigo, pack.code);
  assert.equal(qr.marca, 1_700_000_000);
  assert.equal(qr.estatico, false);
  assert.equal(leerQr(buildQrPayload(pack, { static: true })).estatico, true);

  for (const basura of ['', 'hola', 'RHE1|RHE-ABCD-EFGH|1|x', 'RHE2|RHE-ABCD-EFGH|1|abc|firmafirmafirma', null, 42]) {
    assert.equal(leerQr(basura).ok, false, `debería rechazar ${basura}`);
  }
});

test('el código tecleado se normaliza exactamente igual que en el servidor', () => {
  const casos = ['rhe-abcd-efgh', 'RHE ABCD EFGH', 'abcdefgh', 'RHEABCDEFGH', 'rhe-0o1i-luvw', 'RHERHE22', '', 'RHE-ABCD', '12345678'];
  for (let i = 0; i < 400; i += 1) {
    const real = newPackCode();
    casos.push(real, real.toLowerCase(), real.replace(/-/g, ' '), real.slice(4));
    casos.push(crypto.randomBytes(6).toString('base64').slice(0, 1 + (i % 14)));
  }
  for (const caso of casos) assert.equal(normalizarCodigo(caso), normalizePackCode(caso), `difiere con "${caso}"`);
});

test('una lectura válida se puede guardar', () => {
  const ahora = Date.now();
  const r = evaluarLectura({ tipo: 'qr', payload: buildQrPayload(pack, { at: ahora }) }, { ahora, desfaseMs: 0, ttlSeconds: TTL });
  assert.deepEqual(r, { ok: true, codigo: pack.code });
});

test('un QR vencido no se guarda si se conoce la hora del servidor', () => {
  const ahora = Date.now();
  const viejo = buildQrPayload(pack, { at: ahora - 200_000 });

  const conHora = evaluarLectura({ tipo: 'qr', payload: viejo }, { ahora, desfaseMs: 0, ttlSeconds: TTL });
  assert.equal(conHora.ok, false);
  assert.equal(conHora.motivo, 'qr_expirado');

  // El teléfono atrasa tres minutos: el mismo QR para él es reciente, pero la
  // hora del servidor dice que venció.
  const reciente = buildQrPayload(pack, { at: ahora - 60_000 });
  const atrasado = evaluarLectura({ tipo: 'qr', payload: reciente }, { ahora: ahora - 180_000, desfaseMs: 180_000, ttlSeconds: TTL });
  assert.equal(atrasado.ok, true);

  // Sin haber medido nunca la hora del servidor no se adivina: decide él.
  const sinHora = evaluarLectura({ tipo: 'qr', payload: viejo }, { ahora, desfaseMs: null, ttlSeconds: TTL });
  assert.equal(sinHora.ok, true);

  // Un pase impreso no caduca.
  const impreso = buildQrPayload(pack, { static: true });
  assert.equal(evaluarLectura({ tipo: 'qr', payload: impreso }, { ahora, desfaseMs: 0, ttlSeconds: TTL }).ok, true);
});

test('un código mal formado no se guarda', () => {
  const r = evaluarLectura({ tipo: 'codigo', code: 'RHE-12' }, { ahora: Date.now(), ttlSeconds: TTL });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'codigo_invalido');
  assert.equal(evaluarLectura({ tipo: 'codigo', code: 'abcd efgh' }, { ahora: Date.now(), ttlSeconds: TTL }).codigo, pack.code);
});

test('las respuestas del servidor se clasifican según si reintentar puede arreglarlas', () => {
  assert.equal(clasificarRespuesta(null), 'confirmada');
  assert.equal(clasificarRespuesta(errorApi(0, 'sin_conexion')), 'reintentar');
  assert.equal(clasificarRespuesta(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'reintentar');
  assert.equal(clasificarRespuesta(errorApi(503, 'servidor_ocupado')), 'reintentar');
  assert.equal(clasificarRespuesta(errorApi(500, 'error')), 'reintentar');
  assert.equal(clasificarRespuesta(errorApi(429, 'demasiados_intentos')), 'reintentar');
  assert.equal(clasificarRespuesta(errorApi(409, 'conflicto_concurrencia')), 'reintentar');
  assert.equal(clasificarRespuesta(errorApi(401, 'no_autenticado')), 'sesion');
  assert.equal(clasificarRespuesta(errorApi(409, 'pack_sin_entradas')), 'rechazada');
  assert.equal(clasificarRespuesta(errorApi(409, 'qr_ya_usado')), 'rechazada');
  assert.equal(clasificarRespuesta(errorApi(400, 'qr_expirado')), 'rechazada');
  assert.equal(clasificarRespuesta(errorApi(404, 'pack_no_encontrado')), 'rechazada');
  assert.equal(clasificarRespuesta(errorApi(403, 'sin_permiso')), 'rechazada');
});

test('una lectura se envía con el mismo cuerpo que habría tenido en línea, más sus horas', () => {
  const capturadaEn = Date.parse('2026-09-14T15:00:00.000Z');
  const qr = { id: 'k', tipo: 'qr', payload: 'RHE1|x', puesto: 'Puerta 1', capturadaEn };
  assert.deepEqual(envioDe(qr, capturadaEn + 60_000), {
    ruta: '/api/scan',
    cuerpo: { payload: 'RHE1|x', deviceLabel: 'Puerta 1', capturedAt: '2026-09-14T15:00:00.000Z', sentAt: '2026-09-14T15:01:00.000Z' },
  });
  // Sin puesto no se manda `deviceLabel`: en línea tampoco se habría mandado.
  const codigo = { id: 'k', tipo: 'codigo', code: 'rhe abcd efgh', puesto: null, capturadaEn };
  assert.deepEqual(envioDe(codigo, capturadaEn), {
    ruta: '/api/scan/manual',
    cuerpo: { code: 'rhe abcd efgh', capturedAt: '2026-09-14T15:00:00.000Z', sentAt: '2026-09-14T15:00:00.000Z' },
  });
});

// ---------------------------------------------------------------------------
// Cola
// ---------------------------------------------------------------------------

test('guardar una lectura la deja en disco con todo lo necesario para enviarla', () => {
  const almacenamiento = almacenFalso();
  const cola = colaCon({ almacen: new AlmacenLecturas(almacenamiento) });
  const r = guardarQr(cola);

  assert.equal(r.ok, true);
  assert.equal(r.persistente, true);
  assert.equal(almacenamiento.datos.size, 1);
  const [[clave, crudo]] = [...almacenamiento.datos];
  assert.match(clave, /^rh_lectura:/);
  const guardada = JSON.parse(crudo);
  assert.equal(guardada.codigo, pack.code);
  assert.equal(guardada.operadorId, operador.id);
  assert.equal(guardada.operadorNombre, 'Beto Pista');
  assert.equal(guardada.puesto, 'Puerta 1');
  assert.equal(guardada.estado, 'pendiente');

  // Otra instancia (la página recargada) la encuentra.
  assert.equal(new AlmacenLecturas(almacenamiento).todas().length, 1);
});

test('no se guarda dos veces la misma lectura ni dos del mismo pack dentro de la espera', () => {
  const cola = colaCon();
  const ahora = Date.now();
  const qr = buildQrPayload(pack, { at: ahora });

  assert.equal(guardarQr(cola, { qr, capturadaEn: ahora }).ok, true);
  const repetida = guardarQr(cola, { qr, capturadaEn: ahora + 3000 });
  assert.equal(repetida.motivo, 'ya_guardada');

  const dobleDisparo = guardarQr(cola, { at: ahora + 5000, capturadaEn: ahora + 5000 });
  assert.equal(dobleDisparo.ok, false);
  assert.equal(dobleDisparo.motivo, 'espera_activa');
  assert.match(dobleDisparo.mensaje, /hace 5 segundos/);

  // Otro operador en el mismo teléfono tampoco puede cobrar dos veces al mismo cliente.
  assert.equal(guardarQr(cola, { at: ahora + 6000, capturadaEn: ahora + 6000, quien: otroOperador }).motivo, 'espera_activa');

  assert.equal(guardarQr(cola, { at: ahora + 25_000, capturadaEn: ahora + 25_000 }).ok, true);
  assert.equal(cola.resumen(operador.id).pendientes.length, 2);
});

test('las lecturas se envían en el orden en que se hicieron y desaparecen al confirmarse', async () => {
  const enviadas = [];
  const cola = colaCon({
    enviar: async (ruta, cuerpo, clave) => {
      enviadas.push({ ruta, cuerpo, clave });
      return { ok: true, remaining: 3 };
    },
  });
  const ahora = Date.now();
  const tarde = guardarQr(cola, { at: ahora, capturadaEn: ahora });
  const temprano = cola.guardar(
    { tipo: 'codigo', code: 'RHE-2345-6789', clave: 'manual-1', capturadaEn: ahora - 60_000, puesto: '', operador },
    { ttlSeconds: TTL, cooldownSeconds: ESPERA },
  );
  assert.equal(temprano.ok, true);

  const resultado = await cola.enviarPendientes(operador.id);

  assert.deepEqual(enviadas.map((e) => e.clave), ['manual-1', tarde.lectura.id]);
  assert.equal(enviadas[0].ruta, '/api/scan/manual');
  assert.equal(enviadas[1].ruta, '/api/scan');
  assert.equal(resultado.confirmadas.length, 2);
  assert.equal(resultado.detenidaPor, null);
  assert.equal(cola.almacen.todas().length, 0);
});

test('un corte de red detiene el envío y conserva lo que falta', async () => {
  let llamadas = 0;
  const cola = colaCon({
    enviar: async () => {
      llamadas += 1;
      if (llamadas === 2) throw errorApi(0, 'sin_conexion');
      return { ok: true };
    },
  });
  const ahora = Date.now();
  for (const desplazamiento of [0, 30_000, 60_000]) guardarQr(cola, { at: ahora + desplazamiento, capturadaEn: ahora + desplazamiento });

  const resultado = await cola.enviarPendientes(operador.id);

  assert.equal(resultado.detenidaPor, 'reintentar');
  assert.equal(llamadas, 2, 'no sigue probando con la red caída');
  const quedan = cola.resumen(operador.id).pendientes;
  assert.equal(quedan.length, 2);
  assert.equal(quedan[0].intentos, 1);
  assert.equal(quedan[1].intentos, 0);
});

test('un rechazo pasa a revisión con su motivo y el envío sigue con las demás', async () => {
  let llamadas = 0;
  const cola = colaCon({
    enviar: async () => {
      llamadas += 1;
      if (llamadas === 1) throw errorApi(409, 'pack_sin_entradas', 'Este pack ya no tiene entradas disponibles.');
      return { ok: true };
    },
  });
  const ahora = Date.now();
  guardarQr(cola, { at: ahora, capturadaEn: ahora });
  guardarQr(cola, { at: ahora + 30_000, capturadaEn: ahora + 30_000 });

  const resultado = await cola.enviarPendientes(operador.id);

  assert.equal(resultado.rechazadas.length, 1);
  assert.equal(resultado.confirmadas.length, 1);
  const { rechazadas, pendientes } = cola.resumen(operador.id);
  assert.equal(pendientes.length, 0);
  assert.equal(rechazadas.length, 1);
  assert.equal(rechazadas[0].motivo, 'pack_sin_entradas');
  assert.equal(rechazadas[0].mensaje, 'Este pack ya no tiene entradas disponibles.');

  // Una rechazada no se vuelve a enviar.
  await cola.enviarPendientes(operador.id);
  assert.equal(llamadas, 2);

  // Solo desaparece cuando el operador la revisa.
  cola.descartar(rechazadas[0].id);
  assert.equal(cola.almacen.todas().length, 0);
});

test('con la sesión vencida no se sigue enviando y nada se pierde', async () => {
  const cola = colaCon({ enviar: async () => { throw errorApi(401, 'no_autenticado'); } });
  guardarQr(cola);
  const resultado = await cola.enviarPendientes(operador.id);
  assert.equal(resultado.detenidaPor, 'sesion');
  assert.equal(cola.resumen(operador.id).pendientes.length, 1);
});

test('solo se envían las lecturas de quien tiene la sesión abierta', async () => {
  const claves = [];
  const cola = colaCon({ enviar: async (ruta, cuerpo, clave) => { claves.push(clave); return { ok: true }; } });
  const ahora = Date.now();
  const propia = guardarQr(cola, { at: ahora, capturadaEn: ahora });
  guardarQr(cola, { at: ahora + 40_000, capturadaEn: ahora + 40_000, quien: otroOperador });

  await cola.enviarPendientes(operador.id);

  assert.deepEqual(claves, [propia.lectura.id]);
  const { ajenas, nombresAjenos } = cola.resumen(operador.id);
  assert.equal(ajenas.length, 1);
  assert.deepEqual(nombresAjenos, ['Dana Puerta']);
});

test('descartar no borra una lectura que todavía no se ha cobrado', () => {
  const cola = colaCon();
  const { lectura } = guardarQr(cola);
  cola.descartar(lectura.id);
  assert.equal(cola.resumen(operador.id).pendientes.length, 1);
});

test('dos envíos a la vez en la misma pestaña no mandan nada dos veces', async () => {
  let liberar;
  const puerta = new Promise((resolver) => { liberar = resolver; });
  let llamadas = 0;
  const cola = colaCon({ enviar: async () => { llamadas += 1; await puerta; return { ok: true }; } });
  guardarQr(cola);

  const primero = cola.enviarPendientes(operador.id);
  const segundo = await cola.enviarPendientes(operador.id);
  assert.equal(segundo.ocupada, true);
  liberar();
  await primero;
  assert.equal(llamadas, 1);
});

test('una lectura que otra pestaña ya envió no se vuelve a mandar', async () => {
  const almacenamiento = almacenFalso();
  const claves = [];
  let cola;
  const enviar = async (ruta, cuerpo, clave) => {
    claves.push(clave);
    // Mientras esta pestaña envía la primera, otra envía y borra la segunda.
    for (const k of [...almacenamiento.datos.keys()]) if (!k.endsWith(clave)) almacenamiento.removeItem(k);
    return { ok: true };
  };
  cola = colaCon({ almacen: new AlmacenLecturas(almacenamiento), enviar });
  const ahora = Date.now();
  guardarQr(cola, { at: ahora, capturadaEn: ahora });
  guardarQr(cola, { at: ahora + 30_000, capturadaEn: ahora + 30_000 });

  await cola.enviarPendientes(operador.id);
  assert.equal(claves.length, 1);
});

test('si el navegador no deja guardar, las lecturas siguen en memoria y se avisa', () => {
  const bloqueado = {
    get length() { throw new Error('bloqueado'); },
    key() { throw new Error('bloqueado'); },
    getItem() { throw new Error('bloqueado'); },
    setItem() { throw new Error('bloqueado'); },
    removeItem() { throw new Error('bloqueado'); },
  };
  const almacen = new AlmacenLecturas(bloqueado);
  assert.equal(almacen.persistente, false);
  const cola = colaCon({ almacen });
  const r = guardarQr(cola);
  assert.equal(r.ok, true);
  assert.equal(r.persistente, false);
  assert.equal(cola.resumen(operador.id).pendientes.length, 1);

  assert.equal(new AlmacenLecturas(null).persistente, false);
});

test('una entrada ilegible en el almacenamiento no impide leer las demás', () => {
  const almacenamiento = almacenFalso();
  const almacen = new AlmacenLecturas(almacenamiento);
  const cola = colaCon({ almacen });
  guardarQr(cola);
  almacenamiento.setItem('rh_lectura:rota', '{no es json');
  almacenamiento.setItem('rh_lectura:incompleta', JSON.stringify({ id: 'x' }));
  almacenamiento.setItem('otra-cosa', 'nada que ver');
  assert.equal(almacen.todas().length, 1);
});

test('los datos del escáner se recuerdan aparte de las lecturas', () => {
  const almacen = new AlmacenLecturas(almacenFalso());
  almacen.recordar('operador', operador);
  assert.deepEqual(almacen.recuperar('operador'), operador);
  assert.equal(almacen.todas().length, 0);
  almacen.olvidar('operador');
  assert.equal(almacen.recuperar('operador'), null);
});

test('el reparto separa pendientes, rechazadas y lecturas de otros operadores', () => {
  const lecturas = [
    { id: 'a', operadorId: 'op-1', estado: 'pendiente', capturadaEn: 3 },
    { id: 'b', operadorId: 'op-1', estado: 'rechazada', capturadaEn: 2 },
    { id: 'c', operadorId: 'op-2', operadorNombre: 'Dana', estado: 'pendiente', capturadaEn: 1 },
    { id: 'd', operadorId: 'op-2', operadorNombre: 'Dana', estado: 'rechazada', capturadaEn: 4 },
    { id: 'e', operadorId: 'op-1', estado: 'pendiente', capturadaEn: 0 },
  ];
  const r = repartir(lecturas, 'op-1');
  assert.deepEqual(r.pendientes.map((l) => l.id), ['e', 'a']);
  assert.deepEqual(r.rechazadas.map((l) => l.id), ['b']);
  assert.deepEqual(r.ajenas.map((l) => l.id), ['c']);
  assert.deepEqual(r.nombresAjenos, ['Dana']);
});
