#!/usr/bin/env python3
# SPDX-FileCopyrightText: Assault Consulting
# SPDX-License-Identifier: Apache-2.0

"""Generate placeholder application icons.

Two build-time facts make this necessary before any logo exists:

* the Tauri context macro reads ``icons/icon.png`` at compile time;
* ``tauri-build`` reads ``icons/icon.ico`` on Windows **even when bundling is
  disabled**.

Without both, ``cargo check`` fails on a runner with an error that points
nowhere near the cause. Generating them is cheaper than debugging that twice.

The mark is deliberately plain — a seal shape on a paper-coloured field, no
wordmark — so that nobody mistakes it for a final logo and ships it. Icons are
gitignored; they are build output, not source. When a real logo lands, remove
the ignore entry, commit the assets, and delete this script.

ICNS is not produced: Pillow can only write it on macOS, and nothing in the
current build reads it. It joins the real assets when signing does.
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - CI installs pillow before calling
    print("pillow is required: pip install pillow", file=sys.stderr)
    raise SystemExit(2) from None

OUT = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"

PAPER = (250, 250, 247, 255)
INK = (23, 25, 28, 255)
SEAL = (30, 107, 79, 255)

#: Sizes tauri expects to find alongside icon.png.
PNG_SIZES = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
}
#: Windows .ico carries several sizes in one file.
ICO_SIZES = [16, 32, 48, 64, 128, 256]


def render(size: int) -> Image.Image:
    """A seal on paper: a filled disc with a ring, centred, no text.

    Text at 16 px is mud, and a placeholder that looks finished is a
    placeholder that ships.
    """
    img = Image.new("RGBA", (size, size), PAPER)
    d = ImageDraw.Draw(img)

    pad = size * 0.18
    box = (pad, pad, size - pad, size - pad)
    d.ellipse(box, fill=SEAL)

    inner = size * 0.30
    d.ellipse(
        (inner, inner, size - inner, size - inner),
        outline=PAPER,
        width=max(1, round(size * 0.035)),
    )

    bar = size * 0.42
    d.line((bar, size / 2, size - bar, size / 2), fill=INK, width=max(1, round(size * 0.03)))
    return img


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)

    for name, size in PNG_SIZES.items():
        render(size).save(OUT / name, format="PNG")
        print(f"wrote {OUT / name} ({size}x{size})")

    # Pillow builds the multi-size .ico from one source image plus a size list.
    base = render(max(ICO_SIZES))
    ico = OUT / "icon.ico"
    base.save(ico, format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    print(f"wrote {ico} ({', '.join(f'{s}x{s}' for s in ICO_SIZES)})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
