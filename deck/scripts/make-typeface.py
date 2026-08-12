#!/usr/bin/env python3
"""
Cut a three.js typeface out of the deck's own Archivo.

`close-room-scene.ts` stands its headline up as real geometry in the room, and
`TextGeometry` needs glyph outlines rather than a webfont. Rather than ship a
second font — which would be a different typeface from the one the rest of the
deck sets, on the one slide held longest — this instances the variable font the
deck already self-hosts at the display weight and converts its outlines.

    python3 scripts/make-typeface.py

Writes `src/scenes/archivo-display.typeface.json`. Re-run it if the font is
replaced; the output is committed so neither the build nor the browser needs
fontTools.

Subset to printable ASCII rather than to the close's exact copy: keying the
asset to one string would mean a headline edit silently dropping glyphs, and
the whole set costs a few tens of kilobytes inside a chunk that is already
lazy-loaded a slide ahead of when it is shown.
"""
import json
import pathlib

from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = pathlib.Path(__file__).resolve().parent
FONT = HERE.parent / 'public' / 'fonts' / 'archivo-v25-latin-wght.woff2'
OUT = HERE.parent / 'src' / 'scenes' / 'archivo-display.typeface.json'

# `--weight-display` in theme.css. The headline and `Questions?` are the only
# things this draws, and both are set at it.
WEIGHT = 800

CHARSET = [chr(c) for c in range(0x20, 0x7f)] + list('—–‘’“”…')


class TypefacePen(BasePen):
    """Collects a glyph's contours in the typeface format's own command list.

    The format is the one facetype.js emits: `m x y` to open a contour, `l` for
    a line, `q` for a quadratic with the control point last, `b` for a cubic.
    Y is not flipped — three's `FontLoader` reads these with Y up, which is the
    same orientation the font stores them in.
    """

    def __init__(self, glyph_set, scale):
        super().__init__(glyph_set)
        self.scale = scale
        self.commands = []

    def _n(self, value):
        # Whole font units, at a resolution of 1000 per em. The headline is the
        # largest thing this draws and it renders at 138 pixels per world unit
        # on a 1920 frame, so its em is about 127 pixels and one font unit is an
        # eighth of a pixel — below what the renderer's own antialiasing
        # resolves. Keeping the decimals cost a fifth of the file for detail
        # that cannot reach the screen.
        return round(value * self.scale)

    def _moveTo(self, pt):
        self.commands.append(f'm {self._n(pt[0])} {self._n(pt[1])}')

    def _lineTo(self, pt):
        self.commands.append(f'l {self._n(pt[0])} {self._n(pt[1])}')

    def _curveToOne(self, p1, p2, p3):
        self.commands.append(
            f'b {self._n(p3[0])} {self._n(p3[1])} '
            f'{self._n(p1[0])} {self._n(p1[1])} {self._n(p2[0])} {self._n(p2[1])}'
        )

    def _qCurveToOne(self, p1, p2):
        self.commands.append(
            f'q {self._n(p2[0])} {self._n(p2[1])} {self._n(p1[0])} {self._n(p1[1])}'
        )

    def _closePath(self):
        self.commands.append('z')


def main():
    font = TTFont(FONT)
    font.flavor = None
    font = instancer.instantiateVariableFont(font, {'wght': WEIGHT}, inplace=True)

    upem = font['head'].unitsPerEm
    resolution = 1000
    scale = resolution / upem

    cmap = font.getBestCmap()
    glyph_set = font.getGlyphSet()
    hmtx = font['hmtx']

    glyphs = {}
    missing = []
    for char in CHARSET:
        name = cmap.get(ord(char))
        if name is None:
            missing.append(char)
            continue
        pen = TypefacePen(glyph_set, scale)
        glyph_set[name].draw(pen)
        advance, _ = hmtx[name]
        entry = {'ha': round(advance * scale, 1), 'o': ' '.join(pen.commands)}
        glyphs[char] = entry

    head = font['head']
    hhea = font['hhea']
    face = {
        'glyphs': glyphs,
        'familyName': 'Archivo Display',
        'ascender': round(hhea.ascent * scale),
        'descender': round(hhea.descent * scale),
        'underlinePosition': round(font['post'].underlinePosition * scale),
        'underlineThickness': round(font['post'].underlineThickness * scale),
        'boundingBox': {
            'xMin': round(head.xMin * scale),
            'xMax': round(head.xMax * scale),
            'yMin': round(head.yMin * scale),
            'yMax': round(head.yMax * scale),
        },
        'resolution': resolution,
        'original_font_information': {
            'postscript_name': f'Archivo-wght{WEIGHT}',
            'license': 'SIL Open Font License 1.1 — see public/fonts/OFL.txt',
        },
    }

    OUT.write_text(json.dumps(face, separators=(',', ':'), ensure_ascii=False))
    print(f'{OUT.relative_to(HERE.parent)}: {len(glyphs)} glyphs, {OUT.stat().st_size / 1024:.1f} KB')
    if missing:
        print('missing from the font:', ''.join(missing))


if __name__ == '__main__':
    main()
