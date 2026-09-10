# Colección visual de Racing Hobbies

Escenas originales para banners y pases, sin marcas de terceros ni texto
incrustado. Todas mantienen el azul marino, naranja y negro de Racing Hobbies.

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
