/**
 * El constructor de elementos de la interfaz no debe dejar pasar una dirección
 * que ejecute código.
 *
 * `el()` es la única puerta por la que pasan todos los enlaces de la
 * aplicación. Ninguno se arma hoy con datos de fuera, pero basta un descuido
 * futuro para que un `javascript:` acabe en un `href` y se ejecute dentro de la
 * sesión de quien mire la pantalla. Esta prueba fija la regla.
 *
 * Se monta un DOM mínimo porque `ui.js` corre en el navegador: lo único que
 * necesita de él es crear elementos y guardar sus atributos.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

class NodoDePrueba {
  constructor(etiqueta) {
    this.etiqueta = etiqueta;
    this.atributos = new Map();
    this.hijos = [];
    this.dataset = {};
    this.style = { setProperty() {} };
  }

  setAttribute(clave, valor) {
    this.atributos.set(clave, valor);
  }

  getAttribute(clave) {
    return this.atributos.has(clave) ? this.atributos.get(clave) : null;
  }

  addEventListener() {}
  append(...hijos) {
    this.hijos.push(...hijos);
  }
}

const documentoOriginal = globalThis.document;
const nodoOriginal = globalThis.Node;
const errorOriginal = console.error;
let el;

before(async () => {
  globalThis.Node = NodoDePrueba;
  globalThis.document = {
    createElement: (etiqueta) => new NodoDePrueba(etiqueta),
    createTextNode: (texto) => ({ texto }),
  };
  console.error = () => {};
  ({ el } = await import('../public/js/ui.js'));
});

after(() => {
  globalThis.document = documentoOriginal;
  globalThis.Node = nodoOriginal;
  console.error = errorOriginal;
});

const PELIGROSAS = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  '  javascript:alert(1)',
  'java\tscript:alert(1)',
  'java\nscript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
];

test('una dirección que ejecuta código no llega al documento', () => {
  for (const atributo of ['href', 'src', 'action', 'formaction']) {
    for (const direccion of PELIGROSAS) {
      const nodo = el('a', { [atributo]: direccion });
      assert.equal(
        nodo.getAttribute(atributo),
        null,
        `${atributo}="${direccion}" no debería llegar al documento`,
      );
    }
  }
});

test('las direcciones normales siguen funcionando', () => {
  const casos = [
    '/app',
    '#cliente/9d0c0f6a-1111-4222-8333-444455556666',
    'https://wa.me/593991112233',
    'mailto:cliente@pista.ec',
    'tel:+593991112233',
    'blob:http://localhost:3000/9d0c0f6a-1111-4222-8333-444455556666',
    '/api/packs/9d0c0f6a-1111-4222-8333-444455556666/qr.svg?mode=static',
  ];
  for (const direccion of casos) {
    assert.equal(el('a', { href: direccion }).getAttribute('href'), direccion);
  }
  assert.equal(el('img', { src: '/images/miniapolis-logo-oficial.webp' }).getAttribute('src'), '/images/miniapolis-logo-oficial.webp');
});

test('el QR PNG embebido funciona en una imagen, sin abrir data URL en enlaces', () => {
  const qr = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(el('img', { src: qr }).getAttribute('src'), qr);
  assert.equal(el('a', { href: qr }).getAttribute('href'), null);
  assert.equal(el('img', { src: 'data:image/svg+xml,<svg></svg>' }).getAttribute('src'), null);
});

test('el texto de un elemento sigue insertándose como texto y nunca como marcado', () => {
  const nodo = el('span', {}, '<img src=x onerror=alert(1)>');
  assert.equal(nodo.hijos.length, 1);
  assert.equal(nodo.hijos[0].texto, '<img src=x onerror=alert(1)>');
});
