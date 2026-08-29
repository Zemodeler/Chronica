#!/usr/bin/env python3
"""Extract a geographic subset from a Natural Earth MBTiles archive.

The output is a standard XYZ tile tree plus a small manifest. It deliberately
copies only tiles intersecting the requested bounds, so scenario assets do not
carry a whole-world raster pyramid.
"""

from __future__ import annotations

import json
import math
import sqlite3
import sys
from pathlib import Path


WEST, SOUTH, EAST, NORTH = -25.0, 15.0, 60.0, 72.0


def tile_x(longitude: float, zoom: int) -> int:
    return math.floor((longitude + 180.0) / 360.0 * (2**zoom))


def tile_y(latitude: float, zoom: int) -> int:
    radians = math.radians(latitude)
    return math.floor((1.0 - math.asinh(math.tan(radians)) / math.pi) / 2.0 * (2**zoom))


def main(source: Path, destination: Path) -> None:
    connection = sqlite3.connect(source)
    max_zoom = connection.execute("SELECT MAX(zoom_level) FROM tiles").fetchone()[0]
    if max_zoom is None:
        raise RuntimeError("The source archive contains no tiles.")

    destination.mkdir(parents=True, exist_ok=True)
    levels: list[dict[str, object]] = []

    for zoom in range(max_zoom + 1):
        scale = 2**zoom
        minimum_x, maximum_x = tile_x(WEST, zoom), tile_x(EAST, zoom)
        minimum_y, maximum_y = tile_y(NORTH, zoom), tile_y(SOUTH, zoom)
        copied = 0

        for x in range(minimum_x, maximum_x + 1):
            for y in range(minimum_y, maximum_y + 1):
                tms_y = scale - 1 - y
                row = connection.execute(
                    "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
                    (zoom, x, tms_y),
                ).fetchone()
                if row is None:
                    continue
                target = destination / "tiles" / str(zoom) / str(x) / f"{y}.webp"
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(row[0])
                copied += 1

        levels.append({
            "zoom": zoom,
            "tileBounds": [minimum_x, minimum_y, maximum_x, maximum_y],
            "tileCount": copied,
        })

    manifest = {
        "name": "Natural Earth II — Europe and North Africa",
        "format": "webp",
        "scheme": "xyz",
        "projection": "Web Mercator (EPSG:3857)",
        "bounds": [WEST, SOUTH, EAST, NORTH],
        "minZoom": 0,
        "maxZoom": max_zoom,
        "tileSize": 256,
        "levels": levels,
        "source": "Natural Earth II with Shaded Relief, Water, and Drainages",
        "license": "Public domain",
    }
    (destination / "tiles.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: extract-natural-earth-region.py SOURCE.mbtiles DESTINATION")
    main(Path(sys.argv[1]), Path(sys.argv[2]))
