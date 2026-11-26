// Unit tests for the research data layer. Run with: npm test   (node --test src/research)
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyResearch, normalizeResearch } from './model.js';
import { quoteInText, TfIdf } from './text.js';
import * as S from './store.js';
import { seedSampleProject, addSampleNewPaper } from './sample.js';
import { buildOutline } from './outline.js';
import { autoLayout } from './layout.js';
import { exportMarkdown } from './exportMd.js';
import { splitPastedText, syncTaskForItem } from './useResearch.js';

const fresh = () => emptyResearch();
const view = (r) => S.projectView(r, r.activeProjectId);

test('quoteInText tolerates curly quotes, hyphenated line breaks and whitespace, but not invented text', () => {
  const page = 'The authors’ “spaced   retrieval” prac-\ntice improved recall (d = 0.52) over six weeks.';
  assert.ok(quoteInText('"spaced retrieval" practice improved recall (d = 0.52)', page));
  assert.ok(!quoteInText('spaced retrieval practice eliminated forgetting entirely', page));
  assert.ok(!quoteInText('short', 'short'), 'quotes under 12 chars are never trusted');
});

test('TfIdf ranks the topically similar item above the unrelated one', () => {
  const idx = new TfIdf(['spaced retrieval practice improves recall', 'retrieval practice and recall in students', 'gaussian splatting render memory']);
  assert.ok(idx.cosine(0, 1) > idx.cosine(0, 2));
});

test('sample project: every stored quote is found verbatim in the sample page text', () => {
  const { r, pages } = seedSampleProject(fresh());
  const v = view(r);
  assert.ok(v.items.length >= 8);
  for (const [itemId, evs] of Object.entries(v.evidenceByItem)) {
    for (const e of evs) {
      const doc = pages[e.documentId];
      assert.ok(doc, `pages exist for ${e.documentId}`);
      assert.equal(S.locateQuote(doc, e.quote, e.page), e.page, `quote on item ${itemId} not found on page ${e.page}`);
    }
  }
  const second = addSampleNewPaper(r, v.project.id);
  for (const e of second.r.evidence.filter((x) => x.documentId === second.doc.id)) assert.equal(S.locateQuote(second.pages[second.doc.id], e.quote, e.page), e.page);
});

test('sample: everything is labelled as illustrative and nothing starts as an AI claim of truth', () => {
  const { r } = seedSampleProject(fresh());
  assert.ok(r.documents.every((d) => d.title.includes('(illustrative sample)')));
  assert.ok(r.projects[0].sample);
});

test('Thread Shift: a suggested contradiction flags the contested item and the claims it affects, until reviewed', () => {
  const seeded = seedSampleProject(fresh());
  let r = seeded.r;
  assert.equal(S.affectedItems(view(r)).size, 0, 'no flags before the new paper');
  const shifted = addSampleNewPaper(r, seeded.project.id);
  r = shifted.r;
  const v = view(r);
  const tension = v.connections.find((c) => c.relationship === 'contradicts');
  assert.ok(tension && tension.status === 'suggested');
  assert.equal(tension.origin, 'sample');
  assert.ok(tension.uncertainty.length > 20, 'uncertainty is recorded');
  const flags = S.affectedItems(v);
  const claim = v.items.find((i) => i.title.startsWith('Spaced retrieval improves'));
  assert.ok(flags.has(claim.id), 'the contested claim is flagged');
  assert.ok(flags.get(claim.id).some((x) => x.kind === 'contested'));
  const noBenefit = v.items.find((i) => i.title.startsWith('No retention benefit'));
  assert.ok(flags.has(noBenefit.id));
  // the findings that support the claim are not themselves contested, so only claims are "affected"
  assert.ok([...flags.keys()].every((id) => ['claim', 'finding'].includes(v.itemById[id].type)));
  // reviewing the claim after the thread changed clears its flag
  r = S.markReviewed(r, claim.id);
  assert.ok(!S.affectedItems(view(r)).has(claim.id));
  // dismissing the thread clears everything
  r = S.dismiss(r, tension.id);
  assert.equal(S.affectedItems(view(r)).size, 0);
});

