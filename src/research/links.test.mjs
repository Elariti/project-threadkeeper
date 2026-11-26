// Finding links: scholarly search normalisation, duplicate merging, identifiers, checked-pair memory; plus the
// main-process reminder schedule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { abstractFromIndex, dedupe, fromCrossref, fromOpenAlex, identifierIn, markExisting, normalizeDoi, searchScholarly } from './scholar.js';
import { checkedPairsFor, clearCheckedPairs, createProject, addItem, markPairsChecked, projectView, updateItem } from './store.js';
import { emptyResearch } from './model.js';

const require = createRequire(import.meta.url);
const { pendingReminders, HEADS_UP_MS } = require('../../electron/reminders.cjs');

const work = (over = {}) => ({
  id: 'https://openalex.org/W1', doi: 'https://doi.org/10.1000/ABC.123', display_name: 'Spaced <i>retrieval</i> practice', publication_year: 2021,
  authorships: [{ author: { display_name: 'K. Lee' } }, { author: { display_name: 'M. Ortiz' } }],
  primary_location: { landing_page_url: 'https://journal.example/abc', source: { display_name: 'Journal of Memory' } },
  best_oa_location: { pdf_url: 'https://repo.example/abc.pdf' }, open_access: { is_oa: true },
  abstract_inverted_index: { Spaced: [0], retrieval: [1], helps: [2], 'retention.': [3] }, cited_by_count: 12, type: 'article', ...over,
});

test('DOIs and identifiers are recognised in whatever is pasted', () => {
  assert.equal(normalizeDoi('https://doi.org/10.1000/ABC.123'), '10.1000/abc.123');
  assert.equal(normalizeDoi('doi: 10.1000/xyz).'), '10.1000/xyz');
  assert.equal(normalizeDoi('not a doi'), '');
  assert.deepEqual(identifierIn('see https://www.publisher.com/doi/full/10.1016/j.cell.2020.01.001 for details'), { kind: 'doi', value: '10.1016/j.cell.2020.01.001' });
  assert.deepEqual(identifierIn('https://arxiv.org/abs/2106.09685v2'), { kind: 'doi', value: '10.48550/arxiv.2106.09685' });
  assert.equal(identifierIn('spaced retrieval practice'), null);
});

test('OpenAlex and Crossref records become clean paper records with safe links', () => {
  const p = fromOpenAlex(work());
  assert.equal(p.title, 'Spaced retrieval practice');
  assert.equal(p.doi, '10.1000/abc.123');
  assert.equal(p.url, 'https://doi.org/10.1000/abc.123');
  assert.equal(p.pdfUrl, 'https://repo.example/abc.pdf');
  assert.equal(p.abstract, 'Spaced retrieval helps retention.');
  assert.equal(p.authors, 'K. Lee, M. Ortiz');
  assert.equal(fromOpenAlex(work({ best_oa_location: { pdf_url: 'javascript:alert(1)' }, primary_location: {} })).pdfUrl, '');
  const c = fromCrossref({ DOI: '10.1000/ABC.123', title: ['Spaced retrieval practice'], author: [{ given: 'K.', family: 'Lee' }], issued: { 'date-parts': [[2021]] }, abstract: '<jats:p>Abstract Spaced helps.</jats:p>' });
  assert.equal(c.abstract, 'Spaced helps.');
  assert.equal(c.year, 2021);
  assert.equal(abstractFromIndex(null), '');
});

test('duplicates merge by DOI and by title + year, keeping the richest fields', () => {
  const a = fromOpenAlex(work({ best_oa_location: {}, open_access: { is_oa: false }, abstract_inverted_index: null }));
  const b = fromCrossref({ DOI: '10.1000/abc.123', title: ['Spaced retrieval practice'], abstract: 'From Crossref.', issued: { 'date-parts': [[2021]] } });
  const c = fromOpenAlex(work({ id: 'W2', doi: null, display_name: 'Spaced retrieval practice' }));
  const merged = dedupe([a, b, c]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].abstract.length > 0, true);
  assert.equal(merged[0].pdfUrl, 'https://repo.example/abc.pdf');
});

