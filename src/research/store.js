// Pure state transitions for the research slice (projects, documents, items, evidence, connections...).
// Every function takes the research object and returns a new one (or [next, created]). Nothing here
// touches the network or the disk, so it is easy to test and the UI can never half-apply a change.
import { v4 as uuid } from 'uuid';
import { RELATIONS, docLabel, normalizeResearch, nowIso, shortText } from './model.js';
import { TfIdf, normalize, quoteInText, tokens } from './text.js';

const pairKey = (a, b) => [a, b].sort().join('|');
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n += 1; return n / (a.size + b.size - n); };

/** Two items that restate the same point: a shared (or contained) quote, or near-identical title/content from the same source. */
export function nearDuplicate(a, b, quotesA = [], quotesB = []) {
  const qa = quotesA.map((q) => normalize(q)).filter((q) => q.length >= 30);
  const qb = quotesB.map((q) => normalize(q)).filter((q) => q.length >= 30);
  if (qa.some((x) => qb.some((y) => x.includes(y) || y.includes(x)))) return true;
  if ((a.documentId || null) !== (b.documentId || null)) return false;
  return jaccard(new Set(tokens(a.title)), new Set(tokens(b.title))) >= 0.75 || jaccard(new Set(tokens(a.content || '')), new Set(tokens(b.content || ''))) >= 0.6;
}

/** Likely duplicate items in a project, as [keep, remove] pairs (keeps the better-evidenced, then the older one). */
export function findDuplicateItems(view) {
  const items = view.items.filter((i) => i.type !== 'task');
  const quotes = (i) => (view.evidenceByItem[i.id] || []).map((e) => e.quote);
  const strength = (i) => (i.provenance === 'source-stated' ? 4 : i.provenance === 'user-confirmed' ? 3 : i.provenance === 'partly-sourced' ? 2 : 1) * 10 + quotes(i).length;
  const out = []; const gone = new Set();
  for (let x = 0; x < items.length; x += 1) {
    for (let y = x + 1; y < items.length; y += 1) {
      const [a, b] = [items[x], items[y]];
      if (gone.has(a.id) || gone.has(b.id) || !nearDuplicate(a, b, quotes(a), quotes(b))) continue;
      const keepA = strength(a) > strength(b) || (strength(a) === strength(b) && (a.createdAt || '') <= (b.createdAt || ''));
      const [keep, drop] = keepA ? [a, b] : [b, a];
      out.push([keep, drop]); gone.add(drop.id);
    }
  }
  return out;
}
const titleOf = (r, id) => r.items.find((i) => i.id === id)?.title || 'an item';

function log(r, projectId, kind, summary, refs = []) {
  return { ...r, history: [{ id: uuid(), projectId, at: nowIso(), kind, summary, refs }, ...r.history].slice(0, 600) };
}

// ----------------------------------------------------------------------------- projects
export function createProject(r, { name, researchQuestion = '', sample = false }) {
  const project = { id: uuid(), name: name.trim() || 'Untitled project', researchQuestion: researchQuestion.trim(), sample, createdAt: nowIso(), updatedAt: nowIso() };
  return [log({ ...r, projects: [project, ...r.projects], activeProjectId: project.id }, project.id, 'project_created', `Started “${project.name}”`), project];
}
export const updateProject = (r, id, patch) => ({ ...r, projects: r.projects.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: nowIso() } : p)) });
export const setActiveProject = (r, id) => ({ ...r, activeProjectId: id });

export function deleteProject(r, id) {
  const itemIds = new Set(r.items.filter((i) => i.projectId === id).map((i) => i.id));
  const connIds = new Set(r.connections.filter((c) => c.projectId === id).map((c) => c.id));
  const layouts = { ...r.layouts }; delete layouts[id];
  const outlines = { ...r.outlines }; delete outlines[id];
  const checkedPairs = { ...(r.checkedPairs || {}) }; delete checkedPairs[id];
  const projects = r.projects.filter((p) => p.id !== id);
  return {
    ...r, projects, layouts, outlines, checkedPairs,
    documents: r.documents.filter((d) => d.projectId !== id),
    items: r.items.filter((i) => i.projectId !== id),
    evidence: r.evidence.filter((e) => !itemIds.has(e.itemId)),
    connections: r.connections.filter((c) => c.projectId !== id),
    feedback: r.feedback.filter((f) => !connIds.has(f.connectionId)),
    gaps: r.gaps.filter((g) => g.projectId !== id),
    history: r.history.filter((h) => h.projectId !== id),
    activeProjectId: r.activeProjectId === id ? (projects[0]?.id ?? null) : r.activeProjectId,
  };
}

