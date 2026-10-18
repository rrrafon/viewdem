# DEM Viewer — PH Mountains

Interactive 3D terrain viewer for nine Philippine volcanoes and lakes, built
from this project's stream exporter (L0 whole-scene base + L1/L2 tile
pyramids, lossy-80 WebP textures, 5x-height buildings). Served as plain
static files — no backend, no build step.

**Live locally:**

```bash
python3 -m http.server 8123
# open http://localhost:8123
```

**Hosting:** pushed to GitHub and served from Settings → Pages (`.nojekyll`
is already in the repo root). GitHub limits: site < 1 GB (this build is
~0.97 GB) and no file > 100 MB (largest: Taal buildings GLB, 70 MB).

## The 9 datasets

| Dataset | Terrain pyramid | Buildings |
|---|---|---|
| Mount Mayon | L0 + 2x2 + 4x4 | 5x height, sheds filtered |
| Mount Kanlaon | L0 + 2x2 + 4x4 | 5x height, sheds filtered |
| Mount Isarog | L0 + 2x2 + 4x4 | 5x height, sheds filtered |
| Mount Bud Dajo | L0 + 2x2 + 4x4 | 5x height, sheds filtered |
| Mount Pinatubo | L0 + 2x2 + 4x4 | 5x height, sheds filtered |
| Mount Taal | L0 + 2x2 + 4x4 | 5x height, sheds filtered |
| Mount Banahaw | L0 + 2x2 + 4x4 | 5x height, sheds filtered |
| Mount Hibok-Hibok | L0 + 2x2 + 4x4 | 5x height, sheds filtered |
| Lake Buhi | L0 + 2x2 + 4x4 | 5x height, sheds filtered |

## Structure

```
index.html / main.js / stream.js   viewer app (classic + streaming paths)
vendor/                            vendored Three.js + addons
data/
├── datasets.json                  dataset switcher registry
├── manifest_<name>.json           one classic manifest per dataset
└── stream/<name>/
    ├── tileset.json               LOD levels + switch distances
    ├── elev.json                  256x256 click-readout elevation grid
    ├── L0/whole.glb + .webp       whole-scene base
    ├── L1/r{r}c{c}.glb + .webp    2x2 @ 100k tris
    └── L2/r{r}c{c}.glb + .webp    4x4 @ 150k tris
data/osm/<name>_buildings_lite.glb aligned OSM buildings (GLB)
```

## Regenerate (tools in ../geospatial_python/mesh_dem)

This repo is the **lite variant** for GitHub Pages. The full-quality
master site lives in `~/Documents/placedem/`. To rebuild the lite site:

```bash
# lite: L1@100k, L2@150k, WebP q80, 5x buildings with min-area filter
python lite_build.py --dir ~/Documents/_DEM_OSM_downloads/AERIAL/mtBanahaw/graded
```

(deps: `mesh_dem/maps_preprocess.py` for imagery grading, `mesh_dem/osm_buildings_to_mesh.py`
for buildings, `mesh_dem/export_stream.py` for the pyramids — see that
project's README/PLAN for the full pipeline.)

## Data sources & licenses

- **Terrain:** Copernicus DEM GLO-30 via OpenTopography (open data).
- **Imagery:** Copernicus Sentinel-2 quarterly mosaics (CC-BY-ish via
  Copernicus open access; graded per-dataset with the project tools).
- **Buildings:** OpenStreetMap via Overpass API — **ODbL**. Respect
  fair-use (bulk work should use regional extracts, e.g. Geofabrik).
- Buildings are shown at **5x height exaggeration**; terrain is true
  scale (1.0). Terrain textures use one shared white point per dataset so
  tiles stay tonally seamless.

## Viewer features

Dataset switcher (9), fly/orbit camera, click-to-read elevation + lat/lon,
L0→L1→L2 distance-based refinement, buildings toggle, elevation-grid
readout, mobile layout.