test('results already in the project are marked', () => {
  const [p] = markExisting([fromOpenAlex(work())], [{ id: 'd1', title: 'Other', doi: '10.1000/ABC.123' }]);
  assert.equal(p.existingId, 'd1');
});

const fakeFetch = (routes) => async (url) => {
  const hit = routes.find(([re]) => re.test(url));
  if (!hit) return { ok: false, status: 500, json: async () => ({}) };
  const [, status, body] = hit;
  if (status instanceof Error) throw status;
  return { ok: status < 400, status, json: async () => body };
};

test('search falls back to Crossref when OpenAlex fails, and reports it', async () => {
  const fetchImpl = fakeFetch([
    [/api\.openalex\.org/, new TypeError('Failed to fetch')],
    [/api\.crossref\.org/, 200, { message: { items: [{ DOI: '10.1/x', title: ['A paper'], issued: { 'date-parts': [[2020]] } }] } }],
  ]);
  const out = await searchScholarly('memory', { fetchImpl });
  assert.equal(out.results.length, 1);
  assert.equal(out.provider, 'Crossref');
  assert.match(out.warnings[0], /did not answer/);
});

test('a pasted DOI is looked up exactly; if every index fails the error says so', async () => {
  const fetchImpl = fakeFetch([[/openalex\.org\/works\/doi:10\.1000/, 200, work()]]);
  const out = await searchScholarly('https://doi.org/10.1000/abc.123', { fetchImpl });
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].doi, '10.1000/abc.123');
  const down = fakeFetch([[/./, new TypeError('Failed to fetch')]]);
  await assert.rejects(searchScholarly('memory', { fetchImpl: down }), /Could not reach the paper indexes/);
});

test('checked pairs are remembered per project and forgotten when an item changes', () => {
  let r = emptyResearch(); let p; let a; let b; let c;
  [r, p] = createProject(r, { name: 'P' });
  [r, a] = addItem(r, p.id, { type: 'claim', title: 'A' });
  [r, b] = addItem(r, p.id, { type: 'finding', title: 'B' });
  [r, c] = addItem(r, p.id, { type: 'finding', title: 'C' });
  r = markPairsChecked(r, p.id, [[a.id, b.id], [b.id, c.id]], new Date(Date.now() + 1000).toISOString());
  assert.equal(checkedPairsFor(r, projectView(r, p.id)).length, 2);
  const later = new Date(Date.now() + 5000).toISOString();
  r = { ...updateItem(r, c.id, {}), items: updateItem(r, c.id, {}).items.map((i) => (i.id === c.id ? { ...i, updatedAt: later } : i)) };
  assert.deepEqual(checkedPairsFor(r, projectView(r, p.id)).map((x) => [...x].sort()), [[a.id, b.id].sort()]);
  assert.equal(checkedPairsFor(clearCheckedPairs(r, p.id), projectView(r, p.id)).length, 0);
});

test('reminders: heads-up 5 minutes before, due at the time, never twice, very old ones skipped quietly', () => {
  const now = Date.parse('2026-11-23T14:00:00Z');
  const tasks = [
    { id: 'soon', title: 'Soon', dueAt: new Date(now + 3 * 60000).toISOString() }, // no remindAt: dueAt is used
    { id: 'due', title: 'Due', remindAt: new Date(now - 1000).toISOString() },
    { id: 'later', title: 'Later', dueAt: new Date(now + HEADS_UP_MS + 60000).toISOString() },
    { id: 'done', title: 'Done', dueAt: new Date(now - 1000).toISOString(), completed: true },
    { id: 'old', title: 'Old', dueAt: new Date(now - 10 * 86400000).toISOString() },
  ];
  const first = pendingReminders(tasks, {}, now);
  assert.deepEqual(first.out.map((x) => `${x.task.id}:${x.stage}`), ['soon:soon', 'due:due']);
  assert.equal(first.silent.length, 1);
  const log = Object.fromEntries([...first.out.map((x) => [x.key, now]), ...first.silent.map((k) => [k, now])]);
  assert.equal(pendingReminders(tasks, log, now + 1000).out.length, 0);
  // the "soon" task reaches its time: one more (due) reminder, then nothing
  const atDue = now + 4 * 60000;
  const second = pendingReminders(tasks, log, atDue);
  assert.deepEqual(second.out.map((x) => `${x.task.id}:${x.stage}`), ['soon:due', 'later:soon']); // "later" is now within 5 minutes
  // editing a deadline makes it remind again
  const moved = tasks.map((t) => (t.id === 'due' ? { ...t, remindAt: new Date(now + 2 * 60000).toISOString() } : t));
  assert.deepEqual(pendingReminders(moved, log, now + 1000).out.map((x) => `${x.task.id}:${x.stage}`), ['due:soon']);
});

