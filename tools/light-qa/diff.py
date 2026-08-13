"""
What actually changed between two stills, as a number and as a picture.

Reading a pair of screenshots side by side is how three earlier passes on this
scene talked themselves into shipping a change nobody could see. The mean
absolute difference says whether there is anything there at all; the amplified
difference image says *where*, which is the part that decides whether a
millisecond was well spent.

Usage: python3 tools/light-qa/diff.py <before.png> <after.png> [out.png]
"""
import sys
from PIL import Image, ImageChops, ImageStat


def main() -> int:
    before_path, after_path = sys.argv[1], sys.argv[2]
    out_path = sys.argv[3] if len(sys.argv) > 3 else None

    before = Image.open(before_path).convert("RGB")
    after = Image.open(after_path).convert("RGB")
    if before.size != after.size:
        print(f"size mismatch: {before.size} vs {after.size}")
        return 1

    difference = ImageChops.difference(before, after)
    stat = ImageStat.Stat(difference)
    mean = sum(stat.mean) / 3
    peak = max(difference.getextrema()[channel][1] for channel in range(3))
    # Share of pixels the eye could plausibly notice. Two levels out of 255 is
    # below the threshold on a photographic image and well below it on one
    # carrying this much paper grain.
    grey = difference.convert("L")
    histogram = grey.histogram()
    total = sum(histogram)
    moved = sum(histogram[3:]) / total

    print(f"mean |delta| {mean:6.3f}   peak {peak:3d}   pixels moved >2 levels {moved * 100:5.1f}%")

    if out_path:
        # Amplified eightfold: the interesting differences here are a handful of
        # levels, and an unamplified difference image of them is a black frame.
        Image.eval(difference, lambda value: min(255, value * 8)).save(out_path)
        print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
