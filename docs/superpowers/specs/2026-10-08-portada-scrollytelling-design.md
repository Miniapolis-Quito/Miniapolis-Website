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
  El pie da entonces el tiempo de la vuelta («Tu vuelta 1:42.3»), contado
  desde que se apagó el semáforo y rodando como el tablero de salidas hasta
  fijarse, junto a «Volver arriba», que invita a dar otra. Es el cierre de una
  pista que vive del cronometraje: el visitante se lleva su propio tiempo.

Los nombres de los sectores salen de los índices de la página: no se añade
ningún texto. El indicador es decorativo (`aria-hidden`): la navegación de la
cabecera ya dice dónde se está.

## Gramática de movimiento

Pocas piezas, siempre las mismas:

| Pieza | Movimiento |
|---|---|
| Encabezado | Un solo disparo por encabezado y en orden de lectura: el índice (el número sube por su ventana y su línea se traza), el titular palabra a palabra (0,1 s) y la entradilla línea a línea (0,32 s). |
| Cajas (cifras, filas, tarjetas, paneles) | La telemetría las fija (`portada-mira.js`): un haz de lectura las imprime de izquierda a derecha y una mira, la del cursor, se cierra sobre ellas y se retira. El texto suelto (notas, botones) sigue con `SUBIDA`. |
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

## Segunda ronda: lo que pidió el dueño al recorrerla

- **Fotos homogéneas.** Todas las fotos de la portada pasan por la misma
  gradación (`scripts/gradar-fotos.py`, detallada en `public/images/README.md`):
  la exposición media quedó entre 0,37 y 0,39 (antes 0,33–0,56) y la
  saturación entre 0,08 y 0,18 (antes 0,04–0,22). Los productos de la tienda,
  todos sobre el mismo negro. Ya no hay filtros CSS sueltos por foto.
- **La marquesina corre sola.** Bucle continuo sin costura (cada fila lleva su
  texto dos veces y un hueco final que lo cierra; medida la costura: 0 px), en
  sentidos contrarios. El desplazamiento le da gas (`empujePorVelocidad`) y le
  cambia el sentido; fuera de la pantalla se pausa.
- **La línea verde bajo «Snack bar».** Cada fila traza su línea por arriba;
  la última trae además la suya por debajo.
- **El cursor, sincronizado.** Punto y aro comparten un solo desplazamiento,
  sin inercia: medidos en tres posiciones, los dos caen en el píxel del puntero.

Y escenas nuevas, todas al servicio de la vuelta:

- **La pista, a pantalla completa.** En pantallas anchas la primera foto del
  mosaico entra ocupando toda la pantalla; con el mosaico fijo, la cámara se
  aleja —vuelve a su casilla— y el resto del hangar aparece alrededor.
  Comprobado que cubre la pantalla sin franjas en 1280×720, 1440×900,
  1920×1080, 2560×1440 y 3440×1440.
- **La charla antes de salir.** En el complejo fijo, la entradilla se
  enciende palabra a palabra y después la vuelta recorre los cinco sectores.
- **La galería enfoca.** La foto que pasa por el centro se ve entera y las
  demás esperan más pequeñas y en penumbra (`enfoqueGaleria`).
- **La bandera de meta ondea.** La banda de «Tu pase» es una bandera a cuadros
  dibujada en un lienzo (`portada-bandera.js`): una onda la recorre desde el
  mástil, con luz en las crestas y sombra en los valles, y ondea más fuerte
  cuanto más rápido se baja. Solo se dibuja mientras se ve.

Con todo esto, el recorrido completo a 1440×900 sigue en 16,7 ms de mediana y
ningún fotograma pasa de 34 ms.

## Tercera ronda: cada caja, fijada por la telemetría

El dueño pidió que cada caja de contenido, hasta la más pequeña, contara su
parte. En lugar de un efecto distinto por caja, una sola idea que ya estaba
en la página: el cursor es una mira táctica de un puesto de telemetría. Las
cajas responden en ese idioma.

- **Fijar.** Al llegar a una caja, un haz verde la recorre en el sentido de
  la marcha y la va imprimiendo (`clip-path`, que no la saca del orden del
  teclado); detrás deja una estela que se apaga. Cuatro escuadras se cierran
  sobre ella como al fijar un objetivo y se retiran. Al terminar no queda
  recorte: vuelven la sombra del pase y la inclinación 3D de la tienda. Lo
  usan las cifras de la apertura, los sectores del complejo en el teléfono,
  el plano y las filas de la ficha, las jornadas, el tablero de récords, las
  fechas, la tienda, las ventajas y el pie.
- **La mira sigue la lectura.** En la vuelta del complejo, una sola mira salta
  de sector en sector con el tramo que se corre. En la ficha se fija en la
  fila que se lee y su dato rueda hasta el valor, como el tablero de horarios.
- **Foto finish.** Los récords se corren: un reloj común arranca en 11.80 y
  cada piloto avanza hacia la meta con su barra; cruza en su tiempo y su cifra
  se queda quieta. Las llegadas se separan lo que separan las marcas, a
  cámara lenta (+0.40 son 0,8 s): se ve quién gana y por cuánto. El destello es
  del mejor tiempo. Mientras corren, los lectores de pantalla oyen la marca
  real (`enCarrera`, `salidaDeCarrera`, `momentosDeLlegada`).
- **Las fechas se confirman.** Cada cifra de la agenda llega en contorno y se
  rellena cuando su tarjeta se fija.
- **El pase da la vuelta.** El borde del panel de acceso se traza entero, desde
  la esquina de salida y en el sentido de la marcha; al cerrarse, el pase se
  abre.

Comprobado bajando, subiendo y volviendo a bajar: ninguna caja se queda a
medias. Sin movimiento la mira no existe y todo se ve completo. El recorrido
completo sigue en 16,7 ms de mediana por fotograma.

## Verificación

- `npm test`, con pruebas nuevas para la vuelta (funciones puras
  `sectorEnCurso` y `vueltaCompleta`), el telón y la gramática compartida.
- `npm run test:portada`: 22 formatos, de 320 px a 4K y con movimiento
  reducido. En cada uno comprueba además que la vuelta llega a la meta con sus
  nueve tramos llenos y el tiempo en el pie, que «Muy pronto» termina con
  todas sus letras en su sitio y que la guía de la apertura tiene su luz en
  marcha donde corresponde. Probado contra una versión rota a propósito (sin
  tiempo en la meta): falla en los dos formatos probados y dice por qué.
- Capturas fotograma a fotograma con la rueda del ratón en la salida, el
  complejo, la ficha, el cambio de sector del indicador y la meta; y tiempos
  de fotograma de un recorrido completo (mediana de 16,7 ms).