import { applyExtraction, addDocument, findDuplicateItems, nearDuplicate, stitch, addSuggestedThreads } from './store.js';

test('extracting a source again skips what is already on the map; duplicates are found', () => {
  let r = emptyResearch(); let p; let d;
  [r, p] = createProject(r, { name: 'Plastics' });
  [r, d] = addDocument(r, p.id, { title: 'Apete', hasText: true });
  const loop = 'ALDFG in the marine environment leads to marine organism mortality through ingestion of or entanglement in macroplastics.';
  const first = [{ type: 'claim', title: 'ALDFG mortality feedback loops reduce fish availability', content: 'Mortality reduces fish availability.', provenance: 'source-stated', evidence: [{ page: 5, quote: loop }] }];
  let created;
  [r, created] = applyExtraction(r, p.id, d.id, first);
  assert.equal(created.length, 1);
  const again = [
    { type: 'claim', title: 'ALDFG mortality reduces fish stocks in a reinforcing loop', content: 'The loop reduces stocks.', provenance: 'source-stated', evidence: [{ page: 5, quote: `The CLD construction began with the understanding that ${loop}` }] },
    { type: 'finding', title: 'Annual loss rates of gear', content: '56% of FADs are lost annually.', provenance: 'source-stated', evidence: [{ page: 3, quote: 'Global estimates suggest that 56 % of fish aggregating devices are lost annually' }] },
  ];
  [r, created] = applyExtraction(r, p.id, d.id, again);
  assert.equal(created.length, 1);
  assert.equal(created.skipped, 1);
  assert.equal(nearDuplicate({ title: 'A', documentId: 'x' }, { title: 'B', documentId: 'y' }, [loop], [`Indeed ${loop}`]), true);
  // duplicates already on a map (from an older version) are found for cleaning up
  const old = { ...r, items: [...r.items, { ...r.items[0], id: 'dup', title: 'ALDFG mortality feedback loops reduce fish availability', createdAt: '2099-01-01' }] };
  const dups = findDuplicateItems(projectView(old, p.id));
  assert.equal(dups.length, 1);
  assert.equal(dups[0][1].id, 'dup');
});

test('stitching with edits can reverse the direction and records it', () => {
  let r = emptyResearch(); let p; let a; let b;
  [r, p] = createProject(r, { name: 'P' });
  [r, a] = addItem(r, p.id, { type: 'finding', title: 'Microplastics add mortality' });
  [r, b] = addItem(r, p.id, { type: 'claim', title: 'Feedback loop' });
  let added;
  [r, added] = addSuggestedThreads(r, p.id, [{ from: b.id, to: a.id, relationship: 'extends', explanation: 'x', reasoning: 'A says…', crossSource: false }]);
  assert.equal(added[0].reasoning, 'A says…');
  r = stitch(r, added[0].id, { swap: true, relationship: 'qualifies' });
  const c = r.connections[0];
  assert.deepEqual([c.from, c.to, c.relationship, c.status], [a.id, b.id, 'qualifies', 'confirmed']);
  assert.match(r.feedback[0].comment, /direction reversed/);
});

