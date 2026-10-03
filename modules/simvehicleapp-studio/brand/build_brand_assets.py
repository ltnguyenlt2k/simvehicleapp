#!/usr/bin/env python3
"""Build SimVehicleApp brand assets from the PO brand board (M01-T06 rebrand).

Source: brand/source/simvehicleapp-brand-board.png (1536x1024, PO-provided, 2026-10-03).
Outputs (deterministic for the same input + Pillow version):
  apps/sim/public/brand/simvehicleapp/*   brand kit: concepts A–F, mark, lockups, app icons
  apps/sim/public/{logo,brandbook,brand,favicon}/…, icon.svg, …  Sim assets replaced IN PLACE (same paths,
      so no Sim code changes are needed; raster sizes capped at 1024 px because the source is a 1536 px board).
Usage: python3 brand/build_brand_assets.py      (from modules/simvehicleapp-studio)
"""
from __future__ import annotations

import base64
import io
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
HERE = Path(__file__).resolve().parent
BOARD = HERE / "source" / "simvehicleapp-brand-board.png"
PUBLIC = HERE.parent / "apps" / "sim" / "public"
KIT = PUBLIC / "brand" / "simvehicleapp"

NAVY = (11, 18, 32)                        # dark ink for light backgrounds
TILE_DARK = (24, 35, 56)                   # app icon (dark) tile, sampled from the board
TILE_LIGHT = (242, 246, 251)               # app icon (light) tile
RASTER_CAP = 1024

# Bounding boxes measured on the board (x0, y0, x1, y1), padded by a few px.
BOXES = {
    "concept-a-flow-synthesis": (133, 61, 421, 247),
    "concept-b-drive-forward": (671, 55, 884, 252),
    "concept-c-vehicle-graph": (1170, 42, 1385, 264),
    "concept-d-compile-pipeline": (149, 438, 400, 601),
    "concept-e-signal-wave": (626, 455, 927, 605),
    "concept-f-modular-build": (1175, 437, 1391, 616),
    "lockup-mark": (50, 800, 263, 943),
    "wordmark": (276, 827, 922, 924),
    "tagline": (277, 924, 889, 948),
}


# ---------- extraction ----------
NOISE_FLOOR = 0.16  # the board background is textured; alpha below this is texture, not artwork


def color_to_alpha(rgb: np.ndarray, bg: np.ndarray) -> Image.Image:
    """Remove the board background: minimal alpha such that pixel = a*fg + (1-a)*bg (GIMP color-to-alpha),
    then ramp alpha above NOISE_FLOOR so the background texture becomes fully transparent."""
    up = (rgb - bg) / (255.0 - bg)
    down = (bg - rgb) / np.maximum(bg, 1.0)
    alpha = np.clip(np.maximum(up, down).max(axis=2), 0, 1)
    a = np.maximum(alpha, 1e-6)[..., None]
    fg = np.clip((rgb - (1 - a) * bg) / a, 0, 255)
    out_alpha = np.clip((alpha - NOISE_FLOOR) / (1 - NOISE_FLOOR), 0, 1)
    out = np.dstack([fg, out_alpha * 255]).round().astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def crop(board: np.ndarray, name: str) -> Image.Image:
    x0, y0, x1, y1 = BOXES[name]
    region = board[y0:y1, x0:x1].astype(float)
    border = np.concatenate([region[0], region[-1], region[:, 0], region[:, -1]])
    img = color_to_alpha(region, np.median(border, axis=0))  # local background estimate
    return img.crop(img.getbbox())


def despeckle(img: Image.Image) -> Image.Image:
    """Artwork only (never text): drop faint, grey pixels left by the dark fold shading / board texture."""
    a = np.asarray(img).astype(float)
    sat = a[..., :3].max(axis=2) - a[..., :3].min(axis=2)
    a[(a[..., 3] < 160) & (sat < 70), 3] = 0
    return Image.fromarray(a.round().astype(np.uint8), "RGBA")


def recolor(img: Image.Image, color: tuple[int, int, int], only_neutral: bool = False) -> Image.Image:
    """Paint pixels `color` (keeping alpha). only_neutral: just low-saturation bright pixels (white text)."""
    a = np.asarray(img).astype(float)
    rgb = a[..., :3]
    mask = np.ones(rgb.shape[:2], bool)
    if only_neutral:
        mask = (rgb.max(axis=2) - rgb.min(axis=2) < 60) & (rgb.mean(axis=2) > 150)
    a[mask, :3] = color
    return Image.fromarray(a.round().astype(np.uint8), "RGBA")


