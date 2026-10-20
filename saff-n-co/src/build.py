"""Build all Saff n Co deliverables: A4 boards (SVG/PDF/PNG) and logo files.

Run:  python3 build.py
Page 1 (Ronde 2): the four sketch directions digitised in black and white,
symbol + logotype, with the chosen direction marked.
Page 2 (Ronde 4): the chosen logo in four colour alternatives.
All text is converted to outlines so every SVG/PDF renders identically
without the fonts installed. Pencil sketch thumbnails are the only raster.
"""
import base64
import os
import shutil
from functools import lru_cache

import cairosvg
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

import symbol as sym

SRC = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SRC)
OUT = os.path.join(ROOT, "exports")
INTER = "/usr/share/fonts/opentype/inter/"
F = {
    "dlight": INTER + "InterDisplay-Light.otf",
    "light": INTER + "Inter-Light.otf",
    "med": INTER + "Inter-Medium.otf",
    "semi": INTER + "Inter-SemiBold.otf",
    "caladea": "/usr/share/fonts/truetype/crosextra/Caladea-Regular.ttf",
}

# Logotype pairing per direction: (font, text, tracking em, size relative to symbol height)
LOGOTYPE = {
    1: ("dlight", "SAFF N CO", 0.38, 0.20),
    2: ("caladea", "Saff n Co.", 0.05, 0.25),
    3: ("dlight", "saff n co", 0.10, 0.25),
    4: ("med", "SAFF N CO", 0.24, 0.165),
}

NOTES = {
    1: "Three puffs = awan. Top loop + bowl = &. Top loop + right puff = S.",
    2: "A spiral cloud flowing into a ribbon S, like scent drifting.",
    3: "The S initial curls like a cloud wisp; the tail is the trailing scent.",
    4: "One line draws the cloud and curls into an inner S; dot = scent drop.",
}

# Two-colour schemes: (code, name, mood, ink, ground). The whole logo is drawn in
# ink; ground is its paired background. Tone-on-tone pairs keep it soft but legible.
PALETTES = [
    ("A", "Airy Light Blue", "Fresh, airy, clean, soft premium", "#34587F", "#DDEBF6"),
    ("B", "Soft Neutral Premium", "Elegant, minimal, premium fragrance", "#6E5848", "#F2E9DD"),
    ("C", "Modern Youthful Premium", "Gen Z, stylish, modern, fresh", "#4C478A", "#E5E0F4"),
    ("D", "Fresh Luxe Accent", "Clean, elevated, slightly distinctive", "#2F5E57", "#DCE9E1"),
]


# ---------------------------------------------------------------- text
@lru_cache(None)
def _font(key):
    f = TTFont(F[key])
    return f.getGlyphSet(), f.getBestCmap(), f["head"].unitsPerEm, f["OS/2"].sCapHeight, f["OS/2"].sxHeight


def text_path(txt, key, size, track=0.0):
    """Outline text. Baseline at y=0. Returns (d, width, cap_height)."""
    gs, cmap, upm, cap, xh = _font(key)
    sc = size / upm
    x, out = 0.0, []
    for ch in txt:
        g = gs[cmap[ord(ch)]]
        if ch != " ":
            pen = SVGPathPen(gs, ntos=lambda v: f"{v:.3f}".rstrip("0").rstrip("."))
            g.draw(TransformPen(pen, (sc, 0, 0, -sc, x, 0)))
            out.append(pen.getCommands())
        x += g.width * sc + track * size
    # all-lowercase wordmarks sit on x-height, not cap height
    top = xh if txt == txt.lower() else cap
    return " ".join(out), x - track * size, top * sc


def text(txt, x, y, key, size, fill="#000", anchor="start", track=0.0):
    d, w, _ = text_path(txt, key, size, track)
    dx = {"start": 0, "middle": -w / 2, "end": -w}[anchor]
    return f'<path transform="translate({x + dx:.3f} {y:.3f})" fill="{fill}" d="{d}"/>'


# ---------------------------------------------------------------- logo
@lru_cache(None)
def geometry(sid, rough=False):
    return sym.build(sid, rough=rough)


