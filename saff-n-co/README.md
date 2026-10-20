# Saff n Co: logo refinement

Rebranding project for Saff n Co, a perfume brand. The symbol is three calligraphic strokes traced from the pencil sketch:

- **Cloud / awan.** The three puffs form the cloud silhouette.
- **S.** The top arc and the right bowl read as one "S".
- **&.** The bowl's tail tucks into the left puff, so the loops cross like an ampersand.

The final stage adds droplet terminals on the inner curls, as a nod to perfume drops.

## Files
- `exports/pdf/` contains the A4 print boards. Print them at 100%.
- `exports/svg/` contains the A4 boards, the final black and white logos, symbol-only marks, and 4 colour versions. All text is outlined. In the logo files, the strokes are grouped as `puff`, `arc`, `bowl` and `logotype`.
- `exports/png/` contains the A4 boards at 300 dpi and 3000 px logo previews.

## Rebuild
```
pip install cairosvg fonttools
python3 src/build.py
```
Geometry lives in `src/symbol.py`. Edit the `SKETCH` and `FINAL` key points or the width profiles, then rebuild.