def hstack(*parts: Image.Image, gap: int, align: str = "center") -> Image.Image:
    h = max(p.height for p in parts)
    w = sum(p.width for p in parts) + gap * (len(parts) - 1)
    out = Image.new("RGBA", (w, h))
    x = 0
    for p in parts:
        y = (h - p.height) // 2 if align == "center" else 0
        out.alpha_composite(p, (x, y))
        x += p.width + gap
    return out


def vstack(*parts: Image.Image, gap: int) -> Image.Image:
    w = max(p.width for p in parts)
    out = Image.new("RGBA", (w, sum(p.height for p in parts) + gap * (len(parts) - 1)))
    y = 0
    for p in parts:
        out.alpha_composite(p, ((w - p.width) // 2, y))
        y += p.height + gap
    return out


def rounded_tile(size: int, fill: tuple[int, int, int], radius: float = 0.225, ss: int = 4) -> Image.Image:
    big = Image.new("RGBA", (size * ss, size * ss))
    ImageDraw.Draw(big).rounded_rectangle([0, 0, size * ss - 1, size * ss - 1], radius=int(size * ss * radius), fill=fill + (255,))
    return big.resize((size, size), Image.LANCZOS)


def contain(img: Image.Image, w: int, h: int, pad: float = 0.08, bg: tuple | None = None) -> Image.Image:
    """Fit img inside (w, h) minus padding, centered, preserving its aspect ratio."""
    canvas = Image.new("RGBA", (w, h), (bg + (255,)) if bg else (0, 0, 0, 0))
    bw, bh = w * (1 - 2 * pad), h * (1 - 2 * pad)
    s = min(bw / img.width, bh / img.height)
    fit = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    canvas.alpha_composite(fit, ((w - fit.width) // 2, (h - fit.height) // 2))
    return canvas


def app_icon(mark: Image.Image, size: int, fill: tuple[int, int, int]) -> Image.Image:
    tile = rounded_tile(size, fill)
    tile.alpha_composite(contain(mark, size, size, pad=0.16))
    return tile


# ---------- writers ----------
def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def write_png(path: Path, img: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png_bytes(img))


def write_svg(path: Path, img: Image.Image, view_w: float, view_h: float, title: str) -> None:
    """SVG wrapper around an embedded PNG (the board is raster; keeps every existing <img src=*.svg> working)."""
    data = base64.b64encode(png_bytes(img)).decode()
    path.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{view_w:g}" height="{view_h:g}" viewBox="0 0 {view_w:g} {view_h:g}" role="img">'
        f"<title>{title}</title>"
        f'<image width="{view_w:g}" height="{view_h:g}" href="data:image/png;base64,{data}"/></svg>\n'
    )


def svg_size(path: Path) -> tuple[float, float]:
    m = re.search(r'viewBox=["\']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)', path.read_text(errors="ignore")[:4000])
    return (float(m.group(1)), float(m.group(2))) if m else (1.0, 1.0)


def capped(w: int, h: int) -> tuple[int, int]:
    s = min(1.0, RASTER_CAP / max(w, h))
    return max(1, round(w * s)), max(1, round(h * s))


def main() -> None:
    board = np.asarray(Image.open(BOARD).convert("RGB"))
    concepts = {k: despeckle(crop(board, k)) for k in BOXES if k.startswith("concept-")}
    mark = concepts["concept-a-flow-synthesis"]             # primary mark (= lockup mark, largest copy)
    word_dark = crop(board, "wordmark")                     # white "Sim"/"App" + blue "Vehicle": for dark bg
    word_light = recolor(word_dark, NAVY, only_neutral=True)
    tagline = crop(board, "tagline")
    mono_white = recolor(mark, (255, 255, 255))  # the board's monochrome tile is only ~105 px wide
    mono_dark = recolor(mono_white, NAVY)

    lockup_mark = mark.resize((round(mark.width * word_dark.height * 1.45 / mark.height), round(word_dark.height * 1.45)), Image.LANCZOS)
    gap = round(word_dark.height * 0.35)
    lockup_dark = hstack(lockup_mark, word_dark, gap=gap)
    lockup_light = hstack(lockup_mark, word_light, gap=gap)
    mono_word_dark = recolor(word_dark, NAVY)
    lockup_mono_dark = hstack(recolor(lockup_mark, NAVY), mono_word_dark, gap=gap)
    lockup_tagline_dark = vstack(lockup_dark, tagline, gap=round(gap * 0.6))
    lockup_tagline_mono = recolor(lockup_tagline_dark, NAVY)
    stacked_mono_dark = vstack(recolor(mark, NAVY), mono_word_dark, gap=gap)
    icon_dark = app_icon(mark, 1024, TILE_DARK)
    icon_light = app_icon(mark, 1024, TILE_LIGHT)

    # 1) brand kit
    kit = {
        **{f"{k}.png": v for k, v in concepts.items()},
        "mark.png": mark,
        "mark-mono-white.png": mono_white,
        "mark-mono-dark.png": mono_dark,
        "wordmark-on-dark.png": word_dark,
        "wordmark-on-light.png": word_light,
        "lockup-on-dark.png": lockup_dark,
        "lockup-on-light.png": lockup_light,
        "lockup-mono-dark.png": lockup_mono_dark,
        "lockup-tagline-on-dark.png": lockup_tagline_dark,
        "app-icon-dark.png": icon_dark,
        "app-icon-light.png": icon_light,
    }
    for name, img in kit.items():
        write_png(KIT / name, img)

    # 2) Sim assets replaced in place. Rule order matters (first match wins).
    def variant(rel: str) -> tuple[Image.Image, dict]:
        r = rel.lower()
        if r in ("logo/sim-landing.svg", "logo/wordmark.svg"):
            return lockup_dark, {"natural": True}
        if r == "logo/wordmark-dark.svg":
            return lockup_light, {"natural": True}
        if r.startswith("favicon/") or r in ("icon.svg", "email/broadcast/v0.5/logo.png") or "rounded" in r:
            return icon_dark, {"pad": 0.0}
        if r.startswith("brandbook/logo/"):
            return icon_dark, {"pad": 0.0, "bg": TILE_DARK}
        if r.startswith("logo/426-240/"):  # social/OG banners
            if "b&w" in r:
                return lockup_tagline_mono, {"pad": 0.12, "bg": (255, 255, 255)}
            return lockup_tagline_dark, {"pad": 0.12, "bg": NAVY}
        if r.startswith("brand/color/email/"):
            return lockup_light, {"pad": 0.04}
        if "/text/" in r or "workmark" in r:
            if "b&w" in r or "black" in r:
                return stacked_mono_dark, {"pad": 0.06}
            return (lockup_dark if "reverse" in r else lockup_light), {"pad": 0.04}
        if "b&w" in r or "black" in r:
            return mono_dark, {}
        if "reverse" in r:
            return mono_white, {}
        return mark, {}

    targets = [p for d in ("logo", "brandbook", "brand/color", "favicon") for p in (PUBLIC / d).rglob("*") if p.is_file()]
    targets += [PUBLIC / "icon.svg", PUBLIC / "email/broadcast/v0.5/logo.png"]
    for path in sorted(targets):
        rel = path.relative_to(PUBLIC).as_posix()
        img, opt = variant(rel)
        if path.suffix == ".svg":
            if opt.get("natural"):
                h = 22.0
                write_svg(path, contain(img, *capped(img.width * 4, img.height * 4), pad=0), round(h * img.width / img.height, 2), h, "SimVehicleApp")
            else:
                vw, vh = svg_size(path)
                pw, ph = capped(round(512 * vw / max(vw, vh)), round(512 * vh / max(vw, vh)))
                write_svg(path, contain(img, pw, ph, pad=opt.get("pad", 0.08), bg=opt.get("bg")), vw, vh, "SimVehicleApp")
        elif path.suffix == ".ico":
            icon = contain(img, 256, 256, pad=opt.get("pad", 0.08))
            icon.save(path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
        elif path.suffix == ".png":
            with Image.open(path) as old:
                w, h = capped(*old.size)
            write_png(path, contain(img, w, h, pad=opt.get("pad", 0.08), bg=opt.get("bg")))
    print(f"kit: {len(kit)} files in {KIT.relative_to(HERE.parent)}; replaced {len(targets)} Sim assets")


if __name__ == "__main__":
    main()