def symbol_group(sid, cx, top, h, maxw=None, fills=None, gid=None, rough=False):
    """Symbol fitted into an h-tall (and optionally maxw-wide) box, centred on cx."""
    g = geometry(sid, rough)
    s = min(h / g["h"], (maxw or 1e9) / g["w"])
    tx, ty = cx - g["w"] * s / 2, top + (h - g["h"] * s) / 2
    fills = fills or {}
    paths = "".join(
        (f'<path id="{k}" ' if gid else "<path ") + f'fill="{fills.get(k, "#000")}" d="{d}"/>'
        for k, d in g["paths"])
    idattr = f' id="{gid}"' if gid else ""
    return f'<g{idattr} transform="translate({tx:.3f} {ty:.3f}) scale({s:.5f})">{paths}</g>'


def lockup(sid, cx, top, h, fills=None, ink="#000", gid=False):
    """Symbol in an h-tall box with the logotype centred below. Returns (svg, total height, width)."""
    key, word, track, rel = LOGOTYPE[sid]
    size = h * rel
    d, w, cap = text_path(word, key, size, track)
    gap = h * 0.18
    g = symbol_group(sid, cx, top, h, h * 1.6, fills, "symbol" if gid else None)
    base = top + h + gap + cap
    tid = ' id="logotype"' if gid else ""
    g += f'<path{tid} transform="translate({cx - w / 2:.3f} {base:.3f})" fill="{ink}" d="{d}"/>'
    sw = min(h * 1.6, geometry(sid)["w"] * h / geometry(sid)["h"])
    return g, h + gap + cap, max(w, sw)


# ---------------------------------------------------------------- page
PW, PH, M = 210, 297, 15
GRID_T, GRID_B = 42, 274
CW, CH = (PW - 2 * M) / 2, (GRID_B - GRID_T) / 2
GREY, LINE = "#8A8A8A", "#BDBDBD"


def page(body, title, subtitle, foot_left):
    head = (text("SAFF N CO", M, 22, "semi", 4.2, track=0.25)
            + text(title, M, 30.5, "light", 3.4)
            + text(subtitle, PW - M, 22, "med", 2.5, GREY, "end", 0.12)
            + text("Rebranding Parfum  /  Desain Logo", PW - M, 30.5, "light", 2.5, GREY, "end")
            + f'<line x1="{M}" y1="35" x2="{PW - M}" y2="35" stroke="#000" stroke-width="0.35"/>')
    frame = (f'<rect x="{M}" y="{GRID_T}" width="{PW - 2 * M}" height="{GRID_B - GRID_T}" fill="none" '
             f'stroke="{LINE}" stroke-width="0.3"/>'
             f'<line x1="{PW / 2}" y1="{GRID_T}" x2="{PW / 2}" y2="{GRID_B}" stroke="{LINE}" stroke-width="0.3"/>'
             f'<line x1="{M}" y1="{GRID_T + CH}" x2="{PW - M}" y2="{GRID_T + CH}" stroke="{LINE}" stroke-width="0.3"/>')
    foot = (f'<line x1="{M}" y1="{PH - 17}" x2="{PW - M}" y2="{PH - 17}" stroke="{LINE}" stroke-width="0.3"/>'
            + text(foot_left, M, PH - 12, "light", 2.4, GREY)
            + text("A4  210 x 297 mm  /  print at 100%", PW - M, PH - 12, "light", 2.4, GREY, "end"))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            f'width="{PW}mm" height="{PH}mm" viewBox="0 0 {PW} {PH}">'
            f'<rect width="{PW}" height="{PH}" fill="#fff"/>{frame}{body}{head}{foot}</svg>')


