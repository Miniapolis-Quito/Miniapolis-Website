import test from 'node:test';
import assert from 'node:assert/strict';
import {
  limitar, suavizar, progresoFijo, progresoVista, normalizarVelocidad,
  fase, easeOutCubic, lucesEncendidas, digitosDe, entradaPanel, progresoMaximo, progresoCifra,
  entradaPieza, salidaPieza,
} from '../public/js/portada-motor.js';

const cerca = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} no está a ${eps} de ${b}`);

test('limitar recorta al rango', () => {
  assert.equal(limitar(5), 1);
  assert.equal(limitar(-1), 0);
  assert.equal(limitar(7, 0, 10), 7);
});

test('suavizar no se mueve con dt cero y converge con dt grande', () => {
  assert.equal(suavizar(0, 100, 10, 0), 0);
  cerca(suavizar(0, 100, 10, 1), 100 * (1 - Math.exp(-10)));
});

test('suavizar da lo mismo en dos pasos de 0,5 s que en uno de 1 s', () => {
  const dos = suavizar(suavizar(0, 100, 10, 0.5), 100, 10, 0.5);
  cerca(dos, suavizar(0, 100, 10, 1), 1e-9);
});

test('progresoFijo recorre 0..1 sobre el largo de la escena', () => {
  assert.equal(progresoFijo(0, 100, 400), 0);
  assert.equal(progresoFijo(300, 100, 400), 0.5);
  assert.equal(progresoFijo(900, 100, 400), 1);
  assert.equal(progresoFijo(50, 100, 0), 0);
  assert.equal(progresoFijo(150, 100, 0), 1);
});

test('progresoVista va de 0 al asomar por abajo a 1 al salir por arriba', () => {
  // Elemento en y=1000 de alto 500; ventana de 800.
  assert.equal(progresoVista(200, 800, 1000, 500), 0);
  cerca(progresoVista(850, 800, 1000, 500), 0.5);
  assert.equal(progresoVista(1500, 800, 1000, 500), 1);
});

test('normalizarVelocidad se satura en ±1', () => {
  assert.equal(normalizarVelocidad(0), 0);
  assert.equal(normalizarVelocidad(1200), 0.5);
  assert.equal(normalizarVelocidad(-4800), -1);
});

test('fase reparte un tramo de p', () => {
  assert.equal(fase(0, 0.25, 0.75), 0);
  assert.equal(fase(0.5, 0.25, 0.75), 0.5);
  assert.equal(fase(1, 0.25, 0.75), 1);
  assert.equal(fase(0.3, 0.5, 0.5), 0);
  assert.equal(fase(0.7, 0.5, 0.5), 1);
});

test('easeOutCubic frena al final', () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(0.5), 0.875);
});

test('lucesEncendidas cuenta luces enteras', () => {
  assert.equal(lucesEncendidas(0, 10), 0);
  assert.equal(lucesEncendidas(0.05, 10), 0);
  assert.equal(lucesEncendidas(0.5, 10), 5);
  assert.equal(lucesEncendidas(0.99, 10), 9);
  assert.equal(lucesEncendidas(1, 10), 10);
});

test('las cifras terminan antes de que el tablero se vaya', () => {
  assert.equal(progresoCifra(0.18, 0), 0);
  assert.equal(progresoCifra(0.54, 0), 1);
  assert.equal(progresoCifra(0.64, 1), 1);
  assert.ok(progresoCifra(0.64, 2) < 1, 'la tercera fase conserva su pequeño desfase');
});

test('digitosDe ignora todo lo que no es un dígito', () => {
  assert.deepEqual(digitosDe('400'), [4, 0, 0]);
  assert.deepEqual(digitosDe('1/10'), [1, 1, 0]);
  assert.deepEqual(digitosDe('7 días'), [7]);
});

test('entradaPanel es 0 fuera de pantalla y 1 cuando el panel pasó la mitad', () => {
  assert.equal(entradaPanel(1000, 1000), 0);
  assert.equal(entradaPanel(500, 1000), 1);
  assert.equal(entradaPanel(-200, 1000), 1);
  assert.equal(entradaPanel(750, 1000), 0.5);
  assert.equal(entradaPanel(10, 0), 1);
});

test('progresoMaximo dice hasta dónde llega p al llegar al final de la página', () => {
  // Última escena de 700 px con 84 px de pie en una pantalla de 1440: p solo llega a 0,366.
  cerca(progresoMaximo(700, 84, 1440), 784 / 2140);
  // Con al menos una pantalla de contenido debajo, p llega a 1.
  assert.equal(progresoMaximo(700, 1440, 900), 1);
  assert.equal(progresoMaximo(700, 5000, 900), 1);
  // Sin nada debajo, p llega a alto / (ventana + alto).
  cerca(progresoMaximo(800, 0, 800), 0.5);
  // Nunca negativo ni mayor que 1.
  assert.equal(progresoMaximo(800, -50, 800), 0.5);
});

test('entradaPieza espera bajo la ventana, escalona por columna y termina nítida', () => {
  assert.equal(entradaPieza(1000, 1000), 0, 'aún no asoma');
  assert.equal(entradaPieza(700, 1000), 1, 'ya subió un 30 % de la ventana');
  assert.equal(entradaPieza(-400, 1000), 1, 'por encima sigue entera');
  assert.ok(entradaPieza(850, 1000, 120) < entradaPieza(850, 1000), 'la columna de la derecha llega después');
  assert.equal(entradaPieza(500, 0), 1);
});

test('salidaPieza no toca lo que se lee y solo actúa bajo la cabecera', () => {
  assert.equal(salidaPieza(400, 300, 82), 0, 'en plena lectura no sale');
  assert.equal(salidaPieza(82, 300, 82), 0, 'justo en la cabecera aún no sale');
  cerca(salidaPieza(-68, 300, 82), 0.25);
  assert.equal(salidaPieza(-400, 300, 82), 1, 'ya pasó entera');
  assert.equal(salidaPieza(0, 0, 82), 1, 'una pieza sin alto no divide por cero');
});

test('interpolarCifras cuenta cada número del texto y deja el resto intacto', async () => {
  const { interpolarCifras } = await import('../public/js/portada-motor.js');
  assert.equal(interpolarCifras('44 m × 22,5 m', 1), '44 m × 22,5 m');
  assert.equal(interpolarCifras('44 m × 22,5 m', 0), '0 m × 0,0 m');
  assert.equal(interpolarCifras('44 m × 22,5 m', 0.5), '22 m × 11,3 m');
  assert.equal(interpolarCifras('AMB / MyLaps', 0.3), 'AMB / MyLaps');
  assert.equal(interpolarCifras('12.46', 0.5, { rellenar: true }), '06.23');
  assert.equal(interpolarCifras('12.46', 0, { rellenar: true }), '00.00');
  assert.equal(interpolarCifras('200 vehículos', 2), '200 vehículos', 't se recorta a 1');
});

test('progresoPalabra escalona las palabras y todas terminan a la vez con p = 1', async () => {
  const { progresoPalabra } = await import('../public/js/portada-motor.js');
  for (let i = 0; i < 4; i++) assert.equal(progresoPalabra(1, i, 4), 1);
  for (let i = 0; i < 4; i++) assert.equal(progresoPalabra(0, i, 4), 0);
  assert.ok(progresoPalabra(0.4, 0, 4) > progresoPalabra(0.4, 3, 4), 'la primera palabra va por delante');
  assert.equal(progresoPalabra(0.5, 0, 1), 0.5);
});

test('sectorActual devuelve el último sector que ya empezó', async () => {
  const { sectorActual } = await import('../public/js/portada-motor.js');
  const inicios = [0, 800, 1600, 2400];
  assert.equal(sectorActual(-10, inicios), 0);
  assert.equal(sectorActual(799, inicios), 0);
  assert.equal(sectorActual(800, inicios), 1);
  assert.equal(sectorActual(99999, inicios), 3);
});

test('desfaseCinta envuelve cualquier recorrido dentro de un periodo', async () => {
  const { desfaseCinta } = await import('../public/js/portada-motor.js');
  assert.equal(desfaseCinta(0, 100), 0);
  assert.equal(desfaseCinta(-30, 100), -30);
  assert.equal(desfaseCinta(-130, 100), -30);
  assert.equal(desfaseCinta(30, 100), -70);
  assert.equal(desfaseCinta(250, 100), -50);
  assert.equal(desfaseCinta(50, 0), 0);
});
