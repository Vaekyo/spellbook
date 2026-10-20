"""Build all Saff n Co deliverables: A4 boards (SVG/PDF/PNG) and logo files.

Run:  python3 build.py
All text is converted to outlines so every SVG/PDF renders identically
without the fonts installed.
"""
import os
from functools import lru_cache

import cairosvg
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

import symbol as sym

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "exports")
FONTS = "/usr/share/fonts/opentype/inter/"
F = {
    "reg": FONTS + "Inter-Regular.otf",
    "light": FONTS + "Inter-Light.otf",
    "dlight": FONTS + "InterDisplay-Light.otf",
    "dreg": FONTS + "InterDisplay-Regular.otf",
    "semi": FONTS + "Inter-SemiBold.otf",
    "med": FONTS + "Inter-Medium.otf",
}

BRAND = "SAFF N CO"

# Logotype evolves with the symbol: (font, tracking in em)
LOGOTYPE = {1: ("reg", 0.10), 2: ("light", 0.20), 3: ("dlight", 0.30), 4: ("dlight", 0.38)}

STAGES = {
    1: ("Initial Digital Trace", "Faithful trace of the pencil gesture; paper and graphite noise removed."),
    2: ("Structural Cleanup", "Even monoline weight, smoothed bends, clearer cloud / S / & reading."),
    3: ("Optical Refinement", "Calligraphic stroke contrast, balanced puffs, tapered terminals."),
    4: ("Final Refined Logo", "Droplet terminals, tucked & crossing, clean Bezier outlines."),
}

# name, mood, swatches [(name, hex)]: 0 = S strokes, 1 = puff, 2 = tint, 3 = ink/logotype
PALETTES = [
    ("A", "Airy Light Blue", "Fresh, airy, clean, soft premium",
     [("Deep Sky", "#3E7CB1"), ("Cloud Blue", "#7DB8E3"), ("Mist", "#EAF4FB"), ("Ink Navy", "#1F3A56")]),
    ("B", "Soft Neutral Premium", "Elegant, minimal, premium fragrance",
     [("Taupe", "#8C7766"), ("Sand", "#C9B39C"), ("Ivory", "#F6F1E9"), ("Espresso", "#3F3631")]),
    ("C", "Modern Youthful Premium", "Gen Z, stylish, modern, fresh",
     [("Periwinkle", "#6F7FD6"), ("Dusty Lavender", "#ADA0DB"), ("Lilac Mist", "#F1EEFA"), ("Blue Gray", "#444C6B")]),
    ("D", "Fresh Luxe Accent", "Clean, elevated, slightly distinctive",
     [("Deep Teal", "#3F7A72"), ("Sage", "#93B49B"), ("Silver Blue", "#E6EFF0"), ("Pine", "#24433F")]),
]


# ---------------------------------------------------------------- text
@lru_cache(None)
def _font(key):
    f = TTFont(F[key])
    return f, f.getGlyphSet(), f.getBestCmap(), f["head"].unitsPerEm, f["OS/2"].sCapHeight


def text_path(txt, key, size, track=0.0):
    """Outline text. Baseline at y=0. Returns (d, width, cap_height)."""
    f, gs, cmap, upm, cap = _font(key)
    sc = size / upm
    x, out = 0.0, []
    for ch in txt:
        g = gs[cmap[ord(ch)]]
        if ch != " ":
            pen = SVGPathPen(gs, ntos=lambda v: f"{v:.3f}".rstrip("0").rstrip("."))
            g.draw(TransformPen(pen, (sc, 0, 0, -sc, x, 0)))
            out.append(pen.getCommands())
        x += g.width * sc + track * size
    return " ".join(out), x - track * size, cap * sc


def text(txt, x, y, key, size, fill="#000", anchor="start", track=0.0):
    d, w, _ = text_path(txt, key, size, track)
    dx = {"start": 0, "middle": -w / 2, "end": -w}[anchor]
    return f'<path transform="translate({x + dx:.3f} {y:.3f})" fill="{fill}" d="{d}"/>'


