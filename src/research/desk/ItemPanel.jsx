import React, { useState } from 'react';
import { AlertTriangle, Check, Crosshair, Link2, Plus, Quote, Sparkles, Trash2, X } from 'lucide-react';
import { ATTRIBUTION_LABEL, ITEM_TYPES, ITEM_TYPE_ORDER, RELATIONS, RELATION_KEYS, docLabel } from '../model.js';
import { affectedItems, locateQuote } from '../store.js';
import { ProvenanceBadge, RelationChip, StatusPill } from './ui.jsx';
import { ThreadCard } from './ThreadsView.jsx';

const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function EvidenceAdder({ r, item, onDone }) {
  const docs = r.view.documents;
  const [docId, setDocId] = useState(item.documentId || docs[0]?.id || '');
  const [page, setPage] = useState('');
  const [quote, setQuote] = useState('');
  const [note, setNote] = useState('');
  const add = async () => {
    const text = quote.trim();
    if (!text) return;
    const pages = docId ? await r.getPages(docId) : [];
    const found = pages.length ? locateQuote(pages, text, page ? Number(page) : null) : null;
    r.addEvidence(item.id, { documentId: docId || null, page: found ?? (page ? Number(page) : null), quote: text, verified: found !== null });
    if (pages.length && found === null) setNote('Saved, but this exact passage was not found in the source text, so it is marked “not verified”.');
    else onDone();
    setQuote('');
  };
  return (
    <div className="rd-evadd">
      <div className="rd-row">
        <label className="rd-field inline">Source<select value={docId} onChange={(e) => setDocId(e.target.value)}><option value="">(none)</option>{docs.map((d) => <option key={d.id} value={d.id}>{docLabel(d)}</option>)}</select></label>
        <label className="rd-field inline narrow">Page<input value={page} onChange={(e) => setPage(e.target.value.replace(/\D/g, ''))} placeholder="optional" /></label>
      </div>
      <textarea rows={3} value={quote} onChange={(e) => setQuote(e.target.value)} placeholder="Paste the exact passage…" aria-label="Quote" />
      {note && <p className="rd-warn"><AlertTriangle size={12} /> {note}</p>}
      <div className="rd-actions"><button className="rd-btn ghost" onClick={onDone}>Close</button><button className="rd-btn primary" disabled={!quote.trim()} onClick={add}>Attach passage</button></div>
    </div>
  );
}

function Connector({ r, item, onDone }) {
  const others = r.view.items.filter((i) => i.id !== item.id);
  const [to, setTo] = useState(others[0]?.id || '');
  const [relationship, setRelationship] = useState('supports');
  const [explanation, setExplanation] = useState('');
  return (
    <div className="rd-evadd">
      <div className="rd-row">
        <label className="rd-field inline">This item<select value={relationship} onChange={(e) => setRelationship(e.target.value)} data-testid="connect-relationship">{RELATION_KEYS.map((k) => <option key={k} value={k}>{RELATIONS[k].label}</option>)}</select></label>
        <label className="rd-field inline grow">…<select value={to} onChange={(e) => setTo(e.target.value)} data-testid="connect-target">{others.map((i) => <option key={i.id} value={i.id}>{ITEM_TYPES[i.type].label}: {i.title.slice(0, 60)}</option>)}</select></label>
      </div>
      <input value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="Why? (one sentence)" aria-label="Why" />
      <div className="rd-actions"><button className="rd-btn ghost" onClick={onDone}>Close</button>
        <button className="rd-btn primary" disabled={!to} data-testid="connect-save" onClick={() => { r.createConnection({ from: item.id, to, relationship, explanation }); onDone(); }}><Link2 size={13} /> Connect (stitched)</button></div>
    </div>
  );
}

