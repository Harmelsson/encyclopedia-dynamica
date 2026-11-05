// Encyclopedia Dynamica: the map page.
// Reads the entry files, draws them on a MapLibre map, and shows one card at a time:
// an entry, a topic or method page, the list of everything, or the About page.
//
// Built to stay calm as the data grows:
//  - every entry has a min_zoom (it only appears once you zoom in that far) and an importance;
//  - nearby pins merge into one numbered bubble (clustering), which splits as you zoom in
//    or opens a list when the entries share one spot;
//  - the year filter, layer switches and "unchecked" switch are applied before clustering,
//    so the numbers on the bubbles always match what you could actually open.

import {
  LAYERS, CERT_CLASS, tierOf, sourceChecked, claimChecked, entryChecked,
  overallCertainty, inTime, formatYear,
} from './rules.mjs';

const params = new URLSearchParams(location.search);
const EXAMPLE_MODE = params.has('examples');
const YEAR_MIN = 400, YEAR_MAX = 1000;
const MAX_ZOOM = 9;

const KIND_LABEL = {
  concept: 'Topic page', method: 'Method page', people: 'People', language: 'Language', document: 'Document',
};

const state = {
  year: 900,
  showUnchecked: false,
  showGlow: true,
  layersOn: Object.fromEntries(Object.keys(LAYERS).map(k => [k, true])),
  entries: [],
  concepts: [],
  entryById: new Map(),
  conceptById: new Map(),
  sourcesById: {},
  view: null,          // { type: 'entry' | 'page' | 'list' | 'about' | 'here', id?, ids? }
  trail: [],           // breadcrumb trail of cards opened by following links
  markers: new Map(),
  listQuery: '',
};

// ---------- small helpers ----------

const $ = sel => document.querySelector(sel);
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
function store(key, value) {
  try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch { return null; }
}
const clampYear = y => Math.max(YEAR_MIN, Math.min(YEAR_MAX, Math.round(y)));
const yearSpan = t => t.from === t.to ? formatYear(t.from) : `${formatYear(t.from)} to ${formatYear(t.to)}`;

// ---------- loading data ----------

async function loadJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return res.json();
}

async function loadData() {
  if (EXAMPLE_MODE) {
    const ex = await loadJSON('data/examples/examples.json');
    return { entries: ex.entries, sources: ex.sources, concepts: [] };
  }
  const [index, sources, cindex] = await Promise.all([
    loadJSON('data/entries/index.json'),
    loadJSON('data/sources.json'),
    loadJSON('data/concepts/index.json'),
  ]);
  const [entries, concepts] = await Promise.all([
    Promise.all(index.entries.map(id => loadJSON(`data/entries/${id}.json`))),
    Promise.all(cindex.concepts.map(id => loadJSON(`data/concepts/${id}.json`))),
  ]);
  return { entries, sources: sources.sources, concepts };
}

// What the reader is allowed to see right now.
const isChecked = e => entryChecked(e, state.sourcesById);
const allowed = e => state.showUnchecked || isChecked(e);
function visibleClaims(list) {
  return (list || []).filter(c => state.showUnchecked || claimChecked(c, state.sourcesById));
}
// An entry counts as "at this date" when its layer is on, the slider year falls inside it, and it may be shown.
function entryVisible(e) {
  return state.layersOn[e.layer] && inTime(e, state.year) && allowed(e);
}
function entryPoint(e) {
  const p = e.place || {};
  return typeof p.lon === 'number' && typeof p.lat === 'number' ? [p.lon, p.lat] : null;
}

// ---------- the map ----------

