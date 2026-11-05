// Encyclopedia Dynamica: the map page.
// Reads the entry files, draws them on a MapLibre map, and shows one entry card at a time.

import {
  LAYERS, CERT_CLASS, tierOf, sourceChecked, claimChecked, entryChecked,
  overallCertainty, inTime, formatYear,
} from './rules.mjs';

const params = new URLSearchParams(location.search);
const EXAMPLE_MODE = params.has('examples');

const state = {
  year: 900,
  showUnchecked: false,
  layersOn: Object.fromEntries(Object.keys(LAYERS).map(k => [k, true])),
  entries: [],
  sourcesById: {},
  selected: null,
  markers: new Map(),
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
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
function store(key, value) {
  try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch { return null; }
}

// ---------- loading data ----------

async function loadJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return res.json();
}

async function loadData() {
  if (EXAMPLE_MODE) {
    const ex = await loadJSON('data/examples/examples.json');
    return { entries: ex.entries, sources: ex.sources };
  }
  const [index, sources] = await Promise.all([
    loadJSON('data/entries/index.json'),
    loadJSON('data/sources.json'),
  ]);
  const entries = await Promise.all(index.entries.map(id => loadJSON(`data/entries/${id}.json`)));
  return { entries, sources: sources.sources };
}

// What the reader is allowed to see right now.
function visibleClaims(list) {
  return (list || []).filter(c => state.showUnchecked || claimChecked(c, state.sourcesById));
}
function entryVisible(e) {
  if (!state.layersOn[e.layer]) return false;
  if (!inTime(e, state.year)) return false;
  return state.showUnchecked || entryChecked(e, state.sourcesById);
}

// ---------- the map ----------

const SEA = '#2a3036';
const LAND = '#4a4b47';

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      land:   { type: 'geojson', data: 'data/basemap/land.geojson',   attribution: 'Landscape: <a href="https://www.naturalearthdata.com/">Natural Earth</a> (public domain)' },
      lakes:  { type: 'geojson', data: 'data/basemap/lakes.geojson' },
      rivers: { type: 'geojson', data: 'data/basemap/rivers.geojson' },
      borders: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'sea', type: 'background', paint: { 'background-color': SEA } },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': LAND } },
      { id: 'coast', type: 'line', source: 'land', paint: { 'line-color': '#5c5d58', 'line-width': 0.8 } },
      { id: 'lakes', type: 'fill', source: 'lakes', paint: { 'fill-color': SEA } },
      { id: 'rivers', type: 'line', source: 'rivers',
        paint: { 'line-color': '#5a6b78', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 7, 1.8] } },
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
    ],
  },
  // Phones get a closer view of the steppe; wider screens see from the Carpathian Basin to the Urals.
  bounds: matchMedia('(max-width: 760px)').matches ? [[18, 40], [62, 58]] : [[12, 38], [80, 62]],
  fitBoundsOptions: { padding: { top: 40, bottom: 140, left: 40, right: 40 } },
  minZoom: 2.5,
  maxZoom: 9,
  attributionControl: { compact: false },
  dragRotate: false,
  pitchWithRotate: false,
});
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

// Border entries become shapes on the map. Only shapes whose own claim is visible are drawn,
// and speculative shapes are never drawn by default.
function borderFeatures() {
  const feats = [];
  for (const e of state.entries) {
    if (e.layer !== 'border' || !state.layersOn.border) continue;
    if (!state.showUnchecked && !entryChecked(e, state.sourcesById)) continue;
    for (const s of e.shapes || []) {
      if (!(s.valid_from <= state.year && state.year <= s.valid_to)) continue;
      if (s.certainty === 'speculative') continue;
      const checked = claimChecked(s, state.sourcesById);
      if (!checked && !state.showUnchecked) continue;
      const strength = { 'well established': 1, 'reasonably supported': 0.7, 'disputed or uncertain': 0.45 }[s.certainty] ?? 0.4;
      const dim = checked ? 1 : 0.5;
      feats.push({
        type: 'Feature',
        geometry: s.geometry,
        properties: {
          kind: s.shape_kind,
          entry: e.id,
          color: LAYERS.border.color,
          fillOpacity: 0.22 * strength * dim,
          edgeOpacity: 0.8 * strength * dim,
        },
      });
    }
  }
  return { type: 'FeatureCollection', features: feats };
}

// Point entries become clickable markers.
function entryPoint(e) {
  const p = e.place || {};
  if (typeof p.lon === 'number' && typeof p.lat === 'number') return [p.lon, p.lat];
  return null;
}