// ---------------------------------------------------------------------------- documents
export function addDocument(r, projectId, d) {
  const doc = {
    id: d.id || uuid(), projectId, title: (d.title || 'Untitled source').trim(), authors: (d.authors || '').trim(), year: d.year ? Number(d.year) || null : null,
    doi: d.doi || '', url: d.url || '', fileName: d.fileName || '', pageCount: d.pageCount || 0, origin: d.origin || 'manual',
    verified: d.verified !== false, hasText: Boolean(d.hasText), status: 'added', addedAt: nowIso(),
  };
  return [log({ ...r, documents: [...r.documents, doc] }, projectId, 'document_added', `Added source ${docLabel(doc)}`, [doc.id]), doc];
}
export const updateDocument = (r, id, patch) => ({ ...r, documents: r.documents.map((d) => (d.id === id ? { ...d, ...patch } : d)) });

export function deleteDocument(r, id) {
  const doc = r.documents.find((d) => d.id === id);
  if (!doc) return r;
  let next = r;
  for (const item of r.items.filter((i) => i.documentId === id)) next = deleteItem(next, item.id, { quiet: true });
  next = { ...next, documents: next.documents.filter((d) => d.id !== id), evidence: next.evidence.filter((e) => e.documentId !== id) };
  return log(next, doc.projectId, 'document_removed', `Removed source ${docLabel(doc)}`);
}

// -------------------------------------------------------------------------------- items
export function addItem(r, projectId, p) {
  const item = {
    id: p.id || uuid(), projectId, type: p.type, title: (p.title || '').trim() || 'Untitled', content: (p.content || '').trim(), documentId: p.documentId || null,
    provenance: p.provenance || 'user-confirmed', origin: p.origin || 'manual', noteId: p.noteId || null, taskId: p.taskId || null,
    supportNotes: p.supportNotes || [], attribution: p.attribution || null,
    reviewedAt: null, createdAt: nowIso(), updatedAt: nowIso(),
  };
  const evidence = (p.evidence || []).filter((e) => e.quote).map((e) => ({
    id: uuid(), itemId: item.id, documentId: e.documentId || item.documentId, page: e.page ?? null, quote: e.quote, verified: Boolean(e.verified),
    passageId: e.documentId || item.documentId ? `${e.documentId || item.documentId}:p${e.page ?? 0}` : null,
  }));
  const next = { ...r, items: [...r.items, item], evidence: [...r.evidence, ...evidence] };
  return [p.quiet ? next : log(next, projectId, 'item_added', `Added ${item.type}: ${shortText(item.title, 70)}`, [item.id]), item];
}
export const updateItem = (r, id, patch) => ({ ...r, items: r.items.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: nowIso() } : i)) });

export function confirmItem(r, id) {
  const item = r.items.find((i) => i.id === id);
  if (!item || item.provenance === 'user-confirmed') return r;
  return log(updateItem(r, id, { provenance: 'user-confirmed' }), item.projectId, 'item_confirmed', `Confirmed: ${shortText(item.title, 70)}`, [id]);
}
export function markReviewed(r, id) {
  const item = r.items.find((i) => i.id === id);
  if (!item) return r;
  return log(updateItem(r, id, { reviewedAt: nowIso() }), item.projectId, 'item_reviewed', `Reviewed after new evidence: ${shortText(item.title, 70)}`, [id]);
}

