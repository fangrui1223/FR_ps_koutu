from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw


def draw_icon(size: int, foreground: str, accent: str) -> Image.Image:
    scale = 4
    canvas = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    def box(values: tuple[float, float, float, float]) -> tuple[int, int, int, int]:
        return tuple(round(value * size * scale) for value in values)

    stroke = max(scale, round(size * 0.075 * scale))
    corner = max(scale, round(size * 0.23 * scale))
    margin = round(size * 0.12 * scale)
    extent = size * scale - margin
    segments = (
        ((margin, margin + corner), (margin, margin), (margin + corner, margin)),
        ((extent - corner, margin), (extent, margin), (extent, margin + corner)),
        ((margin, extent - corner), (margin, extent), (margin + corner, extent)),
        ((extent - corner, extent), (extent, extent), (extent, extent - corner)),
    )
    for segment in segments:
        draw.line(segment, fill=foreground, width=stroke, joint="curve")

    draw.ellipse(box((0.34, 0.20, 0.66, 0.52)), fill=accent)
    draw.rounded_rectangle(
        box((0.25, 0.48, 0.75, 0.82)),
        radius=round(size * 0.14 * scale),
        fill=accent,
    )
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate Photoshop UXP plugin and panel icons")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    themes = {
        "dark": ("#F4F7FA", "#20C5D8"),
        "light": ("#17212B", "#087F8C"),
    }
    for theme, (foreground, accent) in themes.items():
        for suffix, size in (("@1x", 23), ("@2x", 46)):
            draw_icon(size, foreground, accent).save(
                args.output / f"plugin-{theme}{suffix}.png",
                optimize=True,
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