function markerFor(e) {
  const shownClaims = visibleClaims(e.claims);
  const cert = overallCertainty(shownClaims);
  const checked = entryChecked(e, state.sourcesById);
  const btn = el('button', {
    class: `marker cert-${CERT_CLASS[cert] || 'low'}${checked ? '' : ' unchecked'}`,
    type: 'button',
    'aria-label': `${e.title}${checked ? '' : ' (not yet checked)'}`,
    style: `--pin: ${LAYERS[e.layer].color}`,
    onclick: ev => { ev.stopPropagation(); select(e.id); },
  }, el('span', { class: 'pin' }), el('span', { class: 'marker-label' }, e.short_title || e.title));
  // The button sits inside a wrapper, because MapLibre puts its own generic label on the marker element.
  return new maplibregl.Marker({ element: el('div', { class: 'marker-wrap' }, btn) }).setLngLat(entryPoint(e));
}

function refreshMap() {
  for (const m of state.markers.values()) m.remove();
  state.markers.clear();
  for (const e of state.entries) {
    if (e.layer === 'border' || !entryVisible(e) || !entryPoint(e)) continue;
    const m = markerFor(e).addTo(map);
    if (state.selected === e.id) m.getElement().firstChild.classList.add('selected');
    state.markers.set(e.id, m);
  }
  const src = map.getSource('borders');
  if (src) src.setData(borderFeatures());
}

// ---------- panels ----------

function renderLayers() {
  const list = $('#layer-list');
  list.replaceChildren();
  for (const [key, layer] of Object.entries(LAYERS)) {
    const n = state.entries.filter(e => e.layer === key && (state.showUnchecked || entryChecked(e, state.sourcesById))).length;
    list.append(el('button', {
      class: 'layer-btn', type: 'button', 'aria-pressed': String(state.layersOn[key]),
      onclick: () => { state.layersOn[key] = !state.layersOn[key]; update(); },
    }, el('span', { class: 'swatch', style: `background:${layer.color}` }), layer.label, el('span', { class: 'count' }, n)));
  }
}

function renderTime() {
  $('#year-label').textContent = formatYear(state.year);
  const shown = state.entries.filter(entryVisible).length;
  const hiddenUnchecked = state.entries.filter(e => !entryChecked(e, state.sourcesById)).length;
  let txt = `${shown} ${shown === 1 ? 'entry' : 'entries'} at this date`;
  if (!state.showUnchecked && hiddenUnchecked) txt += ` · ${hiddenUnchecked} unchecked hidden`;
  $('#count-label').textContent = txt;

  // Show the selected entry's time span on the slider, as a soft band rather than a sharp line.
  const band = $('#range-band');
  const e = state.entries.find(x => x.id === state.selected);
  const slider = $('#year');
  if (e && e.time) {
    const min = +slider.min, max = +slider.max;
    const a = Math.max(min, e.time.from), b = Math.min(max, e.time.to);
    band.style.left = `${((a - min) / (max - min)) * 100}%`;
    band.style.width = `${Math.max(1, ((b - a) / (max - min)) * 100)}%`;
    band.hidden = false;
  } else band.hidden = true;
}

function renderEmptyCard() {
  const total = state.entries.length;
  const checked = state.entries.filter(e => entryChecked(e, state.sourcesById)).length;
  let status;
  if (EXAMPLE_MODE) {
    status = el('p', {}, 'These entries are invented placeholders. They show how a card is laid out and how unchecked claims behave. Turn on "Show unchecked claims" to see the greyed-out ones.');
  } else if (total === 0) {
    status = el('p', {}, 'No entries have been added yet. Entries appear here only once every claim in them has a source that someone has opened and checked. ',
      el('a', { href: '?examples' }, 'See invented example entries'), ' to preview how a card will look.');
  } else {
    status = el('p', {}, `${checked} of ${total} entries are fully checked.`);
  }
  $('#card-body').replaceChildren(el('div', { class: 'empty' },
    el('h2', {}, 'Pick a point on the map'),
    el('p', {}, 'Drag the time slider to see what existed when. Each card starts with the bare fact and its source. Interpretations stay folded until you open them.'),
    status,
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
      el('span', { class: 'reason' }, `${c.certainty}. ${c.certainty_reason}`),
      ok ? null : el('span', { class: 'unchecked-note' }, 'Source not yet checked'),
    ));
}

