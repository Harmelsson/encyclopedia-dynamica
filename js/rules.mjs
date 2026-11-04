// The honesty rules from the entry format and the source standards, written once
// so that the map (in the browser) and the checker (tools/check-data.mjs) use the same logic.

export const LAYERS = {
  'dig site':       { label: 'Dig sites',       color: '#8fb3a6' },
  'written source': { label: 'Written sources', color: '#d1a670' },
  'language':       { label: 'Languages',       color: '#9ea3d6' },
  'ancient DNA':    { label: 'Ancient DNA',     color: '#c49bbd' },
  'border':         { label: 'Borders',         color: '#b8a77a' },
};

// From most to least sure. "speculative" is for interpretations only.
export const CERTAINTY = ['well established', 'reasonably supported', 'disputed or uncertain', 'speculative'];
export const CERT_CLASS = {
  'well established': 'high',
  'reasonably supported': 'medium',
  'disputed or uncertain': 'low',
  'speculative': 'low',
};

export const REVIEW_STATUS = ['draft', 'sources to check', 'checked', 'published'];
export const SOURCE_TYPES = ['primary text', 'excavation report', 'peer-reviewed study', 'review or survey', 'book', 'dataset', 'web page'];

// Tier, worked out from the type (source standards, "The three tiers").
export function tierOf(source) {
  switch (source.type) {
    case 'primary text': case 'excavation report': case 'dataset': return 'A';
    case 'peer-reviewed study': case 'review or survey': return 'B';
    case 'book': return source.scholarly === true ? 'B' : 'C';
    default: return 'C';
  }
}

// A source counts as checked when a person (or Claude, for openly available copies)
// has recorded who checked it and when.
export function sourceChecked(source) {
  return !!(source && source.checked && source.checked.by && source.checked.on);
}

// A claim counts as checked only if the claim itself is marked checked
// AND every source it cites is checked. One unchecked link keeps it hidden.
export function claimChecked(claim, sourcesById) {
  if (!claim.checked || !claim.checked.by || !claim.checked.on) return false;
  if (!Array.isArray(claim.sources) || claim.sources.length === 0) return false;
  return claim.sources.every(ref => sourceChecked(sourcesById[ref.id]));
}

// An entry may appear on the map by default only when it has been reviewed
// as checked and every claim in it is checked too.
export function entryChecked(entry, sourcesById) {
  const statusOk = entry.review && (entry.review.status === 'checked' || entry.review.status === 'published');
  if (!statusOk) return false;
  const all = allClaimsOf(entry);
  return all.length > 0 && all.every(c => claimChecked(c, sourcesById));
}

// Every statement in an entry: its claims, its dating methods and (for borders) its shapes.
export function allClaimsOf(entry) {
  return [...(entry.claims || []), ...(entry.dating_methods || []), ...(entry.shapes || [])];
}

// The overall badge is the LOWEST certainty among the evidence claims being shown,
// so one weak link is never hidden by strong ones.
export function overallCertainty(claims) {
  let worst = -1;
  for (const c of claims) {
    if (c.kind !== 'evidence') continue;
    worst = Math.max(worst, CERTAINTY.indexOf(c.certainty));
  }
  return worst < 0 ? null : CERTAINTY[worst];
}

export function inTime(entry, year) {
  const t = entry.time || {};
  return typeof t.from === 'number' && typeof t.to === 'number' && t.from <= year && year <= t.to;
}

export function formatYear(y) {
  return y < 0 ? `${-y} BC` : `AD ${y}`;
}

