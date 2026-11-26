import React, { useRef, useState } from 'react';
import { BookOpenCheck, Check, ClipboardPaste, ExternalLink, FileDown, Globe, Plus, Search, Upload } from 'lucide-react';
import { ITEM_TYPES, ITEM_TYPE_ORDER, shortText } from '../model.js';
import { splitPastedText } from '../useResearch.js';
import { Modal } from './ui.jsx';

export function ProjectModal({ project, onSave, onDelete, onClose }) {
  const [name, setName] = useState(project?.name || '');
  const [question, setQuestion] = useState(project?.researchQuestion || '');
  const [confirm, setConfirm] = useState(false);
  const save = () => { if (name.trim()) onSave({ name, researchQuestion: question }); };
  return (
    <Modal title={project ? 'Edit project' : 'New research project'} eyebrow="RESEARCH DESK" onClose={onClose} size="md" footer={
      <>
        {project && onDelete && (confirm
          ? <><button className="rd-btn danger" onClick={onDelete} data-testid="project-delete-confirm">Delete project and everything in it</button><button className="rd-btn ghost" onClick={() => setConfirm(false)}>Keep</button></>
          : <button className="rd-btn ghost" onClick={() => setConfirm(true)} data-testid="project-delete">Delete project</button>)}
        <span className="grow" />
        <button className="rd-btn ghost" onClick={onClose}>Cancel</button>
        <button className="rd-btn primary" disabled={!name.trim()} onClick={save} data-testid="project-save">{project ? 'Save' : 'Create project'}</button>
      </>
    }>
      <label className="rd-field">Project name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Retrieval practice and retention" data-testid="project-name" onKeyDown={(e) => e.key === 'Enter' && save()} /></label>
      <label className="rd-field">Research question <span className="optional">(you can refine it later)</span>
        <textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What are you trying to find out?" data-testid="project-question" />
      </label>
      <p className="rd-fine">Every extraction, thread suggestion and outline is anchored to this question. Your sources and notes stay on this device unless you run an AI step.</p>
    </Modal>
  );
}

export function NewItemModal({ r, onClose, onCreated, defaultType = 'claim' }) {
  const [type, setType] = useState(defaultType);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [due, setDue] = useState('');
  const create = () => {
    if (!title.trim()) return;
    const item = r.addItem({ type, title, content, provenance: 'user-confirmed', origin: 'manual', dueAt: type === 'task' && due ? new Date(due).toISOString() : null });
    onCreated?.(item); onClose();
  };
  return (
    <Modal title="New item" eyebrow="ADD TO THE MAP" onClose={onClose} size="md" footer={<><span className="grow" /><button className="rd-btn ghost" onClick={onClose}>Cancel</button><button className="rd-btn primary" disabled={!title.trim()} onClick={create} data-testid="item-create">Add to map</button></>}>
      <div className="rd-typegrid" role="radiogroup" aria-label="Item type">
        {ITEM_TYPE_ORDER.map((t) => (
          <button key={t} role="radio" aria-checked={type === t} className={`rd-typeopt tone-${ITEM_TYPES[t].tone} ${type === t ? 'is-chosen' : ''}`} onClick={() => setType(t)} data-testid={`newtype-${t}`}>
            <strong>{ITEM_TYPES[t].label}</strong><small>{ITEM_TYPES[t].blurb}</small>
          </button>
        ))}
      </div>
      <label className="rd-field">Title<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="One clear sentence" data-testid="item-title" onKeyDown={(e) => e.key === 'Enter' && create()} /></label>
      <label className="rd-field">Details <span className="optional">(optional)</span><textarea rows={3} value={content} onChange={(e) => setContent(e.target.value)} data-testid="item-content" /></label>
      {type === 'task' && <label className="rd-field">Due <span className="optional">(optional, adds a reminder and a cat bubble)</span><input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></label>}
    </Modal>
  );
}

