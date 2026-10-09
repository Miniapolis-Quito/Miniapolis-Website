# Portada: la vuelta, con espectáculo

## Objetivo

Llevar la portada de «bien contada» a inolvidable sin cambiar de identidad:
el mismo negro, el mismo verde reservado a lo que importa, la Saira ancha y las
líneas de un píxel. Todo sigue la gramática de
`2026-10-08-portada-scrollytelling-design.md`: cada movimiento dice algo de la
vuelta o se quita.

## Lo que se queda, en el orden de la vuelta

| Momento | Qué pasa | Qué cuenta |
|---|---|---|
| Salida | Junto al semáforo, el estado real de la pista («Pista abierta hasta las 23:00», «Abre mañana a las 09:00»), sacado de la tabla de horarios. La cuenta atrás es un pórtico de salida en el centro; después la nave respira (un acercamiento lentísimo de ida y vuelta) y la foto se mueve unos píxeles con el puntero. | Que la pista existe ahora mismo. |
| Sectores | Detrás de cada encabezado, su número enorme en contorno de un píxel, más lento que la página. | Dónde se está, como los dorsales en la nave. |
| 09 · Cómo funciona | «Del pack a la pista»: tres pasos y un teléfono `sticky` que enseña la pantalla del paso que se lee (el pack, el QR que se renueva con su haz de lectura y su cuenta atrás, el saldo que baja de 10 a 9). Con ratón, el teléfono se inclina hacia el puntero; en pantalla ancha, un riel junto a los pasos se llena al leerlos. | El producto: el pase en el teléfono. |
| Cronómetro | En la regla vertical de la vuelta corre el tiempo; al cruzar cada sector se detiene un instante en verde con su parcial; en la meta se queda fijo. | La vuelta se está cronometrando. |
| Meta | «MINIÁPOLIS» de lado a lado del pie, en contorno; en la última recta el verde lo llena de izquierda a derecha. | Se cruzó la línea. |

## Lo que se retiró

El primer merge traía además un **manifiesto** (una frase grande entre la
marquesina y el complejo que se encendía palabra a palabra) y la **vuelta
récord en telemetría** (crono, canales, parciales, mapa y traza de velocidad
reconstruidos a partir del trazado). Se quitaron a pedido: el manifiesto
repetía lo que ya dicen las entradillas (la luz natural en «La pista», la
iluminación nocturna en «Complejo», el cuenta vueltas en «Mejores tiempos») y
la telemetría alargaba la página sin aportar lo que no cuenta ya el tablero de
récords. Con ellos se fueron sus funciones puras y sus pruebas.

## Detalles que importan

- **matchMedia.** Con un objeto de condiciones, `gsap.matchMedia()` solo
  llama a la escena si alguna se cumple: todas llevan `todas: 'all'` para que
  el teléfono monte su versión.
- **Las estelas se retiraron** (las líneas de luz que salían del fondo de la
  nave): se leían como un efecto añadido y no como parte de la pista.
- **La foto que sigue al puntero no se movía.** Iba por la propiedad
  `translate` del CSS y GSAP, que escala esa foto en la apertura, la absorbe
  en su `transform` y la deja en `none`. Ahora va por la `x` y la `y` de GSAP.
- **El teléfono se mide en `em` sobre su propio ancho** (`container-type:
  inline-size`): en el móvil es la misma pantalla, más pequeña, y deja ver la
  pantalla por encima de las tarjetas de los pasos. Apaisado se queda lado a
  lado, como en pantalla ancha. El primer paso arranca justo bajo su titular.
- **Cambiar de pantalla es estado, no movimiento**: con movimiento reducido el
  teléfono sigue a los pasos, sin transición. Sin JavaScript enseña el saldo.
- La clase `.pase` ya es del pase impreso (styles.css): el bloque nuevo se
  llama `.funciona`.
- **La meta.** El recorte que llena el nombre sube por encima de su caja: con
  un interlineado tan apretado, la tilde de la Á quedaba fuera. Y la meta de
  la vuelta se cruza aunque la altura de la página se redondee un píxel (en 4K
  el último sector se quedaba en 0,998).
- **La galería en tableta vertical** sube como el resto de los bloques: un
  desplazamiento lateral movía los puntos de anclaje y la tira arrancaba
  empezada.

## Verificación

- `npm test`, con pruebas para la próxima jornada (abierta, hoy, mañana, otro
  día).
- `npm run test:portada` en los 22 formatos; cuenta un sector por sección
  numerada.
- Recorrido completo con la rueda en 1440×900 y 390×844: mediana y percentil
  95 de 16,7 ms por fotograma, sin errores de consola ni desborde horizontal.

## La cuenta atrás, como un pórtico de salida

El semáforo era el gran momento de la apertura y se vivía en una pastilla de
12 px en una esquina, con la pantalla quieta. Ahora, mientras las cinco luces
se encienden, va grande en el centro de la pantalla (hasta 3,4 veces, el 70 %
del ancho en el teléfono) sobre la nave a media luz. Al apagarse vuelve a su
sitio mientras el titular arranca y la nave se enciende.

Se mueve una caja propia, `.hero__portico`, y no el semáforo: la salida ya
anima el `transform` del semáforo y GSAP, además, absorbe en su `transform`
las propiedades `scale` y `translate` del CSS de lo que anima (con ellas el
semáforo se quedaba a escala cero para siempre). Antes de la cuenta atrás el
pórtico espera apagado bajo `.portada-intro`; con movimiento reducido o en
una visita repetida no hay pórtico y el semáforo está en su sitio.