const SEA = '#2a3036';
const LAND = '#4a4b47';
const EMPTY = { type: 'FeatureCollection', features: [] };

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      land:   { type: 'geojson', data: 'data/basemap/land.geojson',   attribution: 'Landscape: <a href="https://www.naturalearthdata.com/">Natural Earth</a> (public domain)' },
      lakes:  { type: 'geojson', data: 'data/basemap/lakes.geojson' },
      rivers: { type: 'geojson', data: 'data/basemap/rivers.geojson' },
      borders: { type: 'geojson', data: EMPTY },
      // Pins. Clustering merges nearby pins into a numbered bubble. clusterMaxZoom equals the
      // map's maximum zoom, so entries that share one spot stay merged and open as a list.
      entries: { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 46, clusterMaxZoom: MAX_ZOOM },
      // The same finds, unclustered, for the soft density glow.
      finds: { type: 'geojson', data: EMPTY },
    },
    layers: [
      { id: 'sea', type: 'background', paint: { 'background-color': SEA } },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': LAND } },
      { id: 'coast', type: 'line', source: 'land', paint: { 'line-color': '#5c5d58', 'line-width': 0.8 } },
      { id: 'lakes', type: 'fill', source: 'lakes', paint: { 'fill-color': SEA } },
      { id: 'rivers', type: 'line', source: 'rivers',
        paint: { 'line-color': '#5a6b78', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 7, 1.8] } },
      // Density glow: where dated finds (dig sites and DNA samples) cluster at this date.
      // It fades out as you zoom in and the individual pins take over.
      { id: 'finds-glow', type: 'heatmap', source: 'finds',
        paint: {
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 2, 28, 6, 70],
          'heatmap-intensity': 0.7,
          'heatmap-weight': 1,
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(143,179,166,0)', 0.3, 'rgba(143,179,166,0.18)', 1, 'rgba(184,167,122,0.42)'],
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.9, 6.5, 0],
        } },
      // Border shapes. A "zone" is a soft fill with a blurred edge and no hard line.
      { id: 'zone-fill', type: 'fill', source: 'borders', filter: ['==', ['get', 'kind'], 'zone'],
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'fillOpacity'] } },
      { id: 'zone-glow', type: 'line', source: 'borders', filter: ['==', ['get', 'kind'], 'zone'],
        paint: { 'line-color': ['get', 'color'], 'line-width': 14, 'line-blur': 12, 'line-opacity': ['get', 'edgeOpacity'] } },
      // A "line" is a crisp border that a source actually names.
      { id: 'border-line', type: 'line', source: 'borders', filter: ['==', ['get', 'kind'], 'line'],
        paint: { 'line-color': ['get', 'color'], 'line-width': 1.6, 'line-opacity': ['get', 'edgeOpacity'] } },
      // "Candidates" are several proposed outlines at equal weight, all dashed.
      { id: 'candidate-line', type: 'line', source: 'borders', filter: ['==', ['get', 'kind'], 'candidates'],
        paint: { 'line-color': ['get', 'color'], 'line-width': 1.4, 'line-dasharray': [3, 2], 'line-opacity': ['get', 'edgeOpacity'] } },
      // An invisible layer, so MapLibre prepares the pin data. The visible pins are HTML buttons (below),
      // which keeps them readable at every text size and usable with a keyboard.
      { id: 'entries-anchor', type: 'circle', source: 'entries', paint: { 'circle-radius': 0, 'circle-opacity': 0 } },
    ],
  },
  // Phones get a closer view of the steppe; wider screens see from the Carpathian Basin to the Urals.
  // Wide screens leave room for the panels on both sides, so every pin starts out in view.
  bounds: matchMedia('(max-width: 760px)').matches ? [[2, 40], [64, 58]] : [[3, 42], [63, 57]],
  fitBoundsOptions: { padding: matchMedia('(max-width: 760px)').matches
    ? { top: 150, bottom: 170, left: 10, right: 10 }
    : { top: 30, bottom: 170, left: 300, right: Math.min(420, innerWidth * 0.3) } },
  minZoom: 2.5,
  maxZoom: MAX_ZOOM,
  attributionControl: { compact: false },
  dragRotate: false,
  pitchWithRotate: false,
});
map.touchZoomRotate.disableRotation();
window.edMap = map; // handy for testing in the browser console
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

// Border entries become shapes on the map. Only shapes whose own claim is visible are drawn,
// and speculative shapes are never drawn by default.
function borderFeatures() {
  const feats = [];
  for (const e of state.entries) {
    if (e.layer !== 'border' || !state.layersOn.border) continue;
    if (!allowed(e)) continue;
    for (const s of e.shapes || []) {
      if (!(s.valid_from <= state.year && state.year <= s.valid_to)) continue;
      if (s.certainty === 'speculative') continue;
      const checked = claimChecked(s, state.sourcesById);
      if (!checked && !state.showUnchecked) continue;
      const strength = { 'well established': 1, 'reasonably supported': 0.7, 'disputed or uncertain': 0.45 }[s.certainty] ?? 0.4;
      const dim = checked ? 1 : 0.5;
      feats.push({
        type: 'Feature', geometry: s.geometry,
        properties: { kind: s.shape_kind, entry: e.id, color: LAYERS.border.color, fillOpacity: 0.22 * strength * dim, edgeOpacity: 0.8 * strength * dim },
      });
    }
  }
  return { type: 'FeatureCollection', features: feats };
}

// The pins for this year, layer choice and zoom level.
function pinFeatures(zoom) {
  const feats = [];
  for (const e of state.entries) {
    if (e.layer === 'border' || !entryVisible(e)) continue;
    const pt = entryPoint(e);
    if (!pt || zoom + 0.001 < (e.min_zoom ?? 0)) continue;
    const cert = overallCertainty(visibleClaims(e.claims));
    feats.push({
      type: 'Feature', geometry: { type: 'Point', coordinates: pt },
      properties: {
        id: e.id, layer: e.layer, importance: e.importance ?? 1,
        cert: CERT_CLASS[cert] || 'low', unchecked: !isChecked(e),
        approx: e.place.precision !== 'exact',
      },
    });
  }
  return { type: 'FeatureCollection', features: feats };
}
function findFeatures() {
  return { type: 'FeatureCollection', features: state.entries
    .filter(e => (e.layer === 'dig site' || e.layer === 'ancient DNA') && entryVisible(e) && entryPoint(e))
    .map(e => ({ type: 'Feature', geometry: { type: 'Point', coordinates: entryPoint(e) }, properties: {} })) };
}

let lastZoomKey = null;
function refreshMap() {
  const zoom = map.getZoom();
  lastZoomKey = Math.floor(zoom * 2);
  for (const m of state.markers.values()) m.remove();
  state.markers.clear();
  map.getSource('entries')?.setData(pinFeatures(zoom));
  map.getSource('finds')?.setData(state.showGlow ? findFeatures() : EMPTY);
  map.getSource('borders')?.setData(borderFeatures());
}
// Entries appear and disappear with zoom, so rebuild the pins when the zoom crosses a half step.
map.on('zoomend', () => { if (Math.floor(map.getZoom() * 2) !== lastZoomKey) refreshMap(); });

