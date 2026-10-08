# Portada: el desplazamiento cuenta una vuelta

## Objetivo

Que recorrer la portada se lea como una sola historia y no como nueve
secciones con un efecto cada una. Fluidez, ritmo y jerarquía antes que
cantidad de movimiento: cada animación tiene que decir algo de la vuelta o
quitarse.

## El hilo: una vuelta al circuito

- **Salida.** El semáforo se enciende y se apaga; «Ven a rodar.» sale letra a
  letra. Una guía fina con una luz que baja indica que la vuelta sigue abajo.
- **Telón.** En pantallas anchas la apertura queda fija y la primera sección
  (`.seccion--telon`) sube por encima con el borde fundido. El titular se
  aparta (cada línea hacia su lado) y se apaga antes de que el telón llegue a
  su altura. En el teléfono no se fija nada.
- **Sectores.** Cada sección numerada es un sector (01 Recorrido … 09 Acceso).
  `portada-vuelta.js` lleva la cuenta: un número que rueda como un marcador,
  nueve tramos que se llenan con el desplazamiento y el nombre del sector en
  curso. En pantallas anchas es una regla vertical en el margen izquierdo; en
  las estrechas, una línea partida arriba del todo. Reemplaza a la línea de
  avance de la cabecera, que se esconde al bajar justo cuando se lee.
- **Meta.** En «Tu pase» la bandera a cuadros se tiende de lado a lado y, al
  final de la página, el número del indicador se convierte en la bandera.

Los nombres de los sectores salen de los índices de la página: no se añade
ningún texto. El indicador es decorativo (`aria-hidden`): la navegación de la
cabecera ya dice dónde se está.

## Gramática de movimiento

Pocas piezas, siempre las mismas:

| Pieza | Movimiento |
|---|---|
| Encabezado | Un solo disparo por encabezado y en orden de lectura: el índice (el número sube por su ventana y su línea se traza), el titular palabra a palabra (0,1 s) y la entradilla línea a línea (0,32 s). |
| Bloques (filas, tarjetas, paneles) | `SUBIDA`: suben 36 px y se encienden, en escalera de 0,08 s. |
| Fotos | Se descubren de abajo arriba mientras la imagen se asienta; al pasar se desplazan un poco más despacio que la página. |
| Datos | Se cuentan como en la pista: el cronómetro corre hasta el récord, el tablero de salidas rueda hasta la hora, el auto dibuja el trazado mientras se lee la ficha. |
| Escenas fijas | Solo en pantallas anchas: la salida, la vuelta por los cinco sectores del complejo y la galería que corre de lado. |

Se retiraron los efectos que no contaban nada: tarjetas y tableros que giraban
en 3D, fechas que entraban inclinadas y contaban desde cero, recortes de fotos
en cuatro direcciones distintas y el número de sección revuelto (con él se fue
`ScrambleTextPlugin`).

## Detalles que importan

- Los trazos con `pathLength="1"` (el plano y los iconos de «Tu pase») se
  animan con `autoRound: false`: GSAP redondea los píxeles a enteros y el
  trazo saltaría de nada a todo a mitad de recorrido.
- El trazado del plano empieza en la línea de salida y el auto espera en la
  parrilla desde el montaje.
- La vuelta se monta al final de las escenas, cuando las fijas ya alargaron la
  página, y busca los sectores en todo `main`: la galería fija va dentro del
  envoltorio de ScrollTrigger.
- Lo recorrido de cada sector sale de la posición (`progresosDeSectores`), con
  límites medidos después de cada `refresh`. Una sección fija se mide por su
  envoltorio: medida por sí misma, el sector de la galería terminaba a un
  tercio de la escena y su tramo se quedaba lleno y quieto dos pantallas.
- Sin movimiento (o sin GSAP) no hay telón, ni vuelta, ni guía: la página se ve
  completa y quieta.

## Revisión de diseño (después del primer merge)

Cada criterio del encargo, medido:

- **Ritmo.** Pantallas de desplazamiento por sector a 1440×900: 01 2,2 · 02 2,5
  · 03 1,5 · 04 0,8 · 05 0,8 · 06 2,2 · 07 3,2 · 08 1,1 · 09 1,0 (16,9 en total).
  Las escenas largas (el recorrido, la vuelta del complejo, la galería) se
  alternan con sectores de datos que se leen de un vistazo, y la vuelta cierra
  con una recta corta hasta la meta. En el teléfono, sin escenas fijas, entre
  0,9 y 2,2 por sector (13,9 en total).
- **Sin efectos gratuitos.** Inventario de todo lo que se mueve y qué cuenta.
  Se retiró la deriva de las tarjetas de eventos y de la tienda, que subían a
  distinta velocidad y descuadraban la rejilla mientras se leía sin decir nada
  de la vuelta. El paralaje de las fotos se queda: ocurre dentro de su marco y
  no mueve la rejilla.
- **Cohesión del indicador.** Verificado sector por sector en escritorio,
  móvil e iPad: cada sección muestra su número y su nombre, los anteriores
  quedan llenos, la meta llega con la bandera y 9/9 tramos, arriba no se ve y
  con movimiento reducido no existe. El tramo de la galería se llena con la
  escena (33 % → 57 % → 81 % a lo largo de la tira).
- **Fluidez.** Mediana de 16,7 ms por fotograma en un recorrido completo con
  la rueda; los pocos fotogramas lentos están en la foto grande de la apertura.

## Verificación

- `npm test`, con pruebas nuevas para la vuelta (funciones puras
  `sectorEnCurso` y `vueltaCompleta`), el telón y la gramática compartida.
- `npm run test:portada`: 22 formatos, de 320 px a 4K y con movimiento
  reducido.
- Capturas fotograma a fotograma con la rueda del ratón en la salida, el
  complejo, la ficha, el cambio de sector del indicador y la meta; y tiempos
  de fotograma de un recorrido completo (mediana de 16,7 ms).
