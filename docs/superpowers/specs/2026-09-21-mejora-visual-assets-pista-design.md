# Mejora visual de imágenes de la pista

## Objetivo

Elevar todos los assets visuales de la web de Miniápolis #3 a una calidad visual premium y coherente, manteniendo como fuente de verdad la pista y el hangar reales. Las imágenes deben mostrar únicamente elementos propios del circuito: asfalto, trazado, bordillos, columnas, ventanas, iluminación y arquitectura existente.

## Restricciones acordadas

- No deben aparecer personas, camiones, autos de fondo, cajas, conos innecesarios, señalética accidental ni objetos distractores.
- No se inventarán edificios, sectores del circuito, decoraciones, vehículos, marcas ni geometrías que no existan en el lugar.
- Se conservarán la identidad visual, el logotipo, los iconos, los colores de marca y la geometría reconocible del trazado.
- El único elemento `<video>` existente es la vista de cámara del escáner; no es un asset de marketing y no se reemplazará.
- El trabajo debe ser no destructivo sobre los cambios ya presentes en `public/css/styles.css` y `tests/frontend.test.js`.

## Alcance de assets

### Activos de fotografía de pista

Revisar y mejorar los archivos de `public/images/pista/`, `public/images/landing/` y `public/images/oficial/` que se usan en la landing o como superficies visuales. La familia final debe cubrir:

- hero horizontal de la pista;
- curva horizontal cinematográfica;
- encuadre vertical del hangar/pista;
- detalle vertical de bordillo;
- detalle de asfalto y línea de carrera;
- escena de ambiente para la landing;
- retrato del auto de pista solo cuando el auto sea el sujeto y no haya personas ni vehículos de fondo.

Los derivados responsive deben conservar el mismo encuadre y no ser simples ampliaciones de una versión pequeña.

### Assets que no se deben alterar con ImageGen

Logotipos, iconos PWA, iconos de Wallet y gráficos vectoriales o de interfaz. Se pueden optimizar en formato o compresión si la revisión demuestra una ganancia clara, pero no se rediseñarán ni se reinterpretarán.

## Tratamiento visual

1. Seleccionar los encuadres reales más útiles para desktop y móvil.
2. Limpiar únicamente elementos no deseados: personas, camiones, vehículos de fondo y objetos accidentales.
3. Mejorar exposición, balance de blancos, rango dinámico, microcontraste, textura del asfalto y legibilidad de bordillos sin cambiar la escena real.
4. Crear versiones de alta resolución con detalle natural, sin halos, texturas plásticas ni geometría falsa.
5. Exportar WebP optimizado y mantener JPEG solo donde el fallback existente lo requiera.
6. Actualizar `srcset`, dimensiones declaradas y referencias solo cuando sea necesario para que la página use el asset final correcto.

## Validación

- Inspección visual individual de cada asset final a tamaño completo.
- Búsqueda visual específica de personas, camiones, autos de fondo y objetos distractores.
- Comprobación de proporciones, nitidez y ausencia de artefactos en crops desktop y móvil.
- Revisión de la landing renderizada en navegador.
- Ejecución de las pruebas existentes y verificación de que no se alteraron los flujos de autenticación, escáner o Wallet.

## Entregables

- Assets finales en `public/images/` con nombres estables y referencias actualizadas.
- Cualquier ajuste mínimo requerido en HTML/CSS para servir las variantes adecuadas.
- Registro breve de los assets reemplazados y de las validaciones realizadas.