// Checks one entry against the rules. Returns a list of plain-language problems.
export function problemsWithEntry(entry, sourcesById) {
  const p = [];
  const need = (cond, msg) => { if (!cond) p.push(msg); };
  const id = entry.id || '(no id)';

  need(typeof entry.id === 'string' && /^[a-z0-9-]+$/.test(entry.id), `${id}: id must be lower-case letters, digits and dashes`);
  need(typeof entry.title === 'string' && entry.title.length > 0, `${id}: needs a title`);
  need(entry.layer in LAYERS, `${id}: layer must be one of ${Object.keys(LAYERS).join(', ')}`);
  need(typeof entry.fact_summary === 'string' && entry.fact_summary.length > 0, `${id}: needs a one-line fact summary`);
  need(entry.place && ['exact', 'approximate', 'disputed', 'unknown'].includes(entry.place.precision), `${id}: place needs a precision tag`);
  need(entry.time && typeof entry.time.from === 'number' && typeof entry.time.to === 'number' && entry.time.from <= entry.time.to, `${id}: time needs from and to years, from not after to`);
  need(entry.time && ['exact', 'approximate', 'range', 'unknown'].includes(entry.time.precision), `${id}: time needs a precision tag`);
  need(Array.isArray(entry.dating_methods) && entry.dating_methods.length > 0, `${id}: needs at least one dating method`);
  need(typeof entry.min_zoom === 'number', `${id}: needs a min_zoom`);
  need(entry.review && REVIEW_STATUS.includes(entry.review.status), `${id}: review status must be one of ${REVIEW_STATUS.join(', ')}`);
  need(Array.isArray(entry.claims) && entry.claims.length > 0, `${id}: needs at least one claim`);

  const claimIds = new Set();
  const allClaims = allClaimsOf(entry);
  if (entry.layer === 'border') {
    need(Array.isArray(entry.shapes) && entry.shapes.length > 0, `${id}: a border entry needs at least one shape`);
    for (const s of entry.shapes || []) {
      const sid = `${id}/${s.id || '(no id)'}`;
      need(['line', 'zone', 'candidates', 'label only'].includes(s.shape_kind), `${sid}: shape_kind must be line, zone, candidates or label only`);
      need(s.shape_kind === 'label only' || (s.geometry && s.geometry.type), `${sid}: needs a GeoJSON geometry`);
      need(s.drawn_from && s.drawn_from.source && s.drawn_from.locator, `${sid}: needs drawn_from (the source and exact figure, page or passage)`);
      need(typeof s.drawn_by === 'string' && s.drawn_by.length > 0, `${sid}: needs drawn_by (who traced it and when)`);
      need(typeof s.valid_from === 'number' && typeof s.valid_to === 'number', `${sid}: needs valid_from and valid_to years`);
    }
  }
  for (const c of allClaims) {
    const cid = `${id}/${c.id || '(no id)'}`;
    need(typeof c.id === 'string' && !claimIds.has(c.id), `${cid}: claim ids must exist and be unique`);
    claimIds.add(c.id);
    need(c.kind === 'evidence' || c.kind === 'interpretation', `${cid}: kind must be evidence or interpretation`);
    need(typeof c.text === 'string' && c.text.length > 0, `${cid}: needs text`);
    need(Array.isArray(c.sources) && c.sources.length > 0, `${cid}: every claim needs at least one source`);
    for (const ref of c.sources || []) {
      need(ref.id in sourcesById, `${cid}: source "${ref.id}" is not in data/sources.json`);
      need(typeof ref.locator === 'string' && ref.locator.length > 0, `${cid}: each source needs a locator (page, chapter, table)`);
    }
    need(CERTAINTY.includes(c.certainty), `${cid}: certainty must be one of ${CERTAINTY.join(', ')}`);
    need(typeof c.certainty_reason === 'string' && c.certainty_reason.length > 0, `${cid}: every certainty level needs a reason line`);
    if (c.kind === 'evidence') {
      need(c.certainty !== 'speculative', `${cid}: evidence cannot be speculative (a fact is either found or not)`);
      // Tier C alone never supports evidence.
      const tiers = (c.sources || []).map(r => sourcesById[r.id]).filter(Boolean).map(tierOf);
      need(tiers.length === 0 || tiers.some(t => t !== 'C'), `${cid}: evidence needs at least one tier A or B source`);
    }
    if (c.kind === 'interpretation') {
      need(Array.isArray(c.held_by) && c.held_by.length > 0, `${cid}: an interpretation must say who holds it`);
      need(Array.isArray(c.rests_on), `${cid}: an interpretation must list the evidence it rests on`);
    }
  }
  for (const c of entry.claims || []) {
    for (const r of c.rests_on || []) need(claimIds.has(r), `${id}/${c.id}: rests on unknown claim "${r}"`);
  }
  for (const x of entry.contradictions || []) {
    need(!('winner' in x) && !('preferred' in x), `${id}/${x.id}: a contradiction never has a winner`);
    need(Array.isArray(x.claims) && x.claims.length >= 2, `${id}/${x.id}: a contradiction needs two or more claims`);
    for (const r of x.claims || []) need(claimIds.has(r), `${id}/${x.id}: unknown claim "${r}"`);
    need(typeof x.what_differs === 'string' && x.what_differs.length > 0, `${id}/${x.id}: needs a "what differs" line`);
  }
  if (entry.review && (entry.review.status === 'checked' || entry.review.status === 'published')) {
    need(!!(entry.review.by && entry.review.on), `${id}: a checked entry must say who checked it and when`);
    for (const c of allClaims) need(claimChecked(c, sourcesById), `${id}/${c.id}: entry is marked checked but this claim or one of its sources is not`);
  }
  return p;
}

export function problemsWithSource(s) {
  const p = [];
  const need = (cond, msg) => { if (!cond) p.push(msg); };
  const id = s.id || '(no id)';
  need(typeof s.id === 'string' && /^[a-z0-9-]+$/.test(s.id), `source ${id}: id must be lower-case letters, digits and dashes`);
  need(SOURCE_TYPES.includes(s.type), `source ${id}: type must be one of ${SOURCE_TYPES.join(', ')}`);
  need(typeof s.reference === 'string' && s.reference.length > 0, `source ${id}: needs a full reference`);
  need(typeof s.language === 'string', `source ${id}: needs a language`);
  need(['current', 'corrected', 'retracted', 'superseded'].includes(s.status), `source ${id}: status must be current, corrected, retracted or superseded`);
  if (s.type === 'web page') need(!!s.archived_copy, `source ${id}: web pages need an archived copy`);
  return p;
}