function renderCard(e) {
  const evidence = visibleClaims((e.claims || []).filter(c => c.kind === 'evidence'));
  const interps = visibleClaims((e.claims || []).filter(c => c.kind === 'interpretation'));
  const dating = visibleClaims(e.dating_methods);
  const shownIds = new Set([...evidence, ...interps, ...dating].map(c => c.id));
  const allClaims = [...(e.claims || []), ...(e.dating_methods || [])];
  const claimById = Object.fromEntries(allClaims.map(c => [c.id, c]));
  // A contradiction shows only when every side of it can be shown.
  const clashes = (e.contradictions || []).filter(x => x.claims.every(id => shownIds.has(id)));

  // Number the sources in the order they are first cited.
  const numbering = new Map();
  for (const c of [...evidence, ...dating, ...interps]) {
    for (const r of c.sources || []) if (!numbering.has(r.id)) numbering.set(r.id, numbering.size + 1);
  }
  const locators = new Map();
  for (const c of [...evidence, ...dating, ...interps]) {
    for (const r of c.sources || []) {
      if (!locators.has(r.id)) locators.set(r.id, new Set());
      locators.get(r.id).add(r.locator);
    }
  }

  const cert = overallCertainty(evidence);
  const certReason = 'The badge is the lowest certainty among the evidence shown, so one weak link is never hidden.';
  const checked = entryChecked(e, state.sourcesById);
  const mainInterps = interps.filter(c => c.certainty !== 'speculative');
  const specInterps = interps.filter(c => c.certainty === 'speculative');

  const interpBlock = c => el('div', { class: 'interp' },
    el('div', {}, c.text, ' ', sourceMarkers(c.sources, numbering)),
    el('span', { class: 'meta' }, 'Held by: ', (c.held_by || []).map(h => h.who).join('; ')),
    (c.rests_on || []).length ? el('span', { class: 'meta' }, 'Rests on: ', c.rests_on.map(id => claimById[id]?.text || id).join(' · ')) : null,
    el('span', { class: 'meta' }, `${c.certainty}. ${c.certainty_reason}`),
    claimChecked(c, state.sourcesById) ? null : el('span', { class: 'unchecked-note' }, 'Source not yet checked'),
  );

  const body = el('article', {},
    el('button', { class: 'close-btn', type: 'button', 'aria-label': 'Close card', onclick: () => select(null) }, '×'),
    el('div', { class: 'card-tags' },
      el('span', { class: 'tag' }, LAYERS[e.layer].label),
      cert ? el('span', { class: 'tag tag-cert', title: certReason }, cert) : null,
      checked ? null : el('span', { class: 'tag', style: 'color: var(--warn)' }, 'Not yet checked'),
    ),
    el('h2', { class: 'title' }, e.title),
    el('p', { class: 'when-where' }, `${formatYear(e.time.from)} to ${formatYear(e.time.to)} (${e.time.precision})`, e.place?.label ? ` · ${e.place.label}` : '', e.place?.precision ? ` (place ${e.place.precision})` : ''),

    el('section', {}, el('h3', {}, 'The fact'),
      el('p', { style: 'margin: 0 0 8px' }, e.fact_summary),
      evidence.length ? el('ul', { class: 'claim-list' }, evidence.map(c => claimLine(c, numbering))) : el('p', { class: 'hint' }, 'No checked evidence to show yet.')),

    el('section', {}, el('h3', {}, 'Sources'),
      numbering.size ? el('ol', {}, [...numbering.keys()].map(id => {
        const s = state.sourcesById[id];
        const ok = sourceChecked(s);
        return el('li', { class: `src${ok ? '' : ' unchecked'}` },
          s.link ? el('a', { href: s.link, target: '_blank', rel: 'noopener' }, s.reference) : s.reference,
          el('span', { class: 'src-type' }, ` · ${s.type}, tier ${tierOf(s)} · at ${[...locators.get(id)].join('; ')}`),
          ok ? el('span', { class: 'src-type', style: 'display:block' }, `Checked by ${s.checked.by} on ${s.checked.on}`) : el('span', { class: 'unchecked-note' }, 'Source not yet checked'),
        );
      })) : el('p', { class: 'hint' }, 'None shown.')),

    dating.length ? el('section', {}, el('h3', {}, 'How it is dated'),
      el('ul', { class: 'claim-list' }, dating.map(c => claimLine(c, numbering)))) : null,

    mainInterps.length || specInterps.length ? el('section', {},
      el('details', { class: 'interps' },
        el('summary', {}, `Interpretations (${mainInterps.length})`),
        mainInterps.map(interpBlock),
        specInterps.length ? el('details', { class: 'speculative' },
          el('summary', {}, `Speculative views (${specInterps.length}), little or no direct evidence`),
          specInterps.map(interpBlock)) : null,
      )) : null,

    clashes.length ? el('section', {}, el('h3', {}, 'Where the evidence clashes'),
      clashes.map(x => el('div', {},
        el('p', { class: 'clash-what' }, x.what_differs),
        el('div', { class: 'clash-sides' }, x.claims.map(id => el('div', { class: 'clash-side' }, claimById[id].text))),
      ))) : null,

    (e.open_questions || []).length ? el('section', {}, el('h3', {}, 'Still unknown'),
      el('ul', {}, e.open_questions.map(q => el('li', {}, q.text)))) : null,

    (e.links || []).length ? el('section', {}, el('h3', {}, 'Follow a thread'),
      el('ul', {}, e.links.map(l => {
        const target = state.entries.find(x => x.id === l.entry);
        return el('li', {}, target
          ? el('a', { href: '#', onclick: ev => { ev.preventDefault(); select(target.id, true); } }, target.title)
          : `${l.label || l.concept || l.entry} (page not written yet)`);
      }))) : null,

    el('section', {}, el('h3', {}, 'My notes'),
      el('textarea', {
        class: 'notes', 'aria-label': 'My private notes on this entry',
        placeholder: 'Private to you, saved only in this browser.',
        oninput: ev => store(`notes:${e.id}`, ev.target.value),
      }, store(`notes:${e.id}`) || '')),

    el('footer', {},
      `Review status: ${e.review.status}`,
      e.review.by ? ` · checked by ${e.review.by} on ${e.review.on}` : '',
      (e.change_notes || []).length ? ` · ${e.change_notes.length} change note(s)` : ''),
  );
  $('#card-body').replaceChildren(body);
  $('#card').scrollTop = 0;
  document.body.classList.add('card-open');
}

