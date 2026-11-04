// Checks every data file against the honesty rules before it can go live.
// Run it with:  node tools/check-data.mjs
// It prints each problem in plain language and fails if there are any.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { problemsWithEntry, problemsWithSource } from '../js/rules.mjs';

const root = new URL('..', import.meta.url).pathname;
const read = p => JSON.parse(readFileSync(join(root, p), 'utf8'));
const problems = [];

function checkSet(label, entries, sources) {
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
const nReal = checkSet('entries', entries, sources);

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
console.log(`All good: ${nReal} real entries and ${nEx} invented examples follow the rules.`);