test('stitching with edits records an edit, and the qualified relationship persists through a JSON round trip', () => {
  const seeded = seedSampleProject(fresh());
  const shifted = addSampleNewPaper(seeded.r, seeded.project.id);
  const tension = view(shifted.r).connections.find((c) => c.relationship === 'contradicts');
  let r = S.stitch(shifted.r, tension.id, { relationship: 'extends', explanation: 'Qualifies the claim: the benefit may not hold for complex material measured by transfer.' });
  const restored = normalizeResearch(JSON.parse(JSON.stringify(r)));
  const c = view(restored).connections.find((x) => x.id === tension.id);
  assert.equal(c.status, 'confirmed');
  assert.equal(c.relationship, 'extends');
  assert.ok(c.editedByUser);
  assert.ok(restored.feedback.some((f) => f.connectionId === tension.id && f.type === 'edit'));
  assert.ok(restored.history[0].summary.startsWith('Stitched with edits'));
});

test('suggestions never duplicate a pair, even after the earlier one was dismissed', () => {
  const seeded = seedSampleProject(fresh());
  const shifted = addSampleNewPaper(seeded.r, seeded.project.id);
  const t = view(shifted.r).connections.find((c) => c.relationship === 'contradicts');
  let r = S.dismiss(shifted.r, t.id);
  const [r2, added] = S.addSuggestedThreads(r, seeded.project.id, [{ from: t.from, to: t.to, relationship: 'contradicts', explanation: 'again' }]);
  assert.equal(added.length, 0);
  assert.equal(r2.connections.length, r.connections.length);
});

test('suggestions with unknown ids or relationship types are ignored (model output is untrusted)', () => {
  const seeded = seedSampleProject(fresh());
  const v = view(seeded.r);
  const [a, b] = v.items;
  const [, added] = S.addSuggestedThreads(seeded.r, seeded.project.id, [
    { from: a.id, to: 'nope', relationship: 'supports' }, { from: a.id, to: b.id, relationship: 'proves' }, { from: a.id, to: a.id, relationship: 'supports' },
  ]);
  assert.equal(added.length, 0);
});

test('deleting an item removes its evidence and threads; deleting a project removes everything under it', () => {
  const seeded = seedSampleProject(fresh());
  const v = view(seeded.r);
  const f = v.items.find((i) => i.type === 'finding');
  const r = S.deleteItem(seeded.r, f.id);
  assert.ok(!r.items.some((i) => i.id === f.id) && !r.evidence.some((e) => e.itemId === f.id) && !r.connections.some((c) => c.from === f.id || c.to === f.id));
  const gone = S.deleteProject(r, seeded.project.id);
  assert.deepEqual([gone.items.length, gone.documents.length, gone.connections.length, gone.evidence.length, gone.history.length], [0, 0, 0, 0, 0]);
});

test('outline: only stitched threads are used by default; proposed ones appear only when asked, and are marked', () => {
  const seeded = seedSampleProject(fresh());
  const shifted = addSampleNewPaper(seeded.r, seeded.project.id);
  const v = view(shifted.r);
  const flat = (o) => o.sections.flatMap((s) => s.entries);
  const base = buildOutline(v);
  assert.ok(!flat(base).some((e) => e.title.startsWith('No retention benefit') && e.role === 'counter-evidence'));
  const withSuggested = buildOutline(v, { includeSuggested: true });
  const counter = flat(withSuggested).find((e) => e.role === 'counter-evidence');
  assert.ok(counter && counter.status === 'proposed');
  assert.ok(base.sections.find((s) => s.id.startsWith('claim:')).entries.length >= 4);
  assert.ok(flat(base).every((e) => e.citations.every((c) => c.quote)));
});

