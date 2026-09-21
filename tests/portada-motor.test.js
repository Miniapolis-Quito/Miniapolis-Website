import test from 'node:test';
import assert from 'node:assert/strict';
import {
  limitar, suavizar, progresoFijo, progresoVista, normalizarVelocidad,
  fase, easeOutCubic, lucesEncendidas, digitosDe, entradaPanel, progresoCifra,
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
