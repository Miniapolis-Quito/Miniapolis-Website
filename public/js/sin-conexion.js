/**
 * Reglas del escáner sin conexión.
 *
 * Cuando se cae la red, el puesto sigue leyendo: cada lectura se guarda en el
 * teléfono y se cobra al volver la señal. Este módulo decide qué se puede
 * guardar y qué hacer con cada respuesta del servidor. No toca la página, la
 * red ni el almacenamiento, así que se prueba igual en Node que en el navegador.
 *
 * Lo que aquí se descarta, el servidor lo rechazaría igual. Comprobarlo antes
 * sirve para decírselo al operador mientras el cliente sigue delante, y no una
 * hora después, cuando ya no hay nada que hacer.
 */

/** Alfabeto de los códigos de pack: sin 0/O, 1/I/L ni U, que se confunden. */
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const LARGO_CUERPO = 8;
const PREFIJO = 'RHE';
const VERSION_QR = 'RHE1';

/**
 * Separa el contenido de un QR de pack sin comprobar la firma, que necesita
 * secretos que nunca salen del servidor.
 * @returns {{ok:true, codigo:string, marca:number, nonce:string, estatico:boolean}|{ok:false}}
 */
export function leerQr(texto) {
  if (typeof texto !== 'string') return { ok: false };
  const partes = texto.trim().split('|');
  if (partes.length !== 5) return { ok: false };
  const [version, codigo, marca, nonce, firma] = partes;
  if (version !== VERSION_QR) return { ok: false };
  if (!/^[A-Z]{2,6}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(codigo)) return { ok: false };
  if (!/^\d{1,12}$/.test(marca)) return { ok: false };
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(nonce)) return { ok: false };
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(firma)) return { ok: false };
  return { ok: true, codigo, marca: Number(marca), nonce, estatico: Number(marca) === 0 };
}

/**
 * Deja un código tecleado en su forma canónica, con las mismas reglas que el
 * servidor: sin separadores, con el prefijo opcional y corrigiendo las
 * confusiones típicas (O→Q, I/L/1→7, U→V). Devuelve '' si no es un código.
 */
export function normalizarCodigo(texto) {
  if (typeof texto !== 'string') return '';
  let limpio = texto.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (limpio.length === PREFIJO.length + LARGO_CUERPO && limpio.startsWith(PREFIJO)) {
    limpio = limpio.slice(PREFIJO.length);
  }
  limpio = limpio.replace(/[O0]/g, 'Q').replace(/[IL1]/g, '7').replace(/U/g, 'V');
  if (limpio.length !== LARGO_CUERPO) return '';
  if ([...limpio].some((c) => !ALFABETO.includes(c))) return '';
  return `${PREFIJO}-${limpio.slice(0, 4)}-${limpio.slice(4)}`;
}

/** Código de pack al que corresponde una lectura, o '' si no se reconoce. */
export function codigoDeLectura(lectura) {
  if (lectura.tipo === 'qr') {
    const qr = leerQr(lectura.payload);
    return qr.ok ? qr.codigo : '';
  }
  return normalizarCodigo(lectura.code);
}

const segundos = (ms) => Math.max(1, Math.round(ms / 1000));

/**
 * ¿Se puede guardar esta lectura para cobrarla después?
 *
 * @param {{tipo:'qr', payload:string}|{tipo:'codigo', code:string}} lectura
 * @param {object} contexto
 * @param {Array} contexto.guardadas   lecturas que ya esperan en este teléfono
 * @param {number} contexto.ahora      reloj del teléfono, en ms
 * @param {number|null} contexto.desfaseMs  hora del servidor menos la del
 *   teléfono, medida la última vez que hubo conexión; null si nunca se midió
 * @param {number} contexto.ttlSeconds      vigencia de un QR
 * @param {number} contexto.cooldownSeconds espera entre consumos del mismo pack
 * @returns {{ok:true, codigo:string}|{ok:false, motivo:string, mensaje:string, tono:'error'|'alerta'|'neutro'}}
 */
