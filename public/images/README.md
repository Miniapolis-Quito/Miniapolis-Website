# Colección visual de Miniápolis #3

Escenas originales para banners y pases, sin marcas de terceros ni texto
incrustado. Todas mantienen el negro y el verde de Miniápolis #3.

## Logotipo

El logotipo oficial de Miniápolis #3 viene dibujado sobre fondo transparente y
con su propio contorno oscuro: va suelto sobre el negro de la interfaz, nunca
dentro de un recuadro verde (el verde de «MINI» y del «#3» desaparecería).

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

## Escenas

| Archivo | Escena | Uso recomendado |
| --- | --- | --- |
| `racing-hobbies-pista-rc.webp` | Dos vehículos RC en una pista nocturna | Cabeceras generales |
| `racing-hobbies-pase-rc.webp` | Buggy en primer plano | Pase físico impreso |
| `racing-hobbies-nocturno-rc.webp` | Buggy de competición bajo luces de pista | Venta, acceso y campañas nocturnas |
| `racing-hobbies-taller-crawler.webp` | Crawler técnico en taller | Servicio técnico y detalle de pack |
| `racing-hobbies-circuito-rc.webp` | Buggy 1/10 en circuito RC nocturno | Cliente, promociones y versiones premium |

Las tres variantes nuevas se exportaron en WebP a 1942 × 809 px y calidad alta
para que conserven detalle en pantalla e impresión sin pesar innecesariamente
en la conexión móvil.

## Peso

Estas imágenes las carga un teléfono en la pista, muchas veces con mala señal,
así que van a 1600 px de ancho y en WebP: ninguna pasa de ~110 KB. Si añades
otra, pásala por el mismo aro antes de subirla:

```bash
magick original.png -resize 1600x -strip -quality 80 nombre.webp
```

De la colección, hoy solo se usan dos: `pista-rc` (portada y cabeceras) y
`pase-rc` (el pase impreso). Las otras tres están preparadas para cuando hagan
falta; si pasado un tiempo siguen sin usarse, mejor quitarlas que arrastrarlas.