import { ringLayout, NODE_SIZE, HUB_ID } from './layout.js';
import { addDocument as addDoc2 } from './store.js';

function ringsFixture() {
  let r = emptyResearch(); let p; const docs = []; const ids = {};
  [r, p] = createProject(r, { name: 'Rings' });
  for (const name of ['A', 'B', 'C']) { let d; [r, d] = addDoc2(r, p.id, { title: name }); docs.push(d); }
  const types = ['claim', 'finding', 'finding', 'limitation', 'method', 'question'];
  docs.forEach((d, n) => types.forEach((t, k) => { let it; [r, it] = addItem(r, p.id, { type: t, title: `${d.title} ${t} ${k}`, documentId: d.id, quiet: true }); ids[`${n}${k}`] = it.id; }));
  let mine; [r, mine] = addItem(r, p.id, { type: 'claim', title: 'My own claim', quiet: true });
  return { r, p, docs, ids, mine };
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const size = (v, id) => (id.startsWith('doc:') ? NODE_SIZE.source : id === HUB_ID ? NODE_SIZE.hub : ['claim', 'finding'].includes(v.itemById[id.slice(5)].type) ? NODE_SIZE.inner : NODE_SIZE.outer);

test('rings map: sources in the middle, claims/findings on the inner ring, the rest outside, nothing overlaps', () => {
  const { r, p, docs } = ringsFixture();
  const v = projectView(r, p.id);
  const { positions } = ringLayout(v);
  const ids = Object.keys(positions);
  for (let x = 0; x < ids.length; x += 1) for (let y = x + 1; y < ids.length; y += 1) {
    assert.ok(dist(positions[ids[x]], positions[ids[y]]) >= (size(v, ids[x]) + size(v, ids[y])) / 2 - 1, `${ids[x]} overlaps ${ids[y]}`);
  }
  for (const d of docs) {
    const c = positions[`doc:${d.id}`];
    const mine = v.items.filter((i) => i.documentId === d.id);
    const inner = Math.max(...mine.filter((i) => ['claim', 'finding'].includes(i.type)).map((i) => dist(positions[`item:${i.id}`], c)));
    const outer = Math.min(...mine.filter((i) => !['claim', 'finding'].includes(i.type)).map((i) => dist(positions[`item:${i.id}`], c)));
    assert.ok(inner < outer, 'claims and findings sit inside the ring of other items');
    for (const i of mine) { // every item is nearest its own source
      for (const o of docs) if (o.id !== d.id) assert.ok(dist(positions[`item:${i.id}`], c) < dist(positions[`item:${i.id}`], positions[`doc:${o.id}`]));
    }
  }
  assert.ok(positions[HUB_ID], 'your own items gather round a hub');
  assert.deepEqual(ringLayout(v).positions, positions); // deterministic
});

test('rings map: threads between papers pull them together; dragged items stay on their ring at the dropped angle', () => {
  const { r, p, docs, ids } = ringsFixture();
  const gap = (rr) => { const pos = ringLayout(projectView(rr, p.id)).positions; return dist(pos[`doc:${docs[0].id}`], pos[`doc:${docs[1].id}`]); };
  let linked;
  [linked] = addSuggestedThreads(r, p.id, [0, 1, 2].map((k) => ({ from: ids[`0${k}`], to: ids[`1${k}`], relationship: 'supports', explanation: 'x' })));
  assert.ok(gap(linked) < gap(r), 'papers that are threaded together end up closer');
  const v = projectView(r, p.id);
  const centre = ringLayout(v).positions[`doc:${docs[0].id}`];
  const drop = { x: centre.x + 500, y: centre.y }; // dropped straight to the right, far out
  const pinned = { [`doc:${docs[0].id}`]: centre, [`item:${ids['00']}`]: drop };
  const pos = ringLayout(v, { pinned }).positions[`item:${ids['00']}`];
  assert.ok(Math.abs(pos.y - centre.y) < 2 && pos.x > centre.x, 'kept the angle');
  assert.ok(dist(pos, centre) < 400, 'snapped back onto its ring');
});
