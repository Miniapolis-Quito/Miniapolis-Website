#!/usr/bin/env python3
"""Gradúa las fotos de la portada para que todas tengan la misma estética.

Las fotos del recinto llegaron de cámaras y momentos distintos: unas cálidas,
otras frías, unas lavadas y otras muy contrastadas. Esta gradación las lleva
a todas al mismo punto, la noche de carrera de la marca:

  1. Balance de blancos neutro, medido en lo que debería ser gris (paredes,
     asfalto): fuera los tintes cálidos o fríos de cada toma.
  2. Los mismos puntos de negro y de blanco.
  3. La misma exposición media.
  4. El mismo contraste (una curva en S suave).
  5. La saturación a un nivel común, sin pasarse en las vivas.
  6. Un mismo matiz: sombras frías y luces apenas cálidas.
  7. Una viñeta suave, la misma en todas.

Uso, desde la raíz del repositorio (necesita numpy y Pillow):

    python3 scripts/gradar-fotos.py public/images pista/foto-nueva.webp [...]

Cada foto maestra se gradúa en su sitio y sus variantes de tamaño
(foto-640.webp, foto-960.webp, foto-1440.webp) y su respaldo .jpeg, si los
hay, se rehacen desde ella. Se aplica una sola vez, sobre la foto original:
gradar una foto ya graduada la vuelve a mover.
"""
import glob
import os
import sys

import numpy as np
from PIL import Image

OBJETIVO_LUM = 0.40      # exposición media común
OBJETIVO_SAT = 0.095     # saturación mediana común
NEGRO, BLANCO = 0.018, 0.965


def luminancia(a):
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def saturacion(a):
    mx = a.max(-1)
    mn = a.min(-1)
    return np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0)


def gradar(a):
    # 1. Balance de blancos con lo que debería ser gris.
    lum = luminancia(a)
    sat = saturacion(a)
    gris = (sat < 0.22) & (lum > 0.12) & (lum < 0.92)
    if gris.sum() < 500:
        gris = lum > 0
    medias = a[gris].mean(0)
    a = a * (medias[1] / medias)[None, None, :]
    a = np.clip(a, 0, 1)
    # 2. Puntos de negro y de blanco comunes.
    lum = luminancia(a)
    p0, p1 = np.percentile(lum, 0.4), np.percentile(lum, 99.6)
    a = np.clip((a - p0) / max(p1 - p0, 1e-3), 0, 1) * (BLANCO - NEGRO) + NEGRO
    # 3. Exposición: la mediana de luminancia a la misma altura.
    med = np.median(luminancia(a))
    gamma = np.log(OBJETIVO_LUM) / np.log(np.clip(med, 0.05, 0.95))
    a = np.clip(a, 1e-6, 1) ** gamma
    # 4. Contraste: una curva en S suave, igual para todas.
    s = a * a * (3 - 2 * a)
    a = a + 0.28 * (s - a)
    # 5. Saturación a un nivel común (sin pasarse en las ya vivas ni apagar del todo las grises).
    lum = luminancia(a)[..., None]
    med_sat = np.median(saturacion(a))
    f = np.clip((OBJETIVO_SAT / max(med_sat, 1e-3)) ** 0.7, 0.55, 1.12)
    a = lum + f * (a - lum)
    # 6. Sombras frías y luces apenas cálidas: un mismo matiz para todas.
    lum = luminancia(np.clip(a, 0, 1))[..., None]
    sombra = (1 - lum) ** 2
    luz = lum ** 3
    a = a + sombra * np.array([-0.022, 0.004, 0.030]) + luz * np.array([0.012, 0.004, -0.010])
    alto, ancho = a.shape[:2]
    y, x = np.ogrid[:alto, :ancho]
    r = np.sqrt(((x - ancho / 2) / (ancho / 2)) ** 2 + ((y - alto / 2) / (alto / 2)) ** 2) / np.sqrt(2)
    a = a * (1 - 0.16 * np.clip((r - 0.45) / 0.55, 0, 1) ** 2)[..., None]
    return np.clip(a, 0, 1)


if __name__ == '__main__':
    raiz = sys.argv[1]
    for rel in sys.argv[2:]:
        ruta = os.path.join(raiz, rel)
        base = ruta[: -len('.webp')]
        a = np.asarray(Image.open(ruta).convert('RGB')).astype(np.float32) / 255
        graduada = Image.fromarray((gradar(a) * 255 + 0.5).astype(np.uint8))
        graduada.save(ruta, 'WEBP', quality=86, method=6)
        hechas = [os.path.basename(ruta)]
        for variante in sorted(glob.glob(base + '-*.webp')):
            sufijo = variante[len(base) + 1 : -len('.webp')]
            if not sufijo.isdigit():
                continue
            ancho = int(sufijo)
            alto = round(graduada.height * ancho / graduada.width)
            graduada.resize((ancho, alto), Image.LANCZOS).save(variante, 'WEBP', quality=84, method=6)
            hechas.append(os.path.basename(variante))
        if os.path.exists(base + '.jpeg'):
            graduada.save(base + '.jpeg', 'JPEG', quality=84, optimize=True, progressive=True)
            hechas.append(os.path.basename(base) + '.jpeg')
        print(' '.join(hechas))
