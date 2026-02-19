from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw


def rounded_rect(draw: ImageDraw.ImageDraw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    out_dir = root / "build"
    out_dir.mkdir(parents=True, exist_ok=True)

    size = 1024
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    rounded_rect(draw, (36, 36, 988, 988), radius=224, fill=(16, 20, 30, 255))
    rounded_rect(draw, (86, 86, 938, 938), radius=192, fill=(22, 28, 44, 255))

    center = (size // 2, size // 2)
    draw.ellipse((210, 210, 814, 814), fill=(17, 24, 39, 255))

    ring_color = (249, 179, 47, 255)
    trace_color = (79, 157, 255, 255)
    glow_color = (115, 194, 255, 255)

    draw.arc((200, 200, 824, 824), start=32, end=312, fill=ring_color, width=64)
    draw.arc((250, 250, 774, 774), start=210, end=26, fill=trace_color, width=38)
    draw.ellipse((456, 456, 568, 568), fill=(224, 236, 255, 255))
    draw.ellipse((480, 480, 544, 544), fill=(79, 157, 255, 255))

    draw.line((252, 594, 396, 520, 528, 602, 686, 430, 796, 494), fill=glow_color, width=24, joint="curve")
    draw.ellipse((770, 468, 840, 538), fill=ring_color)

    png_path = out_dir / "icon.png"
    image.save(png_path, format="PNG")

    ico_path = out_dir / "icon.ico"
    image.save(
      ico_path,
      format="ICO",
      sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    )

    icns_path = out_dir / "icon.icns"
    image.save(
      icns_path,
      format="ICNS",
      sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)]
    )

    print(f"Generated {png_path}")
    print(f"Generated {ico_path}")
    print(f"Generated {icns_path}")


if __name__ == "__main__":
    main()
