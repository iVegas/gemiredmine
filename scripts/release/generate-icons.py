#!/usr/bin/env python3
"""Generates the per-channel application icons in assets/icons/.

Each channel gets its own colour and label so side-by-side installs are easy to tell apart.
Re-run after changing the design; the PNGs are committed so builds do not need Pillow.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "icons"
SIZE = 512
BOLD_FONTS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
]
CHANNELS = {
    "stable": ((37, 99, 235), None),
    "canary": ((217, 119, 6), "CANARY"),
    "unstable": ((190, 24, 93), "UNSTABLE"),
    "dev": ((75, 85, 99), "DEV"),
}


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in BOLD_FONTS:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)


def render(name: str, colour: tuple[int, int, int], label: str | None) -> Image.Image:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((16, 16, SIZE - 16, SIZE - 16), radius=96, fill=colour)

    letter = font(300)
    left, top, right, bottom = draw.textbbox((0, 0), "G", font=letter)
    x = (SIZE - (right - left)) / 2 - left
    y = (SIZE - (bottom - top)) / 2 - top - (40 if label else 0)
    draw.text((x, y), "G", font=letter, fill=(255, 255, 255, 255))

    if label:
        small = font(48)
        left, top, right, bottom = draw.textbbox((0, 0), label, font=small)
        draw.rounded_rectangle((96, 360, SIZE - 96, 440), radius=24, fill=(255, 255, 255, 235))
        draw.text(
            ((SIZE - (right - left)) / 2 - left, 400 - (bottom - top) / 2 - top),
            label,
            font=small,
            fill=colour,
        )
    return image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (colour, label) in CHANNELS.items():
        render(name, colour, label).save(OUT / f"{name}.png", optimize=True)
        print(f"wrote {OUT / f'{name}.png'}")


if __name__ == "__main__":
    main()
