"""Saff n Co symbol geometry: four logo directions traced from the pencil sketches.

Every symbol is a set of calligraphic strokes. A stroke is a centreline
(Catmull-Rom through key points traced from the sketch photo) plus a width
profile. The outline is offset from the centreline, capped round, and
re-fitted as a closed cubic Bezier path, so the output is clean editable vector.

Directions
  1  Cloud Ampersand        sketch "SAFF & CO": top loop + big bowl = "&",
                            top loop + right puff = "S", three puffs = awan.  (chosen)
  2  Auspicious Cloud Ribbon sketch "Sepp & co": spiral cloud flowing into a ribbon S.
  3  Spiral S Wisp          sketch "Saffco": an S initial curling like a cloud wisp.
  4  Monoline Cloud Loop    new digital direction (no pencil sketch): one line draws
                            the cloud and loops into an inner S, dot = scent drop.
"""
import numpy as np

# Key points are in the pixel space of each sketch photo (1200 px versions).
# Stroke tuple: (key, points, start_terminal, end_terminal)
# Terminals: "taper" thin soft end, "ball" droplet end, "round" plain round cap.
SYMBOLS = {
    1: dict(
        name="Cloud Ampersand", source="sketch-1", base=72, contrast=0.55,
        strokes=[
            ("bowl", [(357, 450), (346, 492), (306, 534), (272, 600), (256, 690), (276, 768), (322, 815),
                      (402, 840), (502, 845), (602, 838), (680, 822), (725, 790), (740, 735),
                      (728, 688), (690, 662), (636, 660), (592, 680), (562, 708)], "taper", "ball"),
            ("puff", [(548, 628), (568, 594), (612, 560), (672, 540), (742, 537), (802, 555),
                      (846, 596), (870, 652), (874, 712), (858, 762), (820, 795), (780, 805)], "taper", "taper"),
            ("loop", [(540, 442), (585, 453), (637, 448), (680, 424), (696, 384), (690, 338),
                      (664, 298), (618, 268), (558, 249), (490, 251), (430, 273), (386, 312),
                      (361, 362), (352, 422), (360, 478), (387, 514), (436, 530), (488, 533),
                      (532, 524)], "ball", "taper"),
        ],
    ),
    2: dict(
        name="Auspicious Cloud Ribbon", source="sketch-2", base=62, contrast=0.55,
        strokes=[
            ("spiral", [(622, 456), (592, 463), (576, 490), (590, 520), (630, 527), (680, 506),
                        (709, 462), (700, 406), (660, 370), (600, 356), (532, 370), (472, 410),
                        (432, 462), (408, 510)], "ball", "round"),
            ("ribbon", [(408, 510), (446, 530), (498, 536), (530, 552), (552, 580), (592, 600),
                        (652, 591), (722, 570), (792, 560), (850, 582), (870, 630), (850, 678),
                        (790, 704), (720, 700), (650, 690), (580, 670), (510, 641), (460, 616),
                        (410, 601), (362, 606), (340, 642), (346, 690), (382, 720), (452, 726),
                        (520, 721), (562, 718)], "round", "taper"),
        ],
    ),
    3: dict(
        name="Spiral S Wisp", source="sketch-3", base=70, contrast=0.55,
        strokes=[
            ("s", [(205, 975), (214, 1010), (244, 1019), (268, 996), (271, 956), (249, 922),
                   (206, 905), (165, 912), (136, 945), (125, 995), (138, 1040), (176, 1060),
                   (230, 1068), (274, 1086), (288, 1115), (265, 1138), (220, 1142), (176, 1128),
                   (145, 1126), (120, 1145), (96, 1140), (80, 1113), (60, 1100), (36, 1094),
                   (25, 1069), (40, 1045), (66, 1040), (83, 1058), (76, 1076), (62, 1079)],
             "ball", "ball"),
        ],
    ),
    4: dict(
        name="Monoline Cloud Loop", source=None, base=50, contrast=1.0,
        strokes=[
            ("line", [(232, 440), (170, 432), (112, 410), (76, 365), (72, 315), (98, 274),
                      (145, 252), (190, 250), (198, 198), (232, 155), (285, 130), (345, 128),
                      (395, 148), (430, 185), (442, 232), (485, 222), (540, 232), (586, 268),
                      (608, 322), (595, 380), (548, 424), (470, 446), (392, 442), (336, 418),
                      (305, 378), (312, 336), (346, 316), (380, 332), (386, 366), (362, 384)],
             "taper", "ball"),
        ],
        dots=[("drop", (655, 168), 22)],
    ),
}

CHOSEN = 1


def catmull(pts, n=24):
    P = np.asarray(pts, float)
    P = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1:i + 3]
        for t in np.linspace(0, 1, n, endpoint=False):
            out.append(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-2])
    return np.array(out)


def resample(c, m):
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(c, axis=0), axis=1))]
    s = np.linspace(0, d[-1], m)
    return np.c_[np.interp(s, d, c[:, 0]), np.interp(s, d, c[:, 1])], d[-1]


