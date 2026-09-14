/**
 * Cola de lecturas del escáner sin conexión: dónde se guardan y cómo se envían.
 *
 * Cada lectura vive en su propia clave de `localStorage`. La escritura es
 * síncrona, así que lo que la pantalla da por guardado ya está en disco aunque
 * el teléfono se apague un segundo después; y dos pestañas nunca reescriben una
 * lista compartida, así que no pueden perderse lecturas la una a la otra.
 *
 * La red y el almacenamiento llegan desde fuera para que la cola se pueda
 * probar sin navegador.
 */
import { evaluarLectura, clasificarRespuesta, nuevaLectura, envioDe, repartir } from './sin-conexion.js';

const PREFIJO_LECTURA = 'rh_lectura:';
const PREFIJO_DATO = 'rh_escaner:';

function almacenDelNavegador() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // almacenamiento bloqueado por el navegador
  }
}

/**
 * Lecturas guardadas, con respaldo en memoria si el navegador no deja guardar
 * nada (modo privado estricto, almacenamiento lleno o bloqueado). En ese caso
 * `persistente` es falso y la pantalla lo advierte: las lecturas duran lo que
 * dure la pestaña.
 */
export class AlmacenLecturas {
  constructor(almacen = almacenDelNavegador()) {
    this.almacen = almacen;
    this.memoria = new Map();
    this.persistente = false;
    if (!almacen) return;
    try {
      const prueba = `${PREFIJO_DATO}prueba`;
      almacen.setItem(prueba, '1');
      almacen.removeItem(prueba);
      this.persistente = true;
    } catch {
      this.persistente = false;
    }
  }

  todas() {
    const lecturas = new Map(this.memoria);
    if (this.persistente) {
      try {
        for (let i = 0; i < this.almacen.length; i += 1) {
          const clave = this.almacen.key(i);
          if (!clave?.startsWith(PREFIJO_LECTURA)) continue;
          try {
            const lectura = JSON.parse(this.almacen.getItem(clave));
            if (lectura?.id && lectura.operadorId && Number.isFinite(lectura.capturadaEn)) lecturas.set(lectura.id, lectura);
          } catch {
            /* una entrada ilegible no puede impedir leer las demás */
          }
        }
      } catch {
        /* si el almacenamiento deja de responder, queda lo que hay en memoria */
      }
    }
    return [...lecturas.values()].sort((a, b) => a.capturadaEn - b.capturadaEn);
  }

  existe(id) {
    if (this.memoria.has(id)) return true;
    try {
      return this.persistente && this.almacen.getItem(PREFIJO_LECTURA + id) !== null;
    } catch {
      return false;
    }
  }

  /** Guarda o actualiza una lectura. Devuelve si quedó en disco. */
  guardar(lectura) {
    if (this.persistente) {
      try {
        this.almacen.setItem(PREFIJO_LECTURA + lectura.id, JSON.stringify(lectura));
        this.memoria.delete(lectura.id);
        return true;
      } catch {
        /* sin espacio o bloqueado: mejor en memoria que perderla */
      }
    }
    this.memoria.set(lectura.id, lectura);
    return false;
  }

  quitar(id) {
    this.memoria.delete(id);
    try {
      this.almacen?.removeItem(PREFIJO_LECTURA + id);
    } catch {
      /* nada que hacer */
    }
  }

  /** Datos sueltos del escáner (operador, configuración, desfase del reloj). */
  recordar(nombre, valor) {
    try {
      this.almacen?.setItem(PREFIJO_DATO + nombre, JSON.stringify(valor));
    } catch {
      /* comodidad, no requisito */
    }
  }

  recuperar(nombre) {
    try {
      const crudo = this.almacen?.getItem(PREFIJO_DATO + nombre);
      return crudo ? JSON.parse(crudo) : null;
    } catch {
      return null;
    }
  }

  olvidar(nombre) {
    try {
      this.almacen?.removeItem(PREFIJO_DATO + nombre);
    } catch {
      /* nada que hacer */
    }
  }

  /** ¿Una clave cambiada desde otra pestaña afecta a la cola? */
  static esClaveDeLectura(clave) {
    return clave === null || String(clave).startsWith(PREFIJO_LECTURA);
  }
}

