# Sistema visual: el puesto de telemetría

## Objetivo

Llevar la interfaz al nivel de acabado de una marca seria sin cambiar ni un
color. La identidad Racing Hobbies —negro absoluto y verde `#3dfe40`— se
mantiene intacta; lo que cambia es **cómo está construida** cada pantalla:
ritmo, tipografía, superficies, iconografía y movimiento.

## Referencias y qué se tomó de cada una

- **adrenalineresearchlabs.com**: la estética de laboratorio. Monoespaciada
  para todo lo que es dato o etiqueta, precisión técnica, mayúsculas con
  tracking amplio, cero decoración.
- **klausen.com**: el aire y el ritmo. Marcas de sección entre barras
  (`/ our mission /`), líneas finas en vez de cajas, jerarquía tipográfica
  clara y revelado sereno al desplazarse.

De ahí sale la idea que ordena todo: la pantalla es **un puesto de telemetría**
de una pista. Los números mandan, las etiquetas son técnicas, las líneas son
finas y el color solo aparece cuando significa algo.

## Decisiones

### Tipografía en tres registros

| Registro | Familia | Dónde |
|---|---|---|
| Titular | Anton, mayúsculas | Títulos de pantalla y de tarjeta |
| Lectura | Archivo | Texto corrido, nombres, mensajes |
| Dato | Monoespaciada, mayúsculas, `tracking .16em` | Rótulos de campo, etiquetas de estado, cabeceras de tabla, metadatos, códigos, horas |

La monoespaciada es lo que más cambia la percepción: convierte cada rótulo en
una lectura de instrumento. **Excepción deliberada**: la frase que acompaña a
una casilla se lee como texto normal, no como rótulo; en monoespaciada y
mayúsculas ocupaba tres líneas y costaba leerla.

### Superficies y líneas: no hay cajas

La primera versión de este sistema seguía construyendo la pantalla con
recuadros —tarjeta con borde, banner con foto, pestañas dentro de una caja
gris— y el resultado se parecía demasiado a lo anterior. La segunda quita la
caja como unidad de construcción:

- **Un bloque es una línea fina y el aire que lo rodea**, no un rectángulo con
  borde y fondo. Al pasar por encima, el acento recorre esa línea de lado a
  lado: es la única reacción, y es la misma en toda la interfaz.
- **Fuera los banners con foto.** Cada pantalla abre con una cabecera
  tipográfica: marca de sección, titular grande y una línea que se traza sola
  al cargar. La fotografía competía con los datos y envejecía la pantalla.
- **Un campo es la línea sobre la que se escribe.** Sin recuadro ni relleno:
  al enfocar, esa línea se vuelve de acento y engorda. Como la línea es el
  único contorno del control, tiene su propio color (`--borde-campo`, 4,2:1
  sobre negro) para cumplir el mínimo de 3:1 que pide la norma.
- **Las filas se separan con un pelo de 1 px**, y al pasar por encima se
  desplazan un poco y encienden una marca de acento a la izquierda.
- **Cantos vivos** (2 px, y 0 en lo pequeño) y **sin sombras** en el contenido:
  lo que necesita separarse lo hace con una línea y con espacio, nunca
  simulando relieve. La sombra queda solo para lo que de verdad flota: los
  diálogos.
- Fondo negro con una retícula de 96 px al 1,2 % y un halo verde muy tenue
  arriba: da profundidad sin introducir ningún color nuevo.
- La **esquina de acento** (dos trazos en ángulo) se reserva para lo que de
  verdad manda: el QR del cliente y la mira del escáner.

### Escala: los números y los titulares mandan

Los titulares de pantalla suben a `clamp(2.3rem, 6.5vw, 3.9rem)` y el marcador
de entradas del cliente a `clamp(6rem, 26vw, 13rem)`. Las métricas del panel
pasan de números medianos dentro de ocho cajas iguales a una fila de
instrumentos: cifra grande, rótulo técnico debajo, una línea encima y nada
más.

### Color