def cells():
    for i in range(4):
        yield i, M + (i % 2) * CW, GRID_T + (i // 2) * CH


def sketch_thumb(sid, right, top, maxw=22, maxh=20):
    """Pencil sketch (or, for the new direction, a rough digital sketch) in the cell corner."""
    src = sym.SYMBOLS[sid]["source"]
    if src:
        from PIL import Image
        p = os.path.join(SRC, "sketches", src + ".jpg")
        iw, ih = Image.open(p).size
        s = min(maxw / iw, maxh / ih)
        w, h = iw * s, ih * s
        data = base64.b64encode(open(p, "rb").read()).decode()
        art = (f'<image x="{right - w:.2f}" y="{top:.2f}" width="{w:.2f}" height="{h:.2f}" '
               f'preserveAspectRatio="none" xlink:href="data:image/jpeg;base64,{data}"/>')
        cap = "pencil sketch"
    else:
        w = h = maxh
        art = (f'<rect x="{right - w:.2f}" y="{top:.2f}" width="{w:.2f}" height="{h:.2f}" fill="#EFEFEF"/>'
               + symbol_group(sid, right - w / 2, top + 3, h - 6, w - 6, {"line": "#555", "drop": "#555"},
                              rough=True))
        cap = "new digital sketch"
    frame = (f'<rect x="{right - w:.2f}" y="{top:.2f}" width="{w:.2f}" height="{h:.2f}" fill="none" '
             f'stroke="{LINE}" stroke-width="0.2"/>')
    return art + frame + text(cap, right, top + h + 3, "light", 1.8, GREY, "end")


def alternatives_page():
    body = ""
    for i, x, y in cells():
        sid = i + 1
        cx = x + CW / 2
        chosen = sid == sym.CHOSEN
        body += text(f"ALTERNATIF 0{sid}", x + 7, y + 10, "semi", 3.0, track=0.14)
        body += text(sym.SYMBOLS[sid]["name"], x + 7, y + 15, "light", 2.5, GREY)
        if chosen:
            body += (f'<rect x="{x + 0.4}" y="{y + 0.4}" width="{CW - 0.8}" height="{CH - 0.8}" fill="none" '
                     f'stroke="#000" stroke-width="0.8"/>'
                     f'<rect x="{x + 7}" y="{y + 18.5}" width="27" height="4.6" rx="2.3" fill="#000"/>'
                     + text("TERPILIH  /  CHOSEN", x + 20.5, y + 21.6, "semi", 2.0, "#fff", "middle", 0.1))
        body += sketch_thumb(sid, x + CW - 7, y + 6)
        body += symbol_group(sid, cx, y + 31, 36, 58)
        body += f'<line x1="{x + 30}" y1="{y + 73}" x2="{x + CW - 30}" y2="{y + 73}" stroke="{LINE}" stroke-width="0.2"/>'
        g, _, _ = lockup(sid, cx, y + 78, 16)
        body += g
        body += text(NOTES[sid], cx, y + CH - 5, "light", 2.05, GREY, "middle")
    return page(body, "Ronde 2  /  4 Alternatif Logo Digital Hitam - Putih",
                "4 SKETCH DIRECTIONS  /  SYMBOL + LOGOTYPE",
                "Concept: awan (cloud) + ampersand & + initial S.  Alternatif 01 continues to Ronde 4.")


def color_page():
    body = ""
    c = sym.CHOSEN
    for (i, x, y), (code, name, mood, ink, ground) in zip(cells(), PALETTES):
        cx = x + CW / 2
        body += text(f"COLOR {code}  /  {name.upper()}", x + 7, y + 10, "semi", 3.0, track=0.1)
        body += text(mood, x + 7, y + 15, "light", 2.5, GREY)
        # main: full lockup in ink on its ground
        body += f'<rect x="{x + 8}" y="{y + 20}" width="{CW - 16}" height="60" rx="2" fill="{ground}"/>'
        g, _, _ = lockup(c, cx, y + 31, 27, solid(ink), ink)
        body += g
        # row: reversed symbol, symbol on white, two plain colour chips
        tw, gap, ty, th = (CW - 16 - 6) / 3, 3, y + 84, 24
        tx = [x + 8 + k * (tw + gap) for k in range(3)]
        body += f'<rect x="{tx[0]:.2f}" y="{ty}" width="{tw:.2f}" height="{th}" rx="2" fill="{ink}"/>'
        body += symbol_group(c, tx[0] + tw / 2, ty + 4, th - 8, tw - 6, solid(ground))
        body += (f'<rect x="{tx[1]:.2f}" y="{ty}" width="{tw:.2f}" height="{th}" rx="2" fill="#fff" '
                 f'stroke="{LINE}" stroke-width="0.2"/>')
        body += symbol_group(c, tx[1] + tw / 2, ty + 4, th - 8, tw - 6, solid(ink))
        chip = 8
        for k, col in enumerate((ink, ground)):
            body += (f'<rect x="{tx[2] + tw / 2 - chip - 1 + k * (chip + 2):.2f}" y="{ty + (th - chip) / 2}" '
                     f'width="{chip}" height="{chip}" rx="{chip / 2}" fill="{col}" stroke="{LINE}" stroke-width="0.15"/>')
    return page(body, "Ronde 4  /  4 Alternatif Warna + Skema Warna Logo Digital",
                "LOGO TERPILIH: ALTERNATIF 01  /  2 WARNA PER ALTERNATIF",
                "Same final geometry in every version; each scheme uses two colours only.")


def logo_file(sid, fills, ink, symbol_only=False, bg=None):
    h, pad = 200, 40
    if symbol_only:
        g = symbol_group(sid, 0, 0, h, h * 1.6, fills, "symbol")
        geo = geometry(sid)
        w_box = min(h * 1.6, geo["w"] * h / geo["h"])
        h_box = min(h, geo["h"] * w_box / geo["w"])
        top_off = (h - h_box) / 2
    else:
        g, h_box, w_box = lockup(sid, 0, 0, h, fills, ink, gid=True)
        top_off = 0
    vx, vy, vw, vh = -w_box / 2 - pad, top_off - pad, w_box + 2 * pad, h_box + 2 * pad
    # background sits on its own named layer so it can be deleted for a transparent logo
    r = (f'<rect id="background" x="{vx:.2f}" y="{vy:.2f}" width="{vw:.2f}" height="{vh:.2f}" fill="{bg}"/>'
         if bg else "")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vx:.2f} {vy:.2f} {vw:.2f} {vh:.2f}" '
            f'width="{vw:.0f}" height="{vh:.0f}"><title>Saff n Co</title>{r}{g}</svg>')