/**
 * Un solo envío a la vez entre todas las pestañas del teléfono. Sin Web Locks
 * se envía igual: la clave de idempotencia impide cobrar dos veces, solo se
 * pierde el ahorro de no repetir peticiones.
 */
function bloqueoDelNavegador(tarea) {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return tarea();
  return locks.request('rh-escaner-envio', { ifAvailable: true }, (candado) => (candado ? tarea() : null));
}

export class ColaSinConexion {
  /**
   * @param {object} opciones
   * @param {AlmacenLecturas} opciones.almacen
   * @param {(ruta:string, cuerpo:object, clave:string) => Promise<object>} opciones.enviar
   * @param {(tarea:Function) => Promise<any>} [opciones.bloquear]
   * @param {() => number} [opciones.reloj]
   */
  constructor({ almacen, enviar, bloquear = bloqueoDelNavegador, reloj = () => Date.now() }) {
    this.almacen = almacen;
    this.enviar = enviar;
    this.bloquear = bloquear;
    this.reloj = reloj;
    this.enviando = false;
  }

  resumen(operadorId) {
    return repartir(this.almacen.todas(), operadorId);
  }

  /**
   * Guarda una lectura para cobrarla después, si tiene sentido guardarla.
   * @returns {{ok:true, lectura:object, persistente:boolean}|{ok:false, motivo:string, mensaje:string, tono:string}}
   */
  guardar({ tipo, payload, code, clave, capturadaEn, puesto, operador }, { desfaseMs = null, ttlSeconds, cooldownSeconds }) {
    const evaluacion = evaluarLectura(tipo === 'qr' ? { tipo, payload } : { tipo, code }, {
      guardadas: this.almacen.todas(),
      ahora: capturadaEn,
      desfaseMs,
      ttlSeconds,
      cooldownSeconds,
    });
    if (!evaluacion.ok) return evaluacion;

    const lectura = nuevaLectura({ tipo, payload, code, clave, codigo: evaluacion.codigo, capturadaEn, puesto, operador });
    const persistente = this.almacen.guardar(lectura);
    return { ok: true, lectura, persistente };
  }

  /** Quita de la vista una lectura rechazada que el operador ya revisó. */
  descartar(id) {
    const lectura = this.almacen.todas().find((l) => l.id === id);
    if (lectura?.estado === 'rechazada') this.almacen.quitar(id);
  }

  /**
   * Envía, en orden de lectura, las lecturas pendientes de este operador.
   *
   * Se detiene al primer fallo que puede arreglarse solo (red, servidor
   * ocupado, sesión): seguir solo acumularía intentos fallidos. Un rechazo
   * definitivo no la detiene: esa lectura pasa a revisión y se sigue con la
   * siguiente.
   */
  async enviarPendientes(operadorId) {
    const vacio = { confirmadas: [], rechazadas: [], detenidaPor: null, ocupada: false };
    if (this.enviando) return { ...vacio, ocupada: true };
    this.enviando = true;
    try {
      const resultado = await this.bloquear(async () => {
        const hecho = { ...vacio, confirmadas: [], rechazadas: [] };
        for (const lectura of this.resumen(operadorId).pendientes) {
          // Otra pestaña pudo enviarla mientras esta esperaba su turno.
          if (!this.almacen.existe(lectura.id)) continue;

          const { ruta, cuerpo } = envioDe(lectura, this.reloj());
          try {
            const respuesta = await this.enviar(ruta, cuerpo, lectura.id);
            this.almacen.quitar(lectura.id);
            hecho.confirmadas.push({ lectura, respuesta });
          } catch (error) {
            const clase = clasificarRespuesta(error);
            if (clase === 'rechazada') {
              const rechazada = {
                ...lectura,
                estado: 'rechazada',
                intentos: lectura.intentos + 1,
                motivo: error.codigo || 'rechazada',
                mensaje: error.message,
                rechazadaEn: this.reloj(),
              };
              this.almacen.guardar(rechazada);
              hecho.rechazadas.push({ lectura: rechazada, error });
              continue;
            }
            this.almacen.guardar({ ...lectura, intentos: lectura.intentos + 1 });
            hecho.detenidaPor = clase;
            break;
          }
        }
        return hecho;
      });
      return resultado ?? { ...vacio, ocupada: true };
    } finally {
      this.enviando = false;
    }
  }
}
