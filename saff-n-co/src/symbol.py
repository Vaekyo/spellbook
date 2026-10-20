"""Saff n Co symbol geometry.

The mark is three calligraphic strokes traced from the primary pencil sketch:
  A  small left puff (inner curl top-right, tail at bottom-right)
  B  top arc (starts upper right, sweeps over the top, falls into the centre)
  C  large right bowl (inner curl, then a full bowl ending bottom-left)
B + C read as an "S"; A + C cross at the base like the loops of an "&";
the three bumps together form the cloud / awan silhouette.

Each stroke is a centreline (Catmull-Rom through key points) plus a width
profile. The outline is offset from the centreline, capped round, and
re-fitted as a closed cubic Bezier path.
"""
import numpy as np

# Key points traced from the sketch (image 2, pixel space of the 1536px photo).
SKETCH = {
    "A": [(575, 838), (590, 760), (548, 683), (455, 655), (365, 700), (318, 800),
          (335, 935), (420, 1050), (540, 1092), (640, 1062), (700, 985), (690, 925)],
    "B": [(1042, 568), (1020, 500), (940, 455), (840, 448), (730, 490), (660, 585),
          (657, 705), (708, 805), (797, 872)],
    "C": [(905, 822), (862, 765), (862, 692), (912, 642), (992, 637), (1052, 683),
          (1076, 800), (1076, 955), (1040, 1102), (950, 1200), (830, 1212),
          (722, 1150), (662, 1082), (645, 1058)],
}

# Idealised geometry for the final mark: rounder puffs, even gaps, tangent flow
# from the end of B toward the curl of C so the S reads in one motion.
FINAL = {
    "A": [(585, 850), (598, 765), (552, 690), (462, 662), (372, 700), (325, 795),
          (338, 925), (418, 1040), (532, 1085), (636, 1060), (698, 990), (700, 930)],
    "B": [(1048, 590), (1018, 510), (940, 462), (842, 456), (742, 494), (676, 584),
          (668, 700), (716, 800), (800, 868)],
    "C": [(902, 830), (866, 772), (868, 702), (918, 652), (994, 646), (1054, 694),
          (1082, 808), (1082, 958), (1046, 1102), (956, 1196), (836, 1210),
          (722, 1150), (670, 1102), (636, 1062)],
}


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
    return np.c_[np.interp(s, d, c[:, 0]), np.interp(s, d, c[:, 1])]


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
        # semicircle from the left side, around the tip, to the right side
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


# Which end of each stroke is the inner curl (gets the droplet terminal).
INNER_START = {"A": True, "B": False, "C": True}


def stroke(name, stage):
    pts = {1: SKETCH, 2: SKETCH, 3: None, 4: FINAL}[stage]
    if stage == 3:
        pts = {k: [tuple(0.5 * (np.array(a) + np.array(b))) for a, b in zip(SKETCH[k], FINAL[k])]
               for k in SKETCH}
    raw = catmull(pts[name])
    m = {1: 110, 2: 46, 3: 38, 4: 30}[stage]
    c = resample(raw, m)
    u = np.linspace(0, 1, m)
    rng = np.random.default_rng({"A": 3, "B": 7, "C": 11}[name])

    if stage == 1:
        # hand wobble + pencil pressure variation, no texture
        ph = rng.uniform(0, 6.28, 3)
        wob = (np.sin(u * 9 + ph[0]) * 3.2 + np.sin(u * 37 + ph[1]) * 1.3)
        t = np.gradient(c, axis=0); t /= np.linalg.norm(t, axis=1)[:, None]
        c = c + np.c_[-t[:, 1], t[:, 0]] * wob[:, None]
        w = 40 * (1 + 0.16 * np.sin(u * 17 + ph[2]) + 0.06 * rng.standard_normal(m).cumsum() / np.sqrt(m))
        w *= 0.78 + 0.22 * smoothstep(u / 0.06) * smoothstep((1 - u) / 0.06)
        return to_path(outline(c, w, cap_n=5))

    t = np.gradient(c, axis=0)
    theta = np.arctan2(t[:, 1], t[:, 0])
    if stage == 2:
        w = np.full(m, 40.0)
    else:
        pen = np.radians(-35)
        lo = 0.62 if stage == 3 else 0.5
        base = 44 if stage == 3 else 50
        w = base * (lo + (1 - lo) * np.abs(np.sin(theta - pen)))
        # soften the contrast so it never looks like a stiff serif monogram
        w = np.convolve(np.pad(w, 4, mode="edge"), np.ones(9) / 9, mode="valid")
        tail = smoothstep((1 - u) / 0.22)
        w *= (0.55 + 0.45 * tail)
        if INNER_START[name]:
            if stage == 4:
                # droplet terminal on the inner curl: scent / perfume drop
                w *= 1 + 0.42 * np.exp(-((u - 0.035) / 0.05) ** 2)
            else:
                w *= 0.8 + 0.2 * smoothstep(u / 0.12)
        else:
            w *= 0.5 + 0.5 * smoothstep(u / 0.22)
    return to_path(outline(c, w))


def symbol_paths(stage):
    return [stroke(k, stage) for k in ("A", "B", "C")]


# bounding box of the sketch coordinate space used by every stage
BBOX = (290, 420, 1110, 1245)  # x0, y0, x1, y1
