#!/usr/bin/env python3
"""
Gerador de ícone CriaSiteTiago.app — renderiza PNG 1024x1024 com PIL (se disponível),
senão usa SIPS + SVG fallback.  Produz _icon_tmp.iconset/ com todos os 10 tamanhos
padrão macOS, depois roda iconutil para gerar app.icns.
"""
import os
import sys
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ICONSET = ROOT / "_icon_tmp.iconset"
ICONSET.mkdir(exist_ok=True)

# -------------------- CORES (paleta TRAE) --------------------
BG_TOP       = (17, 22, 42)     # slate-950
BG_BOT       = (47, 29, 89)     # roxo brand escuro
ACCENT_A     = (111, 124, 255)  # roxo brand
ACCENT_B     = (251, 191, 36)   # amarelo (ícone pasta)
ACCENT_C     = (20, 184, 166)   # verde SOLO (é a "A" de agente)
WHITE        = (245, 247, 250)

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

def blend(c1, c2, t):
    return tuple(int(c1[i]*(1-t) + c2[i]*t) for i in range(3))

def radial_gradient(size):
    """Retorna bytes RGBA 1024x1024 (ou size×size) com radial de fundo."""
    W = H = size
    cx, cy = W * 0.5, H * 0.55
    r_max = ((W**2)+(H**2))**0.5 * 0.7
    out = bytearray(W*H*4)
    for y in range(H):
        for x in range(W):
            dx, dy = x-cx, y-cy
            t = min(1.0, ((dx*dx+dy*dy)**0.5)/r_max)
            r,g,b = blend((28, 33, 68), BG_TOP, t*0.6)
            # roxo brand no centro
            if t < 0.55:
                s = t / 0.55
                r,g,b = blend((60, 45, 130), (r,g,b), s)
            idx = (y*W + x)*4
            out[idx:idx+3] = bytes((r,g,b))
            out[idx+3]  = 255
    return bytes(out)

def draw_rect(data, W, x, y, w, h, rgba, radius=0):
    # Preenche retângulo arredondado (sem AA pesado, suficiente para ícone)
    r2 = radius*radius
    for j in range(h):
        yy = y + j
        if yy < 0 or yy >= W: continue
        for i in range(w):
            xx = x + i
            if xx < 0 or xx >= W: continue
            # Checa canto
            inside = True
            if radius > 0:
                cxr, cyr = None, None
                if i < radius and j < radius:
                    cxr, cyr = radius, radius
                elif i >= w-radius and j < radius:
                    cxr, cyr = w-1-radius, radius
                elif i < radius and j >= h-radius:
                    cxr, cyr = radius, h-1-radius
                elif i >= w-radius and j >= h-radius:
                    cxr, cyr = w-1-radius, h-1-radius
                if cxr is not None:
                    if (i-cxr)**2 + (j-cyr)**2 > r2:
                        inside = False
            if inside:
                idx = (yy*W + xx)*4
                data[idx:idx+3] = rgba[:3]
                if len(rgba) == 4:
                    data[idx+3] = rgba[3]
                else:
                    data[idx+3] = 255
    return data

