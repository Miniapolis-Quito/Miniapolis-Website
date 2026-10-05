import test from 'node:test';
import assert from 'node:assert/strict';
import {
  limitar, easeOutCubic, valorContado, tiempoEnTexto, progresoLectura,
  diaDeTexto, rangoDeTexto, horaEcuador, estadoJornada, textoJornada,
} from '../public/js/portada-calculos.js';

test('limitar recorta al rango', () => {
  assert.equal(limitar(5), 1);
  assert.equal(limitar(-1), 0);
  assert.equal(limitar(7, 0, 10), 7);
});

test('easeOutCubic arranca en cero, frena al final y no se sale del rango', () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(0.5), 0.875);
  assert.equal(easeOutCubic(2), 1);
  assert.equal(easeOutCubic(-1), 0);
});

test('valorContado arranca en cero, frena y llega exacto al tiempo real', () => {
  assert.equal(valorContado(12.46, 0), 0);
  assert.equal(valorContado(12.46, 1), 12.46);
  assert.equal(valorContado(12.46, 2), 12.46);
  assert.ok(valorContado(12.46, 0.5) > 12.46 / 2, 'frena al final: a mitad de tiempo va más allá de la mitad');
});

test('tiempoEnTexto fija los decimales y, si se pide, el ancho de la cifra', () => {
  assert.equal(tiempoEnTexto(12.4), '12.40');
  assert.equal(tiempoEnTexto(valorContado(12.46, 1)), '12.46');
  assert.equal(tiempoEnTexto(3.1, 2, 5), '03.10', 'mientras corre, la cifra ocupa lo mismo que la final');
  assert.equal(tiempoEnTexto(0, 2, 5), '00.00');
  assert.equal(tiempoEnTexto(12.46, 2, 5), '12.46');
});

test('progresoLectura va de 0 arriba a 1 al final, sin pasarse', () => {
  assert.equal(progresoLectura(0, 5000, 1000), 0);
  assert.equal(progresoLectura(2000, 5000, 1000), 0.5);
  assert.equal(progresoLectura(4000, 5000, 1000), 1);
  assert.equal(progresoLectura(4500, 5000, 1000), 1, 'el rebote del final no lo pasa de 1');
  assert.equal(progresoLectura(-80, 5000, 1000), 0, 'el rebote de arriba no lo deja negativo');
  assert.equal(progresoLectura(0, 800, 1000), 1, 'una página que cabe entera ya está leída');
});

test('los días de la tabla de horarios se reconocen con o sin tilde y en plural', () => {
  assert.equal(diaDeTexto('Miércoles'), 3);
  assert.equal(diaDeTexto('Sábados'), 6);
  assert.equal(diaDeTexto('Domingos'), 0);
  assert.equal(diaDeTexto('  sabado '), 6);
  assert.equal(diaDeTexto('Feriado'), -1);
  assert.deepEqual(rangoDeTexto('19:00 — 23:30'), [1140, 1410]);
  assert.equal(rangoDeTexto('cerrado'), null);
});

test('la hora de Ecuador es UTC−5 sin cambios de horario', () => {
  // 2026-09-23 es miércoles. 00:30 UTC del jueves = 19:30 del miércoles en Quito.
  const h = horaEcuador(new Date('2026-09-24T00:30:00Z'));
  assert.equal(h.dia, 3);
  assert.equal(h.minutos, 19 * 60 + 30);
  assert.equal(horaEcuador(new Date('2026-01-15T12:00:00Z')).minutos, 7 * 60);
});

test('estadoJornada distingue abierto, antes de abrir, ya cerrado y otro día', () => {
  const miercoles = [3, [19 * 60, 23 * 60 + 30]];
  assert.equal(estadoJornada(...miercoles, new Date('2026-09-24T00:30:00Z')), 'abierto');
  assert.equal(estadoJornada(...miercoles, new Date('2026-09-23T15:00:00Z')), 'antes', 'a las 10:00 del miércoles todavía no abre');
  assert.equal(estadoJornada(...miercoles, new Date('2026-09-24T04:30:00Z')), 'cerrado', 'a las 23:30 en punto ya cerró');
  assert.equal(estadoJornada(...miercoles, new Date('2026-09-25T02:00:00Z')), '', 'un jueves no es miércoles');
  assert.equal(estadoJornada(-1, null), '');
});

test('textoJornada dice en palabras lo que el color sugiere', () => {
  assert.equal(textoJornada('abierto', [1140, 1410]), 'Abierto ahora');
  assert.equal(textoJornada('antes', [540, 1380]), 'Hoy desde las 09:00');
  assert.equal(textoJornada('antes', [1140, 1410]), 'Hoy desde las 19:00');
  assert.equal(textoJornada('cerrado', [540, 1080]), 'Hoy ya cerró');
  assert.equal(textoJornada('', null), '');
});
