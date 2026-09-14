# Diseño de experiencia integral de Racing Hobbies

## Objetivo

Llevar toda la aplicación de entradas a la identidad oficial de Racing Hobbies: negro absoluto, verde oficial `#3cfe3f`, señalética técnica y el coche/logotipo oficiales. El resultado debe sentirse como el puesto digital de una pista RC, pero seguir siendo inmediato para clientes, personal y administración.

## Dirección aprobada

La petición del cliente es extender a toda la web la dirección ya aprobada para entradas y Wallet: estética futurista, minimalista, limpia y fiel al sitio de referencia. Se trabajará sin introducir una marca alternativa ni colores decorativos que compitan con el verde Racing.

## Sistema visual

- **Color:** `#000000` es el lienzo; `#3cfe3f` es el verde oficial obtenido del archivo oficial; blancos cálidos y grises neutros sostienen la lectura. Los colores de éxito, alerta y error permanecen exclusivos de estados operativos.
- **Forma:** esquinas casi rectas, líneas de pista finas, bloques segmentados y barras de progreso rectilíneas. Nada de degradados de neón, vidrio o sombras difusas que debiliten el contraste.
- **Tipografía:** Anton únicamente para encabezados, números principales y etiquetas de sección; Archivo para controles, datos y textos. Los códigos permanecen monoespaciados.
- **Movimiento:** transiciones cortas y funcionales; se desactivan bajo `prefers-reduced-motion`.

## Aplicación por superficie

### Shell y estados compartidos

La barra superior se convierte en una barra de pit: logotipo oficial compacto, navegación segmentada y un borde verde de estado. Formularios, botones, pestañas, tablas, modales, avisos y vacíos usan el mismo lenguaje técnico. Los emojis de cámara/bandera se sustituyen por marcadores visuales CSS para no romper la identidad.

### Cliente

El saldo se presenta como un marcador de pista: número Anton en verde, lectura auxiliar y líneas de carril discretas. El QR conserva una zona blanca funcional para permitir su escaneo, rodeada por el marco negro/verde Racing. Los packs se leen como credenciales técnicas: código, saldo y avance primero; acciones y Wallet después.

### Escáner

La cámara recibe un visor de pista con esquinas de enfoque verdes. El resultado se convierte en un tablero de estado de alto contraste, legible con una mano y bajo sol. La entrada manual, preferencias y actividad comparten la misma jerarquía.

### Administración

El panel usa un tablero operativo: métricas como módulos de telemetría, pestañas como selector de modos y tablas con cabeceras compactas, líneas de separación y estados claros. Los modales de venta/gestión siguen la misma secuencia visual y accesible.

### Acceso, 404 e impresión

Acceso y error mantienen el logotipo oficial como punto de entrada, imágenes auténticas de pista y formularios muy legibles. El pase impreso conserva su diseño propio, pero usa el mismo verde oficial y una banda técnica mínima.

## Compatibilidad y validación

No cambia ninguna ruta, texto de API, identificador que consume JavaScript ni flujo de negocio. Las pruebas estáticas garantizarán que todas las pantallas declaren la paleta y los recursos oficiales; las pruebas funcionales y de interfaz cubrirán los flujos de cliente, escáner, administración, Wallet e impresión. Se realizará revisión visual de escritorio y móvil y se comprobará movimiento reducido.
