from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


OUT_DIR = Path("products/images")
OUT_DIR.mkdir(parents=True, exist_ok=True)


def font(size):
    candidates = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


def centered(draw, xy, text, fill, size):
    f = font(size)
    bbox = draw.textbbox((0, 0), text, font=f)
    x = xy[0] - (bbox[2] - bbox[0]) / 2
    y = xy[1] - (bbox[3] - bbox[1]) / 2
    draw.text((x, y), text, font=f, fill=fill)


def make_card(path, bg, accent, title, subtitle, badge):
    img = Image.new("RGB", (900, 1200), bg)
    d = ImageDraw.Draw(img)

    d.rounded_rectangle((170, 150, 730, 980), radius=48, fill=(255, 255, 255), outline=accent, width=8)
    d.rounded_rectangle((220, 210, 680, 510), radius=36, fill=accent)
    centered(d, (450, 325), title, (255, 255, 255), 62)
    centered(d, (450, 420), subtitle, (255, 255, 255), 34)

    d.ellipse((350, 570, 550, 770), fill=tuple(max(0, c - 35) for c in accent))
    centered(d, (450, 670), badge, (255, 255, 255), 46)
    d.rounded_rectangle((250, 820, 650, 900), radius=28, fill=(245, 247, 250))
    centered(d, (450, 858), "HANDHELD PRODUCT", (46, 52, 64), 28)

    img.save(path)


make_card(
    OUT_DIR / "SKU001.png",
    (232, 246, 235),
    (58, 143, 86),
    "山野小青菜",
    "新鲜直达",
    "FRESH",
)
make_card(
    OUT_DIR / "SKU002.png",
    (234, 242, 255),
    (73, 109, 190),
    "云感保湿乳",
    "清爽保湿",
    "MOIST",
)
make_card(
    OUT_DIR / "SKU003.png",
    (255, 246, 225),
    (198, 123, 43),
    "麦香坚果脆",
    "香脆小包",
    "CRISP",
)

print("Created sample product images in products/images")
