// The one place where the research slice meets the rest of the app: React state, the optional AI service,
// page text on disk, and the checklist. Pure transitions live in store.js; this hook only sequences them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { ApiError, api } from './api.js';
import { ITEM_TYPES, docLabel, emptyResearch, normalizeResearch, nowIso, shortText } from './model.js';
import * as S from './store.js';
import { addSampleNewPaper, seedSampleProject } from './sample.js';
import { deletePages, loadPages, savePages } from './pagesStore.js';
import { buildOutline, outlineFromAi } from './outline.js';
import { exportMarkdown } from './exportMd.js';
import { markExisting, searchScholarly } from './scholar.js';

/** Keeps the checklist entry of a "task" item in step with the item. */
export function syncTaskForItem(tasks, item) {
  const id = `rt-${item.id}`;
  const existing = tasks.find((t) => t.id === id);
  if (item.type !== 'task') return existing ? tasks.filter((t) => t.id !== id) : tasks;
  const dueAt = item.dueAt || null;
  const dateChanged = !existing || existing.dueAt !== dueAt;
  const base = existing || { id, noteId: null, checklistId: null, completed: false, createdAt: nowIso(), researchItemId: item.id, projectId: item.projectId };
  const next = { ...base, title: item.title, dueAt, remindAt: dueAt, researchItemId: item.id, projectId: item.projectId, ...(dateChanged ? { notified: false, notifiedSoon: false, dismissedFor: null } : {}) };
  return existing ? tasks.map((t) => (t.id === id ? next : t)) : [next, ...tasks];
}

const FEATURE_OFFLINE = 'The AI service is not running, so this step was skipped. Everything else keeps working.';

