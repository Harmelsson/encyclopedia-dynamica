// Pictures on cards. Every picture is a file on Wikimedia Commons that we link to:
// nothing is copied into this repository. The rules here are shared by the page
// (js/app.mjs) and the checker (tools/check-data.mjs), like js/rules.mjs.
//
// The list of pictures is data/images.json. Each picture records:
//  - which cards show it ("for": entry or page ids),
//  - what it shows, in our words, and how we know ("shows", "shows_basis"),
//  - what kind of picture it is ("kind"), so a reconstruction or a later drawing
//    is never mistaken for evidence,
//  - the author, credit line and licence exactly as Commons gives them ("commons"),
//    copied by tools/commons-credits.mjs, which reads the Commons API.

// What kind of picture it is. "evidence: true" means the picture shows the thing
// itself (the object, the text, the place), so it can be looked at as evidence.
// Everything else is labelled loudly as not evidence.
export const IMAGE_KINDS = {
  'the find itself':     { label: 'Photo of the find itself', evidence: true },
  'the text itself':     { label: 'Photo of a manuscript', evidence: true },
  'printed edition':     { label: 'Page of a printed edition', evidence: true },
  'the place today':     { label: 'The place today', evidence: true },
  'replica':             { label: 'Modern replica, not the original', evidence: false },
  'reconstruction':      { label: 'Reconstruction: someone’s idea of how it looked, not evidence', evidence: false },
  'later illustration':  { label: 'Later illustration, made long after the events: not evidence', evidence: false },
  'modern map':          { label: 'Modern map: its maker’s interpretation', evidence: false },
  'old map':             { label: 'Old map: its maker’s interpretation, not evidence', evidence: false },
};

// Only free licences that allow reuse with credit. Public domain and CC0 need no
// credit by law, but we give it anyway. CC BY and CC BY-SA need the author, the
// licence and a link, which every picture shows.
export function licenceAllowed(short) {
  const s = String(short || '').trim();
  return /^public domain$/i.test(s) || /^PD\b/i.test(s) || /^CC0\b/i.test(s)
    || /^CC BY(-SA)? \d(\.\d)?( [A-Za-z-]+)?$/i.test(s);
}

// Where a picture's file may be loaded from: Wikimedia's own image server only.
export const IMAGE_HOST = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//;

export function imageChecked(img) {
  return !!(img && img.checked && img.checked.by && img.checked.on);
}

// Checks one picture record. Returns a list of plain-language problems.
export function problemsWithImage(img, knownIds) {
  const p = [];
  const need = (cond, msg) => { if (!cond) p.push(msg); };
  const id = `image ${img.id || '(no id)'}`;
  need(typeof img.id === 'string' && /^[a-z0-9-]+$/.test(img.id), `${id}: id must be lower-case letters, digits and dashes`);
  need(Array.isArray(img.for) && img.for.length > 0, `${id}: needs "for", the entries or pages that show it`);
  for (const f of img.for || []) need(knownIds.has(f), `${id}: is for "${f}", which is not an entry or page`);
  need(typeof img.file === 'string' && /^File:.+\.[A-Za-z0-9]+$/.test(img.file), `${id}: "file" must be the Commons file name, starting with "File:"`);
  need(img.kind in IMAGE_KINDS, `${id}: kind must be one of ${Object.keys(IMAGE_KINDS).join(', ')}`);
  need(typeof img.shows === 'string' && img.shows.length > 0, `${id}: needs "shows", saying what the picture shows`);
  need(typeof img.shows_basis === 'string' && img.shows_basis.length > 0, `${id}: needs "shows_basis", saying how we know what it shows`);
  const c = img.commons || {};
  need(licenceAllowed(c.licence), `${id}: licence "${c.licence}" is not public domain, CC0, CC BY or CC BY-SA`);
  need(/^public domain$|^PD\b|^CC0\b/i.test(c.licence || '') || /^https?:\/\/creativecommons\.org\//.test(c.licence_url || ''), `${id}: a CC BY or CC BY-SA picture needs a link to its licence`);
  need(typeof c.author === 'string' && c.author.length > 0, `${id}: needs the author as Commons gives it`);
  need(typeof c.page === 'string' && /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(c.page), `${id}: needs the Commons file page link`);
  need(typeof c.thumb === 'string' && IMAGE_HOST.test(c.thumb), `${id}: the picture must load from upload.wikimedia.org`);
  need(typeof c.width === 'number' && typeof c.height === 'number', `${id}: needs the picture's width and height`);
  need(typeof c.read_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.read_on), `${id}: needs the date the credit was read from Commons (read_on)`);
  if ('checked' in img) need(imageChecked(img), `${id}: "checked" needs by and on`);
  return p;
}

// ---------- showing pictures on a card (used by js/app.mjs) ----------

const PD = /^public domain$|^PD\b|^CC0\b/i;

// Builds the pictures for one card. `el` is the page's element helper.
// A picture not yet checked is hidden unless the reader shows unchecked claims, like a claim.
export function imageFigures(images, { el, showUnchecked }) {
  const list = (images || []).filter(img => showUnchecked || imageChecked(img));
  if (!list.length) return null;
  return el('section', { class: 'pictures', 'aria-label': 'Pictures' }, list.map(img => figure(img, el)));
}

function figure(img, el) {
  const c = img.commons;
  const kind = IMAGE_KINDS[img.kind] || { label: img.kind, evidence: false };
  const ext = (href, text) => el('a', { href, target: '_blank', rel: 'noopener' }, text);
  const licence = c.licence_url ? ext(c.licence_url, c.licence) : c.licence;
  const name = img.file.replace(/^File:/, '');
  const pic = el('img', {
    src: c.thumb, alt: img.shows, width: c.width, height: c.height, loading: 'lazy', decoding: 'async',
    referrerpolicy: 'no-referrer',
    // If Wikimedia cannot be reached, say so instead of showing a broken picture.
    onerror: ev => ev.target.replaceWith(el('span', { class: 'pic-missing' }, 'The picture could not be loaded from Wikimedia Commons. ', ext(c.page, 'Open it there ↗'))),
  });
  return el('figure', { class: `pic${kind.evidence ? '' : ' pic-not-evidence'}${imageChecked(img) ? '' : ' unchecked'}` },
    ext(c.page, pic),
    el('figcaption', {},
      el('span', { class: 'pic-kind' }, kind.label),
      el('span', { class: 'pic-shows' }, img.shows),
      el('details', { class: 'pic-basis' }, el('summary', {}, 'How we know what it shows'), el('p', {}, img.shows_basis)),
      el('span', { class: 'pic-credit' },
        ext(c.page, `“${name}”`), ' by ', c.attribution || c.author,
        c.credit && c.credit !== c.author ? ` (source: ${c.credit})` : '',
        '. ', PD.test(c.licence) ? licence : ['Licence: ', licence], ', via Wikimedia Commons.'),
      imageChecked(img) ? null : el('span', { class: 'unchecked-note' }, 'Picture not yet checked'),
    ));
}
