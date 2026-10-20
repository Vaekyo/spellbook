# Saff n Co: logo development

Rebranding project for Saff n Co, a perfume brand. The concept is a cloud (awan), with an ampersand "&" and the initial "S" hidden in the mark.

## Ronde 2: 4 alternatives in black and white (`Logo_Refinement_A4`)
Four directions, each digitised as symbol + logotype. Each one sits next to its pencil sketch.

| # | Direction | Source |
|---|---|---|
| 01 | **Cloud Ampersand** (chosen) | pencil sketch "SAFF & CO" |
| 02 | Auspicious Cloud Ribbon | pencil sketch "Sepp & co" |
| 03 | Spiral S Wisp | pencil sketch "Saffco" |
| 04 | Monoline Cloud Loop | new digital direction, added to make four |

Alternatif 01 is the chosen one because it carries all three meanings:
- The three puffs form the cloud.
- The top loop and the big bowl read as "&".
- The top loop and the right puff read as "S".

## Ronde 4: 4 colour alternatives (`Logo_Color_Alternatives_A4`)
Alternatif 01 is used in every version, with the exact same geometry; only the colours change. Each scheme uses two **analogous** colours: a deep ink for the whole logo and a pale background in a neighbouring hue, 25–35° away on the colour wheel.

| Scheme | Ink | Background |
|---|---|---|
| Warna 01 | #34587F blue | #D8F0EE aqua |
| Warna 02 | #6E5848 mocha | #F2EBCF butter cream |
| Warna 03 | #4C478A indigo | #EDE0F3 lilac |
| Warna 04 | #2F5E57 teal | #DAEEDF sage |

Each quadrant shows:
- the full logo on the background colour
- a reversed tile (background colour on ink)
- the symbol on white
- the two swatches with their hex codes

The colour logo SVGs keep the background on its own `background` layer. Delete that layer for a transparent logo.

## Files
- `exports/pdf/` contains both A4 boards. Print them at 100%.
- `exports/svg/` contains:
  - both boards
  - the final black and white logos
  - symbol-only marks
  - the 4 colour logos
  - black versions of all 4 alternatives
  All text is outlined. In the logo files the strokes have IDs (`loop`, `puff`, `bowl`, `logotype`).
- `exports/png/` contains both boards at 300 dpi and 3000 px logo previews.
- `src/sketches/` holds the cropped pencil sketches used as thumbnails. They are the only raster images on the boards.

## Rebuild
```
pip install cairosvg fonttools pillow
python3 src/build.py
```
The geometry lives in `src/symbol.py`: key points traced from each sketch, plus width profiles. Edit them, then rebuild.