function select(id, fly = false) {
  state.selected = id;
  const e = state.entries.find(x => x.id === id);
  if (e) {
    renderCard(e);
    if (fly && entryPoint(e)) map.flyTo({ center: entryPoint(e), speed: 0.8 });
  } else renderEmptyCard();
  update(false);
}

function update(redrawCard = true) {
  // If the selected entry is no longer allowed to show, close its card.
  const sel = state.entries.find(x => x.id === state.selected);
  if (sel && !(state.showUnchecked || entryChecked(sel, state.sourcesById))) { state.selected = null; renderEmptyCard(); }
  else if (sel && redrawCard) renderCard(sel);
  renderLayers();
  renderTime();
  refreshMap();
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
}
$('#size-down').addEventListener('click', () => setTextSize(setTextSize.current - 1));
$('#size-up').addEventListener('click', () => setTextSize(setTextSize.current + 1));

$('#year').addEventListener('input', ev => { state.year = +ev.target.value; update(false); });
$('#show-unchecked').addEventListener('change', ev => { state.showUnchecked = ev.target.checked; update(); });
for (const r of document.querySelectorAll('input[name="tint"]')) r.addEventListener('change', ev => setTint(ev.target.value));
// Clicking a border shape opens its entry; clicking empty map closes the card.
map.on('click', ev => {
  const hit = map.queryRenderedFeatures(ev.point, { layers: ['zone-fill'] })[0];
  if (hit) select(hit.properties.entry);
  else if (state.selected) select(null);
});
map.on('mouseenter', 'zone-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
map.on('mouseleave', 'zone-fill', () => { map.getCanvas().style.cursor = ''; });

// ---------- start ----------

setTint(store('tint') || 'pure');
{ const saved = SIZES.indexOf(Number(store('textSize'))); setTextSize(saved >= 0 ? saved : 1); }
if (matchMedia('(max-width: 760px)').matches) $('#side-details').open = false;
$('#example-banner').hidden = !EXAMPLE_MODE;

const ready = new Promise(res => map.on('load', res));
try {
  const data = await loadData();
  state.entries = data.entries;
  state.sourcesById = Object.fromEntries(data.sources.map(s => [s.id, s]));
} catch (err) {
  console.error(err);
  $('#card-body').replaceChildren(el('p', {}, 'The entries could not be loaded. ', String(err.message)));
}
await ready;
renderEmptyCard();
update(false);
