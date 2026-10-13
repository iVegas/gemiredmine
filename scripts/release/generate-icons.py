#!/usr/bin/env python3
"""Generates the per-channel application icons in assets/icons/.

Each channel gets its own colour and label so side-by-side installs are easy to tell apart.
It writes the Linux PNG, the Windows .ico, and the Windows package tiles.
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


# Tile sizes the Windows package needs (MSIX Assets folder). Square tiles use the icon itself;
# the wide tile centres it on the channel colour.
WINDOWS_TILES = {
    "Square44x44Logo.png": (44, 44),
    "Square150x150Logo.png": (150, 150),
    "StoreLogo.png": (50, 50),
    "Wide310x150Logo.png": (310, 150),
}
ICO_SIZES = [(16, 16), (32, 32), (48, 48), (256, 256)]


def windows_tile(icon: Image.Image, size: tuple[int, int], colour: tuple[int, int, int]) -> Image.Image:
    width, height = size
    if width == height:
        return icon.resize(size, Image.LANCZOS)
    canvas = Image.new("RGBA", size, colour + (255,))
    side = height - 20
    canvas.paste(icon.resize((side, side), Image.LANCZOS), ((width - side) // 2, 10), icon.resize((side, side), Image.LANCZOS))
    return canvas


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (colour, label) in CHANNELS.items():
        icon = render(name, colour, label)
        icon.save(OUT / f"{name}.png", optimize=True)
        icon.save(OUT / f"{name}.ico", sizes=ICO_SIZES)
        print(f"wrote {OUT / f'{name}.png'} and {name}.ico")

        windows_dir = ROOT / "assets" / "windows" / name
        windows_dir.mkdir(parents=True, exist_ok=True)
        for tile, size in WINDOWS_TILES.items():
            windows_tile(icon, size, colour).save(windows_dir / tile, optimize=True)
        print(f"wrote {len(WINDOWS_TILES)} Windows tiles to {windows_dir}")


if __name__ == "__main__":
    main()
