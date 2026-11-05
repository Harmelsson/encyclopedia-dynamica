// Reads the author, credit line and licence of every picture in data/images.json
// straight from the Wikimedia Commons API, so credits are copied, never typed by hand.
//
//   node tools/commons-credits.mjs           compare what is saved with what Commons says now
//   node tools/commons-credits.mjs --write   save what Commons says now into data/images.json
//
// It stops with an error if any file's licence is not public domain, CC0, CC BY or CC BY-SA.
// Needs internet access to commons.wikimedia.org (the website itself does not: it only
// shows the saved credits and loads the pictures from upload.wikimedia.org).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { licenceAllowed } from '../js/images.mjs';

const root = new URL('..', import.meta.url).pathname;
const path = join(root, 'data/images.json');
const data = JSON.parse(readFileSync(path, 'utf8'));
const WRITE = process.argv.includes('--write');
const UA = 'EncyclopediaDynamica/0.1 (https://github.com/harmelsson/encyclopedia-dynamica; credit checker)';
const today = new Date().toISOString().slice(0, 10);

// Commons gives author and credit as small bits of HTML. Keep only the words.
// Hidden parts (Commons repeats some names in invisible text for machines) are dropped first.
const words = html => String(html || '')
  .replace(/<(\w+)[^>]*display:\s*none[^>]*>[^<]*<\/\1>/gi, '')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

async function ask(titles) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  const q = { action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo', redirects: '1',
    iiprop: 'url|size|extmetadata', iiurlwidth: '800', iiextmetadatafilter: 'Artist|Credit|Attribution|LicenseShortName|LicenseUrl|UsageTerms|ImageDescription', titles: titles.join('|') };
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  // Commons asks automated readers to slow down when busy. Wait and try again.
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(u, { headers: { 'User-Agent': UA } });
    if (res.ok) return res.json();
    if (res.status !== 429 || attempt === 6) throw new Error(`Commons answered ${res.status}`);
    await new Promise(r => setTimeout(r, 10000 * attempt));
  }
}

const byTitle = new Map();
const titles = [...new Set(data.images.map(i => i.file))];
for (let i = 0; i < titles.length; i += 40) {
  const j = await ask(titles.slice(i, i + 40));
  const renamed = new Map([...(j.query.normalized || []), ...(j.query.redirects || [])].map(n => [n.to, n.from]));
  for (const p of j.query.pages) {
    byTitle.set(p.title, p);
    if (renamed.has(p.title)) byTitle.set(renamed.get(p.title), p);
  }
}

const problems = [], changes = [];
for (const img of data.images) {
  const p = byTitle.get(img.file);
  const ii = p && p.imageinfo && p.imageinfo[0];
  if (!ii) { problems.push(`${img.id}: ${img.file} was not found on Commons`); continue; }
  const m = ii.extmetadata || {};
  const v = k => words(m[k] && m[k].value);
  const fresh = {
    page: ii.descriptionurl,
    author: v('Artist') || 'Not stated on Commons',
    credit: v('Credit'),
    attribution: v('Attribution') || undefined,
    licence: v('LicenseShortName'),
    licence_url: v('LicenseUrl') || undefined,
    // Thumbnails load from Wikimedia's image server; tracking parameters are removed.
    thumb: String(ii.thumburl || ii.url).split('?')[0].replace('://thumb.wikimedia.org/', '://upload.wikimedia.org/'),
    width: ii.thumbwidth || ii.width,
    height: ii.thumbheight || ii.height,
    read_on: today,
  };
  if (!licenceAllowed(fresh.licence)) problems.push(`${img.id}: licence on Commons is "${fresh.licence}", which is not allowed`);
  const old = img.commons || {};
  const diff = Object.keys(fresh).filter(k => k !== 'read_on' && String(old[k] ?? '') !== String(fresh[k] ?? ''));
  if (diff.length) changes.push(`${img.id}: ${diff.map(k => `${k} "${old[k] ?? ''}" → "${fresh[k] ?? ''}"`).join('; ')}`);
  if (WRITE) img.commons = JSON.parse(JSON.stringify(fresh));
}

if (WRITE) writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
for (const c of changes) console.log(`${WRITE ? 'Updated' : 'Differs'}: ${c}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`${data.images.length} pictures read from Commons. ${changes.length ? `${changes.length} differ${WRITE ? ' and were updated' : ': run with --write to save'}.` : 'All saved credits match.'}`);
