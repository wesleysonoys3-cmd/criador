#!/usr/bin/env python3
"""
Gera app.icns para CriaSiteTiago SEM depender de PIL/cairosvg:
1) Constrói o PNG master 1024x1024 manualmente usando bytes.
2) Usa /usr/bin/sips para resize em 10 tamanhos padrão do iconset.
3) Usa /usr/bin/iconutil para converter em .icns.
"""
import os
import sys
import struct
import zlib
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ICONSET = ROOT / "_icon_tmp.iconset"
ICONSET.mkdir(parents=True, exist_ok=True)
for f in ICONSET.glob("*.png"):
    f.unlink()

SIZES = [
    (16,   "icon_16x16.png"),
    (32,   "icon_16x16@2x.png"),
    (32,   "icon_32x32.png"),
    (64,   "icon_32x32@2x.png"),
    (128,  "icon_128x128.png"),
    (256,  "icon_128x128@2x.png"),
    (256,  "icon_256x256.png"),
    (512,  "icon_256x256@2x.png"),
    (512,  "icon_512x512.png"),
    (1024, "icon_512x512@2x.png"),
]

# ---------- helpers ----------
def blend(a, b, t):
    return (
        int(a[0]*(1-t) + b[0]*t),
        int(a[1]*(1-t) + b[1]*t),
        int(a[2]*(1-t) + b[2]*t),
    )

def pack_png(path, W, H, rgb_pixels):
    """rgb_pixels: flat list of 3 bytes per pixel, row-major"""
    def chunk(ctype, data):
        return (struct.pack(">I", len(data)) + ctype + data +
                struct.pack(">I", zlib.crc32(ctype + data) & 0xffffffff))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)  # 8-bit RGB
    # filtro 0 por scanline
    raw = bytearray()
    stride = W*3
    for y in range(H):
        raw.append(0)
        raw.extend(rgb_pixels[y*stride:(y+1)*stride])
    idat = zlib.compress(bytes(raw), 9)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    Path(path).write_bytes(png)

# ---------- Cores (tema TRAE) ----------
BG_TOP       = (17, 22, 42)
BG_DARK      = (14, 16, 36)
BRAND        = (111, 124, 255)   # roxo
AMBER        = (251, 191, 36)    # pasta
GREEN        = (16, 185, 129)    # SOLO
WHITE        = (245, 247, 250)
MUTED        = (172, 180, 220)

SIZE = 1024
# Fundo com gradiente radial
W = H = SIZE
cx, cy = W*0.50, H*0.54
rmax = (W**2 + H**2) ** 0.5 * 0.72
pixels = bytearray(W*H*3)
for y in range(H):
    for x in range(W):
        dx, dy = x-cx, y-cy
        t = min(1.0, ((dx*dx+dy*dy)**0.5)/rmax)
        # centro (roxo brand suave) -> borda (bg escuro)
        c_center = (36, 32, 95)
        c_edge   = BG_DARK
        r,g,b = blend(c_center, c_edge, t)
        # gradiente vertical suave
        r2,g2,b2 = blend((18, 21, 44), (12, 14, 30), y/H)
        r,g,b = blend((r,g,b), (r2,g2,b2), 0.35)
        idx = (y*W + x)*3
        pixels[idx:idx+3] = bytes((r,g,b))

# Retângulo arredondado (máscara + sombra + janela IDE)
def rounded_rect_mask(W_,H_,r):
    """Return bytearray 0/1 alpha mask of rounded rect."""
    out = bytearray(W_*H_)
    for y in range(H_):
        for x in range(W_):
            inside = True
            if x < r and y < r:
                inside = (x-r)**2+(y-r)**2 <= r*r
            elif x >= W_-r and y < r:
                inside = (x-(W_-1-r))**2+(y-r)**2 <= r*r
            elif x < r and y >= H_-r:
                inside = (x-r)**2+(y-(H_-1-r))**2 <= r*r
            elif x >= W_-r and y >= H_-r:
                inside = (x-(W_-1-r))**2+(y-(H_-1-r))**2 <= r*r
            if inside:
                out[y*W_+x] = 1
    return out

