// Evidence-linked outline built straight from the map. Nothing is invented: every entry is an item the
// user has, cited with the passages attached to it. Proposed (unstitched) threads are left out unless asked for.
import { RELATIONS, docLabel } from './model.js';

function entry(view, itemId, role, status, text) {
  const item = view.itemById[itemId];
  if (!item) return null;
  const doc = view.docById[item.documentId];
  const citations = (view.evidenceByItem[itemId] || []).map((e) => ({ source: docLabel(view.docById[e.documentId] || doc), page: e.page, quote: e.quote, verified: e.verified }));
  return { itemId, role, status, title: item.title, type: item.type, provenance: item.provenance, text: text || item.content, citations, noPassage: !citations.length && item.type !== 'question' && item.type !== 'claim' };
}

export function buildOutline(view, { includeSuggested = false } = {}) {
  const live = view.connections.filter((c) => c.status === 'confirmed' || (includeSuggested && c.status === 'suggested'));
  const statusOf = (c) => (c.status === 'confirmed' ? 'confirmed' : 'proposed');
  const sections = [];
  const placed = new Set();
  const use = (e) => { if (e) placed.add(e.itemId); return e; };
  const clean = (list) => list.filter(Boolean);

  const motivating = clean([...view.items.filter((i) => i.type === 'question'), ...view.items.filter((i) => i.type === 'gap')].map((i) => use(entry(view, i.id, i.type === 'gap' ? 'candidate gap' : 'question', 'confirmed'))));
  sections.push({ id: 'intro', heading: 'Introduction and research question', purpose: view.project?.researchQuestion || 'Add a research question to anchor the outline.', entries: motivating, needsEvidence: !view.project?.researchQuestion });

  for (const claim of view.items.filter((i) => i.type === 'claim')) {
    const entries = [use(entry(view, claim.id, 'claim', 'confirmed'))];
    let support = 0;
    for (const c of live) {
      const other = c.to === claim.id ? c.from : c.from === claim.id && c.relationship === 'contradicts' ? c.to : null;
      if (!other || !view.itemById[other]) continue;
      if (c.relationship === 'supports' && c.to === claim.id) { entries.push(use(entry(view, other, 'support', statusOf(c), c.explanation))); support += 1; }
      else if (c.relationship === 'contradicts') entries.push(use(entry(view, other, 'counter-evidence', statusOf(c), c.explanation)));
      else if (c.relationship === 'qualifies' && c.to === claim.id) entries.push(use(entry(view, other, 'qualification', statusOf(c), c.explanation)));
      else if (['extends', 'explains', 'depends_on', 'informs'].includes(c.relationship) && c.to === claim.id) entries.push(use(entry(view, other, RELATIONS[c.relationship].label, statusOf(c), c.explanation)));
    }
    const ownQuote = (view.evidenceByItem[claim.id] || []).some((e) => e.verified);
    // A claim with its own verified quote is not "without evidence"; it just has nothing else linked to it yet.
    sections.push({ id: `claim:${claim.id}`, heading: claim.title, purpose: 'Argue this claim from the evidence you have stitched, and say where it is contested.', entries: clean(entries), needsEvidence: support === 0,
      needsLabel: support ? '' : ownQuote ? 'Only its own quote: no supporting item linked yet' : 'Needs evidence' });
  }

  const limitations = clean(view.items.filter((i) => i.type === 'limitation').map((i) => use(entry(view, i.id, 'limitation', 'confirmed'))));
  if (limitations.length) sections.push({ id: 'limitations', heading: 'Limitations and caveats', purpose: 'What the sources themselves say limits their conclusions.', entries: limitations, needsEvidence: false });
  const methods = clean(view.items.filter((i) => i.type === 'method').map((i) => use(entry(view, i.id, 'method', 'confirmed'))));
  if (methods.length) sections.push({ id: 'methods', heading: 'Methods in the literature', purpose: 'How the evidence was produced, to inform your own methodology.', entries: methods, needsEvidence: false });
  const contributions = clean(view.items.filter((i) => i.type === 'contribution').map((i) => use(entry(view, i.id, 'contribution', 'confirmed'))));
  if (contributions.length) sections.push({ id: 'contribution', heading: 'Potential contribution', purpose: 'Provisional: what your work could add.', entries: contributions, needsEvidence: false });
  const loose = clean(view.items.filter((i) => ['finding', 'decision'].includes(i.type) && !placed.has(i.id)).map((i) => entry(view, i.id, i.type, 'confirmed')));
  if (loose.length) sections.push({ id: 'unplaced', heading: 'Findings not yet connected to a claim', purpose: 'These are on your map but no stitched thread ties them into the argument yet.', entries: loose, needsEvidence: true, needsLabel: 'Not linked to a claim yet' });
  return { mode: 'map', includeSuggested, sections };
}

/** Turn an AI outline (sections with item_ids) into the same shape, citing only items that exist. */
export function outlineFromAi(view, sections) {
  return {
    mode: 'ai', includeSuggested: false,
    sections: sections.map((s, n) => ({
      id: `ai:${n}`, heading: s.heading, purpose: s.purpose, needsEvidence: s.needs_evidence || !(s.item_ids || []).length,
      entries: (s.item_ids || []).map((id) => entry(view, id, view.itemById[id]?.type || 'item', 'confirmed')).filter(Boolean),
    })),
  };
}
