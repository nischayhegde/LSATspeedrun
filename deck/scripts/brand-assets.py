#!/usr/bin/env python3
"""
Turns the three usable images out of the founders' original PDF deck into
palette-matched assets for the deck's start screen.

    cd /Users/alan/LSATspeedrun && .venv/bin/python deck/scripts/brand-assets.py

Inputs, all in `deck/public/brand/` and all committed:

    ut-seal-source.jpg   1280x1280  UT Austin seal, burnt orange line art on a
                                    white disc, the PDF's transparency flattened
                                    to black outside the circle
    alan.jpg              192x192    Alan Abraham. Effectively ~96x120 of real
                                    detail; the weakest asset in the set
    nischay.jpg           512x512    Nischay Hegde, studio grey

Outputs, also committed, because a presentation laptop must not need a Python
environment to render its own title card:

    ut-seal.png          gold-foil seal, alpha = ink coverage
    founder-alan.png     matched engraved portrait plate
    founder-nischay.png  matched engraved portrait plate

## Why the portraits are stylised rather than shown as photographs

Alan's photo is roughly a quarter the linear resolution of Nischay's, and the
original title slide lists Alan first. Shown as two photographs at the same size,
one is visibly soft and it is the one in the more prominent position. So both are
put through the same engraving: tone-normalised, duotoned onto the deck's navy →
gold → paper ramp, and modulated by a fine horizontal line screen at a pitch
fixed in *output* pixels. A line screen is a resolution leveller — above the
pitch, detail survives; below it, it was never going to survive anyway — so a
96px source and a 512px source converge, and the result reads as an engraved
plate on a share certificate rather than as a bad crop. It is also the treatment
the rest of the deck already uses (`.engraved`, the engine-turned title bars).

Dropping in a better scan of Alan later is a straight file replacement: overwrite
`alan.jpg`, re-run this script, and re-check `HEAD_BOX` below — nothing in
`src/start/` knows or cares about the source resolution.

## Why the crops are constants

Both portraits are composed to the same three numbers — head height as a fraction
of the frame, eye line as a fraction of the frame, and face centre on the vertical
axis — because a pair of portraits that disagree on any of them reads as a mistake
however good the photographs are. `HEAD_BOX` records where the head actually is in
each source, measured by eye off a pixel ruler; the composition maths is shared.
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

BRAND = Path(__file__).resolve().parents[1] / 'public' / 'brand'

# --- the shared composition -------------------------------------------------
OUT = 512
#: Supersample, then downsample. The line screen is generated at 2x and reduced,
#: which is what gives its edges a printed softness instead of aliasing.
WORK = OUT * 2
#: Head height (hair to chin) as a fraction of the framed height. Capped by
#: Nischay's source, which is already head-filling and cannot be zoomed out of.
HEAD_FRACTION = 0.55
#: Where the eye line sits. Portraits put it above centre; a face centred on the
#: geometric middle of a circle reads as sinking in it.
EYE_FRACTION = 0.42

#: Measured off a pixel ruler over each source: (centre x, hair top y, chin y,
#: eye line y). Re-measure after replacing a source file.
HEAD_BOX = {
    'alan': dict(cx=92, top=27, chin=110, eye=62),
    'nischay': dict(cx=298, top=62, chin=342, eye=203),
}

# --- the duotone ramp -------------------------------------------------------
#: navy shadow → gold midtone → warm paper highlight. The midtone stop is what
#: makes it a gold-toned engraving rather than a blue-tinted photograph.
RAMP = (
    (0.00, (0x07, 0x12, 0x1c)),
    (0.34, (0x2a, 0x3c, 0x46)),
    (0.62, (0xa8, 0x82, 0x42)),
    (0.84, (0xe6, 0xcd, 0x93)),
    (1.00, (0xfb, 0xf3, 0xdf)),
)

#: Line screen pitch in *output* pixels, and how much of the tone it eats.
SCREEN_PITCH = 3.0
SCREEN_DEPTH = 0.42


def ramp_lut() -> np.ndarray:
    """256x3 lookup table interpolating `RAMP`."""
    stops = np.array([stop for stop, _ in RAMP])
    colours = np.array([colour for _, colour in RAMP], dtype=float)
    x = np.linspace(0, 1, 256)
    return np.stack([np.interp(x, stops, colours[:, channel]) for channel in range(3)], axis=1)


def compose(source: Image.Image, box: dict) -> Image.Image:
    """Crop `source` so the head lands on the shared composition, at WORK size."""
    head = box['chin'] - box['top']
    # Scale that puts `head` source pixels at HEAD_FRACTION of the output.
    scale = (WORK * HEAD_FRACTION) / head
    side = WORK / scale
    # Place the eye line, then the face centre, then clamp both into the source.
    top = box['eye'] - (WORK * EYE_FRACTION) / scale
    left = box['cx'] - side / 2
    width, height = source.size
    left = max(0.0, min(left, width - side))
    top = max(0.0, min(top, height - side))
    if side > min(width, height):
        # A source too small to give the requested framing: take all of it and
        # let the head land wherever it lands rather than sampling off the edge.
        side = float(min(width, height))
        left = max(0.0, min(box['cx'] - side / 2, width - side))
        top = max(0.0, min(box['eye'] - side * EYE_FRACTION, height - side))
    cropped = source.crop((round(left), round(top), round(left + side), round(top + side)))
    return cropped.resize((WORK, WORK), Image.LANCZOS)


def engrave(image: Image.Image) -> Image.Image:
    """Tone-normalise, duotone, line-screen, vignette, circular mask."""
    # A touch of sharpening before anything else. On the soft source this
    # recovers the edges the line screen then has something to follow; on the
    # sharp one it is below the threshold of visibility at 512px.
    grey = image.convert('L').filter(ImageFilter.UnsharpMask(radius=WORK / 220, percent=120, threshold=2))
    tone = np.asarray(grey, dtype=float) / 255.0

    size = tone.shape[0]
    ys, xs = np.mgrid[0:size, 0:size].astype(float)
    radius = np.sqrt(((xs - size / 2) / (size / 2)) ** 2 + ((ys - size / 2) / (size / 2)) ** 2)

    # Percentile stretch rather than min/max, and measured over the face rather
    # than the whole frame. Both sources have specular pixels on skin and
    # glasses, and one of them also has a large black polo; normalising against
    # either leaves the two faces sitting at different places on the ramp, which
    # is precisely the mismatch this whole treatment exists to remove. The
    # backgrounds are then dealt with separately, below.
    face = radius < 0.55
    low, high = np.percentile(tone[face], (2.0, 98.0))
    tone = np.clip((tone - low) / max(high - low, 1e-6), 0, 1)
    # Gentle S-curve. Engraved plates have contrast; photographs have range.
    tone = np.clip(tone * tone * (3 - 2 * tone) * 0.82 + tone * 0.18, 0, 1)

    # Vignette, in tone space so it survives the duotone. Deliberately heavy: it
    # is the only thing that makes one studio's mid-grey backdrop and another's
    # near-black read as the same navy ground, and a matched ground is most of
    # what makes two portraits read as a pair.
    tone *= np.clip(1.04 - 0.94 * np.clip((radius - 0.30) / 0.70, 0, 1) ** 1.35, 0, 1)

    # The line screen. Amplitude peaks in the midtones and falls away at both
    # ends, so the lines describe the modelling of the face and do not comb the
    # highlights or fill in the shadows.
    phase = np.sin(2 * math.pi * ys / (SCREEN_PITCH * WORK / OUT))
    midtone = np.clip(1 - abs(tone - 0.5) * 2, 0, 1) ** 0.7
    tone = np.clip(tone + phase * midtone * SCREEN_DEPTH * 0.5, 0, 1)

    rgb = ramp_lut()[(tone * 255).astype(np.uint8)]
    out = Image.fromarray(rgb.astype(np.uint8), 'RGB').resize((OUT, OUT), Image.LANCZOS)

    # Circular alpha, one output pixel of feather. The ring around the plate is
    # drawn in CSS, so this only has to be a clean edge.
    ys, xs = np.mgrid[0:OUT, 0:OUT].astype(float)
    distance = np.sqrt((xs - (OUT - 1) / 2) ** 2 + (ys - (OUT - 1) / 2) ** 2)
    alpha = np.clip((OUT / 2 - distance) * 1.6, 0, 1) * 255
    out.putalpha(Image.fromarray(alpha.astype(np.uint8), 'L'))
    return out


def seal() -> Image.Image:
    """
    Recolour the UT seal from burnt orange on white to gold foil on nothing.

    The source is the PDF's flattened PNG: orange line art on a white disc, black
    everywhere outside the circle. Two observations make the extraction exact
    rather than approximate. Ink coverage is the blue channel inverted — the
    orange is #bf5700, so blue runs 255 on the paper to 0 in the ink and nothing
    else in the image uses blue at all. And the circle is found by asking where
    the flattened black stops, which is a hard edge.

    The gold is a vertical foil ramp baked into the RGB, so the result is a plain
    `<img>` with an alpha channel: no CSS mask, no blend mode, nothing that can
    fail to composite on a projector.
    """
    source = np.asarray(Image.open(BRAND / 'ut-seal-source.jpg').convert('RGB'), dtype=float)
    height, width = source.shape[:2]

    lit = source.max(axis=2) > 40
    ys, xs = np.nonzero(lit)
    cy, cx = (ys.min() + ys.max()) / 2, (xs.min() + xs.max()) / 2
    radius = min(ys.max() - ys.min(), xs.max() - xs.min()) / 2

    gy, gx = np.mgrid[0:height, 0:width].astype(float)
    distance = np.sqrt((gx - cx) ** 2 + (gy - cy) ** 2)
    inside = np.clip((radius - distance) * 0.9, 0, 1)

    ink = np.clip(1 - source[:, :, 2] / 255.0, 0, 1)
    # The paper inside the circle is not perfectly white in a JPEG, so lift the
    # floor before scaling or the whole disc carries a faint gold haze.
    ink = np.clip((ink - 0.12) / 0.72, 0, 1)
    alpha = ink * inside

    foil = np.stack([
        np.interp(gy / height, [0, 0.32, 0.66, 1], [0xfb, 0xef, 0xc8, 0x8f]),
        np.interp(gy / height, [0, 0.32, 0.66, 1], [0xf1, 0xd5, 0x9b, 0x62]),
        np.interp(gy / height, [0, 0.32, 0.66, 1], [0xd4, 0x93, 0x4b, 0x25]),
    ], axis=2)

    out = np.concatenate([foil, (alpha * 255)[:, :, None]], axis=2).astype(np.uint8)
    return Image.fromarray(out, 'RGBA').resize((768, 768), Image.LANCZOS)


def main() -> None:
    for name, box in HEAD_BOX.items():
        source = Image.open(BRAND / f'{name}.jpg').convert('RGB')
        plate = engrave(compose(source, box))
        target = BRAND / f'founder-{name}.png'
        plate.save(target, optimize=True)
        print(f'{target.relative_to(BRAND.parents[1])}  {plate.size[0]}x{plate.size[1]}  {target.stat().st_size // 1024}KB')

    target = BRAND / 'ut-seal.png'
    seal().save(target, optimize=True)
    print(f'{target.relative_to(BRAND.parents[1])}  768x768  {target.stat().st_size // 1024}KB')


if __name__ == '__main__':
    main()