def draw_rounded_rect(pixels, W, x, y, w, h, color, radius=0, alpha=1.0):
    mask = rounded_rect_mask(w, h, radius)
    for j in range(h):
        yy = y + j
        if yy < 0 or yy >= W: continue
        for i in range(w):
            xx = x + i
            if xx < 0 or xx >= W: continue
            if mask[j*w+i]:
                idx = (yy*W + xx)*3
                if alpha < 0.999:
                    src = pixels[idx:idx+3]
                    mixed = (
                        int(src[0]*(1-alpha) + color[0]*alpha),
                        int(src[1]*(1-alpha) + color[1]*alpha),
                        int(src[2]*(1-alpha) + color[2]*alpha),
                    )
                    pixels[idx:idx+3] = bytes(mixed)
                else:
                    pixels[idx:idx+3] = bytes(color)
    return pixels

# Sombra janela
draw_rounded_rect(pixels, W, 108, 184, 808, 510, (0,0,0), radius=44, alpha=0.32)
# Janela IDE
draw_rounded_rect(pixels, W, 100, 170, 808, 510, (21, 25, 48), radius=44, alpha=1.0)
# Borda brilhante brand
draw_rounded_rect(pixels, W, 100, 170, 808, 510, BRAND, radius=44, alpha=0.08)
# Barra título
draw_rounded_rect(pixels, W, 100, 170, 808, 62, (30, 34, 60), radius=44, alpha=1.0)
# 3 pontinhos
def draw_circle(pixels, W, cx, cy, r, color):
    for y in range(cy-r, cy+r+1):
        for x in range(cx-r, cx+r+1):
            if x < 0 or y < 0 or x >= W or y >= W: continue
            if (x-cx)**2+(y-cy)**2 <= r*r:
                idx = (y*W + x)*3
                pixels[idx:idx+3] = bytes(color)

draw_circle(pixels, W, 150, 201, 12, (246, 86, 86))
draw_circle(pixels, W, 190, 201, 12, (251, 191, 36))
draw_circle(pixels, W, 230, 201, 12, (16, 185, 129))

# Pasta amarela (folder)
draw_rounded_rect(pixels, W, 185, 354, 180, 154, AMBER, radius=14, alpha=1.0)
draw_rounded_rect(pixels, W, 185, 310, 100, 48, (217, 150, 9), radius=14, alpha=1.0)

# Tag verde "Cria" estilo botão SOLO
draw_rounded_rect(pixels, W, 604, 472, 250, 72, GREEN, radius=18, alpha=0.18)
draw_rounded_rect(pixels, W, 604, 472, 250, 72, GREEN, radius=18, alpha=0.08)

# Símbolo "</>" roxo brand (2 triângulos)
def draw_triangle(pixels, W, pts, color, alpha=1.0):
    # bounding box
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    x0,x1 = max(0,min(xs)-1), min(W-1,max(xs)+1)
    y0,y1 = max(0,min(ys)-1), min(W-1,max(ys)+1)
    (x2,y2),(x3,y3),(x4,y4) = pts
    for y in range(y0, y1+1):
        for x in range(x0, x1+1):
            # teste bary simples: 3 sinais de half-plane
            def sign(p1x,p1y,p2x,p2y,p3x,p3y):
                return (p1x-p3x)*(p2y-p3y)-(p2x-p3x)*(p1y-p3y)
            d1 = sign(x,y,x2,y2,x3,y3)
            d2 = sign(x,y,x3,y3,x4,y4)
            d3 = sign(x,y,x4,y4,x2,y2)
            has_neg = (d1<0) or (d2<0) or (d3<0)
            has_pos = (d1>0) or (d2>0) or (d3>0)
            if not (has_neg and has_pos):
                idx = (y*W + x)*3
                if alpha < 0.999:
                    src = pixels[idx:idx+3]
                    mixed = (
                        int(src[0]*(1-alpha) + color[0]*alpha),
                        int(src[1]*(1-alpha) + color[1]*alpha),
                        int(src[2]*(1-alpha) + color[2]*alpha),
                    )
                    pixels[idx:idx+3] = bytes(mixed)
                else:
                    pixels[idx:idx+3] = bytes(color)

# "<"
draw_triangle(pixels, W, [(438,330),(398,385),(438,440)], BRAND)
# ">"
draw_triangle(pixels, W, [(520,330),(560,385),(520,440)], BRAND)

# Letras: "Cria" (dentro do tag verde), fonte pixel simplificada
# Vamos desenhar pequenos caracteres 7px tall em escala g 6x  = 42px total
TEXT_BIG = [
    ("Cria", 604+20, 472+16, (110,231,183), 6, 1),
]
APP_NAME = [
    ("CriaSiteTiago", None, 800, WHITE, 10, 2),
    ("agente autonomo · estilo TRAE", None, 888, MUTED, 4, 1),
]