export function deleteItem(r, id, { quiet = false } = {}) {
  const item = r.items.find((i) => i.id === id);
  if (!item) return r;
  const connIds = new Set(r.connections.filter((c) => c.from === id || c.to === id).map((c) => c.id));
  const next = {
    ...r,
    items: r.items.filter((i) => i.id !== id),
    evidence: r.evidence.filter((e) => e.itemId !== id),
    connections: r.connections.filter((c) => !connIds.has(c.id)),
    feedback: r.feedback.filter((f) => !connIds.has(f.connectionId)),
    gaps: r.gaps.map((g) => (g.itemId === id ? { ...g, itemId: null, status: 'candidate' } : g)),
  };
  return quiet ? next : log(next, item.projectId, 'item_removed', `Removed ${item.type}: ${shortText(item.title, 70)}`);
}

export function addEvidence(r, itemId, ev) {
  const item = r.items.find((i) => i.id === itemId);
  if (!item) return r;
  const documentId = ev.documentId || item.documentId;
  const entry = { id: uuid(), itemId, documentId, page: ev.page ?? null, quote: ev.quote.trim(), verified: Boolean(ev.verified), passageId: documentId ? `${documentId}:p${ev.page ?? 0}` : null };
  return updateItem({ ...r, evidence: [...r.evidence, entry] }, itemId, {});
}
export const removeEvidence = (r, id) => ({ ...r, evidence: r.evidence.filter((e) => e.id !== id) });

/** Add the items the backend extracted from one document. Evidence quotes arrive already verified. */
export function applyExtraction(r, projectId, documentId, extracted) {
  let next = r;
  const created = [];
  let skipped = 0;
  // Extracting a source again must not add what is already on the map (or repeat itself).
  const known = r.items.filter((i) => i.projectId === projectId).map((i) => ({ item: i, quotes: r.evidence.filter((e) => e.itemId === i.id).map((e) => e.quote) }));
  for (const e of extracted) {
    const quotes = (e.evidence || []).map((x) => x.quote);
    const probe = { title: e.title, content: e.content, documentId };
    if (known.some((k) => nearDuplicate(probe, k.item, quotes, k.quotes))) { skipped += 1; continue; }
    let item;
    [next, item] = addItem(next, projectId, {
      type: e.type, title: e.title, content: e.content, documentId, provenance: e.provenance, origin: 'ai', quiet: true,
      supportNotes: e.support_notes || [], attribution: e.attribution || null,
      evidence: (e.evidence || []).map((x) => ({ page: x.page, quote: x.quote, verified: x.verified !== false, documentId })),
    });
    known.push({ item, quotes });
    created.push(item);
  }
  created.skipped = skipped;
  const doc = r.documents.find((d) => d.id === documentId);
  next = updateDocument(next, documentId, { status: 'extracted', extractedAt: nowIso() });
  return [log(next, projectId, 'items_extracted', `Extracted ${created.length} item${created.length === 1 ? '' : 's'} from ${docLabel(doc)}`, created.map((i) => i.id)), created];
}

// ----------------------------------------------------------------------------- connections
/** Add proposed threads. Pairs that already have a connection (any status, including dismissed) are skipped. */
export function addSuggestedThreads(r, projectId, threads, origin = 'ai') {
  const seen = new Set(r.connections.filter((c) => c.projectId === projectId).map((c) => pairKey(c.from, c.to)));
  const ids = new Set(r.items.filter((i) => i.projectId === projectId).map((i) => i.id));
  const added = [];
  for (const t of threads) {
    if (!ids.has(t.from) || !ids.has(t.to) || t.from === t.to || !RELATIONS[t.relationship]) continue;
    const key = pairKey(t.from, t.to);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push({
      id: uuid(), projectId, from: t.from, to: t.to, relationship: t.relationship, explanation: t.explanation || '', uncertainty: t.uncertainty || '',
      confidence: t.confidence || 'low', evidence: t.evidence || [], evidenceMissing: t.evidenceMissing ?? !(t.evidence || []).length,
      similarity: t.similarity ?? null, status: 'suggested', origin: t.origin || origin, investigation: null, createdAt: nowIso(), updatedAt: nowIso(),
      reasoning: t.reasoning || '', checked: t.checked || null, checkNote: t.checkNote || '', crossSource: t.crossSource ?? null,
    });
  }
  if (!added.length) return [r, added];
  const tension = added.filter((c) => c.relationship === 'contradicts').length;
  const summary = `${added.length} thread suggestion${added.length === 1 ? '' : 's'} proposed${tension ? `, ${tension} possible contradiction${tension === 1 ? '' : 's'}` : ''}`;
  return [log({ ...r, connections: [...r.connections, ...added] }, projectId, 'threads_suggested', summary, added.map((c) => c.id)), added];
}

