import test from 'node:test';
import assert from 'node:assert/strict';
import {
  limitar, easeOutCubic, valorContado, tiempoEnTexto, progresoLectura,
  diaDeTexto, rangoDeTexto, horaEcuador, estadoJornada, textoJornada,
  formatoMiles, inclinacionPorVelocidad, posicionesEnRecorrido, atraccion, cifrasRodando,
  sectorEnCurso, vueltaCompleta,
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

test('formatoMiles usa el punto como separador, como en Ecuador', () => {
  assert.equal(formatoMiles(1000), '1.000');
  assert.equal(formatoMiles(999), '999');
  assert.equal(formatoMiles(0), '0');
  assert.equal(formatoMiles(1234567), '1.234.567');
  assert.equal(formatoMiles(1000.9), '1.000', 'mientras cuenta solo enseña enteros');
});

test('inclinacionPorVelocidad se tuerce contra el desplazamiento y nunca pasa del tope', () => {
  assert.equal(inclinacionPorVelocidad(0), 0);
  assert.ok(inclinacionPorVelocidad(840) < 0, 'al bajar se inclina hacia atrás');
  assert.ok(inclinacionPorVelocidad(-840) > 0, 'al subir, al revés');
  assert.equal(inclinacionPorVelocidad(840), -2);
  assert.equal(inclinacionPorVelocidad(100000), -8);
  assert.equal(inclinacionPorVelocidad(-100000), 8);
  assert.ok(Object.is(inclinacionPorVelocidad(-0), 0), 'nunca devuelve -0');
});

test('posicionesEnRecorrido reparte las curvas a lo largo de la vuelta', () => {
  assert.deepEqual(posicionesEnRecorrido(6), [0.2, 0.35, 0.5, 0.65, 0.8, 0.95]);
  assert.deepEqual(posicionesEnRecorrido(1), [0.2]);
  assert.deepEqual(posicionesEnRecorrido(0), []);
  const p = posicionesEnRecorrido(9);
  assert.ok(p.every((x, i) => i === 0 || x > p[i - 1]), 'siempre en orden de paso');
});

test('atraccion acerca el botón al puntero con un tope', () => {
  assert.equal(atraccion(0), 0);
  assert.equal(atraccion(0.5), 5);
  assert.equal(atraccion(-1, 7), -7);
  assert.equal(atraccion(3), 10, 'fuera del botón no tira más');
  assert.equal(atraccion(-3, 7), -7);
});

test('cifrasRodando solo hace rodar las cifras y las fija de izquierda a derecha', () => {
  const siempre = (n) => () => n / 10;
  assert.equal(cifrasRodando('19:00 — 23:30', 0, siempre(7)), '77:77 — 77:77', 'los dos puntos y el guion no se tocan');
  assert.equal(cifrasRodando('19:00 — 23:30', 1, siempre(7)), '19:00 — 23:30');
  assert.equal(cifrasRodando('19:00 — 23:30', 0.5, siempre(7)), '19:00 — 77:77', 'a mitad, la primera hora ya está fija');
  assert.equal(cifrasRodando('19:00 — 23:30', 0.4, siempre(0)).length, '19:00 — 23:30'.length, 'el ancho del texto no cambia');
  assert.equal(cifrasRodando('cerrado', 0.3), 'cerrado');
});


test('sectorEnCurso dice en qué sector de la vuelta se está leyendo', () => {
  assert.equal(sectorEnCurso([0, 0, 0]), -1, 'en la apertura todavía no arrancó ningún sector');
  assert.equal(sectorEnCurso([0.4, 0, 0]), 0);
  assert.equal(sectorEnCurso([1, 0.02, 0]), 1, 'basta con entrar en un sector para estar en él');
  assert.equal(sectorEnCurso([1, 1, 1]), 2);
  assert.equal(sectorEnCurso([]), -1);
});

test('vueltaCompleta solo cuando el último sector se recorre entero', () => {
  assert.equal(vueltaCompleta([1, 1, 0.9]), false);
  assert.equal(vueltaCompleta([1, 1, 1]), true);
  assert.equal(vueltaCompleta([1, 1, 0.996]), true, 'el redondeo del final de la página cuenta como meta');
  assert.equal(vueltaCompleta([]), false);
});