def solid(color):
    return {k: color for k in ("loop", "puff", "bowl", "spiral", "ribbon", "s", "line", "drop")}


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    for d in ("svg", "pdf", "png"):
        os.makedirs(os.path.join(OUT, d))
    for name, svg in (("Logo_Refinement_A4", alternatives_page()), ("Logo_Color_Alternatives_A4", color_page())):
        p = os.path.join(OUT, "svg", name + ".svg")
        open(p, "w").write(svg)
        cairosvg.svg2pdf(url=p, write_to=os.path.join(OUT, "pdf", name + ".pdf"))
        cairosvg.svg2png(url=p, write_to=os.path.join(OUT, "png", name + "_300dpi.png"), output_width=2480)

    c = sym.CHOSEN
    files = {
        "Logo_Final_Black": logo_file(c, solid("#000"), "#000"),
        "Logo_Final_White": logo_file(c, solid("#fff"), "#fff"),
        "Logo_Symbol_Black": logo_file(c, solid("#000"), "#000", symbol_only=True),
        "Logo_Symbol_White": logo_file(c, solid("#fff"), "#fff", symbol_only=True),
    }
    for code, name, _, ink, ground in PALETTES:
        files[f"Logo_Color_{code}_{name.replace(' ', '')}"] = logo_file(c, solid(ink), ink, bg=ground)
    for sid, spec in sym.SYMBOLS.items():
        files[f"Alt0{sid}_{spec['name'].replace(' ', '')}_Black"] = logo_file(sid, solid("#000"), "#000")
    for name, svg in files.items():
        p = os.path.join(OUT, "svg", name + ".svg")
        open(p, "w").write(svg)
        out = os.path.join(OUT, "png", name + ".png")
        if "White" in name:
            # preview the white logo on a dark ground; the SVG itself stays transparent
            svg = svg.replace("<title>", '<rect x="-9999" y="-9999" width="99999" height="99999" fill="#1E1E1E"/><title>')
        cairosvg.svg2png(bytestring=svg.encode(), write_to=out, output_width=3000)
    print("built", len(files) + 2, "svg files")


if __name__ == "__main__":
    main()