export function evaluarLectura(lectura, { guardadas = [], ahora, desfaseMs = null, ttlSeconds, cooldownSeconds = 0 }) {
  let codigo;

  if (lectura.tipo === 'qr') {
    const qr = leerQr(lectura.payload);
    if (!qr.ok) {
      return {
        ok: false,
        motivo: 'qr_invalido',
        tono: 'error',
        mensaje: 'Ese código no es una entrada de la pista.',
      };
    }
    codigo = qr.codigo;

    if (guardadas.some((g) => g.tipo === 'qr' && g.payload === lectura.payload.trim())) {
      return { ok: false, motivo: 'ya_guardada', tono: 'neutro', mensaje: 'Esta lectura ya está guardada.' };
    }

    // Solo se puede juzgar la vigencia si alguna vez se midió la hora del
    // servidor: el QR lleva la hora del servidor, no la de este teléfono.
    if (!qr.estatico && desfaseMs !== null && Number.isFinite(desfaseMs)) {
      const edad = (ahora + desfaseMs) / 1000 - qr.marca;
      if (edad > ttlSeconds) {
        return {
          ok: false,
          motivo: 'qr_expirado',
          tono: 'error',
          mensaje:
            'El QR del cliente ya venció. Pídele que actualice su pantalla o que te dicte el código del pack.',
        };
      }
    }
  } else {
    codigo = normalizarCodigo(lectura.code);
    if (!codigo) {
      return {
        ok: false,
        motivo: 'codigo_invalido',
        tono: 'error',
        mensaje: 'Ese código no tiene el formato de un pack (RHE-XXXX-XXXX). Revísalo con el cliente.',
      };
    }
  }

  if (cooldownSeconds > 0) {
    const cercana = guardadas
      .filter((g) => g.codigo === codigo)
      .map((g) => Math.abs(ahora - g.capturadaEn))
      .filter((distancia) => distancia < cooldownSeconds * 1000)
      .sort((a, b) => a - b)[0];
    if (cercana !== undefined) {
      return {
        ok: false,
        motivo: 'espera_activa',
        tono: 'alerta',
        mensaje:
          `Ya guardaste una entrada de ${codigo} hace ${segundos(cercana)} segundos. ` +
          `Espera ${Math.ceil(cooldownSeconds - cercana / 1000)} segundos si de verdad es otra persona.`,
      };
    }
  }

  return { ok: true, codigo };
}

/**
 * Qué hacer con la respuesta del servidor a una lectura enviada.
 *
 * - `confirmada`: se cobró (o ya se había cobrado: la clave de idempotencia
 *   devuelve la respuesta original).
 * - `reintentar`: no se sabe o puede salir bien más tarde. La lectura se queda.
 * - `sesion`: la sesión ya no vale. La lectura espera a que esa persona vuelva.
 * - `rechazada`: el servidor dijo que no y repetirlo no lo cambiará.
 */
export function clasificarRespuesta(error) {
  if (!error) return 'confirmada';
  const estado = Number(error.status ?? 0);
  if (!estado || error.name === 'TimeoutError' || error.name === 'AbortError') return 'reintentar';
  if (estado === 401) return 'sesion';
  if (estado === 408 || estado === 429 || estado >= 500) return 'reintentar';
  if (error.codigo === 'conflicto_concurrencia') return 'reintentar';
  if (estado >= 400) return 'rechazada';
  return 'reintentar';
}

/** Lectura lista para guardarse: lleva todo lo necesario para enviarla igual más tarde. */
export function nuevaLectura({ tipo, payload, code, clave, codigo, capturadaEn, puesto, operador }) {
  return {
    id: clave,
    tipo,
    ...(tipo === 'qr' ? { payload: payload.trim() } : { code: code.trim() }),
    codigo,
    capturadaEn,
    puesto: puesto || null,
    operadorId: operador.id,
    operadorNombre: operador.fullName,
    estado: 'pendiente',
    intentos: 0,
  };
}

/**
 * Ruta y cuerpo con que se envía una lectura guardada.
 *
 * El cuerpo repite exactamente lo que se habría enviado en línea (mismo puesto,
 * mismo código) más las dos horas: si el servidor llegó a cobrarla antes del
 * corte, la clave de idempotencia la reconoce como el mismo intento.
 */
export function envioDe(lectura, ahora) {
  const horas = { capturedAt: new Date(lectura.capturadaEn).toISOString(), sentAt: new Date(ahora).toISOString() };
  const puesto = lectura.puesto ? { deviceLabel: lectura.puesto } : {};
  return lectura.tipo === 'qr'
    ? { ruta: '/api/scan', cuerpo: { payload: lectura.payload, ...puesto, ...horas } }
    : { ruta: '/api/scan/manual', cuerpo: { code: lectura.code, ...puesto, ...horas } };
}

/** Reparte las lecturas guardadas según quién puede ocuparse de ellas. */
export function repartir(lecturas, operadorId) {
  const ordenadas = [...lecturas].sort((a, b) => a.capturadaEn - b.capturadaEn);
  const propias = ordenadas.filter((l) => l.operadorId === operadorId);
  const ajenas = ordenadas.filter((l) => l.operadorId !== operadorId && l.estado === 'pendiente');
  const nombresAjenos = [...new Set(ajenas.map((l) => l.operadorNombre).filter(Boolean))];
  return {
    pendientes: propias.filter((l) => l.estado === 'pendiente'),
    rechazadas: propias.filter((l) => l.estado === 'rechazada'),
    ajenas,
    nombresAjenos,
  };
}