function pinMarker(e, props) {
  const showLabel = props.importance >= 3 || map.getZoom() >= 5;
  const btn = el('button', {
    class: `marker cert-${props.cert}${props.unchecked ? ' unchecked' : ''}${props.approx ? ' approx' : ''}${currentEntryId() === e.id ? ' selected' : ''}`,
    type: 'button',
    'data-id': e.id,
    'aria-label': `${e.title}${props.unchecked ? ' (not yet checked)' : ''}${props.approx ? ' (rough location)' : ''}`,
    style: `--pin: ${LAYERS[e.layer].color}`,
    onclick: ev => { ev.stopPropagation(); go({ type: 'entry', id: e.id }); },
  },
  props.approx ? el('span', { class: 'halo', 'aria-hidden': 'true' }) : null,
  el('span', { class: 'pin' }),
  showLabel ? el('span', { class: 'marker-label' }, e.short_title || e.title) : null);
  // The button sits inside a wrapper, because MapLibre puts its own generic label on the marker element.
  return new maplibregl.Marker({ element: el('div', { class: 'marker-wrap' }, btn) });
}

function clusterMarker(f) {
  const id = f.properties.cluster_id, n = f.properties.point_count;
  const btn = el('button', {
    class: 'cluster', type: 'button', 'aria-label': `${n} entries here. Open or zoom in.`,
    style: `--size: ${Math.min(52, 30 + Math.log2(n) * 6)}px`,
    onclick: async ev => {
      ev.stopPropagation();
      const src = map.getSource('entries');
      const zoom = await src.getClusterExpansionZoom(id);
      if (zoom <= MAX_ZOOM && zoom > map.getZoom() + 0.05) {
        map.easeTo({ center: f.geometry.coordinates, zoom });
      } else {
        const leaves = await src.getClusterLeaves(id, 500, 0);
        go({ type: 'here', ids: leaves.map(l => l.properties.id) });
      }
    },
  }, el('span', { class: 'cluster-n' }, n));
  return new maplibregl.Marker({ element: el('div', { class: 'marker-wrap' }, btn) });
}

// Draw HTML pins and bubbles for whatever MapLibre currently shows.
function drawMarkers() {
  if (!map.getSource('entries') || !map.isSourceLoaded('entries')) return;
  const seen = new Map();
  for (const f of map.querySourceFeatures('entries')) {
    const key = f.properties.cluster ? `c${f.properties.cluster_id}` : `e${f.properties.id}`;
    if (seen.has(key)) continue;
    let m = state.markers.get(key);
    if (!m) {
      if (f.properties.cluster) m = clusterMarker(f);
      else {
        const e = state.entryById.get(f.properties.id);
        if (!e) continue;
        m = pinMarker(e, f.properties);
      }
      m.setLngLat(f.geometry.coordinates).addTo(map);
    }
    seen.set(key, m);
  }
  for (const [key, m] of state.markers) if (!seen.has(key)) m.remove();
  state.markers = seen;
}
let drawQueued = false;
map.on('render', () => {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; drawMarkers(); });
});

function markSelected() {
  const id = currentEntryId();
  for (const b of document.querySelectorAll('.marker')) b.classList.toggle('selected', b.dataset.id === id);
}
const currentEntryId = () => (state.view && state.view.type === 'entry' ? state.view.id : null);

// ---------- address bar: every card has its own link, and Back works ----------

function viewToHash(v) {
  const p = new URLSearchParams();
  if (v?.type === 'entry') p.set('entry', v.id);
  else if (v?.type === 'page') p.set('page', v.id);
  else if (v?.type === 'list') p.set('list', '');
  else if (v?.type === 'about') p.set('about', '');
  else if (v?.type === 'here') p.set('here', v.ids.join(','));
  p.set('year', String(state.year));
  return '#' + p.toString().replace(/=(&|$)/g, '$1');
}
function hashToView() {
  const p = new URLSearchParams(location.hash.slice(1));
  const y = Number(p.get('year'));
  const year = Number.isFinite(y) && p.has('year') ? clampYear(y) : null;
  let view = null;
  if (p.has('entry')) view = { type: 'entry', id: p.get('entry') };
  else if (p.has('page')) view = { type: 'page', id: p.get('page') };
  else if (p.has('list')) view = { type: 'list' };
  else if (p.has('about')) view = { type: 'about' };
  else if (p.has('here')) view = { type: 'here', ids: p.get('here').split(',').filter(Boolean) };
  return { view, year };
}
const sameView = (a, b) => !!a && !!b && a.type === b.type && (a.id || '') === (b.id || '') && (a.ids || []).join() === (b.ids || []).join();

let pendingTrail = null;
// Open a card. Following a link inside a card adds to the breadcrumb trail; anything else starts a new one.
function go(view, { fromLink = false } = {}) {
  const linkable = v => v && (v.type === 'entry' || v.type === 'page');
  if (fromLink && linkable(state.view) && linkable(view)) pendingTrail = [...state.trail, view];
  else pendingTrail = linkable(view) ? [view] : [];
  // Opening an entry that is not "at this date" moves the slider to it, so its pin shows.
  if (view?.type === 'entry') {
    const e = state.entryById.get(view.id);
    if (e && e.time && !inTime(e, state.year)) setYear(clampYear((Math.max(e.time.from, YEAR_MIN) + Math.min(e.time.to, YEAR_MAX)) / 2), false);
  }
  const h = viewToHash(view);
  if (h === location.hash) applyHash(); else location.hash = h;
}
function applyHash() {
  const { view, year } = hashToView();
  if (year != null && year !== state.year) setYear(year, false);
  // A link without a year that opens an entry from another time moves the slider to that entry.
  if (year == null && view?.type === 'entry') {
    const e = state.entryById.get(view.id);
    if (e && e.time && !inTime(e, state.year)) setYear(clampYear((Math.max(e.time.from, YEAR_MIN) + Math.min(e.time.to, YEAR_MAX)) / 2), false);
  }
  if (pendingTrail) state.trail = pendingTrail;
  else {
    // Arrived by Back/Forward or a pasted link: reuse the trail if the card is on it.
    const i = state.trail.findIndex(t => sameView(t, view));
    state.trail = i >= 0 ? state.trail.slice(0, i + 1) : (view && (view.type === 'entry' || view.type === 'page') ? [view] : []);
  }
  pendingTrail = null;
  state.view = view;
  renderCard();
  update();
  if (view?.type === 'entry') bringIntoView(state.entryById.get(view.id));
}