export function createConnection(r, projectId, { from, to, relationship = 'related_to', explanation = '' }) {
  if (!from || !to || from === to || !RELATIONS[relationship]) return [r, null];
  const existing = r.connections.find((c) => c.projectId === projectId && pairKey(c.from, c.to) === pairKey(from, to));
  if (existing && existing.status !== 'rejected') return [r, null];
  const base = { from, to, relationship, explanation, status: 'confirmed', origin: 'user', confidence: 'high', evidence: [], evidenceMissing: false, uncertainty: '', updatedAt: nowIso() };
  const conn = existing ? { ...existing, ...base } : { id: uuid(), projectId, similarity: null, investigation: null, createdAt: nowIso(), ...base };
  const connections = existing ? r.connections.map((c) => (c.id === existing.id ? conn : c)) : [...r.connections, conn];
  return [log({ ...r, connections }, projectId, 'thread_created', `You connected: ${RELATIONS[relationship].sentence(shortText(titleOf(r, from), 40), shortText(titleOf(r, to), 40))}`, [conn.id]), conn];
}

function setFeedback(r, connectionId, type, comment = '') {
  return { ...r, feedback: [{ id: uuid(), connectionId, type, comment, createdAt: nowIso() }, ...r.feedback] };
}
const patchConn = (r, id, patch) => ({ ...r, connections: r.connections.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: nowIso() } : c)) });

export function stitch(r, id, edits = {}) {
  const conn = r.connections.find((c) => c.id === id);
  if (!conn) return r;
  const relationship = edits.relationship && RELATIONS[edits.relationship] ? edits.relationship : conn.relationship;
  const explanation = edits.explanation ?? conn.explanation;
  const swap = Boolean(edits.swap);
  const [from, to] = swap ? [conn.to, conn.from] : [conn.from, conn.to];
  const edited = relationship !== conn.relationship || explanation !== conn.explanation || swap;
  let next = patchConn(r, id, { status: 'confirmed', relationship, explanation, from, to, editedByUser: edited || conn.editedByUser });
  const what = [relationship !== conn.relationship && `was “${RELATIONS[conn.relationship].label}”, now “${RELATIONS[relationship].label}”`, swap && 'direction reversed', explanation !== conn.explanation && 'explanation rewritten'].filter(Boolean).join('; ');
  next = setFeedback(next, id, edited ? 'edit' : 'stitch', edited ? `${what[0].toUpperCase()}${what.slice(1)}.` : '');
  return log(next, conn.projectId, edited ? 'thread_edited' : 'thread_stitched',
    `${edited ? 'Stitched with edits' : 'Stitched'}: ${RELATIONS[relationship].sentence(shortText(titleOf(r, from), 40), shortText(titleOf(r, to), 40))}`, [id]);
}
export function dismiss(r, id, comment = '') {
  const conn = r.connections.find((c) => c.id === id);
  if (!conn) return r;
  return log(setFeedback(patchConn(r, id, { status: 'rejected' }), id, 'dismiss', comment), conn.projectId, 'thread_dismissed',
    `Dismissed: ${RELATIONS[conn.relationship].sentence(shortText(titleOf(r, conn.from), 40), shortText(titleOf(r, conn.to), 40))}`, [id]);
}
export const restoreConnection = (r, id) => patchConn(r, id, { status: 'suggested' });
export function recordInvestigation(r, id, investigation) {
  const conn = r.connections.find((c) => c.id === id);
  if (!conn) return r;
  const next = setFeedback(patchConn(r, id, { investigation: { ...investigation, at: nowIso() } }), id, 'investigate', investigation.notes || '');
  return log(next, conn.projectId, 'thread_investigated', `Investigated: ${RELATIONS[conn.relationship].sentence(shortText(titleOf(r, conn.from), 40), shortText(titleOf(r, conn.to), 40))}`, [id]);
}
export function deleteConnection(r, id) {
  return { ...r, connections: r.connections.filter((c) => c.id !== id), feedback: r.feedback.filter((f) => f.connectionId !== id) };
}