Sin colores nuevos. El verde solo aparece en: acción principal, dato vivo,
estado correcto, foco y las marcas de sección. El rojo, el ámbar y el verde de
estado siguen reservados a estados operativos.

### Movimiento

Una sola familia de curvas (`cubic-bezier(.22,1,.36,1)`) y tres duraciones
(140 / 260 / 460 ms) para todo:

- **Revelado al entrar en pantalla** de los bloques de cada página.
- **Entrada de panel** al cambiar de pestaña, y de los diálogos.
- **Titular que se descubre**: al abrir una pantalla, el título aparece de
  abajo arriba con un recorte, y la línea de la cabecera se traza sola.
- **Botones**: el borde se vuelve de acento y el fondo se tiñe apenas; ya no
  se levantan. Mantienen el barrido de luz al pasar por encima.
- **Datos**: las barras del gráfico crecen escalonadas; el saldo late al
  cambiar; la barra de progreso se desplaza.

Dos reglas que no se negocian:

1. **El movimiento nunca puede esconder contenido.** La clase que oculta un
   bloque antes de revelarlo la pone JavaScript, nunca el HTML; hay una red de
   seguridad que la retira a los 2,5 s; y el estado final se fija con
   `opacity: 1` explícito, no solo en el último fotograma de la animación.
   Esto último salió de un fallo real: dos reglas `animation` sobre el mismo
   elemento no se suman, y la del panel pisaba a la del revelado dejando la
   pestaña **en blanco**.
2. **Quien pide menos movimiento no ve ninguno** (`prefers-reduced-motion`), y
   aun así lo ve todo.

### Cursor propio

En un equipo con ratón, el puntero del sistema se sustituye por **un punto que
va pegado al ratón y un anillo que lo persigue con retardo**; sobre algo que se
puede pulsar el anillo se abre y se llena, y al pulsar se contrae. Ambos se
pintan con mezcla por diferencia, así que se ven sobre el negro y sobre el
verde sin cambiar de color. Los acompaña un halo muy tenue, por detrás del
texto, que se mueve mucho más despacio.

Cuatro condiciones lo hacen seguro:

1. Solo se monta con ratón de verdad (`hover: hover` y `pointer: fine`). En un
   teléfono no hay puntero que seguir y el dedo tapa la pantalla.
2. Quien pide menos movimiento se queda con el cursor del sistema.
3. La clase que esconde el cursor nativo la pone el módulo, nunca el HTML: si
   el JavaScript no llega a ejecutarse, el ratón se ve con normalidad.
4. Sobre un campo de texto vuelve la barra del sistema, que es la que dice
   dónde se va a escribir.

### Iconografía propia

Los 78 emojis repartidos por la interfaz se sustituyeron por **29 iconos de un
solo trazo** sobre retícula de 24×24, dibujados en `ui.js` y servidos como SVG
en línea. Un emoji lo dibuja cada sistema operativo a su manera —con su color y
su estilo—, así que la misma pantalla se veía distinta en cada teléfono y
ninguno combinaba con la identidad. Estos heredan el color del texto, pesan
unos cientos de bytes y se ocultan al lector de pantalla, porque lo que
significan siempre está escrito al lado.

### Controles del navegador

`color-scheme: dark` en la raíz: el calendario de una fecha, la lista de un
desplegable y las barras de desplazamiento dejan de aparecer en blanco. El
desplegable lleva además su propia flecha.

## Qué se comprueba solo

- Toda clase usada en el HTML existe en la hoja de estilos.
- Ninguna utilidad de `ui.js` se pasa **sin llamarla**: `el(..., icono)` en vez
  de `el(..., icono(nombre))` no rompe nada, pero imprime el código fuente de
  la función en la pantalla. Pasó al cambiar los emojis, y ahora hay una prueba
  que lo caza.
- Las cuatro pruebas en navegador (interfaz, recuperación, escáner sin conexión
  y avisos) recorren las pantallas y fallan si alguna deja de funcionar.