// If an opened entry's pin is hidden behind a panel or off screen, glide the map to it.
function bringIntoView(e) {
  const pt = e && entryPoint(e);
  if (!pt) return;
  const r = map.getContainer().getBoundingClientRect();
  const card = $('#card').getBoundingClientRect();
  const left = $('.left-col').getBoundingClientRect();
  const phone = matchMedia('(max-width: 760px)').matches;
  const free = phone
    ? { x0: 16, x1: r.width - 16, y0: left.bottom + 8, y1: (card.height ? card.top : r.height - 180) - 8 }
    : { x0: left.right + 16, x1: card.left - 16, y0: 16, y1: r.height - 180 };
  const p = map.project(pt);
  if (p.x > free.x0 && p.x < free.x1 && p.y > free.y0 && p.y < free.y1) return;
  const cx = (free.x0 + free.x1) / 2, cy = (free.y0 + free.y1) / 2;
  map.easeTo({ center: pt, offset: [cx - r.width / 2, cy - r.height / 2], duration: 900 });
}
window.addEventListener('hashchange', applyHash);

function setYear(y, writeHash = true) {
  state.year = y;
  $('#year').value = String(y);
  if (writeHash) history.replaceState(null, '', viewToHash(state.view));
}

// ---------- side panels ----------

function renderLayers() {
  const list = $('#layer-list');
  list.replaceChildren();
  for (const [key, layer] of Object.entries(LAYERS)) {
    const n = state.entries.filter(e => e.layer === key && allowed(e)).length;
    list.append(el('button', {
      class: 'layer-btn', type: 'button', 'aria-pressed': String(state.layersOn[key]),
      onclick: () => { state.layersOn[key] = !state.layersOn[key]; update(); },
    }, el('span', { class: 'swatch', style: `background:${layer.color}` }), layer.label, el('span', { class: 'count' }, n)));
  }
}

function renderTime() {
  $('#year-label').textContent = formatYear(state.year);
  const here = state.entries.filter(entryVisible);
  const pinned = here.filter(e => entryPoint(e)).length;
  const unplaced = here.length - pinned;
  const hiddenUnchecked = state.entries.filter(e => !isChecked(e)).length;
  let txt = `${here.length} ${here.length === 1 ? 'entry' : 'entries'} at this date`;
  if (unplaced) txt += ` · ${unplaced} with no map place`;
  if (!state.showUnchecked && hiddenUnchecked) txt += ` · ${hiddenUnchecked} unchecked hidden`;
  $('#count-label').textContent = txt;

  // Each entry's time span as a faint bar under the slider: darker where more entries overlap.
  const strip = $('#tick-strip');
  strip.replaceChildren();
  const span = YEAR_MAX - YEAR_MIN;
  for (const e of state.entries) {
    if (!e.time || !state.layersOn[e.layer] || !allowed(e)) continue;
    const a = Math.max(YEAR_MIN, e.time.from), b = Math.min(YEAR_MAX, e.time.to);
    if (a > b) continue;
    strip.append(el('span', {
      class: 'tick', style: `left:${((a - YEAR_MIN) / span) * 100}%; width:max(3px, ${((b - a) / span) * 100}%); background:${LAYERS[e.layer].color}`,
    }));
  }

  // The open entry's time span, as a soft band rather than a sharp line.
  const band = $('#range-band');
  const e = state.entryById.get(currentEntryId());
  if (e && e.time) {
    const a = Math.max(YEAR_MIN, e.time.from), b = Math.min(YEAR_MAX, e.time.to);
    band.style.left = `${((a - YEAR_MIN) / span) * 100}%`;
    band.style.width = `${Math.max(1, ((b - a) / span) * 100)}%`;
    band.hidden = false;
  } else band.hidden = true;
}

// ---------- cards ----------

function cardShell(...children) {
  const crumbs = state.trail.length > 1 ? el('nav', { class: 'trail', 'aria-label': 'Your path' },
    el('button', { type: 'button', class: 'linkish', onclick: () => history.back() }, '← Back'),
    el('span', { class: 'trail-path' }, state.trail.map((t, i) => {
      const item = t.type === 'entry' ? state.entryById.get(t.id) : state.conceptById.get(t.id);
      const name = item ? (item.short_title || item.title) : t.id;
      const last = i === state.trail.length - 1;
      return [i ? ' › ' : '', last ? el('span', { 'aria-current': 'page' }, name)
        : el('a', { href: viewToHash(t), onclick: ev => { ev.preventDefault(); pendingTrail = state.trail.slice(0, i + 1); location.hash = viewToHash(t); } }, name)];
    }))) : null;
  const body = el('article', {},
    el('button', { class: 'close-btn', type: 'button', 'aria-label': 'Close card', onclick: () => go(null) }, '×'),
    crumbs, ...children);
  $('#card-body').replaceChildren(body);
  $('#card').scrollTop = 0;
  document.body.classList.add('card-open');
}