// -------------------------------------------------------------------- layout, gaps, outline
// Layout positions are circle centres in the "rings" map. Positions saved by the older column map (kind missing)
// are ignored, so an upgrade starts from a clean self-organised picture.
const LAYOUT_KIND = 'rings';
const ownPositions = (r, projectId) => (r.layouts[projectId]?.kind === LAYOUT_KIND ? r.layouts[projectId].positions || {} : {});
export const saveLayout = (r, projectId, positions) => ({ ...r, layouts: { ...r.layouts, [projectId]: { kind: LAYOUT_KIND, positions: { ...ownPositions(r, projectId), ...positions }, updatedAt: nowIso() } } });
export const resetLayout = (r, projectId) => ({ ...r, layouts: { ...r.layouts, [projectId]: { kind: LAYOUT_KIND, positions: {}, updatedAt: nowIso() } } });

export function setGaps(r, projectId, gaps) {
  const have = new Set(r.gaps.filter((g) => g.projectId === projectId).map((g) => g.title.toLowerCase()));
  const fresh = gaps.filter((g) => !have.has(g.title.toLowerCase())).map((g) => ({
    id: uuid(), projectId, title: g.title, description: g.description, basis: g.basis, support: g.support || [], counterevidence: g.counterevidence || [],
    nextSearch: g.nextSearch || g.next_search || [], status: 'candidate', itemId: null, createdAt: nowIso(),
  }));
  if (!fresh.length) return [r, fresh];
  return [log({ ...r, gaps: [...r.gaps, ...fresh] }, projectId, 'gaps_explored', `${fresh.length} candidate gap${fresh.length === 1 ? '' : 's'} proposed`, fresh.map((g) => g.id)), fresh];
}
export const updateGap = (r, id, patch) => ({ ...r, gaps: r.gaps.map((g) => (g.id === id ? { ...g, ...patch } : g)) });

export function addGapToMap(r, gapId) {
  const gap = r.gaps.find((g) => g.id === gapId);
  if (!gap || gap.itemId) return [r, null];
  let next = r;
  let item;
  [next, item] = addItem(next, gap.projectId, { type: 'gap', title: gap.title, content: gap.description, provenance: 'ai-interpretation', origin: 'gap' });
  const existingIds = new Set(next.items.map((i) => i.id));
  const threads = gap.support.filter((id) => existingIds.has(id)).map((id) => ({
    from: id, to: item.id, relationship: 'motivates', confidence: 'low', evidenceMissing: true,
    explanation: 'This item is part of the basis for the candidate gap.', uncertainty: 'Observed in this collection only.', origin: 'ai',
  }));
  [next] = addSuggestedThreads(next, gap.projectId, threads, 'ai');
  return [updateGap(next, gapId, { itemId: item.id, status: 'added' }), item];
}
/** Remember pairs the AI looked at (so the next "Find threads" spends its calls on new pairs). */
export function markPairsChecked(r, projectId, pairs, at = nowIso()) {
  if (!pairs?.length) return r;
  const mine = { ...((r.checkedPairs || {})[projectId] || {}) };
  for (const p of pairs) if (Array.isArray(p) && p.length >= 2) mine[pairKey(p[0], p[1])] = at;
  const keys = Object.keys(mine);
  if (keys.length > 4000) for (const k of keys.sort((a, b) => (mine[a] < mine[b] ? -1 : 1)).slice(0, keys.length - 4000)) delete mine[k];
  return { ...r, checkedPairs: { ...(r.checkedPairs || {}), [projectId]: mine } };
}
export const clearCheckedPairs = (r, projectId) => { const all = { ...(r.checkedPairs || {}) }; delete all[projectId]; return { ...r, checkedPairs: all }; };
/** Checked pairs that are still valid: neither item changed since it was checked, and both still exist. */
export function checkedPairsFor(r, view) {
  const mine = (r.checkedPairs || {})[view.project?.id] || {};
  const out = [];
  for (const [key, at] of Object.entries(mine)) {
    const [a, b] = key.split('|');
    const ia = view.itemById[a]; const ib = view.itemById[b];
    if (ia && ib && (ia.updatedAt || '') <= at && (ib.updatedAt || '') <= at) out.push([a, b]);
  }
  return out;
}
export const setOutline = (r, projectId, outline) => ({ ...r, outlines: { ...r.outlines, [projectId]: { ...outline, generatedAt: nowIso() } } });