def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def outline(c, w, cap_n=11):
    t = np.gradient(c, axis=0)
    t /= np.linalg.norm(t, axis=1)[:, None]
    n = np.c_[-t[:, 1], t[:, 0]]
    L = c + n * (w / 2)[:, None]
    R = c - n * (w / 2)[:, None]

    def cap(center, tang, r, a_from):
        # semicircle from one side, around the tip, to the other side
        base = np.arctan2(a_from[1], a_from[0])
        sign = 1 if a_from[0] * tang[1] - a_from[1] * tang[0] > 0 else -1
        ang = base + sign * np.linspace(0, np.pi, cap_n + 2)[1:-1]
        return center + r * np.c_[np.cos(ang), np.sin(ang)]

    end = cap(c[-1], t[-1], w[-1] / 2, n[-1])
    start = cap(c[0], -t[0], w[0] / 2, -n[0])
    return np.vstack([L, end, R[::-1], start])


def to_path(Q, prec=1):
    """Closed Catmull-Rom -> cubic Bezier path data."""
    k = len(Q)
    f = lambda p: f"{p[0]:.{prec}f} {p[1]:.{prec}f}"
    d = [f"M{f(Q[0])}"]
    for i in range(k):
        p0, p1, p2, p3 = Q[i - 1], Q[i], Q[(i + 1) % k], Q[(i + 2) % k]
        d.append(f"C{f(p1 + (p2 - p0) / 6)} {f(p2 - (p3 - p1) / 6)} {f(p2)}")
    return "".join(d) + "Z"


def circle_path(cx, cy, r, prec=1):
    k = 0.5523 * r
    f = lambda v: f"{v:.{prec}f}"
    return (f"M{f(cx + r)} {f(cy)}C{f(cx + r)} {f(cy + k)} {f(cx + k)} {f(cy + r)} {f(cx)} {f(cy + r)}"
            f"C{f(cx - k)} {f(cy + r)} {f(cx - r)} {f(cy + k)} {f(cx - r)} {f(cy)}"
            f"C{f(cx - r)} {f(cy - k)} {f(cx - k)} {f(cy - r)} {f(cx)} {f(cy - r)}"
            f"C{f(cx + k)} {f(cy - r)} {f(cx + r)} {f(cy - k)} {f(cx + r)} {f(cy)}Z")


def _terminal(kind, u, length):
    # profile lengths are in absolute units so short and long strokes end alike
    if kind == "taper":
        return 0.45 + 0.55 * smoothstep(u * length / 260)
    if kind == "ball":
        x = u * length
        return 1 + 0.42 * np.exp(-((x - 18) / 32) ** 2)
    return np.ones_like(u)


def build(sid, rough=False, size=1000):
    """Return dict(paths=[(key, d)], w, h) normalised so the larger side = size."""
    spec = SYMBOLS[sid]
    allpts = np.vstack([np.asarray(s[1], float) for s in spec["strokes"]]
                       + [np.array([d[1]]) for d in spec.get("dots", [])])
    lo, hi = allpts.min(0), allpts.max(0)
    base = spec["base"] * size / 1000
    sc = (size - 2 * base) / (hi - lo).max()
    tf = lambda p: (np.asarray(p, float) - lo) * sc

    polys, keys = [], []
    for i, (key, pts, t0, t1) in enumerate(spec["strokes"]):
        raw = catmull(tf(pts))
        _, length = resample(raw, 2)
        m = max(16, int(length / ((14 if rough else 34) * size / 1000)))
        c, _ = resample(raw, m)
        u = np.linspace(0, 1, m)
        if rough:
            # hand wobble + pencil pressure variation: the "digital sketch" look
            rng = np.random.default_rng(sid * 10 + i)
            ph = rng.uniform(0, 6.28, 3)
            wob = np.sin(u * length / 110 + ph[0]) * 4 + np.sin(u * length / 31 + ph[1]) * 1.6
            t = np.gradient(c, axis=0); t /= np.linalg.norm(t, axis=1)[:, None]
            c = c + np.c_[-t[:, 1], t[:, 0]] * wob[:, None]
            w = base * 0.85 * (1 + 0.16 * np.sin(u * length / 80 + ph[2]))
            w *= 0.8 + 0.2 * smoothstep(u / 0.05) * smoothstep((1 - u) / 0.05)
            polys.append(outline(c, w, cap_n=6)); keys.append(key)
            continue
        t = np.gradient(c, axis=0)
        theta = np.arctan2(t[:, 1], t[:, 0])
        k = spec["contrast"]
        w = base * (k + (1 - k) * np.abs(np.sin(theta - np.radians(-35))))
        w = np.convolve(np.pad(w, 3, mode="edge"), np.ones(7) / 7, mode="valid")
        w *= _terminal(t0, u, length) * _terminal(t1, 1 - u, length)
        polys.append(outline(c, w)); keys.append(key)

    dots = [(key, tf(p), r * sc) for key, p, r in spec.get("dots", [])]
    pts = np.vstack(polys + [np.array([p - r, p + r]) for _, p, r in dots])
    mn = pts.min(0)
    w_, h_ = pts.max(0) - mn
    paths = [(k_, to_path(p - mn)) for k_, p in zip(keys, polys)]
    paths += [(k_, circle_path(*(p - mn), r)) for k_, p, r in dots]
    return dict(paths=paths, w=w_, h=h_, name=spec["name"])
