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

### Set optimizado de la portada

| Archivo | Escena |
| --- | --- |
| `pista/miniapolis-track-wide.webp` | Hero y panorama del circuito indoor de asfalto |
| `pista/miniapolis-track-vertical.webp` | Vista vertical del hangar y del trazado de asfalto |
| `pista/miniapolis-asphalt-detail.webp` | Textura de asfalto, curvas y bordillos |

Las superficies del trazado se presentan como asfalto continuo; las líneas y
los bordillos conservan sus colores reales de pista.

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