function renderCard() {
  const v = state.view;
  if (!v) return renderEmptyCard();
  if (v.type === 'list') return renderListCard();
  if (v.type === 'about') return renderAboutCard();
  if (v.type === 'here') return renderHereCard(v.ids);
  const item = v.type === 'entry' ? state.entryById.get(v.id) : state.conceptById.get(v.id);
  if (!item) return cardShell(el('h2', { class: 'title' }, 'Not found'), el('p', {}, `Nothing here is called “${v.id}”. It may have been renamed.`));
  if (!allowed(item)) return cardShell(el('h2', { class: 'title' }, item.title), el('p', { class: 'hint' }, 'This card is not fully checked yet. Turn on “Show unchecked claims” to see it.'));
  renderItemCard(item, v.type === 'page');
}

function renderEmptyCard() {
  const total = state.entries.length;
  const checked = state.entries.filter(isChecked).length;
  let status;
  if (EXAMPLE_MODE) {
    status = el('p', {}, 'These entries are invented placeholders. They show how a card is laid out and how unchecked claims behave. Turn on "Show unchecked claims" to see the greyed-out ones.');
  } else if (total === 0) {
    status = el('p', {}, 'No entries have been added yet.');
  } else {
    status = el('p', {}, `${checked} of ${total} entries are fully checked, plus ${state.concepts.length} topic and method pages.`);
  }
  $('#card-body').replaceChildren(el('div', { class: 'empty' },
    el('h2', {}, 'Pick a point on the map'),
    el('p', {}, 'Drag the time slider to see what existed when. Each card starts with the bare fact and its source. Interpretations stay folded until you open them.'),
    el('p', {}, 'A numbered bubble holds several entries: click it to zoom in or to list them. A pin with a soft ring has a rough location.'),
    status,
    el('p', {}, el('a', { href: '#list', onclick: ev => { ev.preventDefault(); go({ type: 'list' }); } }, 'See everything as a list'),
      ' · ', el('a', { href: '#about', onclick: ev => { ev.preventDefault(); go({ type: 'about' }); } }, 'How this map works')),
  ));
  document.body.classList.remove('card-open');
}

function sourceMarkers(refs, numbering) {
  return el('span', { class: 'markers' }, (refs || []).map(r => `[${numbering.get(r.id)}]`).join(' '));
}