test('gaps: adding to the map creates a provisional gap item with only suggested threads', () => {
  const seeded = seedSampleProject(fresh());
  const v = view(seeded.r);
  const supportIds = v.items.filter((i) => i.type === 'limitation').map((i) => i.id);
  let [r] = S.setGaps(seeded.r, seeded.project.id, [{ title: 'Transfer outcomes are rarely measured', description: 'Observed in this collection only.', basis: 'limitation', support: supportIds }]);
  const gap = r.gaps[0];
  let item;
  [r, item] = S.addGapToMap(r, gap.id);
  assert.equal(item.type, 'gap');
  assert.equal(item.provenance, 'ai-interpretation');
  const links = view(r).connections.filter((c) => c.to === item.id);
  assert.equal(links.length, supportIds.length);
  assert.ok(links.every((c) => c.status === 'suggested' && c.evidenceMissing));
  const [, again] = S.setGaps(r, seeded.project.id, [{ title: gap.title, description: 'x', basis: 'limitation', support: supportIds }]);
  assert.equal(again.length, 0, 'duplicate gap titles are not added twice');
});

test('keyword fallback only ever proposes "related to" and says nobody checked the relationship', () => {
  const seeded = seedSampleProject(fresh());
  const t = S.heuristicThreads(view(seeded.r));
  assert.ok(t.length > 0);
  assert.ok(t.every((x) => x.relationship === 'related_to' && x.origin === 'heuristic' && x.evidenceMissing && /nobody/i.test(x.uncertainty)));
});

test('retrieveNodes finds the relevant items for a question', () => {
  const seeded = seedSampleProject(fresh());
  const hits = S.retrieveNodes(view(seeded.r), 'six-week recall after weekly quizzes', 3);
  assert.ok(hits.length && hits[0].title.toLowerCase().includes('quiz'));
});

test('layout gives every document and item a position, and dragged positions win once saved', () => {
  const seeded = seedSampleProject(fresh());
  const v = view(seeded.r);
  const auto = autoLayout(v);
  assert.equal(Object.keys(auto).length, v.documents.length + v.items.length + (v.items.some((i) => !i.documentId) ? 1 : 0)); // + the "Your items" hub
  const r = S.saveLayout(seeded.r, seeded.project.id, { [`item:${v.items[0].id}`]: { x: 5, y: 6 } });
  assert.deepEqual(view(r).layout[`item:${v.items[0].id}`], { x: 5, y: 6 });
  assert.deepEqual(view(S.resetLayout(r, seeded.project.id)).layout, {});
});

test('markdown export keeps provenance and the stitched / proposed split', () => {
  const seeded = seedSampleProject(fresh());
  const shifted = addSampleNewPaper(seeded.r, seeded.project.id);
  const md = exportMarkdown(view(shifted.r));
  assert.match(md, /## Stitched threads/);
  assert.match(md, /## Proposed threads \(not yet reviewed\)/);
  assert.match(md, /Source-stated/);
  assert.match(md, /illustrative sample/i);
});

test('task items keep a checklist entry in step with the item', () => {
  const seeded = seedSampleProject(fresh());
  let [r, item] = S.addItem(seeded.r, seeded.project.id, { type: 'task', title: 'Re-read paper D' });
  item = { ...item, dueAt: '2030-01-01T10:00:00.000Z' };
  let tasks = syncTaskForItem([], item);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].dueAt, item.dueAt);
  tasks = syncTaskForItem(tasks, { ...item, title: 'Re-read paper D carefully' });
  assert.equal(tasks[0].title, 'Re-read paper D carefully');
  tasks = syncTaskForItem(tasks, { ...item, type: 'question' });
  assert.equal(tasks.length, 0);
});

test('pasted text becomes numbered sections', () => {
  assert.deepEqual(splitPastedText('a\n\n\nb').map((p) => p.page), [1]);
  const long = Array.from({ length: 40 }, (_, n) => `Paragraph ${n} ${'word '.repeat(60)}`).join('\n\n');
  assert.ok(splitPastedText(long).length > 1);
  assert.equal(splitPastedText('one\fthree').length, 2);
  assert.equal(splitPastedText('   ').length, 0);
});

test('normalizeResearch fills in collections missing from older saves', () => {
  const r = normalizeResearch({ projects: [{ id: 'p' }] });
  assert.deepEqual(Object.keys(r).sort(), Object.keys(emptyResearch()).sort());
  assert.equal(normalizeResearch(null).projects.length, 0);
});
