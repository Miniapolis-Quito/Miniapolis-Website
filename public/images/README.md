# Colección visual de Miniápolis #3

Escenas originales para banners y pases, sin marcas de terceros ni texto
incrustado. Sobre el negro de la interfaz son lo único que aporta color aparte
del verde de la marca: van sin filtros y con una línea de un píxel por marco.

## Logotipo

El logotipo oficial de Miniápolis #3 viene dibujado sobre fondo transparente y
está pensado para el negro: el de la interfaz y el de la banda que encabeza el
pase impreso. Va siempre suelto, nunca dentro de un recuadro de color (el verde
de «MINI» y del «#3» desaparecería).

| Archivo | Qué es | Dónde se usa |
| --- | --- | --- |
| `miniapolis-logo-oficial.webp` | Logotipo completo, 1000 × 425 px | Cabeceras de todas las pantallas y pase impreso |
| `miniapolis-wallet-icon.png` | Sello cuadrado (bandera + antena), 660 × 660 px | Icono de Google Wallet, que lo recorta en círculo |
| `miniapolis-wallet-wide-logo.png` | Logotipo completo sobre transparente, 1280 × 400 px | Cabecera del pase de Google Wallet |
| `miniapolis-icono-192.png`, `miniapolis-icono-512.png` | Sello cuadrado con margen de seguridad | Iconos `maskable` del manifiesto |

El sello cuadrado y el favicon salen del mismo dibujo vectorial que
`/public/favicon.svg`: si cambia uno, hay que volver a exportar los demás.

```bash
rsvg-convert -w 660 -h 660 marca-cuadrada.svg -o miniapolis-wallet-icon.png
```

Los iconos de Apple Wallet (`assets/wallet/icon*.png` y `logo*.png`) salen de
ese mismo par de archivos y hay que regenerarlos a la vez.

## Material oficial de la pista

En `oficial/` está el material de origen que entregó Miniápolis. La portada
pública usa ahora el set optimizado de `pista/`, generado a partir de las fotos
reales del recinto:

| Archivo | Escena |
| --- | --- |
| `pista-senna-wide.webp` | El McLaren Senna a escala sobre el asfalto — foto de apertura |
| `pista-senna-vertical.webp` | El mismo coche detenido junto a un bordillo |
| `pista-hangar-vertical.webp` | La nave con el trazado de asfalto y bordillos |
| `pista-hangar-curva.webp` | Curva con bordillo rojo y blanco sobre el asfalto |
| `pista-circuito-panorama.webp` | Panorámica del circuito completo |

### Set premium optimizado de la portada

| Archivo | Escena |
| --- | --- |
| `pista/miniapolis-track-wide.webp` | Hero limpio del circuito indoor de asfalto, 1675 × 939 |
| `pista/miniapolis-track-corner-wide.webp` | Vista baja limpia de una curva, 1675 × 939 |
| `pista/miniapolis-track-side-wide.webp` | Vista lateral de las rectas y ventanas, 1675 × 939 |
| `pista/miniapolis-gallery-wide.webp` | Vista centrada del hangar y el trazado, 1675 × 939 |
| `pista/miniapolis-gallery-curb-wide.webp` | Bordillo y línea de carrera en primer plano, 1675 × 939 |
| `pista/miniapolis-hangar-vertical.webp` | Arcos y ventanas del hangar sobre el circuito, 941 × 1671 |
| `pista/miniapolis-curb-detail-vertical.webp` | Detalle vertical limpio del bordillo rojo y blanco, 941 × 1672 |
| `pista/miniapolis-asphalt-detail.webp` | Textura vertical limpia del asfalto y línea de carrera, 941 × 1672 |
| `pista/miniapolis-track-vertical.webp` | Reserva optimizada del trazado vertical real, 941 × 1670 |
| `pista/miniapolis-pit-corner-vertical.webp` | Esquina limpia junto al área de boxes, 941 × 1671 |
| `pista/miniapolis-gallery-curb-vertical.webp` | Curva vertical con bordillo y arquitectura real, 941 × 1671 |
| `pista/miniapolis-gallery-car-vertical.webp` | Auto RC único en la pista, 941 × 1671 |

Cada bloque visual de la portada usa un encuadre distinto. Las variantes `-640`,
`-960` y `-1440` son únicamente alternativas responsive del mismo encuadre, no
repeticiones dentro de la página. Las superficies del trazado se presentan como
asfalto continuo; las líneas y los bordillos conservan sus colores reales.

La actualización premium mantiene esta misma colección como fuente de verdad:
los masters horizontales y verticales conservan la arquitectura real del hangar,
los arcos, ventanas, columnas, asfalto y bordillos. La limpieza visual elimina
personas, camiones, autos de fondo y objetos accidentales sin añadir geometría ni
decoración nueva. Las variantes responsive deben compartir el encuadre de su
master y declarar en HTML sus dimensiones reales.

Los archivos de `landing/` se reservan para composiciones editoriales: `miniapolis-car-detail`
usa el auto RC como sujeto único y `miniapolis-track-atmosphere` muestra solo el
ambiente real del circuito. `miniapolis-action`, `miniapolis-track-portrait` y el
directorio `pista-real/` no son fuentes permitidas para la portada.

`miniapolis-track-atmosphere` se sirve en 1675 × 939 con variantes 1440/960;
`miniapolis-car-detail` se sirve en 1221 × 1289 con variantes 900/640. El hero
usa `pista/miniapolis-track-wide` y sus variantes 1440/960; la panorámica oficial
queda como material de origen y no se carga en la portada.

Los logotipos, iconos PWA, recursos de Wallet y la vista de cámara del escáner no
se editan con ImageGen ni forman parte de esta colección fotográfica.

Las tres composiciones de marca (`miniapolis-bandera-hero.webp`,
`miniapolis-logo-dark.webp`, `miniapolis-logo-light.webp`) se conservan como
material de origen aunque ninguna pantalla las use ahora mismo.

## Peso

Estas imágenes las carga un teléfono en la pista, muchas veces con mala señal,
así que van en WebP y al doble del tamaño al que de verdad se muestran, no más:
a partir de ahí solo se gastan datos. La receta, midiendo antes cuánto ocupa la
imagen en pantalla:

```bash
magick original.webp -resize '1200x>' -strip -quality 80 nombre.webp
```

Al cierre de septiembre de 2026 la portada pesaba 1,8 MB en la primera carga,
casi todo fotografías exportadas a mucha más resolución de la que se ve: la
panorámica se mostraba a 1100 px y la más grande llegaba a 449 KB. Ajustadas al
doble de su tamaño en pantalla, la página quedó en 1,2 MB sin que la diferencia
se aprecie (43 dB de PSNR comparadas al tamaño al que se ven).

El atributo `width`/`height` del HTML tiene que coincidir con el archivo. Si no,
el navegador reserva una proporción equivocada y la página pega un salto cuando
la imagen termina de cargar.

Y si una deja de usarse, quítala en vez de arrastrarla: cada clon del
repositorio se la lleva entera. En septiembre de 2026 se retiraron por eso las
cinco escenas `racing-hobbies-*.webp` de la marca anterior y las quince
`pista-oficial-NN.webp` de una galería que ya no existe. Están en el historial
de git si alguna vez hacen falta.