function claimLine(c, numbering) {
  const ok = claimChecked(c, state.sourcesById);
  return el('li', { class: `claim${ok ? '' : ' unchecked'}` },
    el('span', { class: `dot dot-${CERT_CLASS[c.certainty] || 'low'}`, title: `${c.certainty}: ${c.certainty_reason}` }),
    el('span', {},
      c.text, ' ', sourceMarkers(c.sources, numbering),
      el('span', { class: 'reason' }, `${cap(c.certainty)}. ${c.certainty_reason}`),
      ok ? null : el('span', { class: 'unchecked-note' }, 'Source not yet checked'),
    ));
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function linkTo(l) {
  if (l.entry) {
    const t = state.entryById.get(l.entry);
    if (t && allowed(t)) return el('a', { href: viewToHash({ type: 'entry', id: t.id }), onclick: ev => { ev.preventDefault(); go({ type: 'entry', id: t.id }, { fromLink: true }); } }, t.title);
    return `${l.label || l.entry} (not shown yet)`;
  }
  const c = state.conceptById.get(l.concept);
  if (c && allowed(c)) return el('a', { href: viewToHash({ type: 'page', id: c.id }), onclick: ev => { ev.preventDefault(); go({ type: 'page', id: c.id }, { fromLink: true }); } }, c.title);
  return el('span', { class: 'placeholder' }, `${l.label || l.concept} (page not written yet)`);
}

// Which entries and pages link here. Every link works both ways.
function backlinks(item, isPage) {
  const key = isPage ? 'concept' : 'entry';
  return [...state.entries.map(e => ({ e, type: 'entry' })), ...state.concepts.map(e => ({ e, type: 'page' }))]
    .filter(({ e }) => e.id !== item.id && allowed(e) && (e.links || []).some(l => l[key] === item.id))
    .map(({ e, type }) => ({ [type === 'entry' ? 'entry' : 'concept']: e.id }));
}

function sourceItem(id, locators) {
  const s = state.sourcesById[id];
  if (!s) return el('li', {}, `Unknown source “${id}”`);
  const ok = sourceChecked(s);
  const bits = [s.type, `tier ${tierOf(s)}`];
  if (s.distance) bits.push(`written ${s.distance === 'unknown' ? 'at an unknown distance from the events' : s.distance === 'later' ? 'later than the events' : s.distance === 'contemporary' ? 'at the time' : s.distance}`);
  if (s.peer_review && s.type !== 'primary text') bits.push(s.peer_review);
  return el('li', { class: `src${ok ? '' : ' unchecked'}` },
    s.link ? el('a', { href: s.link, target: '_blank', rel: 'noopener' }, s.reference) : s.reference,
    el('span', { class: 'src-type' }, ` · ${bits.join(', ')} · at ${[...locators].join('; ')}`),
    ok ? el('span', { class: 'src-check' }, `Checked by ${s.checked.by} on ${s.checked.on}`,
      s.checked.copy ? [' in ', el('a', { href: s.checked.copy, target: '_blank', rel: 'noopener' }, 'this open copy')] : null,
      s.checked.read_in ? `. ${s.checked.read_in}` : '') : el('span', { class: 'unchecked-note' }, 'Source not yet checked'),
    [s.distance_note, s.tier_note, s.quotes ? `Quotes: ${s.quotes}` : null, s.derives_from_note].filter(Boolean)
      .map(t => el('span', { class: 'src-note' }, t)),
  );
}

function renderItemCard(e, isPage) {
  const evidence = visibleClaims((e.claims || []).filter(c => c.kind === 'evidence'));
  const interps = visibleClaims((e.claims || []).filter(c => c.kind === 'interpretation'));
  const dating = visibleClaims(e.dating_methods);
  const shown = [...evidence, ...dating, ...interps];
  const shownIds = new Set(shown.map(c => c.id));
  const claimById = Object.fromEntries([...(e.claims || []), ...(e.dating_methods || [])].map(c => [c.id, c]));
  // A contradiction shows only when every side of it can be shown.
  const clashes = (e.contradictions || []).filter(x => x.claims.every(id => shownIds.has(id)));

  // Number the sources in the order they are first cited.
  const numbering = new Map(), locators = new Map();
  for (const c of shown) for (const r of c.sources || []) {
    if (!numbering.has(r.id)) { numbering.set(r.id, numbering.size + 1); locators.set(r.id, new Set()); }
    locators.get(r.id).add(r.locator);
  }
  if (e.place?.source && !numbering.has(e.place.source.id)) {
    numbering.set(e.place.source.id, numbering.size + 1); locators.set(e.place.source.id, new Set());
  }
  if (e.place?.source) locators.get(e.place.source.id).add(`${e.place.source.locator} (map position)`);

  const cert = overallCertainty(evidence);
  const checked = isChecked(e);
  const mainInterps = interps.filter(c => c.certainty !== 'speculative');
  const specInterps = interps.filter(c => c.certainty === 'speculative');

  const interpBlock = c => el('div', { class: 'interp' },
    el('div', {}, c.text, ' ', sourceMarkers(c.sources, numbering)),
    el('span', { class: 'meta' }, 'Held by: ', (c.held_by || []).map(h => h.who).join('; ')),
    (c.rests_on || []).length ? el('span', { class: 'meta' }, 'Rests on: ', c.rests_on.map(id => claimById[id]?.text || id).join(' · ')) : null,
    el('span', { class: 'meta' }, `${cap(c.certainty)}. ${c.certainty_reason}`),
    claimChecked(c, state.sourcesById) ? null : el('span', { class: 'unchecked-note' }, 'Source not yet checked'),
  );

  const p = e.place || {};
  const whereLine = isPage ? null : el('p', { class: 'when-where' },
    `${yearSpan(e.time)} (${e.time.precision})`,
    p.label ? ` · ${p.role === 'written at' ? 'Written at: ' : ''}${p.label}` : '',
    p.precision && p.precision !== 'unknown' ? ` (place ${p.precision})` : '');
  // "Linked from" lists only links that do not already appear under "Follow a thread".
  const own = new Set((e.links || []).map(l => (l.entry ? 'e:' + l.entry : 'c:' + l.concept)));
  const back = backlinks(e, isPage).filter(l => !own.has(l.entry ? 'e:' + l.entry : 'c:' + l.concept));

  cardShell(
    el('div', { class: 'card-tags' },
      el('span', { class: 'tag' }, isPage ? (KIND_LABEL[e.kind] || 'Page') : LAYERS[e.layer].label),
      cert ? el('span', { class: 'tag tag-cert', title: 'The badge is the lowest certainty among the evidence shown, so one weak link is never hidden.' }, cert) : null,
      checked ? null : el('span', { class: 'tag', style: 'color: var(--warn)' }, 'Not yet checked'),
    ),
    el('h2', { class: 'title' }, e.title),
    whereLine,
    p.note ? el('p', { class: 'place-note' }, p.note) : null,

    el('section', {}, el('h3', {}, isPage ? 'In short' : 'The fact'),
      el('p', { style: 'margin: 0 0 8px' }, e.fact_summary),
      evidence.length ? el('ul', { class: 'claim-list' }, evidence.map(c => claimLine(c, numbering))) : (isPage ? null : el('p', { class: 'hint' }, 'No checked evidence to show yet.'))),

    el('section', {}, el('h3', {}, 'Sources'),
      numbering.size ? el('ol', {}, [...numbering.keys()].map(id => sourceItem(id, locators.get(id)))) : el('p', { class: 'hint' }, 'None shown.')),

    dating.length ? el('section', {}, el('h3', {}, 'How it is dated'),
      el('ul', { class: 'claim-list' }, dating.map(c => claimLine(c, numbering)))) : null,

    mainInterps.length || specInterps.length ? el('section', {},
      el('details', { class: 'interps' },
        el('summary', {}, `Interpretations (${mainInterps.length})`),
        el('p', { class: 'hint' }, 'What people think the evidence means. Each view says who holds it and what it rests on.'),
        mainInterps.map(interpBlock),
        specInterps.length ? el('details', { class: 'speculative' },
          el('summary', {}, `Speculative views (${specInterps.length}), little or no direct evidence`),
          specInterps.map(interpBlock)) : null,
      )) : null,

    clashes.length ? el('section', {}, el('h3', {}, 'Where the evidence clashes'),
      clashes.map(x => el('div', { class: 'clash' },
        el('p', { class: 'clash-what' }, x.what_differs),
        el('div', { class: 'clash-sides' }, x.claims.map(id => el('div', { class: 'clash-side' },
          claimById[id].text,
          claimById[id].held_by ? el('span', { class: 'meta' }, '— ', claimById[id].held_by.map(h => h.who).join('; ')) : null))),
      ))) : null,

    (e.open_questions || []).length ? el('section', {}, el('h3', {}, 'Still unknown'),
      el('ul', {}, e.open_questions.map(q => el('li', {}, q.text)))) : null,

    (e.links || []).length ? el('section', {}, el('h3', {}, 'Follow a thread'),
      el('ul', { class: 'thread-list' }, e.links.map(l => el('li', {}, linkTo(l))))) : null,

    back.length ? el('section', {}, el('h3', {}, 'Linked from'),
      el('ul', { class: 'thread-list' }, back.map(l => el('li', {}, linkTo(l))))) : null,

    el('section', {}, el('h3', {}, 'My notes'),
      el('textarea', {
        class: 'notes', 'aria-label': 'My private notes on this card',
        placeholder: 'Private to you, saved only in this browser.',
        oninput: ev => store(`notes:${e.id}`, ev.target.value),
      }, store(`notes:${e.id}`) || '')),

    el('footer', {},
      `Review status: ${e.review.status}`,
      e.review.by ? ` · checked by ${e.review.by} on ${e.review.on}` : '',
      e.review.note ? `. ${e.review.note}` : '',
      (e.change_notes || []).length ? ` · ${e.change_notes.length} change note(s)` : ''),
  );
}

function listRow(item, type) {
  const isEntry = type === 'entry';
  const cert = overallCertainty(visibleClaims((item.claims || []).filter(c => c.kind === 'evidence')));
  const color = isEntry ? LAYERS[item.layer].color : 'var(--muted)';
  return el('li', {},
    el('a', { class: 'list-row', href: viewToHash({ type, id: item.id }), onclick: ev => { ev.preventDefault(); go({ type, id: item.id }); } },
      el('span', { class: 'swatch', style: `background:${color}` }),
      el('span', { class: 'list-main' },
        el('span', { class: 'list-title' }, item.title),
        el('span', { class: 'list-meta' }, isEntry ? `${yearSpan(item.time)} · ${LAYERS[item.layer].label}${entryPoint(item) ? '' : ' · no map place'}` : (KIND_LABEL[item.kind] || 'Page'),
          cert ? ` · ${cert}` : '')),
    ));
}

function renderListCard() {
  const results = el('div', { class: 'list-results' });
  const fill = () => {
    const q = state.listQuery.trim().toLowerCase();
    const match = x => !q || `${x.title} ${x.short_title || ''} ${x.fact_summary}`.toLowerCase().includes(q);
    const entries = state.entries.filter(e => allowed(e) && match(e)).sort((a, b) => a.time.from - b.time.from || a.title.localeCompare(b.title));
    const pages = state.concepts.filter(c => allowed(c) && match(c)).sort((a, b) => a.title.localeCompare(b.title));
    results.replaceChildren(
      el('h3', {}, `Entries (${entries.length}), oldest first`),
      entries.length ? el('ul', { class: 'list' }, entries.map(e => listRow(e, 'entry'))) : el('p', { class: 'hint' }, 'No entries match.'),
      el('h3', {}, `Topic and method pages (${pages.length})`),
      pages.length ? el('ul', { class: 'list' }, pages.map(c => listRow(c, 'page'))) : el('p', { class: 'hint' }, 'No pages match.'),
    );
  };
  const input = el('input', {
    type: 'search', class: 'search', placeholder: 'Search titles and summaries', 'aria-label': 'Search entries and pages', value: state.listQuery,
    oninput: ev => { state.listQuery = ev.target.value; fill(); },
  });
  fill();
  cardShell(el('h2', { class: 'title' }, 'Everything in Encyclopedia Dynamica'),
    el('p', { class: 'hint' }, 'Including entries with no known place on the map, and pages for topics and methods.'),
    input, results);
}

function renderHereCard(ids) {
  const items = ids.map(id => state.entryById.get(id)).filter(e => e && allowed(e))
    .sort((a, b) => (b.importance ?? 1) - (a.importance ?? 1) || a.time.from - b.time.from);
  cardShell(el('h2', { class: 'title' }, `${items.length} entries at this spot`),
    el('p', { class: 'hint' }, 'These entries share one location on the map at this date, so their pins sit on top of each other.'),
    el('ul', { class: 'list' }, items.map(e => listRow(e, 'entry'))));
}

function renderAboutCard() {
  const nSources = Object.keys(state.sourcesById).length;
  cardShell(
    el('h2', { class: 'title' }, 'How this map works'),
    el('section', {}, el('h3', {}, 'What you are looking at'),
      el('p', {}, 'An encyclopedia you explore on a map and a timeline. Every card starts with what a source actually says or what a study actually found. What it means is kept apart, folded under “Interpretations”, and always says who thinks so.')),
    el('section', {}, el('h3', {}, 'How sure are we?'),
      el('ul', {},
        el('li', {}, el('b', {}, 'Well established: '), 'what the source says, read in the source itself; or two independent sources agree.'),
        el('li', {}, el('b', {}, 'Reasonably supported: '), 'one checked scholarly source, with nothing against it.'),
        el('li', {}, el('b', {}, 'Disputed or uncertain: '), 'scholars disagree, or the evidence is thin. Both sides are shown under “Where the evidence clashes”.'),
        el('li', {}, el('b', {}, 'Speculative: '), 'an idea someone has proposed with little direct evidence. Kept in its own folded group.'))),
    el('section', {}, el('h3', {}, 'Who checked this'),
      el('p', {}, `All ${nSources} sources on this map were opened and read by Claude in copies anyone can open online, and each source says which copy was read and in what language. Marc spot-checks a sample. Anything not checked stays hidden unless you turn on “Show unchecked claims”.`),
      el('p', {}, 'Where a medieval text is quoted in Latin, the English next to it is Claude’s own rendering unless a named translator is given. Where a text could only be read as another scholar quotes it, the card says so.')),
    el('section', {}, el('h3', {}, 'Pins and places'),
      el('p', {}, 'A pin with a soft ring has a rough location: the source names only a region, and the card says how the pin was placed. Written sources are pinned where the text was written, not where the events happened. Entries with no known place are in the list but not on the map.'),
      el('p', {}, 'The landscape is today’s: modern coastlines, rivers and lakes. No borders are drawn yet, because every border has to be traced from a scholarly map that has been checked.')),
    el('section', {}, el('h3', {}, 'Credits'),
      el('ul', {},
        el('li', {}, 'Landscape: ', el('a', { href: 'https://www.naturalearthdata.com/', target: '_blank', rel: 'noopener' }, 'Natural Earth'), ', public domain.'),
        el('li', {}, 'Map engine: ', el('a', { href: 'https://maplibre.org/', target: '_blank', rel: 'noopener' }, 'MapLibre GL JS'), ', BSD 3-Clause licence.'),
        el('li', {}, 'Medieval Latin passages read through the ', el('a', { href: 'https://mmp.acdh-dev.oeaw.ac.at/', target: '_blank', rel: 'noopener' }, 'Mapping Medieval Peoples database'), ' of the Austrian Academy of Sciences.'),
        el('li', {}, 'Open-access copies of studies from the repository of the Library of the Hungarian Academy of Sciences (REAL), Scientific Reports, the University of Szeged journals and the University of Helsinki.'))),
  );
}

function update() {
  renderLayers();
  renderTime();
  refreshMap();
  markSelected();
}

// ---------- controls ----------

function setTint(t) {
  document.documentElement.dataset.tint = t;
  store('tint', t);
  for (const r of document.querySelectorAll('input[name="tint"]')) r.checked = r.value === t;
}

// Text size: 90% to 160%, in steps, remembered in this browser.
const SIZES = [0.9, 1, 1.1, 1.2, 1.3, 1.45, 1.6];
function setTextSize(i) {
  i = Math.max(0, Math.min(SIZES.length - 1, i));
  document.documentElement.style.setProperty('--ts', SIZES[i]);
  $('#size-label').textContent = `${Math.round(SIZES[i] * 100)}%`;
  $('#size-down').disabled = i === 0;
  $('#size-up').disabled = i === SIZES.length - 1;
  store('textSize', String(SIZES[i]));
  setTextSize.current = i;
  // Pin labels are HTML, so rebuild them at the new size.
  if (map.loaded()) refreshMap();
}
$('#size-down').addEventListener('click', () => setTextSize(setTextSize.current - 1));
$('#size-up').addEventListener('click', () => setTextSize(setTextSize.current + 1));

let yearQueued = false;
$('#year').addEventListener('input', ev => {
  state.year = +ev.target.value;
  if (yearQueued) return;
  yearQueued = true;
  requestAnimationFrame(() => { yearQueued = false; update(); history.replaceState(null, '', viewToHash(state.view)); });
});
$('#show-unchecked').addEventListener('change', ev => { state.showUnchecked = ev.target.checked; renderCard(); update(); });
$('#show-glow').addEventListener('change', ev => { state.showGlow = ev.target.checked; store('glow', ev.target.checked ? '1' : '0'); refreshMap(); });
for (const r of document.querySelectorAll('input[name="tint"]')) r.addEventListener('change', ev => setTint(ev.target.value));
$('#open-list').addEventListener('click', () => go({ type: 'list' }));
$('#open-about').addEventListener('click', () => go({ type: 'about' }));
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && state.view && !ev.target.closest('textarea, input')) go(null);
});
// Clicking a border shape opens its entry; clicking empty map closes the card.
map.on('click', ev => {
  const hit = map.queryRenderedFeatures(ev.point, { layers: ['zone-fill'] })[0];
  if (hit) go({ type: 'entry', id: hit.properties.entry });
  else if (state.view) go(null);
});
map.on('mouseenter', 'zone-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
map.on('mouseleave', 'zone-fill', () => { map.getCanvas().style.cursor = ''; });

// ---------- start ----------

setTint(store('tint') || 'pure');
{ const saved = SIZES.indexOf(Number(store('textSize'))); setTextSize(saved >= 0 ? saved : 1); }
state.showGlow = store('glow') !== '0';
$('#show-glow').checked = state.showGlow;
if (matchMedia('(max-width: 760px)').matches) $('#side-details').open = false;
$('#example-banner').hidden = !EXAMPLE_MODE;
$('#year').min = String(YEAR_MIN); $('#year').max = String(YEAR_MAX);

const ready = new Promise(res => map.on('load', res));
try {
  const data = await loadData();
  state.entries = data.entries;
  state.concepts = data.concepts;
  state.entryById = new Map(data.entries.map(e => [e.id, e]));
  state.conceptById = new Map(data.concepts.map(c => [c.id, c]));
  state.sourcesById = Object.fromEntries(data.sources.map(s => [s.id, s]));
} catch (err) {
  console.error(err);
  $('#card-body').replaceChildren(el('p', {}, 'The entries could not be loaded. ', String(err.message)));
}
await ready;
const start = hashToView();
if (start.year != null) setYear(start.year, false);
else setYear(state.year, false);
applyHash();
