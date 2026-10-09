#!/usr/bin/env python3
"""Render the App Dock icons.

Three rounded squares plus a five-pointed star in the top-right slot, on a
transparent background, filled with a royal-blue-to-charcoal diagonal gradient.
Supersampled for anti-aliasing; writes PNGs with no third-party dependencies.

    python3 icons/make-icons.py
"""

import math
import struct
import zlib
from pathlib import Path

ROYAL_BLUE = (65, 105, 225)   # #4169e1
CHARCOAL = (54, 69, 79)       # #36454f

SIZES = (16, 32, 48, 128)
SAMPLES = 6                   # per axis, so 36 subsamples per pixel

# Layout in unit coordinates, 0..1 across the icon.
PAD = 0.07
GAP = 0.075
CELL = (1 - 2 * PAD - GAP) / 2
RADIUS = 0.11                 # rounded-square corner radius

STAR_OUTER = 0.215
STAR_INNER = 0.095


def cell(col, row):
    """Bounds of one grid slot: (x0, y0, x1, y1)."""
    x0 = PAD + col * (CELL + GAP)
    y0 = PAD + row * (CELL + GAP)
    return x0, y0, x0 + CELL, y0 + CELL


SQUARES = [cell(0, 0), cell(0, 1), cell(1, 1)]

_star_x0, _star_y0, _star_x1, _star_y1 = cell(1, 0)
STAR_CENTER = ((_star_x0 + _star_x1) / 2, (_star_y0 + _star_y1) / 2)

# Ten alternating points, first one straight up.
STAR = [
    (
        STAR_CENTER[0] + (STAR_OUTER if i % 2 == 0 else STAR_INNER)
        * math.cos(math.radians(-90 + i * 36)),
        STAR_CENTER[1] + (STAR_OUTER if i % 2 == 0 else STAR_INNER)
        * math.sin(math.radians(-90 + i * 36)),
    )
    for i in range(10)
]


def in_rounded_rect(x, y, bounds, r=RADIUS):
    x0, y0, x1, y1 = bounds
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    # Clamp to the inner rect, then the corner test is a plain circle test.
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r


def in_polygon(x, y, points):
    """Ray casting, counting crossings of a horizontal ray to the right."""
    inside = False
    j = len(points) - 1
    for i, (xi, yi) in enumerate(points):
        xj, yj = points[j]
        if (yi > y) != (yj > y) and x < xi + (y - yi) / (yj - yi) * (xj - xi):
            inside = not inside
        j = i
    return inside


def covered(x, y):
    return any(in_rounded_rect(x, y, b) for b in SQUARES) or in_polygon(x, y, STAR)


def gradient(x, y):
    """Royal blue at the top-left of the artwork, charcoal at the bottom-right.

    Normalised across the padded content span rather than the full canvas, so
    both endpoint colours actually appear instead of being clipped by the
    margin the shapes never reach into.
    """
    span = 1 - 2 * PAD
    t = min(max(((x + y) / 2 - PAD) / span, 0.0), 1.0)
    return tuple(round(a + (b - a) * t) for a, b in zip(ROYAL_BLUE, CHARCOAL))


def chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def render(size):
    step = 1.0 / (size * SAMPLES)
    raw = bytearray()

    for py in range(size):
        raw.append(0)  # PNG filter: none
        for px in range(size):
            hits = 0
            for sy in range(SAMPLES):
                y = (py * SAMPLES + sy + 0.5) * step
                for sx in range(SAMPLES):
                    x = (px * SAMPLES + sx + 0.5) * step
                    if covered(x, y):
                        hits += 1

            if hits == 0:
                raw.extend((0, 0, 0, 0))
                continue

            # Straight (non-premultiplied) alpha, so edges do not pick up a
            # dark fringe against light backgrounds.
            r, g, b = gradient((px + 0.5) / size, (py + 0.5) / size)
            raw.extend((r, g, b, round(hits / (SAMPLES * SAMPLES) * 255)))

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))


if __name__ == "__main__":
    out = Path(__file__).parent
    for size in SIZES:
        path = out / f"icon{size}.png"
        path.write_bytes(render(size))
        print(f"{path.name}  {path.stat().st_size} bytes")
