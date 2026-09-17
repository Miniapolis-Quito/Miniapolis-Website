# Colección visual de Miniápolis #3

Escenas originales para banners y pases, sin marcas de terceros ni texto
incrustado. Son el único color fuerte de una interfaz de papel claro: se
apoyan sobre el fondo sin marcos ni filtros.

## Logotipo

El logotipo oficial de Miniápolis #3 viene dibujado sobre fondo transparente y
con su propio contorno oscuro, así que se lee igual sobre el papel claro de la
interfaz que sobre la banda negra del pase impreso. Va siempre suelto, nunca
dentro de un recuadro de color (el verde de «MINI» y del «#3» desaparecería).

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

En `oficial/` está lo que entregó Miniápolis. La portada pública usa hoy las
cinco fotografías del recinto:

| Archivo | Escena |
| --- | --- |
| `pista-senna-wide.webp` | El McLaren Senna a escala sobre el asfalto — foto de apertura |
| `pista-senna-vertical.webp` | El mismo coche detenido junto a un bordillo |
| `pista-hangar-vertical.webp` | La nave con el trazado de césped y bordillos |
| `pista-hangar-curva.webp` | Curva con bordillo rojo y blanco sobre el césped |
| `pista-circuito-panorama.webp` | Panorámica del circuito completo |

Las tres composiciones de marca (`miniapolis-bandera-hero.webp`,
`miniapolis-logo-dark.webp`, `miniapolis-logo-light.webp`) se conservan como
material de origen aunque ninguna pantalla las use ahora mismo.

## Peso

Estas imágenes las carga un teléfono en la pista, muchas veces con mala señal,
así que van a 1600 px de ancho y en WebP. Si añades otra, pásala por el mismo
aro antes de subirla:

```bash
magick original.png -resize 1600x -strip -quality 80 nombre.webp
```

Y si una deja de usarse, quítala en vez de arrastrarla: cada clon del
repositorio se la lleva entera. En septiembre de 2026 se retiraron por eso las
cinco escenas `racing-hobbies-*.webp` de la marca anterior y las quince
`pista-oficial-NN.webp` de una galería que ya no existe. Están en el historial
de git si alguna vez hacen falta.
