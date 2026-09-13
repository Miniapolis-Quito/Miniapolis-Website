/**
 * Lector de eventos (SSE) para las pruebas.
 *
 * Usa fetch en streaming, igual que la interfaz real, para que lo que se
 * comprueba aquí sea lo mismo que recibe un navegador.
 */
import assert from 'node:assert/strict';

let base = null;

/** Fija la dirección del servidor levantado por el archivo de pruebas. */
export function fijarBase(url) {
  base = url;
}

/** Abre una conexión de eventos y devuelve un lector con `esperar(tipo)`. */
export async function abrirCanal(token, { desdeEvento = null } = {}) {
  const control = new AbortController();
  const respuesta = await fetch(`${base}/api/events`, {
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${token}`,
      ...(desdeEvento ? { 'Last-Event-ID': String(desdeEvento) } : {}),
    },
    signal: control.signal,
  });
  assert.equal(respuesta.status, 200);

  const recibidos = [];
  const enEspera = [];
  let pendiente = '';

  const lector = respuesta.body.pipeThrough(new TextDecoderStream()).getReader();
  (async () => {
    try {
      while (true) {
        const { value, done } = await lector.read();
        if (done) break;
        pendiente += value;
        let corte;
        while ((corte = pendiente.indexOf('\n\n')) !== -1) {
          const bloque = pendiente.slice(0, corte);
          pendiente = pendiente.slice(corte + 2);
          let tipo = 'message';
          let datos = '';
          let id = null;
          for (const linea of bloque.split('\n')) {
            if (linea.startsWith('event:')) tipo = linea.slice(6).trim();
            else if (linea.startsWith('data:')) datos += linea.slice(5).trim();
            else if (linea.startsWith('id:')) id = Number.parseInt(linea.slice(3).trim(), 10);
          }
          if (!datos) continue;
          const evento = { tipo, id, datos: JSON.parse(datos) };
          recibidos.push(evento);
          for (let i = enEspera.length - 1; i >= 0; i -= 1) {
            if (enEspera[i].tipo === tipo) enEspera.splice(i, 1)[0].resolver(evento);
          }
        }
      }
    } catch {
      /* la conexión se cerró */
    }
  })();

  return {
    recibidos,
    cerrar: () => control.abort(),
    esperar(tipo, ms = 5000) {
      const ya = recibidos.find((e) => e.tipo === tipo);
      if (ya) return Promise.resolve(ya);
      return new Promise((resolver, rechazar) => {
        const espera = { tipo, resolver };
        enEspera.push(espera);
        setTimeout(() => {
          const i = enEspera.indexOf(espera);
          if (i !== -1) enEspera.splice(i, 1);
          rechazar(
            new Error(
              `No llegó ningún evento "${tipo}" en ${ms} ms. Recibidos: ${recibidos.map((e) => e.tipo).join(', ') || 'ninguno'}`,
            ),
          );
        }, ms).unref?.();
      });
    },
  };
}
