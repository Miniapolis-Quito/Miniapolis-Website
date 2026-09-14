/**
 * Conexión de tiempo real (SSE) sobre `fetch`.
 *
 * Se usa fetch en lugar de EventSource porque EventSource no permite enviar la
 * cabecera Authorization: habría que poner el token en la URL, donde acabaría
 * registrado en el servidor y en cualquier proxy intermedio. A cambio hay que
 * implementar la reconexión a mano: espera exponencial con algo de aleatoriedad
 * y reanudación desde el último evento recibido.
 */
import { tokenActual, refrescarSesion, limpiarSesion, cambioDePasswordPropio } from './api.js';

const ESPERA_BASE = 1000;
const ESPERA_MAXIMA = 30_000;

export class ConexionEnVivo {
  constructor({ onEvento, onEstado } = {}) {
    this.onEvento = onEvento || (() => {});
    this.onEstado = onEstado || (() => {});
    this.ultimoId = 0;
    this.intentos = 0;
    this.controlador = null;
    this.temporizador = null;
    this.detenida = false;
    this.estado = 'inactivo';

    this.enEspera = false;
    /** Esperando a que termine un cambio de contraseña hecho desde esta pestaña. */
    this.esperandoCambio = false;

    this._alVolverAlFrente = () => {
      // Al volver a la pestaña o recuperar la red, reconectar de inmediato.
      if (
        !this.detenida &&
        !this.esperandoCambio &&
        this.estado !== 'conectado' &&
        document.visibilityState === 'visible'
      ) {
        this.enEspera = false;
        this.intentos = 0;
        this._reconectarYa();
      }
    };
    document.addEventListener('visibilitychange', this._alVolverAlFrente);
    window.addEventListener('online', this._alVolverAlFrente);
  }

  _cambiarEstado(estado, detalle) {
    if (this.estado === estado) return;
    this.estado = estado;
    this.onEstado(estado, detalle);
  }

  iniciar() {
    this.detenida = false;
    this._conectar();
    return this;
  }

  detener() {
    this.detenida = true;
    clearTimeout(this.temporizador);
    this.controlador?.abort();
    this.controlador = null;
    document.removeEventListener('visibilitychange', this._alVolverAlFrente);
    window.removeEventListener('online', this._alVolverAlFrente);
    this._cambiarEstado('inactivo');
  }

  _reconectarYa() {
    clearTimeout(this.temporizador);
    this.controlador?.abort();
    this.temporizador = setTimeout(() => this._conectar(), 60);
  }

  /**
   * Deja de reintentar sin desmontar nada. Se usa cuando el servidor cierra
   * este canal porque la persona tiene demasiadas pestañas abiertas: esta se
   * queda en silencio y vuelve sola en cuanto alguien la mire.
   */
  pausar() {
    clearTimeout(this.temporizador);
    this.controlador?.abort();
    this.controlador = null;
    this.enEspera = true;
    this._cambiarEstado('en-espera');
  }

