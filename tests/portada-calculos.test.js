import test from 'node:test';
import assert from 'node:assert/strict';
import {
  limitar, easeOutCubic, valorContado, tiempoEnTexto, progresoLectura,
  diaDeTexto, rangoDeTexto, horaEcuador, estadoJornada, textoJornada,
  formatoMiles, inclinacionPorVelocidad, posicionesEnRecorrido, atraccion, cifrasRodando,
  sectorEnCurso, vueltaCompleta, progresosDeSectores, tiempoDeVuelta, empujePorVelocidad, onda, enfoqueGaleria,
  enCarrera, salidaDeCarrera, momentosDeLlegada, sectorEnAvance, estelaSiguiente, posicionLectura,
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

test('progresosDeSectores reparte la vuelta en tramos contiguos', () => {
  const inicios = [100, 300, 1000];
  assert.deepEqual(progresosDeSectores(0, inicios, 1200), [0, 0, 0], 'en la apertura no empezó ninguno');
  assert.deepEqual(progresosDeSectores(200, inicios, 1200), [0.5, 0, 0]);
  assert.deepEqual(progresosDeSectores(650, inicios, 1200), [1, 0.5, 0], 'el sector largo (una escena fija) se llena a su ritmo');
  assert.deepEqual(progresosDeSectores(1200, inicios, 1200), [1, 1, 1], 'al final de la página la vuelta está completa');
  assert.deepEqual(progresosDeSectores(5000, inicios, 1200), [1, 1, 1], 'el rebote del final no pasa de 1');
  assert.deepEqual(progresosDeSectores(1000, [100, 1000], 1000), [1, 1], 'un último sector sin recorrido cuenta como hecho al llegar');
  assert.equal(vueltaCompleta(progresosDeSectores(1200, inicios, 1200)), true);
  assert.equal(sectorEnCurso(progresosDeSectores(650, inicios, 1200)), 1);
});

test('tiempoDeVuelta se lee como un cronómetro: minutos, segundos y décimas', () => {
  assert.equal(tiempoDeVuelta(102_340), '1:42.3');
  assert.equal(tiempoDeVuelta(0), '0:00.0');
  assert.equal(tiempoDeVuelta(9_999), '0:09.9', 'las décimas se truncan: nunca se adelanta el tiempo');
  assert.equal(tiempoDeVuelta(600_000), '10:00.0');
  assert.equal(tiempoDeVuelta(3_599_999), '59:59.9');
  assert.equal(tiempoDeVuelta(3_600_000), '', 'una hora ya no es una vuelta');
  assert.equal(tiempoDeVuelta(-5), '');
  assert.equal(tiempoDeVuelta(Number.NaN), '');
  // El tablero de salidas lo hace rodar sin mover los dos puntos ni el punto.
  assert.match(cifrasRodando('1:42.3', 0.5, () => 0), /^\d:\d{2}\.\d$/);
});

// ---------------------------------------------------------------------------
// La próxima jornada
// ---------------------------------------------------------------------------

import { proximaJornada, textoProximaJornada } from '../public/js/portada-calculos.js';

test('proximaJornada: abierta ahora, más tarde hoy, mañana o el día que toque', () => {
  const jornadas = [
    { dia: 3, rango: [1140, 1410] }, // miércoles 19:00–23:30
    { dia: 6, rango: [540, 1380] }, // sábado 09:00–23:00
    { dia: 0, rango: [540, 1080] }, // domingo 09:00–18:00
  ];
  // Las horas son de Ecuador (UTC−5): 2026-10-10 es sábado.
  const sabado10 = new Date('2026-10-10T15:00:00Z'); // 10:00
  assert.deepEqual(proximaJornada(jornadas, sabado10), { abierta: true, dia: 6, dias: 0, minutos: 1380, dentroDe: 0 });
  assert.equal(textoProximaJornada(proximaJornada(jornadas, sabado10)), 'Pista abierta hasta las 23:00');
  const miercoles = new Date('2026-10-07T17:00:00Z'); // miércoles 12:00
  assert.equal(textoProximaJornada(proximaJornada(jornadas, miercoles)), 'Abre hoy a las 19:00');
  const viernes = new Date('2026-10-09T20:00:00Z'); // viernes 15:00
  assert.equal(textoProximaJornada(proximaJornada(jornadas, viernes)), 'Abre mañana a las 09:00');
  const lunes = new Date('2026-10-05T17:00:00Z'); // lunes 12:00
  assert.equal(textoProximaJornada(proximaJornada(jornadas, lunes)), 'Abre el miércoles a las 19:00');
  const domingoNoche = new Date('2026-10-12T00:00:00Z'); // domingo 11 a las 19:00, ya cerró
  assert.equal(textoProximaJornada(proximaJornada(jornadas, domingoNoche)), 'Abre el miércoles a las 19:00');
  assert.equal(proximaJornada([{ dia: -1, rango: null }]), null);
  assert.equal(textoProximaJornada(null), '');
});

test('empujePorVelocidad: la marquesina va a su paso y el desplazamiento le da gas', () => {
  assert.equal(empujePorVelocidad(0), 1, 'quieta, a paso de crucero');
  assert.equal(empujePorVelocidad(260), 2);
  assert.equal(empujePorVelocidad(-260), 2, 'subir empuja igual; el sentido va aparte');
  assert.equal(empujePorVelocidad(100000), 7, 'un tirón de rueda no la dispara');
  assert.equal(empujePorVelocidad(Number.NaN), 1);
});

test('onda: la bandera de meta ondea entre límites y el mástil la sujeta', () => {
  for (const t of [0, 0.4, 1.7, 9.3]) {
    for (const i of [0, 5, 20, 40]) {
      const { desplazamiento, luz } = onda(i, 1, t, 40);
      assert.ok(Math.abs(desplazamiento) <= 1 && Math.abs(luz) <= 1, 'nunca se sale de la banda');
    }
  }
  const junto = Math.max(...[0, 0.3, 0.6, 0.9].map((t) => Math.abs(onda(0, 0, t, 40).desplazamiento)));
  const libre = Math.max(...[0, 0.3, 0.6, 0.9].map((t) => Math.abs(onda(39, 0, t, 40).desplazamiento)));
  assert.ok(junto <= 0.25 && libre > 0.6, 'junto al mástil apenas se mueve; el extremo libre ondea');
  assert.notDeepEqual(onda(10, 1, 0, 40), onda(10, 1, 0.5, 40), 'la tela se mueve con el tiempo');
});

test('enfoqueGaleria: la foto del centro está en foco y las de los lados se apartan', () => {
  assert.equal(enfoqueGaleria(720, 720, 1440), 0);
  assert.ok(Math.abs(enfoqueGaleria(720 + 396, 720, 1440) - 0.5) < 1e-9, 'a un cuarto de pantalla, a medias');
  assert.equal(enfoqueGaleria(-500, 720, 1440), 1, 'fuera de la pantalla, del todo fuera de foco');
});

test('enCarrera: hasta la meta corre con el reloj común y al cruzarla se queda en su marca', () => {
  assert.deepEqual(enCarrera(11.8, 11.8, 12.46), { tiempo: 11.8, avance: 0, llego: false });
  const mitad = enCarrera(12.13, 11.8, 12.46);
  assert.equal(mitad.tiempo, 12.13);
  assert.ok(Math.abs(mitad.avance - 0.5) < 1e-9, 'a medio camino, media barra');
  assert.deepEqual(enCarrera(12.9, 11.8, 12.46), { tiempo: 12.46, avance: 1, llego: true }, 'el reloj sigue, su marca no');
  assert.equal(enCarrera(12, 12, 12).avance, 1, 'sin recorrido, ya llegó');
});

test('salidaDeCarrera: una décima redonda antes del mejor tiempo', () => {
  assert.equal(salidaDeCarrera([12.46, 12.86, 13.04]), 11.8);
  assert.equal(salidaDeCarrera([9.95], 0.5), 9.4);
});

test('momentosDeLlegada: las diferencias reales, a cámara lenta', () => {
  const [lider, segundo, tercero] = momentosDeLlegada([12.46, 12.86, 13.04], 11.8);
  assert.ok(Math.abs(lider - 1.32) < 1e-9);
  assert.ok(Math.abs(segundo - lider - 0.8) < 1e-9, '+0.40 se ve como 0,8 s');
  assert.ok(Math.abs(tercero - lider - 1.16) < 1e-9, '+0.58 se ve como 1,16 s');
  assert.deepEqual(momentosDeLlegada([10], 11), [0], 'nadie llega antes de la salida');
});

test('sectorEnAvance: el último sector ya pasado, y -1 en la parrilla', () => {
  const marcas = [0.1, 0.4, 0.8];
  assert.equal(sectorEnAvance(marcas, 0), -1, 'arriba del todo no empezó ninguno');
  assert.equal(sectorEnAvance(marcas, 0.1), -1, 'sobre la marca todavía no se cruzó');
  assert.equal(sectorEnAvance(marcas, 0.25), 0);
  assert.equal(sectorEnAvance(marcas, 0.5), 1);
  assert.equal(sectorEnAvance(marcas, 1), 2);
  assert.equal(sectorEnAvance([], 0.5), -1, 'sin sectores no hay en cuál estar');
});

test('estelaSiguiente: se estira deprisa con la velocidad y se recoge despacio hasta apagarse', () => {
  assert.equal(estelaSiguiente(0, 0), 0, 'quieto, sin estela');
  const arranque = estelaSiguiente(0, 3);
  assert.ok(Math.abs(arranque - 0.35) < 1e-9, 'a toda velocidad crece un tercio por fotograma');
  assert.equal(estelaSiguiente(0, -3), arranque, 'al subir se estira igual: el sentido va aparte');
  assert.ok(estelaSiguiente(1, 30) <= 1, 'nunca pasa de entera');
  assert.ok(Math.abs(estelaSiguiente(1, 0) - 0.9) < 1e-9, 'al frenar se recoge un décimo por fotograma');
  let estela = 1;
  let fotogramas = 0;
  while (estela > 0 && fotogramas < 200) {
    estela = estelaSiguiente(estela, 0);
    fotogramas += 1;
  }
  assert.equal(estela, 0, 'termina en cero exacto: el bucle que la pinta para');
  assert.ok(fotogramas < 60, 'y se apaga en menos de un segundo');
});

test('posicionLectura: cuelga bajo la cabeza y no se sale de la cinta', () => {
  assert.equal(posicionLectura(0, 400, 100), 8, 'en la parrilla, pegada al margen izquierdo');
  assert.equal(posicionLectura(1, 400, 100), 292, 'en la meta, pegada al margen derecho');
  assert.equal(posicionLectura(0.5, 400, 100), 150);
  for (const avance of [0.1, 0.33, 0.5, 0.77, 0.9]) {
    const x = posicionLectura(avance, 400, 100);
    const cabeza = avance * 400;
    assert.ok(x <= cabeza && cabeza <= x + 100, `con ${avance}, la cabeza cae dentro de la lectura`);
  }
  assert.equal(posicionLectura(0.5, 90, 100), 8, 'si no cabe, se queda al margen');
  assert.equal(posicionLectura(2, 400, 100), 292, 'el avance se recorta al rango');
});
