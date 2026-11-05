// Checks every data file against the honesty rules before it can go live.
// Run it with:  node tools/check-data.mjs
// It prints each problem in plain language and fails if there are any.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { problemsWithEntry, problemsWithSource } from '../js/rules.mjs';

const root = new URL('..', import.meta.url).pathname;
const read = p => JSON.parse(readFileSync(join(root, p), 'utf8'));
const problems = [];

function checkSet(label, entries, sources, concepts = []) {
  const byId = {};
  for (const s of sources) {
    if (byId[s.id]) problems.push(`${label}: source id "${s.id}" is used twice`);
    byId[s.id] = s;
    problems.push(...problemsWithSource(s).map(m => `${label}: ${m}`));
  }
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.id)) problems.push(`${label}: entry id "${e.id}" is used twice`);
    seen.add(e.id);
    problems.push(...problemsWithEntry(e, byId).map(m => `${label}: ${m}`));
  }
  for (const c of concepts) {
    if (seen.has(c.id)) problems.push(`${label}: page id "${c.id}" is used twice`);
    seen.add(c.id);
    problems.push(...problemsWithEntry(c, byId, { concept: true }).map(m => `${label} (pages): ${m}`));
  }
  return entries.length;
}

// Real entries
const index = read('data/entries/index.json');
const sources = read('data/sources.json').sources;
const entries = index.entries.map(id => {
  const e = read(`data/entries/${id}.json`);
  if (e.id !== id) problems.push(`data/entries/${id}.json: its id is "${e.id}", but the file name says "${id}"`);
  return e;
});
const listed = new Set(index.entries.map(id => `${id}.json`));
for (const f of readdirSync(join(root, 'data/entries'))) {
  if (f !== 'index.json' && f.endsWith('.json') && !listed.has(f)) problems.push(`data/entries/${f} is not listed in data/entries/index.json`);
}
// Topic and method pages: same claim rules, but no place or time.
const cindex = read('data/concepts/index.json');
const concepts = cindex.concepts.map(id => {
  const c = read(`data/concepts/${id}.json`);
  if (c.id !== id) problems.push(`data/concepts/${id}.json: its id is "${c.id}", but the file name says "${id}"`);
  return c;
});
const clisted = new Set(cindex.concepts.map(id => `${id}.json`));
for (const f of readdirSync(join(root, 'data/concepts'))) {
  if (f !== 'index.json' && f.endsWith('.json') && !clisted.has(f)) problems.push(`data/concepts/${f} is not listed in data/concepts/index.json`);
}
const nReal = checkSet('entries', entries, sources, concepts);

// Every link must point to a real entry or page, or be a labelled placeholder for a page not written yet.
const entryIds = new Set(entries.map(e => e.id));
const conceptIds = new Set(concepts.map(c => c.id));
for (const e of [...entries, ...concepts]) {
  for (const l of e.links || []) {
    if (l.entry) { if (!entryIds.has(l.entry)) problems.push(`${e.id}: links to entry "${l.entry}", which does not exist`); }
    else if (l.concept) { if (!conceptIds.has(l.concept) && !l.label) problems.push(`${e.id}: links to page "${l.concept}", which does not exist yet, so the link needs a label`); }
    else problems.push(`${e.id}: a link needs an entry or a concept`);
  }
  if (entryIds.has(e.id) && conceptIds.has(e.id)) problems.push(`"${e.id}" is used both as an entry id and a page id`);
}

// A word in card text can link to only one page, so no two pages may claim the same alias.
const aliasOwner = new Map();
for (const c of concepts) for (const a of c.aliases || []) {
  const k = a.toLowerCase();
  if (aliasOwner.has(k) && aliasOwner.get(k) !== c.id) problems.push(`alias "${a}" is claimed by both ${aliasOwner.get(k)} and ${c.id}`);
  aliasOwner.set(k, c.id);
}

// Invented examples: same rules, and every text must be labelled [EXAMPLE].
const ex = read('data/examples/examples.json');
const nEx = checkSet('examples', ex.entries, ex.sources);
for (const e of ex.entries) if (!e.title.startsWith('[EXAMPLE]')) problems.push(`examples: "${e.id}" title must start with [EXAMPLE]`);
for (const s of ex.sources) if (!s.reference.startsWith('[EXAMPLE]')) problems.push(`examples: source "${s.id}" must start with [EXAMPLE]`);

// Cliopatria must never be in the repository, not even as a mention in data.
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(geo)?json$/.test(name) && /cliopatria/i.test(readFileSync(p, 'utf8'))) {
      problems.push(`${p.slice(root.length)} mentions Cliopatria. Cliopatria data, or anything derived from it, must never be committed.`);
    }
  }
}
walk(join(root, 'data'));

if (problems.length) {
  console.error(`Found ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`All good: ${nReal} real entries, ${concepts.length} topic and method pages, ${sources.length} sources and ${nEx} invented examples follow the rules.`);