# Fonte 5x7 (núcleo, letras ASCII usadas)
FONT_5x7 = {
    'C': ["01110","10001","10000","10000","10000","10001","01110"],
    'r': ["00000","00000","01110","01001","01000","01000","01000"],
    'i': ["00100","00000","01100","00100","00100","00100","01110"],
    'a': ["00000","00000","01110","00001","01111","10001","01111"],
    'S': ["01110","10001","10000","01110","00001","10001","01110"],
    't': ["00100","00100","11111","00100","00100","00101","00010"],
    'e': ["00000","00000","01110","10001","11111","10000","01110"],
    'T': ["11111","00100","00100","00100","00100","00100","00100"],
    'g': ["00000","00000","01111","10001","10001","01111","00001","01110"],
    'o': ["00000","00000","01110","10001","10001","10001","01110"],
    'n': ["00000","00000","10110","11001","10001","10001","10001"],
    'm': ["00000","00000","10001","11011","10101","10001","10001"],
    'u': ["00000","00000","10001","10001","10001","10001","01111"],
    'l': ["01100","00100","00100","00100","00100","00100","01110"],
    '·': ["000","000","000","111","000","000","000"],
    ' ': ["00000","00000","00000","00000","00000","00000","00000"],
    'E': ["11111","10000","10000","11110","10000","10000","11111"],
    'R': ["11110","10001","10001","11110","10100","10010","10001"],
    'A': ["01110","10001","10001","11111","10001","10001","10001"],
}
FONT_5x7['C'][0] = "01110"
FONT_5x7['g'] = ["00000","00000","01111","10001","10001","01111","00001"]

def draw_text(pixels, W, text, ox, oy, color, scale=4, line=7):
    cursor = ox
    for ch in text:
        glyph = FONT_5x7.get(ch, FONT_5x7[' '])
        gw = len(glyph[0])
        for j, row in enumerate(glyph):
            for i, px in enumerate(row):
                if px == '1':
                    for yy in range(scale):
                        for xx in range(scale):
                            x = cursor + i*scale + xx
                            y = oy + j*scale + yy
                            if 0 <= x < W and 0 <= y < W:
                                idx = (y*W + x)*3
                                pixels[idx:idx+3] = bytes(color)
        cursor += (gw+1)*scale
    return cursor

# Calcular largura para centralizar "Cria" dentro tag
def text_width(text, scale):
    w = 0
    for ch in text:
        glyph = FONT_5x7.get(ch, FONT_5x7[' '])
        gw = len(glyph[0])
        w += (gw+1)*scale
    return max(0, w - scale)

# Desenhar "Cria" centralizado no tag verde 250×72 x=604
t = "Cria"
sc = 6
tw = text_width(t, sc)
x_start = 604 + (250 - tw)//2
draw_text(pixels, W, t, x_start, 472 + (72 - 7*sc)//2, (110,231,183), scale=sc)

# "CriaSiteTiago" centralizado abaixo
t = "CriaSiteTiago"
sc = 10
tw = text_width(t, sc)
x_start = (SIZE - tw)//2
draw_text(pixels, W, t, x_start, 800, WHITE, scale=sc)

# "agente autonomo · estilo TRAE"
t = "agente autonomo · estilo TRAE"
sc = 5
tw = text_width(t, sc)
x_start = (SIZE - tw)//2
draw_text(pixels, W, t, x_start, 895, MUTED, scale=sc)

# Salvar PNG master
MASTER = ROOT / "_icon_master_1024.png"
pack_png(str(MASTER), W, H, bytes(pixels))
print("✅ PNG master 1024x1024 em:", MASTER)

# Gerar todos tamanhos via sips
for sz, fname in SIZES:
    out = ICONSET / fname
    subprocess.run([
        "sips", "-z", str(sz), str(sz),
        str(MASTER), "--out", str(out)
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # sips por default não dá overwrite? garantir que existe
    if not out.exists():
        # fallback: copiar o master com nome e depois rezize
        subprocess.run(["cp", str(MASTER), str(out)], check=True)
        subprocess.run([
            "sips", "-z", str(sz), str(sz), str(out)
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("  -", fname, " ", out.stat().st_size, "bytes")

# .icns
DEST_ICNS = ROOT / "app.icns"
if DEST_ICNS.exists():
    DEST_ICNS.unlink()
subprocess.run(["iconutil", "-c", "icns", str(ICONSET), "-o", str(DEST_ICNS)], check=True)
print("✅ Ícone macOS final:", DEST_ICNS, DEST_ICNS.stat().st_size, "bytes")
