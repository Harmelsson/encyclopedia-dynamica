"""Cut Natural Earth's physical layers down to the Magyar slice's region.

Natural Earth is public domain (https://www.naturalearthdata.com/about/terms-of-use/).
We keep only physical layers (land, rivers, lakes): no modern borders, cities or roads.

Usage: python3 tools/clip_natural_earth.py <folder with ne_50m_*.geojson> data/basemap
Source files: https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
"""
import json, sys
from pathlib import Path
from shapely.geometry import shape, mapping
from shapely import clip_by_rect, set_precision

# West, south, east, north in degrees: from western Europe to the Ob river.
BOX = (-25.0, 15.0, 110.0, 75.0)
LAYERS = {
    "ne_50m_land": "land",
    "ne_50m_lakes": "lakes",
    "ne_50m_rivers_lake_centerlines": "rivers",
}
KEEP = {"name", "featurecla", "scalerank"}

def main(src, out):
    src, out = Path(src), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    for ne, name in LAYERS.items():
        data = json.loads((src / f"{ne}.geojson").read_text())
        feats = []
        for f in data["features"]:
            g = set_precision(clip_by_rect(shape(f["geometry"]), *BOX), 0.001)
            if g.is_empty:
                continue
            props = {k: v for k, v in f["properties"].items() if k in KEEP and v is not None}
            feats.append({"type": "Feature", "properties": props, "geometry": mapping(g)})
        fc = {"type": "FeatureCollection",
              "source": f"Natural Earth 1:50m, {ne} (public domain), clipped to {BOX}",
              "features": feats}
        (out / f"{name}.geojson").write_text(json.dumps(fc, separators=(",", ":")))
        print(name, len(feats))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