# ---------------------------------------------------------------- logo
X0, Y0, X1, Y1 = sym.BBOX
SW, SH = X1 - X0, Y1 - Y0


def symbol_group(stage, cx, top, h, fills=("#000",) * 3, gid=None):
    s = h / SH
    tx, ty = cx - SW * s / 2 - X0 * s, top - Y0 * s
    idattr = f' id="{gid}"' if gid else ""
    paths = "".join(f'<path id="{n}" fill="{c}" d="{d}"/>' if gid else f'<path fill="{c}" d="{d}"/>'
                    for n, c, d in zip(("puff", "arc", "bowl"), fills, sym.symbol_paths(stage)))
    return f'<g{idattr} transform="translate({tx:.3f} {ty:.3f}) scale({s:.5f})">{paths}</g>'


def lockup(stage, cx, top, h, fills=("#000",) * 3, ink="#000", gid=False):
    """Symbol of height h with the logotype centred below. Returns (svg, total height)."""
    key, track = LOGOTYPE[stage]
    size = h * 0.205
    d, w, cap = text_path(BRAND, key, size, track)
    gap = h * 0.17
    g = symbol_group(stage, cx, top, h, fills, "symbol" if gid else None)
    base = top + h + gap + cap
    tid = ' id="logotype"' if gid else ""
    g += f'<path{tid} transform="translate({cx - w / 2:.3f} {base:.3f})" fill="{ink}" d="{d}"/>'
    return g, h + gap + cap, w


# ---------------------------------------------------------------- page
PW, PH, M = 210, 297, 15
GRID_T, GRID_B = 42, 274
CW, CH = (PW - 2 * M) / 2, (GRID_B - GRID_T) / 2
GREY, LINE = "#8A8A8A", "#BDBDBD"


def page(body, title, subtitle):
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
            + text("Concept: awan (cloud) + ampersand & + initial S  /  scent that floats, softly.",
                   M, PH - 12, "light", 2.4, GREY)
            + text("A4  210 x 297 mm  /  print at 100%", PW - M, PH - 12, "light", 2.4, GREY, "end"))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{PW}mm" height="{PH}mm" viewBox="0 0 {PW} {PH}">'
            f'<rect width="{PW}" height="{PH}" fill="#fff"/>{head}{frame}{body}{foot}</svg>')