function ItemEditor({ r, sel, item, tasks, onFind }) {
  const { view } = r;
  const [title, setTitle] = useState(item.title);
  const [content, setContent] = useState(item.content);
  const [adding, setAdding] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const flags = affectedItems(view).get(item.id);
  const evidence = view.evidenceByItem[item.id] || [];
  const doc = item.documentId ? view.docById[item.documentId] : null;
  const conns = view.connections.filter((c) => (c.from === item.id || c.to === item.id) && c.status !== 'rejected');
  const task = item.type === 'task' ? tasks.find((t) => t.researchItemId === item.id) : null;

  const commitText = () => {
    const t = title.trim() || item.title;
    if (t === item.title && content === item.content) return;
    r.updateItem(item.id, { title: t, content, ...(item.provenance !== 'user-confirmed' ? { provenance: 'user-confirmed' } : {}) });
  };

  return (
    <div className="rd-panel-body" data-testid="item-panel" key={item.id}>
      <div className="rd-panel-top">
        <label className="rd-field inline">Type
          <select value={item.type} onChange={(e) => r.updateItem(item.id, { type: e.target.value })} data-testid="item-type">{ITEM_TYPE_ORDER.map((t) => <option key={t} value={t}>{ITEM_TYPES[t].label}</option>)}</select>
        </label>
        <ProvenanceBadge value={item.provenance} />
      </div>
      <textarea className="rd-title-input" rows={2} value={title} onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} onBlur={commitText} aria-label="Title" />
      <textarea className="rd-content-input" rows={5} value={content} onChange={(e) => setContent(e.target.value)} onBlur={commitText} aria-label="Details" placeholder="Details…" />
      {item.provenance !== 'user-confirmed' && <p className="rd-fine">{item.provenance === 'ai-interpretation' ? 'This wording came from the AI, not from the authors.' : item.provenance === 'source-stated' ? 'The authors state this, and the passage below, found in the source text, covers what the item says.' : item.provenance === 'partly-sourced' ? 'The passage below is real, but the item says more than it does.' : 'Not checked against a source yet.'} Editing it, or confirming it, makes it yours.</p>}
      {item.provenance === 'partly-sourced' && item.supportNotes?.length > 0 && (
        <div className="rd-support" data-testid="support-notes"><strong><AlertTriangle size={12} /> Not covered by the quote</strong><ul>{item.supportNotes.map((n) => <li key={n}>{n}</li>)}</ul><span>Narrow the wording to what the quote says, or attach a passage that covers the rest.</span></div>
      )}
      {item.attribution === 'cited' && <p className="rd-cited">{ATTRIBUTION_LABEL.cited}: the authors are reporting someone else’s study here. Cite the original if you rely on it.</p>}
      {doc && <p className="rd-source-line">Source: <button className="rd-link" onClick={() => sel.openSource({ docId: doc.id, page: evidence[0]?.page, quote: evidence[0]?.quote })}>{docLabel(doc)} · {doc.title}</button></p>}

      {flags && (
        <div className="rd-flagbox" data-testid="item-flag">
          <strong><AlertTriangle size={13} /> Thread Shift: needs a second look</strong>
          {flags.map((f, n) => {
            const other = view.itemById[f.otherId]; const via = view.itemById[f.viaId];
            return <p key={n}>{f.kind === 'contested' ? <>A {f.status === 'suggested' ? 'proposed' : 'stitched'} thread says this may conflict with “{other?.title}”.</> : <>It rests on “{via?.title}”, which may now be in conflict with “{other?.title}”.</>} <button className="rd-link" onClick={() => sel.selectEdge(f.connectionId)}>Open the thread</button></p>;
          })}
          <button className="rd-btn" onClick={() => r.markReviewed(item.id)} data-testid="mark-reviewed"><Check size={13} /> I have reviewed this</button>
        </div>
      )}

      {item.type === 'task' && (
        <div className="rd-taskbox">
          <label className="rd-field inline">Due<input type="datetime-local" value={toLocalInput(item.dueAt)} onChange={(e) => r.updateItem(item.id, { dueAt: e.target.value ? new Date(e.target.value).toISOString() : null })} data-testid="task-due" /></label>
          <p className="rd-fine">{task ? `A reminder${task.completed ? ' (done)' : ''}: if it has a date, the cat will remind you 5 minutes before and when it is overdue.` : 'Give it a date to get a reminder.'}</p>
        </div>
      )}

      <div className="rd-section-title"><span>Evidence</span><button className="rd-btn ghost small" onClick={() => setAdding(true)}><Plus size={12} /> Attach passage</button></div>
      {evidence.map((e) => (
        <blockquote key={e.id} className={`rd-quote ${e.verified ? 'ok' : 'warn'}`} data-testid="evidence">
          <Quote size={12} />“{e.quote}”
          <footer>{docLabel(view.docById[e.documentId])}{e.page ? `, p. ${e.page}` : ''} · {e.verified ? 'found in the source text' : 'not verified against source text'}
            {e.documentId && <button className="rd-link" onClick={() => sel.openSource({ docId: e.documentId, page: e.page, quote: e.quote })}>View in source</button>}
            <button className="rd-link danger" onClick={() => r.removeEvidence(e.id)} aria-label="Remove passage"><X size={11} /></button></footer>
        </blockquote>
      ))}
      {!evidence.length && !adding && <p className="rd-fine">{item.type === 'claim' || item.type === 'question' ? 'Claims and questions can stand without a quote, but they are stronger with evidence linked.' : 'No supporting passage attached. Without one, this item is only your word.'}</p>}
      {adding && <EvidenceAdder r={r} item={item} onDone={() => setAdding(false)} />}

      <div className="rd-section-title"><span>Threads</span><button className="rd-btn ghost small" onClick={() => setConnecting(true)} data-testid="connect-open"><Plus size={12} /> Connect to…</button></div>
      {connecting && <Connector r={r} item={item} onDone={() => setConnecting(false)} />}
      {conns.map((c) => {
        const otherId = c.from === item.id ? c.to : c.from;
        const other = view.itemById[otherId];
        return (
          <button key={c.id} className="rd-connrow" onClick={() => sel.selectEdge(c.id)}>
            <StatusPill status={c.status} />
            <span className="rd-conn-text">{c.from === item.id ? <RelationChip relationship={c.relationship} proposed={c.status === 'suggested'} /> : <><em>is</em> <RelationChip relationship={c.relationship} proposed={c.status === 'suggested'} /> <em>by</em></>} <b>{other?.title}</b></span>
          </button>
        );
      })}
      {!conns.length && !connecting && <p className="rd-fine">Not connected to anything yet.</p>}

      <div className="rd-actions wrap">
        {item.provenance !== 'user-confirmed' && <button className="rd-btn" onClick={() => r.confirmItem(item.id)} data-testid="confirm-item"><Check size={13} /> I checked this</button>}
        <button className="rd-btn ghost" onClick={() => sel.setFocusId(item.id)}><Crosshair size={13} /> Focus on map</button>
        <button className="rd-btn ghost" onClick={() => onFind({ focusIds: [item.id] })} disabled={Boolean(r.busy)}><Sparkles size={13} /> Find threads for this</button>
        <button className="rd-btn danger-ghost" onClick={() => { sel.clear(); r.removeItem(item.id); }} data-testid="delete-item" title="Delete this item (you can undo, or press Delete)"><Trash2 size={13} /> Delete</button>
      </div>
    </div>
  );
}

export default function ItemPanel({ r, sel, tasks, onFind }) {
  const item = sel.itemId ? r.view.itemById[sel.itemId] : null;
  const conn = !item && sel.edgeId ? r.view.connections.find((c) => c.id === sel.edgeId) : null;
  if (!item && !conn) return null;
  return (
    <aside className="rd-panel" aria-label={item ? 'Item details' : 'Thread details'}>
      <div className="rd-panel-head"><span className="eyebrow">{item ? 'ITEM' : 'THREAD'}</span><button className="icon-btn" onClick={sel.clear} aria-label="Close panel"><X size={15} /></button></div>
      {item ? <ItemEditor r={r} sel={sel} item={item} tasks={tasks} onFind={onFind} /> : <div className="rd-panel-body"><ThreadCard key={conn.id} r={r} conn={conn} sel={sel} /></div>}
    </aside>
  );
}
