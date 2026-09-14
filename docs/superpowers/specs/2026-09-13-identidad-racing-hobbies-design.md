# Identidad Racing Hobbies para el sistema de entradas

## Objetivo

Hacer que la aplicación de entradas, el pase físico y los pases de Apple y
Google Wallet representen la misma identidad que `Racing Website`: Racing
Hobbies Ecuador, negro, verde oficial `#3dfe40`, tipografía Anton/Archivo y el
logotipo oficial con el auto RC.

## Dirección seleccionada

Se adopta la dirección **Black Racing** de la web. El fondo será negro puro y
las superficies serán grises neutras; el verde oficial será el único color de
energía de marca. Se eliminan el naranja, azul y degradados magenta del sistema
actual. Los colores funcionales (error, advertencia y éxito) se conservarán
solamente donde comunican estado, sin usarlos como identidad.

## Componentes

- Un único logo oficial, preparado con fondo transparente a partir del arte
  entregado, se utilizará en el encabezado, acceso, estados vacíos, impresión y
  pases de cartera.
- La interfaz cargará las fuentes Anton y Archivo que ya utiliza la web; Anton
  se reservará para titulares, contadores y códigos destacados.
- La barra, tarjetas, formularios, pestañas, métricas y progreso se actualizarán
  mediante los tokens de diseño de marca, sin cambiar sus comportamientos ni
  reducir contraste o tamaño táctil.
- El pase físico incorporará el logo horizontal, una franja verde/negra, el QR
  sobre blanco y la información del pack en una composición imprimible de alto
  contraste.
- Apple Wallet usará fondo negro, textos claros, etiquetas verdes y los assets
  oficiales con las resoluciones requeridas por PassKit. Google Wallet recibirá
  el mismo fondo y un logotipo público de marca.

## Activos y compatibilidad

El logotipo oficial entregado se convertirá a PNG transparente sin cambiar su
dibujo ni su tipografía. Se exportarán las dimensiones exigidas por Apple
Wallet (`icon` 29/58/87 y `logo` 160/320) y una versión web para la aplicación.
El logo para Google Wallet se servirá desde la URL pública de la aplicación;
si no hay URL pública configurada, el pase sigue funcionando sin pedir un
recurso remoto.

## Límites y errores

No se modificarán los datos de los packs, QR, autenticación ni los flujos de
venta y acceso. Los recursos de cartera se leerán en memoria como ahora; una
falta de configuración de cartera seguirá degradando a los controles existentes.

## Verificación

- Pruebas automatizadas para los colores y logo de los objetos Apple/Google.
- Prueba de interfaz y vista impresa para confirmar que el QR, nombre y pase
  siguen apareciendo y que solo se imprime el pase.
- Inspección visual en escritorio y móvil de acceso, cliente, administración y
  el pase físico.