// ------------------------------------------------------------------------------ selectors
export function projectView(r0, projectId) {
  const r = normalizeResearch(r0);
  const project = r.projects.find((p) => p.id === projectId) || null;
  const documents = r.documents.filter((d) => d.projectId === projectId);
  const items = r.items.filter((i) => i.projectId === projectId);
  const itemIds = new Set(items.map((i) => i.id));
  const evidenceByItem = {};
  for (const e of r.evidence) if (itemIds.has(e.itemId)) (evidenceByItem[e.itemId] ||= []).push(e);
  return {
    project, documents, items, evidenceByItem,
    connections: r.connections.filter((c) => c.projectId === projectId),
    gaps: r.gaps.filter((g) => g.projectId === projectId),
    history: r.history.filter((h) => h.projectId === projectId),
    layout: ownPositions(r, projectId),
    outline: r.outlines[projectId] || null,
    docById: Object.fromEntries(documents.map((d) => [d.id, d])),
    itemById: Object.fromEntries(items.map((i) => [i.id, i])),
  };
}

export const pendingThreads = (view) => view.connections.filter((c) => c.status === 'suggested');

/**
 * Thread Shift: which items need a second look because of a possible or confirmed contradiction that
 * the user has not reviewed yet? Contested items are the two ends of the thread; claims that the contested
 * item supports are "affected" (the implication travels one step down the argument).
 */
export function affectedItems(view) {
  const out = new Map();
  const add = (id, reason) => { if (!out.has(id)) out.set(id, []); out.get(id).push(reason); };
  const unreviewed = (item, conn) => !(item.reviewedAt && item.reviewedAt >= conn.updatedAt);
  for (const c of view.connections) {
    if (c.relationship !== 'contradicts' || c.status === 'rejected') continue;
    for (const [endId, otherId] of [[c.from, c.to], [c.to, c.from]]) {
      const end = view.itemById[endId];
      if (!end || end.type === 'task') continue;
      if (unreviewed(end, c)) add(endId, { kind: 'contested', connectionId: c.id, otherId, status: c.status });
      for (const s of view.connections) {
        if (s.relationship !== 'supports' || s.status !== 'confirmed' || s.from !== endId) continue;
        const claim = view.itemById[s.to];
        if (claim && claim.type === 'claim' && claim.id !== otherId && unreviewed(claim, c)) add(claim.id, { kind: 'affected', connectionId: c.id, otherId, viaId: endId, status: c.status });
      }
    }
  }
  return out;
}

/** Items within `hops` connections of `id` (rejected connections ignored). */
export function neighborhood(view, id, hops = 1) {
  const seen = new Set([id]);
  let frontier = [id];
  for (let h = 0; h < hops; h += 1) {
    const next = [];
    for (const c of view.connections) {
      if (c.status === 'rejected') continue;
      if (frontier.includes(c.from) && !seen.has(c.to)) { seen.add(c.to); next.push(c.to); }
      if (frontier.includes(c.to) && !seen.has(c.from)) { seen.add(c.from); next.push(c.from); }
    }
    frontier = next;
  }
  return seen;
}

// ------------------------------------------------------- shapes for the backend + fallbacks
export function toApiItem(view, item) {
  return {
    id: item.id, type: item.type, title: item.title, content: item.content, document_id: item.documentId, provenance: item.provenance,
    evidence: (view.evidenceByItem[item.id] || []).slice(0, 12).map((e) => ({ page: e.page, quote: e.quote, document_id: e.documentId })),
  };
}
export const toApiDocs = (view) => view.documents.map((d) => ({ id: d.id, title: d.title, authors: d.authors, year: d.year }));
export const toApiConns = (view, statuses = ['confirmed', 'suggested', 'rejected']) =>
  view.connections.filter((c) => statuses.includes(c.status)).map((c) => ({ id: c.id, from: c.from, to: c.to, relationship: c.relationship, explanation: c.explanation, status: c.status }));