/** From a sidecar note: pick what kind of item it should become on the research map. */
export function NoteToMapModal({ note, projectName, onAdd, onClose }) {
  const [type, setType] = useState('question');
  return (
    <Modal title="Add to research map" eyebrow={`NOTE · ${shortText(note.title || 'Untitled', 30).toUpperCase()}`} onClose={onClose} size="md" footer={<><span className="grow" /><button className="rd-btn ghost" onClick={onClose}>Cancel</button><button className="rd-btn primary" onClick={() => onAdd(type)} data-testid="note-to-map-add">Add to “{shortText(projectName, 24)}”</button></>}>
      <p className="rd-fine">Your note stays where it is. A linked item is added to the map, and you stay in charge of how it connects.</p>
      <div className="rd-typegrid" role="radiogroup" aria-label="Item type">
        {ITEM_TYPE_ORDER.map((t) => (
          <button key={t} role="radio" aria-checked={type === t} className={`rd-typeopt tone-${ITEM_TYPES[t].tone} ${type === t ? 'is-chosen' : ''}`} onClick={() => setType(t)} data-testid={`notetype-${t}`}>
            <strong>{ITEM_TYPES[t].label}</strong><small>{ITEM_TYPES[t].blurb}</small>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function AddSourceModal({ r, initialTab = 'pdf', initialQuery = '', onClose, onAdded }) {
  const [tab, setTab] = useState(initialTab);
  const [parsed, setParsed] = useState(null);
  const [meta, setMeta] = useState({ title: '', authors: '', year: '', doi: '' });
  const [text, setText] = useState('');
  const [extract, setExtract] = useState(r.ai.state === 'ready');
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState(null); // web results (Tavily)
  const [papers, setPapers] = useState(null); // { results, warnings, provider } from OpenAlex / Crossref
  const [where, setWhere] = useState('papers'); // 'papers' | 'web'
  const [added, setAdded] = useState({}); // result id -> doc id, for this dialog
  const [adding, setAdding] = useState(null);
  const [openAbs, setOpenAbs] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);
  const inlineProblem = r.problem && ['pdf', 'search'].includes(r.problem.kind) ? r.problem : null;

  const pick = async (file) => {
    if (!file) return;
    const res = await r.parsePdf(file);
    if (res) { setParsed({ ...res, file }); setMeta({ title: res.title_guess || file.name.replace(/\.pdf$/i, ''), authors: res.author_guess || '', year: '', doi: '' }); }
  };
  const finish = async (payload) => {
    setSaving(true);
    try { const doc = await r.addSource({ ...payload, extract }); onAdded?.(doc); onClose(); } finally { setSaving(false); }
  };
  const search = async () => {
    const q = query.trim();
    if (!q) return;
    if (where === 'web') setResults(await r.findSources(q));
    else { const out = await r.findPapers(q); if (out) setPapers(out); }
  };
  const addPaper = async (p, fullText) => {
    setAdding(`${p.id}|${fullText ? 'full' : 'abs'}`);
    try { const doc = await r.addPaper(p, { fullText, extract }); if (doc) setAdded((a) => ({ ...a, [p.id]: doc.id })); } finally { setAdding(null); }
  };
  const tabs = [['pdf', 'PDF', Upload], ['paste', 'Paste text', ClipboardPaste], ['search', 'Find papers', Search]];
  const metaFields = (
    <>
      <label className="rd-field">Title<input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} data-testid="source-title" /></label>
      <div className="rd-row">
        <label className="rd-field grow">Authors<input value={meta.authors} onChange={(e) => setMeta({ ...meta, authors: e.target.value })} placeholder="Last, F., Last, F." data-testid="source-authors" /></label>
        <label className="rd-field narrow">Year<input value={meta.year} onChange={(e) => setMeta({ ...meta, year: e.target.value.replace(/\D/g, '').slice(0, 4) })} data-testid="source-year" /></label>
      </div>
    </>
  );
  const extractRow = (
    <label className="rd-check"><input type="checkbox" checked={extract} onChange={(e) => setExtract(e.target.checked)} disabled={r.ai.state !== 'ready'} data-testid="extract-toggle" /> Extract claims, findings and limitations with AI now
      {r.ai.state !== 'ready' && <em> · AI is not connected. You can still add items by selecting passages in the source.</em>}</label>
  );
  const sections = splitPastedText(text).length;

  return (
    <Modal title="Add a source" eyebrow="CAPTURE" onClose={onClose} size="lg" className="rd-addsource">
      <div className="rd-seg" role="tablist">{tabs.map(([k, label, Icon]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)} data-testid={`addtab-${k}`}><Icon size={13} /> {label}</button>)}</div>
      {inlineProblem && <p className="rd-warn" data-testid="modal-problem">{inlineProblem.message}{inlineProblem.kind === 'pdf' && <> <button className="rd-link" onClick={() => { r.setProblem(null); setTab('paste'); }}>Paste the text instead</button></>}</p>}

      {tab === 'pdf' && (
        <div className="rd-addbody">
          {!parsed ? (
            <div className="rd-drop" onClick={() => fileRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}>
              <Upload size={22} /><strong>{r.busy ? r.busy : 'Choose a PDF'}</strong><span>Text-based PDFs only (up to 25 MB, 250 pages). Scanned pages are not read.</span>
              <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => pick(e.target.files?.[0])} data-testid="pdf-input" />
            </div>
          ) : (
            <>
              <p className="rd-fine" data-testid="pdf-read">Read {parsed.pages.length} of {parsed.page_count} page{parsed.page_count === 1 ? '' : 's'} from {parsed.file_name}. {(parsed.warnings || []).join(' ')}</p>
              {metaFields}
              {extractRow}
            </>
          )}
        </div>
      )}
      {tab === 'paste' && (
        <div className="rd-addbody">
          {metaFields}
          <label className="rd-field">Text of the paper<textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the abstract, a section, or the whole paper…" data-testid="paste-text" /></label>
          <p className="rd-fine">{text.trim() ? `${sections} section${sections === 1 ? '' : 's'}. ` : ''}Pasted text has no page numbers, so passages are cited by section. Quotes are only ever accepted if they appear in this text.</p>
          {extractRow}
        </div>
      )}
      {tab === 'search' && (
        <div className="rd-addbody">
          <div className="rd-searchrow">
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={where === 'papers' ? 'Topic, title, author… or paste a DOI / doi.org / arXiv link' : 'Search the web for…'} aria-label="Search for sources" onKeyDown={(e) => e.key === 'Enter' && search()} data-testid="source-query" />
            <button className="rd-btn primary" onClick={search} disabled={!query.trim() || Boolean(r.busy)} data-testid="source-search"><Search size={13} /> Search</button>
          </div>
          <div className="rd-where" role="radiogroup" aria-label="Where to search">
            <button role="radio" aria-checked={where === 'papers'} className={where === 'papers' ? 'is-on' : ''} onClick={() => setWhere('papers')}><BookOpenCheck size={12} /> Papers (OpenAlex + Crossref)</button>
            <button role="radio" aria-checked={where === 'web'} className={where === 'web' ? 'is-on' : ''} onClick={() => setWhere('web')} disabled={!r.ai.search} title={r.ai.search ? 'General web search through the backend (Tavily)' : 'Needs TAVILY_API_KEY in backend/.env and the backend running'}><Globe size={12} /> Web</button>
          </div>
          {where === 'papers' ? (
            <>
              <p className="rd-fine">Real paper records with DOIs, from scholarly indexes (no AI, no key needed). <b>Add</b> stores the abstract as the source text; <b>Full text</b> downloads the open-access PDF (needs the backend).</p>
              {papers?.warnings?.length > 0 && <p className="rd-warn">{papers.warnings.join(' ')}</p>}
              {papers && !papers.results.length && <p className="rd-fine">No papers found. Try fewer or different words, or paste the DOI.</p>}
              <ul className="rd-results rd-papers" data-testid="paper-results">
                {(papers?.results || []).map((p) => {
                  const have = added[p.id] || p.existingId;
                  return (
                    <li key={p.id}>
                      <div className="rd-paper-main">
                        <strong>{p.title}</strong>
                        <span className="rd-paper-meta">{[p.authors, p.year, p.venue].filter(Boolean).join(' · ')}</span>
                        <span className="rd-paper-links">
                          {p.url && <a href={p.url} target="_blank" rel="noreferrer"><ExternalLink size={11} /> {p.doi ? `doi:${p.doi}` : 'Open'}</a>}
                          {p.openAccess && <em className="rd-oa">Open access</em>}
                          {p.citedBy > 0 && <small>cited {p.citedBy}×</small>}
                          <small className="rd-prov-src">{p.provider}</small>
                        </span>
                        {p.abstract
                          ? <p className={openAbs === p.id ? 'is-open' : ''}>{openAbs === p.id ? p.abstract : shortText(p.abstract, 260)} {p.abstract.length > 260 && <button className="rd-link" onClick={() => setOpenAbs(openAbs === p.id ? null : p.id)}>{openAbs === p.id ? 'less' : 'more'}</button>}</p>
                          : <p className="rd-fine">No abstract in the index.</p>}
                      </div>
                      <div className="rd-paper-actions">
                        {have ? <span className="rd-added"><Check size={12} /> In project</span> : (
                          <>
                            <button className="rd-btn" disabled={Boolean(adding)} onClick={() => addPaper(p, false)} data-testid="add-paper"><Plus size={13} /> {adding === `${p.id}|abs` ? 'Adding…' : 'Add'}</button>
                            {p.pdfUrl && <button className="rd-btn" disabled={Boolean(adding) || r.ai.state === 'offline'} title={r.ai.state === 'offline' ? 'Start the backend to download PDFs' : 'Download and read the open-access PDF'} onClick={() => addPaper(p, true)} data-testid="add-paper-full"><FileDown size={13} /> {adding === `${p.id}|full` ? 'Downloading…' : 'Full text'}</button>}
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <>
              <p className="rd-fine">Web results are added as <b>unverified</b> sources with no text. Read the page, then paste its text to check anything against it.</p>
              {results?.length === 0 && <p className="rd-fine">No results.</p>}
              <ul className="rd-results">
                {(results || []).map((x) => (
                  <li key={x.url}><div><strong>{x.title}</strong><a href={x.url} target="_blank" rel="noreferrer">{x.url}</a><p>{shortText(x.content, 220)}</p></div>
                    {added[x.url] ? <span className="rd-added"><Check size={12} /> Added</span> : <button className="rd-btn" onClick={() => { const d = r.addExternalSource(x); if (d) setAdded((a) => ({ ...a, [x.url]: d.id })); }} data-testid="add-external"><Plus size={13} /> Add as unverified</button>}</li>
                ))}
              </ul>
            </>
          )}
          {extractRow}
          <div className="rd-actions end"><button className="rd-btn ghost" onClick={onClose}>Done</button></div>
        </div>
      )}
      {tab !== 'search' && (
        <div className="rd-actions end">
          <button className="rd-btn ghost" onClick={onClose}>Cancel</button>
          {tab === 'pdf' && <button className="rd-btn primary" disabled={!parsed || !meta.title.trim() || saving} data-testid="source-add" onClick={() => finish({ ...meta, year: meta.year || null, origin: 'pdf', fileName: parsed.file_name, pages: parsed.pages })}>Add source</button>}
          {tab === 'paste' && <button className="rd-btn primary" disabled={!meta.title.trim() || !text.trim() || saving} data-testid="source-add" onClick={() => finish({ ...meta, year: meta.year || null, origin: 'paste', pages: splitPastedText(text), pageUnit: 'section' })}>Add source</button>}
        </div>
      )}
    </Modal>
  );
}
