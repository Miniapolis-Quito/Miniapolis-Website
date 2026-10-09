# Portada: la vuelta, con espectáculo

## Objetivo

Llevar la portada de «bien contada» a inolvidable sin cambiar de identidad:
el mismo negro, el mismo verde reservado a lo que importa, la Saira ancha y las
líneas de un píxel. Más escenas que cuentan la pista con datos, más
profundidad y un cierre que se recuerda. Todo sigue la gramática de
`2026-10-08-portada-scrollytelling-design.md`: cada movimiento dice algo de la
vuelta o se quita.

## Lo nuevo, en el orden de la vuelta

| Momento | Qué pasa | Qué cuenta |
|---|---|---|
| Salida | Junto al semáforo, el estado real de la pista («Pista abierta hasta las 23:00», «Abre mañana a las 09:00»), sacado de la tabla de horarios. Estelas de luz salen del fondo de la nave y aceleran con la rueda y con la salida; la foto se mueve unos píxeles con el puntero. | Que la pista existe ahora mismo, y velocidad. |
| Sectores | Detrás de cada encabezado, su número enorme en contorno de un píxel, más lento que la página. | Dónde se está, como los dorsales en la nave. |
| Manifiesto | Entre la marquesina y el complejo, una sola frase grande que se enciende palabra a palabra (fija en pantalla ancha). | Qué es la pista, de una vez. |
| 05 · Vuelta récord | La repetición del récord de la tabla en un puesto de telemetría: crono, velocidad, fuerza lateral, acelerador, freno, tres parciales, el auto sobre el mapa y la traza de velocidad. En pantalla ancha el tablero se fija y el desplazamiento es el tiempo (bajar es rodar, subir es rebobinar); en el teléfono la vuelta corre a tiempo real cada vez que se llega. | Lo que vive la pista: el cronometraje. |
| 09 · Cómo funciona | «Del pack a la pista»: tres pasos y un teléfono `sticky` que enseña la pantalla del paso que se lee (el pack, el QR que se renueva con su haz de lectura y su cuenta atrás, el saldo que baja de 10 a 9). | El producto: el pase en el teléfono. |
| Cronómetro | En la regla vertical de la vuelta corre el tiempo; al cruzar cada sector se detiene un instante en verde con su parcial; en la meta se queda fijo. | La vuelta se está cronometrando. |
| Meta | El nombre de la pista de lado a lado del pie, en contorno; en la última recta el verde lo llena de izquierda a derecha. | Se cruzó la línea. |

Convive con lo que llegó a la vez a `main` (el mosaico fijo, la mira que fija
cada caja, la bandera de verdad, el foto finish de los récords, la galería que
enfoca): las cajas del tablero de telemetría se fijan con la misma
`fijarCaja` que el resto de la página.

## La vuelta récord no se dibuja a mano

`portada-calculos.js` reconstruye la vuelta con funciones puras y probadas:

- `curvaturas`: 1/radio en cada punto del trazado (el mismo del plano).
- `perfilDeVelocidad`: el límite de agarre en cada curva (√(a·R)), la punta,
  y las pasadas de aceleración y frenada de un ingeniero de pista, dos veces
  porque la vuelta es cerrada.
- `telemetriaDeVuelta`: escala a la longitud de la ficha (172 m) y al tiempo
  del primer puesto de la tabla (12.46 s); da distancia, tiempo, velocidad,
  acelerador, freno y fuerza lateral por muestra.
- `muestraEnTiempo` y `parcialesDeVuelta`: un instante interpolado y los tres
  parciales, que suman exactamente la vuelta.

Con el trazado real sale una punta de 83 km/h en la recta de meta, 30 km/h en
la horquilla, 1,6 g de lateral y parciales de 3.82 · 4.46 · 4.17. La nota del
bloque dice que es una recreación ilustrativa.

`proximaJornada` y `textoProximaJornada` dan el rótulo del estado de la pista.

## Detalles que importan

- **matchMedia.** Con un objeto de condiciones, `gsap.matchMedia()` solo
  llama a la escena si alguna se cumple: las escenas nuevas (manifiesto y
  vuelta récord) llevan `todas: 'all'`, como las demás, para que el teléfono
  monte su versión (la vuelta a tiempo real, el manifiesto que se enciende al
  pasar).
- **La traza se descubre por distancia**, con un recorte que avanza en x, y
  no con `stroke-dashoffset`: el trazo mide su largo, no su avance, y se
  quedaba atrás del cursor en cada subida y bajada de velocidad.
- **El estado de la pista no lo anima la salida**: la salida mide sus valores
  de partida al montarse, cuando `.portada-intro` todavía lo apaga, y lo
  dejaba invisible. Se va con `.hero__contenido`.
- **Estelas.** Un lienzo 2D, 70 líneas como mucho (34 en el teléfono), dos
  pasadas por línea (halo y núcleo) en lugar de un desenfoque, apagadas donde
  va el titular y solo mientras la apertura se ve.
- **El teléfono se mide en `em` sobre su propio ancho** (`container-type:
  inline-size`): en el móvil es la misma pantalla, más pequeña, y deja ver la
  pantalla por encima de las tarjetas de los pasos.
- **Cambiar de pantalla es estado, no movimiento**: con movimiento reducido el
  teléfono sigue a los pasos, sin transición. Sin JavaScript enseña el saldo.
- La clase `.pase` ya es del pase impreso (styles.css): el bloque nuevo se
  llama `.funciona`.
- **Apaisado.** Un teléfono en horizontal tiene sitio a lo ancho: «Cómo
  funciona» se queda con los pasos y el teléfono lado a lado, como en
  pantalla ancha, en lugar de un teléfono diminuto tapado por las tarjetas.
- **La meta.** El recorte que llena el nombre sube por encima de su caja: con
  un interlineado tan apretado, la tilde de la Á quedaba fuera.

## Verificación

- `npm test`, con pruebas nuevas para la telemetría (curvatura de un estadio,
  agarre, saltos imposibles, duración exacta, interpolación, parciales) y la
  próxima jornada (abierta, hoy, mañana, otro día).
- `npm run test:portada` en los 22 formatos.
- Capturas en 1440×900, 390×844 y con movimiento reducido de cada escena
  nueva: sin errores de consola y sin desborde horizontal.