export function fromApiThreads(threads = []) {
  return threads.map((t) => ({
    from: t.from, to: t.to, relationship: t.relationship, explanation: t.explanation, uncertainty: t.uncertainty, confidence: t.confidence,
    evidence: (t.evidence || []).map((e) => ({ itemId: e.item_id, quote: e.quote })), evidenceMissing: Boolean(t.evidence_missing), similarity: t.similarity,
    reasoning: t.reasoning || '', checked: t.checked || null, checkNote: t.check_note || '', crossSource: t.cross_source ?? null,
  }));
}

/** Keyword-only candidates for when no AI is connected. They never claim a relationship type beyond "related to". */
export function heuristicThreads(view, { focusIds = [], limit = 6 } = {}) {
  const items = view.items.filter((i) => i.type !== 'task' && i.type !== 'decision');
  const seen = new Set(view.connections.map((c) => pairKey(c.from, c.to)));
  const focus = new Set(focusIds);
  const index = new TfIdf(items.map((i) => `${i.title}. ${i.content} ${(view.evidenceByItem[i.id] || []).slice(0, 3).map((e) => e.quote).join(' ')}`));
  const pairs = [];
  for (let a = 0; a < items.length; a += 1) {
    for (let b = a + 1; b < items.length; b += 1) {
      const [x, y] = [items[a], items[b]];
      if (seen.has(pairKey(x.id, y.id)) || (focus.size && !focus.has(x.id) && !focus.has(y.id))) continue;
      if (nearDuplicate(x, y, (view.evidenceByItem[x.id] || []).map((e) => e.quote), (view.evidenceByItem[y.id] || []).map((e) => e.quote))) continue;
      const cross = (x.documentId || null) !== (y.documentId || null);
      const terms = index.sharedTerms(a, b);
      let score = index.cosine(a, b);
      if (terms.length < (cross ? 1 : 2) || score < (cross ? 0.04 : 0.06)) continue;
      score *= cross ? 1.3 : 0.7;
      pairs.push({ x, y, score, terms });
    }
  }
  pairs.sort((p, q) => q.score - p.score);
  return pairs.slice(0, limit).map(({ x, y, score, terms }) => ({
    from: x.id, to: y.id, relationship: 'related_to', origin: 'heuristic', crossSource: (x.documentId || null) !== (y.documentId || null), confidence: 'low', evidence: [], evidenceMissing: true, similarity: Number(score.toFixed(3)),
    explanation: `Both items mention: ${terms.join(', ')}.`,
    uncertainty: 'Matched on shared words only. Nobody (neither AI nor you) has checked how these two items relate. Choose the relationship yourself with Edit.',
  }));
}

/** Pick the items most relevant to a question for map-aware Q&A. */
export function retrieveNodes(view, question, k = 10) {
  const items = view.items.filter((i) => i.type !== 'task');
  if (!items.length) return [];
  const index = new TfIdf(items.map((i) => `${i.title}. ${i.content} ${(view.evidenceByItem[i.id] || []).map((e) => e.quote).join(' ')}`));
  const scores = index.query(question);
  return items.map((item, n) => ({ item, score: scores[n] })).filter((x) => x.score > 0.02).sort((a, b) => b.score - a.score).slice(0, k).map((x) => x.item);
}

/** Verify a quote against stored page text. `pages` is [{page,text}]. Returns the page it was found on, or null. */
export function locateQuote(pages, quote, preferredPage = null) {
  if (!pages?.length || !quote) return null;
  const preferred = pages.find((p) => p.page === preferredPage);
  if (preferred && quoteInText(quote, preferred.text)) return preferred.page;
  const hit = pages.find((p) => quoteInText(quote, p.text));
  return hit ? hit.page : null;
}
