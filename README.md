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
| `data/entries/` | Real entries on the map, one file each, listed in `index.json` |
| `data/concepts/` | Topic and method pages (for example "Uralic languages", "Ancient DNA"), which entries link to. Same claim rules, but no place or time. A page's `aliases` are the words that link to it automatically: the first time one appears on a card, it becomes a dotted link to the page |
| `data/sources.json` | The shared list of sources that entries cite |
| `data/images.json` | Pictures on cards. Each is a Wikimedia Commons file that we link to, never copy. It says which cards show it, what it shows and how we know, and what kind of picture it is (the real thing, a replica, a reconstruction, a later illustration), with the author and licence read from Commons |
| `js/images.mjs` | The picture rules (allowed licences, labels) and how a picture is shown on a card |
| `tools/commons-credits.mjs` | Reads each picture's author, credit and licence from the Commons API. Run with `--write` after adding a picture; run without it to see if anything on Commons changed |
| `data/examples/` | Invented examples, marked `[EXAMPLE]`, shown only in example mode |
| `data/basemap/` | The landscape: coastlines, rivers and lakes from Natural Earth |
| `tools/check-data.mjs` | Checks every data file against the rules; runs automatically on each pull request |
| `tools/clip_natural_earth.py` | Recreates `data/basemap/` from Natural Earth's own files |
| `lib/maplibre-gl/` | MapLibre, the map engine (version 4.7.1), kept here so the site does not depend on another server |

## Handy links

Every card has its own address, so you can bookmark or share it, and the browser's Back button works:

- A single entry: `#entry=ws-regino-889`
- A topic page: `#page=uralic-languages`
- The list of everything: `#list`
- A year: add `&year=862`

## Rules for content

- Every claim has a real source that someone can check.
- Evidence and interpretation are kept apart, and every interpretation is attributed to whoever holds it.
- When sources disagree, both are shown side by side rather than one being picked.
- Uncertainty is marked honestly.
- Nothing is added unless it has been checked. Claims whose source is not yet checked stay hidden unless the reader turns on "Show unchecked claims".
- Claude may mark a source checked only after reading it in a copy anyone can open; the source record links that copy and says what language was read. Marc spot-checks a sample.
- A pin that is not exact says how it was placed. Written sources are pinned where the text was written, not where the events happened.

## Credits

- Landscape: [Natural Earth](https://www.naturalearthdata.com/), public domain.
- Pictures: linked from [Wikimedia Commons](https://commons.wikimedia.org/). Only public domain, CC0, CC BY and CC BY-SA files are used; each picture's author, source and licence are shown under it.
- Map engine: [MapLibre GL JS](https://maplibre.org/), BSD 3-Clause licence (see `lib/maplibre-gl/LICENSE.txt`).
- Medieval Latin passages were read through the [Mapping Medieval Peoples database](https://mmp.acdh-dev.oeaw.ac.at/) of the Austrian Academy of Sciences.
- Historical borders are drawn by this project from cited sources. No ready-made border dataset is used.