export function useResearch({ data, setData, notify, offerUndo }) {
  const tasksRef = useRef(data.tasks || []);
  tasksRef.current = data.tasks || [];
  const research = useMemo(() => normalizeResearch(data.research), [data.research]);
  const rRef = useRef(research);
  rRef.current = research;
  const base = data.settings?.aiBaseUrl || 'http://127.0.0.1:8000';
  const baseRef = useRef(base);
  baseRef.current = base;

  const [busy, setBusy] = useState(null);       // label of the running AI/PDF step, or null
  const [problem, setProblem] = useState(null); // { message, offline, kind, retry? } shown as a banner
  const [ai, setAi] = useState({ state: 'unknown', model: false, search: false });
  const pagesCache = useRef({});

  const projectId = research.activeProjectId && research.projects.some((p) => p.id === research.activeProjectId)
    ? research.activeProjectId : (research.projects[0]?.id ?? null);
  const view = useMemo(() => S.projectView(research, projectId), [research, projectId]);
  const viewNow = () => { const r = rRef.current; const id = r.activeProjectId && r.projects.some((p) => p.id === r.activeProjectId) ? r.activeProjectId : r.projects[0]?.id; return S.projectView(r, id); };

  const commit = useCallback((next, tasksFn) => {
    rRef.current = next;
    setData((prev) => ({ ...prev, research: next, ...(tasksFn ? { tasks: tasksFn(prev.tasks) } : {}) }));
  }, [setData]);

  // ----------------------------------------------------------------------------- AI status
  const checkAi = useCallback(async () => {
    try {
      const h = await api.health(baseRef.current);
      setAi({ state: h.model_configured ? 'ready' : 'no-model', model: Boolean(h.model_configured), search: Boolean(h.research_configured) });
    } catch { setAi({ state: 'offline', model: false, search: false }); }
  }, []);
  useEffect(() => { checkAi(); }, [base, checkAi]);

  const fail = (error, kind, retry) => {
    const offline = error instanceof ApiError && error.offline;
    const unconfigured = error instanceof ApiError && error.status === 503;
    setProblem({ kind, retry, offline: offline || unconfigured, message: error?.message || 'Something went wrong.' });
    if (offline) setAi((a) => ({ ...a, state: 'offline' }));
    if (unconfigured) setAi((a) => ({ ...a, state: 'no-model' }));
  };
  const busyRef = useRef(null);
  const withBusy = async (label, fn) => { busyRef.current = label; setBusy(label); setProblem(null); try { return await fn(); } finally { busyRef.current = null; setBusy(null); } };

  /**
   * Deletes are instant and can be undone for a few seconds: `before` is the research slice before the delete and
   * `goneTasks` the checklist entries that went with it. Source text on disk is only removed after the Undo window.
   */
  const undoable = (message, before, goneTasks = [], cleanup = null) => {
    const restore = () => commit(before, (tasks) => [...goneTasks.filter((g) => !tasks.some((t) => t.id === g.id)), ...tasks]);
    if (offerUndo) offerUndo(message, restore, cleanup);
    else { cleanup?.(); notify(message); }
  };

  // --------------------------------------------------------------------------- projects
  const createProject = (name, question) => { const [next, p] = S.createProject(rRef.current, { name, researchQuestion: question }); commit(next); return p; };
  const selectProject = (id) => commit(S.setActiveProject(rRef.current, id));
  const updateProject = (id, patch) => commit(S.updateProject(rRef.current, id, patch));
  const removeProject = (id) => {
    const before = rRef.current;
    const project = before.projects.find((p) => p.id === id);
    if (!project) return;
    const docs = before.documents.filter((d) => d.projectId === id);
    const itemIds = new Set(before.items.filter((i) => i.projectId === id).map((i) => i.id));
    const goneTasks = tasksRef.current.filter((t) => itemIds.has(t.researchItemId));
    commit(S.deleteProject(before, id), (tasks) => tasks.filter((t) => !itemIds.has(t.researchItemId)));
    setProblem(null);
    undoable(`Deleted project “${shortText(project.name, 40)}” (${itemIds.size} item${itemIds.size === 1 ? '' : 's'}, ${docs.length} source${docs.length === 1 ? '' : 's'})`, before, goneTasks,
      () => docs.forEach((d) => { if (!rRef.current.documents.some((x) => x.id === d.id)) { deletePages(d.id); delete pagesCache.current[d.id]; } }));
  };
  const loadSample = async () => {
    if (rRef.current.projects.some((p) => p.sample)) {
      const existing = rRef.current.projects.find((p) => p.sample);
      commit(S.setActiveProject(rRef.current, existing.id));
      return existing;
    }
    const { r, project, pages } = seedSampleProject(rRef.current);
    for (const [docId, p] of Object.entries(pages)) { pagesCache.current[docId] = p; await savePages(docId, p); }
    commit(r);
    return project;
  };
  /** Thread Shift demo: add a new (invented) paper whose result differs from the project's main claim. */
  const addSampleNewPaperToProject = async () => {
    const id = viewNow().project?.id;
    if (!id) return null;
    const { r, doc, pages, threads } = addSampleNewPaper(rRef.current, id);
    for (const [docId, p] of Object.entries(pages)) { pagesCache.current[docId] = p; await savePages(docId, p); }
    commit(r);
    return { doc, threads };
  };

  // ---------------------------------------------------------------------------- sources
  const getPages = useCallback(async (docId) => {
    if (pagesCache.current[docId]) return pagesCache.current[docId];
    const pages = await loadPages(docId);
    pagesCache.current[docId] = pages;
    return pages;
  }, []);

  const parsePdf = (file) => withBusy('Reading the PDF…', async () => {
    try { return await api.parsePdf(baseRef.current, file); } catch (e) { fail(e, 'pdf'); return null; }
  });

  /** Add a source whose text we already have (parsed PDF or pasted). Optionally extract items right away. */
  const addSource = async ({ title, authors, year, doi, url, fileName, origin = 'paste', pages = [], pageUnit = 'page', verified = true, snippet = '', extract = false }) => {
    const id = viewNow().project?.id;
    if (!id) return null;
    const hasText = pages.some((p) => p.text.trim());
    let [next, doc] = S.addDocument(rRef.current, id, { title, authors, year, doi, url, fileName, origin, pageCount: pages.length, hasText, verified });
    next = S.updateDocument(next, doc.id, { pageUnit, snippet });
    commit(next);
    if (hasText) { pagesCache.current[doc.id] = pages; await savePages(doc.id, pages); }
    if (extract && hasText) await extractDocument(doc.id);
    return doc;
  };
  const addTextToSource = async (docId, text, unit = 'section') => {
    const pages = splitPastedText(text);
    pagesCache.current[docId] = pages;
    await savePages(docId, pages);
    commit(S.updateDocument(rRef.current, docId, { hasText: true, pageCount: pages.length, pageUnit: unit, verified: true, textKind: 'pasted' }));
    return pages;
  };
  const updateDocument = (id, patch) => commit(S.updateDocument(rRef.current, id, patch));
  const removeDocument = (id) => {
    const before = rRef.current;
    const doc = before.documents.find((d) => d.id === id);
    if (!doc) return;
    const itemIds = new Set(before.items.filter((i) => i.documentId === id).map((i) => i.id));
    const goneTasks = tasksRef.current.filter((t) => itemIds.has(t.researchItemId));
    commit(S.deleteDocument(before, id), (tasks) => tasks.filter((t) => !itemIds.has(t.researchItemId)));
    undoable(`Removed source ${docLabel(doc)}${itemIds.size ? ` and its ${itemIds.size} item${itemIds.size === 1 ? '' : 's'}` : ''}`, before, goneTasks,
      () => { if (!rRef.current.documents.some((x) => x.id === id)) { deletePages(id); delete pagesCache.current[id]; } });
  };

  const extractDocument = async (docId) => {
    const v = viewNow();
    const doc = v.docById[docId];
    if (!doc) return null;
    return withBusy(`Extracting claims, findings and limitations from ${docLabel(doc)}…`, async () => {
      try {
        const pages = (await getPages(docId)).filter((p) => p.text.trim()).slice(0, 250);
        if (!pages.length) throw new ApiError('This source has no text yet. Paste its text first.');
        // Tell the model what is already on the map from this source, so "Extract again" finds new things instead of repeats.
        const existing = v.items.filter((i) => i.documentId === docId).slice(0, 300).map((i) => ({ title: i.title, content: i.content.slice(0, 1000), quotes: (v.evidenceByItem[i.id] || []).slice(0, 6).map((e) => e.quote.slice(0, 600)) }));
        const maxItems = Math.max(10, Math.min(24, Math.round(pages.length * 1.2)));
        const res = await api.extract(baseRef.current, { research_question: v.project?.researchQuestion || '', document: { id: doc.id, title: doc.title, authors: doc.authors, year: doc.year }, pages, max_items: maxItems, existing });
        const [next, created] = S.applyExtraction(rRef.current, doc.projectId, docId, res.items || []);
        commit(next);
        const partly = created.filter((i) => i.provenance === 'partly-sourced').length;
        const skipped = created.skipped ? ` ${created.skipped} repeat${created.skipped === 1 ? ' was' : 's were'} skipped.` : '';
        notify(created.length
          ? `Found ${created.length} new item${created.length === 1 ? '' : 's'} in ${docLabel(doc)}${partly ? ` (${partly} only partly backed by their quote)` : ''}.${skipped} Review them before you rely on them.`
          : `Nothing new could be extracted and verified from ${docLabel(doc)}.${skipped}`, 5200);
        if (res.warnings?.length) setProblem({ kind: 'warning', message: res.warnings.join(' ') });
        return created;
      } catch (e) { fail(e, 'extract'); return null; }
    });
  };

  /** Web search through the optional backend (Tavily). Results carry no text and are added as unverified. */
  const findSources = async (query) => withBusy('Searching the web…', async () => {
    try { const res = await api.searchSources(baseRef.current, query); return res.results || []; } catch (e) { fail(e, 'search'); return null; }
  });
  /**
   * Scholarly search (OpenAlex, then Crossref), straight from the app: works without the AI backend, returns real
   * papers with DOIs, abstracts and open-access PDF links, merged and marked when already in the project.
   */
  const searchRef = useRef(null);
  const findPapers = async (query) => {
    searchRef.current?.abort?.();
    const controller = new AbortController();
    searchRef.current = controller;
    setBusy('Searching OpenAlex and Crossref…'); setProblem(null);
    try {
      const out = await searchScholarly(query, { signal: controller.signal, limit: 12 });
      if (controller.signal.aborted) return null;
      return { ...out, results: markExisting(out.results, viewNow().documents) };
    } catch (e) {
      if (controller.signal.aborted) return null;
      setProblem({ kind: 'search', message: e.message || 'The search failed.' });
      return null;
    } finally { if (searchRef.current === controller) { searchRef.current = null; setBusy(null); } }
  };
  /**
   * Add a paper from the scholarly search. With `fullText` and an open-access PDF link, the backend downloads and
   * reads the PDF; otherwise (or if that fails) the abstract is stored as the source's text, labelled as such.
   */
  const addPaper = async (paper, { fullText = false, extract = false } = {}) => {
    const v = viewNow();
    if (!v.project) return null;
    if (paper.existingId && v.docById[paper.existingId]) { notify('That paper is already in this project.'); return v.docById[paper.existingId]; }
    const meta = { title: paper.title, authors: paper.authors, year: paper.year, doi: paper.doi, url: paper.url || paper.landingUrl, verified: true };
    if (fullText && paper.pdfUrl) {
      const parsed = await withBusy('Downloading the open-access PDF…', async () => {
        try { return await api.fetchFullText(baseRef.current, paper.pdfUrl); } catch (e) { return { error: e }; }
      });
      if (parsed && !parsed.error && parsed.pages?.length) {
        const doc = await addSource({ ...meta, origin: 'pdf', fileName: parsed.file_name, pages: parsed.pages, pageUnit: 'page', extract });
        if (doc) updateDocument(doc.id, { textKind: 'full', pdfUrl: paper.pdfUrl, venue: paper.venue });
        notify(`Added the full text of ${docLabel(doc)} (${parsed.pages.length} pages).`);
        return doc;
      }
      const why = parsed?.error?.offline ? 'the AI service is not running' : (parsed?.error?.message || 'the download failed');
      notify(`Could not get the full text (${why}). ${paper.abstract ? 'Added it with its abstract instead.' : 'Added it without text.'}`, 5200);
    }
    const pages = paper.abstract ? [{ page: 1, text: paper.abstract }] : [];
    const doc = await addSource({ ...meta, origin: 'search', pages, pageUnit: 'abstract', snippet: shortText(paper.abstract, 500), extract: extract && pages.length > 0 });
    if (doc) updateDocument(doc.id, { textKind: pages.length ? 'abstract' : 'none', pdfUrl: paper.pdfUrl || '', venue: paper.venue });
    if (!fullText) notify(pages.length ? `Added ${docLabel(doc)} with its abstract. Paste or download the full text for more.` : `Added ${docLabel(doc)}. It has no abstract; paste its text to work with it.`, 4200);
    return doc;
  };
  const addExternalSource = (r) => {
    const id = viewNow().project?.id;
    if (!id) return null;
    let [next, doc] = S.addDocument(rRef.current, id, { title: r.title || r.url, url: r.url, origin: 'search', verified: false, hasText: false });
    next = S.updateDocument(next, doc.id, { snippet: shortText(r.content || '', 500) });
    commit(next);
    notify('Added as an unverified source. Paste its text or open the link to read it before relying on it.');
    return doc;
  };

  // ------------------------------------------------------------------------------ items
  const itemTasks = (item, prevTasks) => syncTaskForItem(prevTasks, item);
  const addItem = (params) => {
    const id = viewNow().project?.id;
    if (!id) return null;
    const [next, item] = S.addItem(rRef.current, id, params);
    const patched = params.dueAt ? { ...item, dueAt: params.dueAt } : item;
    const final = params.dueAt ? S.updateItem(next, item.id, { dueAt: params.dueAt }) : next;
    commit(final, patched.type === 'task' ? (tasks) => itemTasks(patched, tasks) : undefined);
    return patched;
  };
  const updateItem = (id, patch) => {
    const next = S.updateItem(rRef.current, id, patch);
    const item = next.items.find((i) => i.id === id);
    // A human edit makes an AI item the user's own text only when they confirm it; editing keeps the label honest.
    commit(next, item && (item.type === 'task' || patch.type) ? (tasks) => itemTasks(item, tasks) : undefined);
  };
  const confirmItem = (id) => commit(S.confirmItem(rRef.current, id));
  const markReviewed = (id) => commit(S.markReviewed(rRef.current, id));
  const removeItem = (id) => {
    const before = rRef.current;
    const item = before.items.find((i) => i.id === id);
    if (!item) return;
    const goneTasks = tasksRef.current.filter((t) => t.researchItemId === id);
    commit(S.deleteItem(before, id), (tasks) => tasks.filter((t) => t.researchItemId !== id));
    undoable(`Deleted ${(ITEM_TYPES[item.type]?.label || 'item').toLowerCase()} “${shortText(item.title, 40)}”`, before, goneTasks);
  };
  /** Delete several items at once (one Undo for all of them). */
  const removeItems = (ids) => {
    const before = rRef.current;
    const set = new Set(ids.filter((id) => before.items.some((i) => i.id === id)));
    if (!set.size) return;
    let next = before;
    for (const id of set) next = S.deleteItem(next, id);
    const goneTasks = tasksRef.current.filter((t) => set.has(t.researchItemId));
    commit(next, (tasks) => tasks.filter((t) => !set.has(t.researchItemId)));
    undoable(`Deleted ${set.size} item${set.size === 1 ? '' : 's'}`, before, goneTasks);
  };
  const addEvidence = (itemId, ev) => commit(S.addEvidence(rRef.current, itemId, ev));
  const removeEvidence = (evId) => commit(S.removeEvidence(rRef.current, evId));
  /** Turn a saved sidecar note into an item on the map. */
  const addNoteToMap = (note, type = 'question') => {
    const item = addItem({ type, title: note.title || shortText(note.body, 60) || 'Untitled note', content: note.body || '', provenance: 'user-confirmed', origin: 'note', noteId: note.id });
    return item;
  };

  // ------------------------------------------------------------------------- connections
  const createConnection = (params) => { const id = viewNow().project?.id; const [next, conn] = S.createConnection(rRef.current, id, params); if (conn) commit(next); return conn; };
  const stitch = (id, edits) => commit(S.stitch(rRef.current, id, edits));
  const dismiss = (id, comment) => commit(S.dismiss(rRef.current, id, comment));
  const restore = (id) => commit(S.restoreConnection(rRef.current, id));
  const removeConnection = (id) => commit(S.deleteConnection(rRef.current, id));

  const discoverThreads = async ({ focusIds = [], keyword = false, recheck = false } = {}) => {
    const v = viewNow();
    const usable = v.items.filter((i) => i.type !== 'task');
    if (usable.length < 2) { notify('Add at least two items before looking for threads.'); return null; }
    if (busyRef.current) { notify('Already working on it…'); return null; } // a double click must not send the same work twice
    const finish = (threads, origin, extra = {}) => {
      let next = rRef.current;
      if (extra.checked?.length) next = S.markPairsChecked(next, v.project.id, extra.checked);
      let added;
      [next, added] = S.addSuggestedThreads(next, v.project.id, threads, origin);
      commit(next);
      const tension = added.filter((c) => c.relationship === 'contradicts').length;
      const looked = extra.considered ? ` (reasoned over ${extra.considered} pair${extra.considered === 1 ? '' : 's'})` : '';
      const qualify = added.filter((c) => c.relationship === 'qualifies').length;
      const cross = added.filter((c) => c.crossSource).length;
      const parts = [cross && `${cross} between different papers`, tension && `${tension} tension${tension === 1 ? '' : 's'}`, qualify && `${qualify} qualification${qualify === 1 ? '' : 's'}`].filter(Boolean);
      notify(added.length ? `${added.length} thread suggestion${added.length === 1 ? '' : 's'} to review${parts.length ? `: ${parts.join(', ')}` : ''}${looked}.` : (extra.warnings?.[0] || `No new thread suggestions${looked}.`), 5200);
      const notes = (extra.warnings || []).filter((w) => !(added.length === 0 && w === extra.warnings[0]));
      if (extra.allChecked) setProblem({ kind: 'warning', message: extra.warnings?.[0] || 'Every likely pair has already been checked.', retry: { label: 'Check them again', run: () => discoverThreads({ focusIds, recheck: true }) } });
      else if (notes.length) setProblem({ kind: 'warning', message: notes.join(' ') });
      return { added, ...extra };
    };
    if (keyword) return finish(S.heuristicThreads(v, { focusIds }), 'heuristic');
    return withBusy('Looking for threads…', async () => {
      try {
        const payload = {
          research_question: v.project?.researchQuestion || '', items: usable.slice(0, 400).map((i) => S.toApiItem(v, i)), documents: S.toApiDocs(v).slice(0, 100),
          connections: S.toApiConns(v).slice(0, 2000), focus_item_ids: focusIds, top_k: 8,
          checked_pairs: recheck ? [] : S.checkedPairsFor(rRef.current, v).slice(0, 5000),
        };
        const res = await api.discover(baseRef.current, payload);
        return finish(S.fromApiThreads(res.threads), 'ai', { considered: res.considered, dropped: res.dropped, warnings: res.warnings, checked: res.checked, allChecked: res.all_checked });
      } catch (e) { fail(e, 'discover', { label: 'Use keyword matching (no AI)', run: () => discoverThreads({ focusIds, keyword: true }) }); return null; }
    });
  };

  const investigate = async (connId) => {
    const v = viewNow();
    const c = v.connections.find((x) => x.id === connId);
    if (!c) return null;
    const a = v.itemById[c.from]; const b = v.itemById[c.to];
    return withBusy('Comparing the two items…', async () => {
      try {
        const res = await api.investigate(baseRef.current, {
          research_question: v.project?.researchQuestion || '', relationship: c.relationship, explanation: c.explanation,
          a: S.toApiItem(v, a), b: S.toApiItem(v, b),
          a_document: a.documentId ? S.toApiDocs(v).find((d) => d.id === a.documentId) : null, b_document: b.documentId ? S.toApiDocs(v).find((d) => d.id === b.documentId) : null,
        });
        return res;
      } catch (e) { fail(e, 'investigate'); return null; }
    });
  };
  const saveInvestigation = (connId, investigation) => commit(S.recordInvestigation(rRef.current, connId, investigation));

  // -------------------------------------------------------------------------------- gaps
  const exploreGaps = async () => {
    const v = viewNow();
    if (v.items.length < 3) { notify('Add a few more items before exploring gaps.'); return null; }
    return withBusy('Looking for candidate gaps in your collection…', async () => {
      try {
        const res = await api.gaps(baseRef.current, { research_question: v.project?.researchQuestion || '', items: v.items.filter((i) => i.type !== 'task').map((i) => S.toApiItem(v, i)), connections: S.toApiConns(v), documents: S.toApiDocs(v) });
        const [next, fresh] = S.setGaps(rRef.current, v.project.id, res.gaps || []);
        commit(next);
        notify(fresh.length ? `${fresh.length} candidate gap${fresh.length === 1 ? '' : 's'} proposed. They are provisional.` : 'No new candidate gaps were found.');
        return fresh;
      } catch (e) { fail(e, 'gaps'); return null; }
    });
  };
  const addGapToMap = (id) => { const [next, item] = S.addGapToMap(rRef.current, id); commit(next); return item; };
  const updateGap = (id, patch) => commit(S.updateGap(rRef.current, id, patch));

  // ----------------------------------------------------------------------- outline + ask
  const generateAiOutline = async () => {
    const v = viewNow();
    const keep = v.items.filter((i) => i.type !== 'task');
    if (!keep.length) { notify('Nothing to outline yet.'); return null; }
    return withBusy('Drafting an outline from your map…', async () => {
      try {
        const res = await api.outline(baseRef.current, { research_question: v.project?.researchQuestion || '', items: keep.map((i) => S.toApiItem(v, i)), connections: S.toApiConns(v, ['confirmed']), documents: S.toApiDocs(v) });
        const outline = outlineFromAi(v, res.sections || []);
        commit(S.setOutline(rRef.current, v.project.id, outline));
        if (res.warnings?.length) setProblem({ kind: 'warning', message: res.warnings.join(' ') });
        return outline;
      } catch (e) { fail(e, 'outline'); return null; }
    });
  };
  const clearOutline = () => { const id = viewNow().project?.id; const outlines = { ...rRef.current.outlines }; delete outlines[id]; commit({ ...rRef.current, outlines }); };

  const ask = async (question) => {
    const v = viewNow();
    const nodes = S.retrieveNodes(v, question, 10);
    try {
      setBusy('Reading your map…'); setProblem(null);
      const res = await api.ask(baseRef.current, { question, research_question: v.project?.researchQuestion || '', nodes: nodes.map((i) => S.toApiItem(v, i)), connections: S.toApiConns(v, ['confirmed', 'suggested']), documents: S.toApiDocs(v) });
      return { ok: true, ...res, nodes: nodes.map((n) => n.id) };
    } catch (e) {
      fail(e, 'ask');
      return { ok: false, error: e.message, offline: e instanceof ApiError && (e.offline || e.status === 503), nodes: nodes.map((n) => n.id) };
    } finally { setBusy(null); }
  };

  // ------------------------------------------------------------------------------ layout
  const saveLayout = (positions) => { const id = viewNow().project?.id; if (id) commit(S.saveLayout(rRef.current, id, positions)); };
  const resetLayout = () => { const id = viewNow().project?.id; if (id) commit(S.resetLayout(rRef.current, id)); };

  // ----------------------------------------------------------------------------- export
  const exportProject = async () => {
    const v = viewNow();
    if (!v.project) return null;
    const content = exportMarkdown(v);
    const name = `${v.project.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'research-project'}.md`;
    if (window.threadkeeper?.saveExport) { const res = await window.threadkeeper.saveExport({ name, content }); notify(`Saved to ${res.path}`); return res; }
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
    notify(`Exported ${name}`);
    return { ok: true, name, content };
  };

  const outline = view.outline?.sections ? view.outline : null;
  return {
    research, view, projectId, busy, problem, setProblem, ai, checkAi, emptyResearch,
    createProject, selectProject, updateProject, removeProject, loadSample, addSampleNewPaper: addSampleNewPaperToProject,
    getPages, parsePdf, addSource, addTextToSource, updateDocument, removeDocument, extractDocument, findSources, findPapers, addPaper, addExternalSource,
    addItem, updateItem, confirmItem, markReviewed, removeItem, removeItems, addEvidence, removeEvidence, addNoteToMap,
    createConnection, stitch, dismiss, restore, removeConnection, discoverThreads, investigate, saveInvestigation,
    exploreGaps, addGapToMap, updateGap, generateAiOutline, clearOutline, outline, liveOutline: () => buildOutline(viewNow()), ask,
    saveLayout, resetLayout, exportProject, uuid,
  };
}

/** Pasted text has no real page numbers. Form-feeds split pages; otherwise split on blank lines into ~6,000-character "sections". */
export function splitPastedText(text) {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  const byFormFeed = clean.split('\f').map((t) => t.trim()).filter(Boolean);
  if (byFormFeed.length > 1) return byFormFeed.map((t, n) => ({ page: n + 1, text: t.slice(0, 40000) }));
  const sections = [];
  let current = '';
  for (const para of clean.split(/\n{2,}/)) {
    if (current && current.length + para.length > 6000) { sections.push(current); current = ''; }
    current += `${current ? '\n\n' : ''}${para}`;
  }
  if (current) sections.push(current);
  return sections.map((t, n) => ({ page: n + 1, text: t.slice(0, 40000) }));
}