  _programarReconexion() {
    if (this.detenida || this.enEspera) return;
    this.intentos += 1;
    const base = Math.min(ESPERA_BASE * 2 ** (this.intentos - 1), ESPERA_MAXIMA);
    // Aleatoriedad para que muchos clientes no reconecten todos a la vez.
    const espera = base * (0.7 + Math.random() * 0.6);
    this._cambiarEstado('reconectando', { enSegundos: Math.round(espera / 1000) });
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this._conectar(), espera);
  }

  async _conectar() {
    if (this.detenida) return;
    this.enEspera = false;
    this.controlador?.abort();
    const controlador = new AbortController();
    this.controlador = controlador;
    this._cambiarEstado('conectando');

    try {
      let token = tokenActual();
      if (!token) {
        await refrescarSesion();
        token = tokenActual();
      }

      const respuesta = await fetch('/api/events', {
        credentials: 'same-origin',
        signal: controlador.signal,
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
          ...(this.ultimoId ? { 'Last-Event-ID': String(this.ultimoId) } : {}),
        },
      });

      if (respuesta.status === 401) {
        // Token caducado a mitad del stream: se renueva y se reintenta ya.
        await refrescarSesion();
        this.intentos = 0;
        this._reconectarYa();
        return;
      }
      if (!respuesta.ok || !respuesta.body) {
        throw new Error(`Respuesta inesperada del servidor (${respuesta.status})`);
      }

      this.intentos = 0;
      this._cambiarEstado('conectado');

      const lector = respuesta.body.pipeThrough(new TextDecoderStream()).getReader();
      let acumulado = '';

      while (true) {
        const { value, done } = await lector.read();
        if (done) break;
        acumulado += value;

        // Los eventos SSE se separan por una línea en blanco.
        let corte;
        while ((corte = acumulado.indexOf('\n\n')) !== -1) {
          const bloque = acumulado.slice(0, corte);
          acumulado = acumulado.slice(corte + 2);
          this._procesarBloque(bloque);
        }
        // Un bloque desmesurado solo puede venir de datos corruptos.
        if (acumulado.length > 1_000_000) acumulado = '';
      }

      // El servidor cerró: se reconecta.
      this._cambiarEstado('desconectado');
      this._programarReconexion();
    } catch (error) {
      if (controlador.signal.aborted || this.detenida) return;
      this._cambiarEstado('desconectado', { mensaje: error.message });
      this._programarReconexion();
    }
  }

  _procesarBloque(bloque) {
    let tipo = 'message';
    let datos = '';
    let id = null;

    for (const linea of bloque.split('\n')) {
      if (linea.startsWith(':')) continue; // latido
      const dosPuntos = linea.indexOf(':');
      const campo = dosPuntos === -1 ? linea : linea.slice(0, dosPuntos);
      const valor = dosPuntos === -1 ? '' : linea.slice(dosPuntos + 1).replace(/^ /, '');
      if (campo === 'event') tipo = valor;
      else if (campo === 'data') datos += (datos ? '\n' : '') + valor;
      else if (campo === 'id') id = valor;
    }

    if (id !== null) {
      const numero = Number.parseInt(id, 10);
      if (Number.isInteger(numero) && numero > this.ultimoId) this.ultimoId = numero;
    }
    if (!datos) return;

    // El servidor avisa cuando la sesión dejó de ser válida (cuenta suspendida,
    // rol cambiado o sesión cerrada desde otro sitio): no tiene sentido
    // reintentar, hay que volver a entrar.
    if (tipo === 'sesion.invalida') {
      const cambioPropio = cambioDePasswordPropio();
      if (cambioPropio) {
        // Esta pestaña acaba de cambiar su contraseña: el aviso es para las
        // demás pantallas. El canal abierto sigue atado a la sesión anterior,
        // así que se corta y, cuando el cambio termina bien, se vuelve a abrir
        // con la sesión nueva. Si el cambio falló, el aviso vino de otro sitio.
        this.esperandoCambio = true;
        this.pausar();
        cambioPropio.then((salioBien) => {
          this.esperandoCambio = false;
          if (this.detenida) return;
          if (salioBien) {
            this.intentos = 0;
            this._reconectarYa();
          } else {
            this.detener();
            limpiarSesion();
          }
        });
        return;
      }
      this.detener();
      limpiarSesion();
      return;
    }

    // Demasiadas pestañas abiertas: el servidor se queda con la última. Esta
    // no insiste, pero sigue atenta a que alguien vuelva a mirarla.
    if (tipo === 'canal.reemplazado') {
      this.pausar();
      return;
    }

    let contenido;
    try {
      contenido = JSON.parse(datos);
    } catch {
      return;
    }
    try {
      this.onEvento(tipo, contenido);
    } catch (error) {
      console.error('Error procesando evento en vivo', error);
    }
  }
}

/** Etiqueta legible del estado de la conexión. */
export function textoEstado(estado) {
  return (
    {
      conectado: 'En vivo',
      conectando: 'Conectando…',
      reconectando: 'Reconectando…',
      desconectado: 'Sin conexión',
      'en-espera': 'En pausa (otra pestaña)',
      inactivo: 'Desconectado',
    }[estado] || estado
  );
}
