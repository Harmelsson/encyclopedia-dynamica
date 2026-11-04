# Encyclopedia Dynamica

An interactive map-and-timeline encyclopedia of the world's history, built so that evidence comes first and interpretation is always optional, labelled and separate.

**Live site:** https://harmelsson.github.io/encyclopedia-dynamica/
**Example mode** (invented entries that show how a card looks): https://harmelsson.github.io/encyclopedia-dynamica/?examples

## How this repository works

- Every file that makes up the website lives here, and every change is saved as a version.
- Changes arrive as pull requests with a plain summary. Once a pull request is merged, the site updates within a few minutes.
- The site is published by GitHub Pages straight from the `main` branch. There is no build step: the files here are exactly the files the site serves.

## What is where

| Path | What it is |
| --- | --- |
| `index.html`, `css/`, `js/` | The map page |
| `js/rules.mjs` | The honesty rules (what counts as checked, how certainty is worked out), shared by the page and the checker |
| `data/entries/` | Real entries, one file each, listed in `index.json`. Empty until the first entries are sourced and checked |
| `data/sources.json` | The shared list of sources that entries cite |
| `data/examples/` | Invented examples, marked `[EXAMPLE]`, shown only in example mode |
| `data/basemap/` | The landscape: coastlines, rivers and lakes from Natural Earth |
| `tools/check-data.mjs` | Checks every data file against the rules; runs automatically on each pull request |
| `tools/clip_natural_earth.py` | Recreates `data/basemap/` from Natural Earth's own files |
| `lib/maplibre-gl/` | MapLibre, the map engine (version 4.7.1), kept here so the site does not depend on another server |

## Rules for content

- Every claim has a real source that someone can check.
- Evidence and interpretation are kept apart, and every interpretation is attributed to whoever holds it.
- When sources disagree, both are shown side by side rather than one being picked.
- Uncertainty is marked honestly.
- Nothing is added unless it has been checked. Claims whose source is not yet checked stay hidden unless the reader turns on "Show unchecked claims".

## Credits

- Landscape: [Natural Earth](https://www.naturalearthdata.com/), public domain.
- Map engine: [MapLibre GL JS](https://maplibre.org/), BSD 3-Clause licence (see `lib/maplibre-gl/LICENSE.txt`).
- Historical borders are drawn by this project from cited sources. No ready-made border dataset is used.
