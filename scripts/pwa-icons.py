"""
Genera los iconos de la PWA a partir del logo real (public/logo-teia.png).

Por que un MONOGRAMA y no el wordmark: el logo es apaisado (2432x273, ratio 8.9:1). Metido en
un cuadrado queda diminuto e ilegible a 48px. La "T" inicial mide 227x257 (casi cuadrada), asi
que llena el icono y conserva la tipografia autentica de la marca — no se redibuja nada.

Dos identidades para que se distingan en la pantalla de inicio:
  cliente (la tienda)  = fondo crema  + T oscura   (fiel a la marca)
  admin   (el panel)   = fondo oscuro + T crema    (inversa, se reconoce de un vistazo)

Tecnica: se usa el CANAL ALFA del glifo como mascara y se pega un color solido. El alfa viene
del logo en alta resolucion y se baja con LANCZOS, asi que los bordes quedan suaves sin depender
del antialiasing de dibujo de Pillow (que no lo tiene).

Uso:  python scripts/pwa-icons.py
"""
from PIL import Image
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
LOGO = RAIZ / "public" / "logo-teia.png"
SALIDA = RAIZ / "public" / "icons"

CREMA = (244, 236, 222)   # --bg  #F4ECDE
OSCURO = (45, 33, 25)     # color muestreado del logo #2D2119

# Caja de la "T" en el PNG original (medida sobre el canal alfa: x 8-234, y 8-264).
CAJA_T = (8, 8, 235, 265)

# Que porcion de la altura del icono ocupa la letra.
#   normal   : icono cuadrado completo, la letra respira
#   maskable : Android recorta a un circulo; la zona segura es el 80% central,
#              asi que la letra va mas chica para que no se coma los bordes
ALTO_NORMAL = 0.52
ALTO_MASKABLE = 0.40


def glifo_alfa():
    """El alfa de la 'T' recortada, en alta resolucion."""
    return Image.open(LOGO).convert("RGBA").crop(CAJA_T).split()[3]


def icono(lado, fondo, tinta, alfa, fraccion):
    lienzo = Image.new("RGB", (lado, lado), fondo)  # RGB = opaco (iOS no admite transparencia)
    alto = max(1, round(lado * fraccion))
    ancho = max(1, round(alto * alfa.width / alfa.height))
    mascara = alfa.resize((ancho, alto), Image.LANCZOS)
    capa = Image.new("RGB", (ancho, alto), tinta)
    lienzo.paste(capa, ((lado - ancho) // 2, (lado - alto) // 2), mascara)
    return lienzo


def main():
    SALIDA.mkdir(parents=True, exist_ok=True)
    alfa = glifo_alfa()

    temas = {
        "cliente": (CREMA, OSCURO),
        "admin": (OSCURO, CREMA),
    }

    hechos = []
    for nombre, (fondo, tinta) in temas.items():
        # normales (Chrome pide 192 y 512) + apple-touch (180, opaco) + favicon
        for lado in (192, 512):
            p = SALIDA / f"{nombre}-{lado}.png"
            icono(lado, fondo, tinta, alfa, ALTO_NORMAL).save(p, optimize=True)
            hechos.append(p)
        p = SALIDA / f"{nombre}-maskable-512.png"
        icono(512, fondo, tinta, alfa, ALTO_MASKABLE).save(p, optimize=True)
        hechos.append(p)
        p = SALIDA / f"{nombre}-apple-180.png"
        icono(180, fondo, tinta, alfa, ALTO_NORMAL).save(p, optimize=True)
        hechos.append(p)

    # favicon del sitio: la identidad de la tienda
    p = SALIDA / "favicon-32.png"
    icono(32, CREMA, OSCURO, alfa, 0.62).save(p, optimize=True)  # a 32px la letra necesita mas cuerpo
    hechos.append(p)

    for p in hechos:
        print("  " + p.relative_to(RAIZ).as_posix() + "  " + str(p.stat().st_size) + " bytes")
    print("listo: " + str(len(hechos)) + " archivos")


if __name__ == "__main__":
    main()