def draw_text_pil(img, text, font_size, y, color, weight="bold"):
    from PIL import ImageDraw, ImageFont
    draw = ImageDraw.Draw(img)
    font = None
    for path in [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
    ]:
        if os.path.exists(path):
            try:
                font = ImageFont.truetype(path, font_size)
                break
            except Exception:
                pass
    if font is None:
        try:
            font = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", font_size)
        except Exception:
            font = ImageFont.load_default()
    bbox = draw.textbbox((0,0), text, font=font)
    tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
    draw.text(((img.width - tw)//2 - bbox[0], y - bbox[1]), text, fill=color, font=font)
    return tw, th

try:
    from PIL import Image
    HAS_PIL = True
except Exception:
    HAS_PIL = False


if HAS_PIL:
    SIZE = 1024
    raw = radial_gradient(SIZE)
    img = Image.frombytes("RGBA", (SIZE, SIZE), raw)
    px = SIZE
    # ---------- Cartela / janela estilo IDE TRAE ----------
    pad = int(px*0.10)
    w = px - 2*pad
    h = int(px*0.58)
    x0 = pad
    y0 = int(px*0.17)
    data = bytearray(img.tobytes())
    # Sombra suave (retângulo maior, alpha baixo)
    draw_rect(data, px, x0+8, y0+14, w, h, (0,0,0,110), radius=int(px*0.038))
    # Janela
    draw_rect(data, px, x0, y0, w, h, (22, 26, 48, 255), radius=int(px*0.032))
    # Barra título
    draw_rect(data, px, x0, y0, w, int(px*0.055), (32,37,66,255), radius=int(px*0.032))
    # 3 pontinhos vermelho/amarelo/verde
    dot_r = max(3, int(px*0.012))
    for i,col in enumerate([(246,71,71),(251,191,36),(16,185,129)]):
        cxx = x0 + int(px*0.042) + i*int(px*0.032)
        cyy = y0 + int(px*0.027)
        for dy in range(-dot_r, dot_r+1):
            for dx in range(-dot_r, dot_r+1):
                if dx*dx+dy*dy <= dot_r*dot_r:
                    xx, yy = cxx+dx, cyy+dy
                    idx = (yy*px + xx)*4
                    data[idx:idx+3] = col
                    data[idx+3]   = 255
    # Pasta amarela (TRAE folder) dentro da janela
    fx = x0 + int(w*0.08)
    fy = y0 + int(h*0.32)
    fw = int(w*0.26)
    fh = int(h*0.32)
    draw_rect(data, px, fx, fy+int(fh*0.12), fw, int(fh*0.88), ACCENT_B + (255,), radius=int(px*0.010))
    # Aba da pasta
    draw_rect(data, px, fx, fy, int(fw*0.48), int(fh*0.22), (217, 150, 9, 255), radius=int(px*0.008))
    # Símbolo "</>" no canto direito do folder
    bx0 = fx + fw + int(w*0.045)
    by0 = fy + int(fh*0.08)
    bw = int(w*0.07)
    bh = int(fh*0.84)
    # Triângulo esquerdo <
    for j in range(bh):
        for i in range(bw):
            if i <= j*(bw/(bh*0.9+1)) and i <= (bh-1-j)*(bw/(bh*0.9+1)):
                xx, yy = bx0+i, by0+j
                idx = (yy*px + xx)*4
                data[idx:idx+3] = ACCENT_A
                data[idx+3] = 255
    # Triângulo direito >
    bx2 = bx0 + bw + int(w*0.02)
    for j in range(bh):
        for i in range(bw):
            if i >= j*(bw/(bh*0.9+1))-0.5 and i >= (bh-1-j)*(bw/(bh*0.9+1))-0.5:
                xx, yy = bx2+i, by0+j
                idx = (yy*px + xx)*4
                data[idx:idx+3] = ACCENT_A
                data[idx+3] = 255

    # Texto "Cria" no verde SOLO (tipo tag de ação), estilo botão TRAE
    tag_w = int(w*0.30)
    tag_h = int(h*0.14)
    tx0 = x0 + w - tag_w - int(w*0.06)
    ty0 = fy + fh + int(h*0.06)
    draw_rect(data, px, tx0, ty0, tag_w, tag_h, (16, 185, 129, 35), radius=int(px*0.014))
    # depois desenhar texto com PIL
    img = Image.frombytes("RGBA", (px, px), bytes(data))
    # Escrever "Cria" dentro do tag verde
    draw_text_pil(img, "Cria", max(14, int(px*0.034)), ty0+int(tag_h*0.12), (110, 231, 183))
    # Título abaixo da janela: CriaSiteTiago
    draw_text_pil(img, "CriaSiteTiago", int(px*0.082), int(px*0.78), WHITE)
    # Subtítulo
    draw_text_pil(img, "agente autônomo · estilo TRAE", int(px*0.032), int(px*0.88), (180, 190, 220))
    big = img.resize((1024, 1024), Image.LANCZOS)
else:
    # ---------- FALLBACK: SVG -> PNG via cairosvg / qlmanage ----------
    import textwrap
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stop-color="#1f1b4a"/>
          <stop offset="55%" stop-color="#161a33"/>
          <stop offset="100%" stop-color="#0d1024"/>
        </linearGradient>
        <radialGradient id="halo" cx="50%" cy="58%" r="60%">
          <stop offset="0%" stop-color="#6f7cff" stop-opacity="0.45"/>
          <stop offset="100%" stop-color="#6f7cff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1024" height="1024" rx="200" fill="url(#bg)"/>
      <rect width="1024" height="1024" rx="200" fill="url(#halo)"/>
      <!-- Janela IDE -->
      <rect x="110" y="172" width="804" height="500" rx="44" fill="#171a30" stroke="#6f7cff" stroke-opacity="0.35" stroke-width="3"/>
      <rect x="110" y="172" width="804" height="62"  rx="44" fill="#202542"/>
      <circle cx="156" cy="203" r="12" fill="#f55454"/>
      <circle cx="196" cy="203" r="12" fill="#fbbf24"/>
      <circle cx="236" cy="203" r="12" fill="#10b981"/>
      <!-- Pasta amarela -->
      <g transform="translate(180 310)">
        <rect x="0" y="40" width="180" height="150" rx="14" fill="#fbbf24"/>
        <rect x="0" y="0"  width="95"  height="48"  rx="14" fill="#d99609"/>
      </g>
      <!-- Símbolo </> -->
      <g fill="#6f7cff">
        <path d="M 430 330 L 400 380 L 430 430 L 455 430 L 425 380 L 455 330 Z"/>
        <path d="M 540 330 L 510 380 L 540 430 L 565 430 L 535 380 L 565 330 Z"/>
      </g>
      <!-- Tag verde Cria -->
      <rect x="616" y="472" width="230" height="70" rx="18" fill="#10b981" fill-opacity="0.18"/>
      <text x="731" y="518" font-family="Arial, sans-serif" font-size="38" font-weight="700" text-anchor="middle" fill="#6ee7b7">Cria</text>
      <!-- Nome do app abaixo -->
      <text x="512" y="800" font-family="Arial, sans-serif" font-size="86" font-weight="800" text-anchor="middle" fill="#f5f7fa">CriaSiteTiago</text>
      <text x="512" y="870" font-family="Arial, sans-serif" font-size="32" font-weight="500" text-anchor="middle" fill="#b4bcdc">agente autônomo · estilo TRAE</text>
    </svg>"""
    svg_path = ROOT / "_icon_tmp.svg"
    svg_path.write_text(svg, encoding="utf-8")
    # tentar cairosvg, senão renderizar via qlmanage / sips é mais complicado;
    # tentar PIL+svg2png, senão gerar um PNG vazio de fundo e usar ícone
    try:
        import cairosvg
        cairosvg.svg2png(bytestring=svg.encode('utf-8'), write_to=str(ROOT/"_icon_tmp_master.png"), output_width=1024, output_height=1024)
    except Exception:
        # Fallback super simples: criar PNG via PIL apenas cores + texto
        from PIL import Image, ImageDraw, ImageFont
        SIZE=1024
        img = Image.new("RGBA",(SIZE,SIZE), BG_TOP + (255,))
        draw = ImageDraw.Draw(img)
        draw.rounded_rectangle([0,0,SIZE,SIZE], radius=SIZE//5, fill=BG_TOP)
        draw.rounded_rectangle([110,172,914,672], radius=44, fill=(23,26,48,255), outline=ACCENT_A + (90,), width=3)
        draw.ellipse([144,191,168,215], fill=(245,84,84))
        draw.ellipse([184,191,208,215], fill=ACCENT_B)
        draw.ellipse([224,191,248,215], fill=ACCENT_C)
        draw.rounded_rectangle([180,348,360,500], radius=14, fill=ACCENT_B + (255,))
        draw.rounded_rectangle([180,310,276,358], radius=14, fill=(217,150,9,255))
        draw.polygon([(430,330),(400,380),(430,430),(455,430),(425,380),(455,330)], fill=ACCENT_A)
        draw.polygon([(540,330),(510,380),(540,430),(565,430),(535,380),(565,330)], fill=ACCENT_A)
        draw.rounded_rectangle([616,472,846,542], radius=18, fill=(16,185,129,46))
        # Texto
        for pth in ["/System/Library/Fonts/Supplemental/Arial Bold.ttf","/System/Library/Fonts/Supplemental/Arial.ttf"]:
            if os.path.exists(pth):
                break
        fnt_big = ImageFont.truetype(pth, 86) if os.path.exists(pth) else ImageFont.load_default()
        fnt_med = ImageFont.truetype(pth, 40) if os.path.exists(pth) else ImageFont.load_default()
        fnt_sm  = ImageFont.truetype(pth, 36) if os.path.exists(pth) else ImageFont.load_default()
        draw.text((731 - 80, 483), "Cria", fill=(110,231,183), font=fnt_sm)
        bbox = draw.textbbox((0,0),"CriaSiteTiago", font=fnt_big)
        tw = bbox[2]-bbox[0]
        draw.text(((SIZE-tw)//2, 800), "CriaSiteTiago", fill=WHITE, font=fnt_big)
        bbox2 = draw.textbbox((0,0),"agente autônomo · estilo TRAE", font=fnt_sm)
        tw2 = bbox2[2]-bbox2[0]
        draw.text(((SIZE-tw2)//2, 880), "agente autônomo · estilo TRAE", fill=(180,190,220), font=fnt_sm)
    big_path = ROOT/"_icon_tmp_master.png"
    img.save(str(big_path), "PNG")
    big = Image.open(str(big_path)).convert("RGBA")

# -------------------- Gerar todos tamanhos do iconset --------------------
W_MASTER = H_MASTER = 1024
master = big.resize((W_MASTER, H_MASTER), Image.LANCZOS)
for size, fname in SIZES:
    resized = master.resize((size, size), Image.LANCZOS)
    resized.save(str(ICONSET / fname), "PNG")

# Converter iconset -> .icns
subprocess.run(
    ["iconutil", "-c", "icns", str(ICONSET), "-o", str(ROOT / "app.icns")],
    check=True,
)
print("✅ Ícone gerado em:", ROOT / "app.icns")