def cells():
    for i in range(4):
        yield i, M + (i % 2) * CW, GRID_T + (i // 2) * CH


def arrow(x, y):
    # dotted progression arrow sitting on a divider, as in the brief example
    dots = "".join(f'<circle cx="{x - 3.2 + k * 1.3:.2f}" cy="{y}" r="0.28" fill="{GREY}"/>' for k in range(4))
    return (f'<circle cx="{x}" cy="{y}" r="3.2" fill="#fff"/>{dots}'
            f'<path d="M{x + 2.2} {y - 1.1} L{x + 3.4} {y} L{x + 2.2} {y + 1.1}Z" fill="{GREY}"/>')


def refinement_page():
    body = ""
    for i, x, y in cells():
        st = i + 1
        name, note = STAGES[st]
        cx = x + CW / 2
        body += text(f"REFINEMENT 0{st}", x + 7, y + 10, "semi", 3.0, track=0.14)
        body += text(name, x + 7, y + 15, "light", 2.5, GREY)
        body += symbol_group(st, cx, y + 22, 44)
        body += f'<line x1="{x + 30}" y1="{y + 73}" x2="{x + CW - 30}" y2="{y + 73}" stroke="{LINE}" stroke-width="0.2"/>'
        g, _, _ = lockup(st, cx, y + 80, 18)
        body += g
        body += text(note, cx, y + CH - 5, "light", 2.05, GREY, "middle")
    body += arrow(PW / 2, GRID_T + CH / 2) + arrow(PW / 2, GRID_T + CH * 1.5)
    return page(body, "4 Tahap Refinement Digital Logo  /  Hitam - Putih", "ROUND 2  /  SYMBOL + LOGOTYPE")


def color_page():
    body = ""
    for (i, x, y), (code, name, mood, sw) in zip(cells(), PALETTES):
        cx = x + CW / 2
        fills = (sw[1][1], sw[0][1], sw[0][1])
        body += text(f"COLOR {code}  /  {name.upper()}", x + 7, y + 10, "semi", 3.0, track=0.1)
        body += text(mood, x + 7, y + 15, "light", 2.5, GREY)
        body += symbol_group(4, cx, y + 20, 30, fills)
        body += f'<rect x="{x + 8}" y="{y + 55}" width="{CW - 16}" height="32" rx="2" fill="{sw[2][1]}"/>'
        g, lh, _ = lockup(4, cx, y + 59.5, 18, fills, sw[3][1])
        body += g
        n, gap = len(sw), 2.5
        w = (CW - 16 - gap * (n - 1)) / n
        for k, (sname, hx) in enumerate(sw):
            sx = x + 8 + k * (w + gap)
            body += (f'<rect x="{sx:.2f}" y="{y + 92}" width="{w:.2f}" height="9" rx="1" fill="{hx}" '
                     f'stroke="{LINE}" stroke-width="0.15"/>')
            body += text(hx.upper(), sx, y + 105.5, "med", 2.3, "#222", track=0.04)
            body += text(sname, sx, y + 109.3, "light", 2.0, GREY)
    return page(body, "4 Alternatif Warna + Skema Warna Logo Digital", "FINAL GEOMETRY  /  COLOR ONLY CHANGES")


def logo_file(fills, ink, symbol_only=False, bg=None):
    h = 200
    pad = 40
    if symbol_only:
        g = symbol_group(4, 0, 0, h, fills, "symbol")
        w_box, h_box = SW * h / SH, h
    else:
        g, h_box, tw = lockup(4, 0, 0, h, fills, ink, gid=True)
        w_box = max(SW * h / SH, tw)
    vx, vy, vw, vh = -w_box / 2 - pad, -pad, w_box + 2 * pad, h_box + 2 * pad
    r = f'<rect x="{vx:.2f}" y="{vy:.2f}" width="{vw:.2f}" height="{vh:.2f}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vx:.2f} {vy:.2f} {vw:.2f} {vh:.2f}" '
            f'width="{vw:.0f}" height="{vh:.0f}"><title>Saff n Co</title>{r}{g}</svg>')


def save(name, svg):
    p = os.path.join(OUT, "svg", name)
    open(p, "w").write(svg)
    return p


def main():
    for d in ("svg", "pdf", "png"):
        os.makedirs(os.path.join(OUT, d), exist_ok=True)
    for name, svg in (("Logo_Refinement_A4", refinement_page()), ("Logo_Color_Alternatives_A4", color_page())):
        p = save(name + ".svg", svg)
        cairosvg.svg2pdf(url=p, write_to=os.path.join(OUT, "pdf", name + ".pdf"))
        cairosvg.svg2png(url=p, write_to=os.path.join(OUT, "png", name + "_300dpi.png"), output_width=2480)

    blk, wht = ("#000",) * 3, ("#fff",) * 3
    files = {
        "Logo_Final_Black": logo_file(blk, "#000"),
        "Logo_Final_White": logo_file(wht, "#fff"),
        "Logo_Symbol_Black": logo_file(blk, "#000", symbol_only=True),
        "Logo_Symbol_White": logo_file(wht, "#fff", symbol_only=True),
    }
    for code, name, _, sw in PALETTES:
        files[f"Logo_Color_{code}_{name.replace(' ', '')}"] = logo_file((sw[1][1], sw[0][1], sw[0][1]), sw[3][1])
    for name, svg in files.items():
        p = save(name + ".svg", svg)
        bg = "#1E1E1E" if "White" in name else None
        src = svg.replace("<title>", f'<rect x="-9999" y="-9999" width="99999" height="99999" fill="{bg}"/><title>') if bg else None
        out = os.path.join(OUT, "png", name + ".png")
        if src:
            cairosvg.svg2png(bytestring=src.encode(), write_to=out, output_width=3000)
        else:
            cairosvg.svg2png(url=p, write_to=out, output_width=3000)
    print("built", len(files) + 2, "svg files")


if __name__ == "__main__":
    main()
