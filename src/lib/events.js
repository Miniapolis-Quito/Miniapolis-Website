/**
 * Bus de eventos en memoria para las conexiones SSE.
 *
 * Cada cliente conectado se suscribe a uno o más canales:
 *   - `user:<id>`  → cambios en los packs de ese cliente
 *   - `staff`      → feed de escaneos para el personal de pista
 *   - `admin`      → todo lo anterior más altas, bajas y ajustes
 *
 * Los eventos llevan un `id` incremental; si un cliente se reconecta indicando
 * el último id recibido, se le reenvía lo que se perdió del buffer reciente.
 */
import { EventEmitter } from 'node:events';

const BUFFER_SIZE = 200;

class EventHub {
  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(0);
    this.sequence = 0;
    this.buffer = [];
    this.clients = new Set();
  }

  /** Publica un evento en varios canales a la vez. */
  publish(channels, type, data) {
    this.sequence += 1;
    const event = {
      id: this.sequence,
      type,
      data,
      channels: Array.isArray(channels) ? channels : [channels],
      at: new Date().toISOString(),
    };
    this.buffer.push(event);
    if (this.buffer.length > BUFFER_SIZE) this.buffer.splice(0, this.buffer.length - BUFFER_SIZE);
    this.emitter.emit('event', event);
    return event;
  }

  /** Eventos posteriores a `lastId` que pertenezcan a alguno de los canales. */
  replay(channels, lastId) {
    if (!Number.isInteger(lastId) || lastId <= 0) return [];
    const set = new Set(channels);
    return this.buffer.filter((e) => e.id > lastId && e.channels.some((c) => set.has(c)));
  }

  subscribe(channels, listener) {
    const set = new Set(channels);
    const handler = (event) => {
      if (event.channels.some((c) => set.has(c))) listener(event);
    };
    this.emitter.on('event', handler);
    return () => this.emitter.off('event', handler);
  }

  registerClient(client) {
    this.clients.add(client);
    return () => this.clients.delete(client);
  }

  get connectionCount() {
    return this.clients.size;
  }
}

export const hub = new EventHub();

export const channels = {
  user: (userId) => `user:${userId}`,
  staff: 'staff',
  admin: 'admin',
};

export default hub;
