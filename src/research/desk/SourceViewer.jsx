import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Sparkles, Trash2 } from 'lucide-react';
import { ITEM_TYPES, docLabel, shortText } from '../model.js';
import { Highlighted, Modal } from './ui.jsx';

const EXTRACTABLE = ['finding', 'claim', 'limitation', 'method', 'question'];

export default function SourceViewer({ r, target, onClose, onSelectItem }) {
  const doc = r.view.docById[target.docId];
  const [pages, setPages] = useState(null);
  const [page, setPage] = useState(target.page || 1);
  const [quote, setQuote] = useState(target.quote || '');
  const [picked, setPicked] = useState('');
  const [type, setType] = useState('finding');
  const [pasted, setPasted] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const textRef = useRef(null);
  useEffect(() => { let on = true; r.getPages(target.docId).then((p) => { if (on) setPages(p); }); return () => { on = false; }; }, [target.docId, doc?.hasText]);
  useEffect(() => { const m = textRef.current?.querySelector('mark'); m?.scrollIntoView?.({ block: 'center' }); }, [page, quote, pages]);
  if (!doc) return null;

  const items = r.view.items.filter((i) => i.documentId === doc.id);
  const current = pages?.find((p) => p.page === page) || pages?.[0];
  const unit = doc.pageUnit === 'section' ? 'Section' : doc.pageUnit === 'abstract' ? 'Abstract' : 'Page';
  const readSelection = () => { const s = String(window.getSelection?.() || '').replace(/\s+/g, ' ').trim(); setPicked(s.length >= 12 ? s : ''); };
  const addPicked = () => {
    const item = r.addItem({ type, title: shortText(picked, 90), content: picked, documentId: doc.id, provenance: 'source-stated', origin: 'manual', evidence: [{ page: current.page, quote: picked, verified: true, documentId: doc.id }] });
    setPicked(''); window.getSelection?.()?.removeAllRanges?.();
    if (item) onSelectItem?.(item.id);
  };
  const jump = (e) => { setPage(e.page || 1); setQuote(e.quote); };

  return (
    <Modal title={doc.title} eyebrow={`SOURCE · ${docLabel(doc).toUpperCase()}`} onClose={onClose} size="xl" className="rd-sourceviewer">
      <div className="rd-sv">
        <div className="rd-sv-side">
          <div className="rd-section-title"><span>About this source</span></div>
          <label className="rd-field">Title<input defaultValue={doc.title} onBlur={(e) => r.updateDocument(doc.id, { title: e.target.value.trim() || doc.title })} /></label>
          <div className="rd-row">
            <label className="rd-field grow">Authors<input defaultValue={doc.authors} onBlur={(e) => r.updateDocument(doc.id, { authors: e.target.value })} /></label>
            <label className="rd-field narrow">Year<input defaultValue={doc.year || ''} onBlur={(e) => r.updateDocument(doc.id, { year: Number(e.target.value) || null })} /></label>
          </div>
          {doc.url && <p className="rd-fine"><a href={doc.url} target="_blank" rel="noreferrer">{doc.url}</a></p>}
          {doc.verified === false && <p className="rd-warn">Unverified source found by web search. Read it yourself before relying on it.</p>}
          {doc.snippet && !doc.hasText && <p className="rd-fine">Search snippet (not the paper’s text): {doc.snippet}</p>}
          <div className="rd-section-title"><span>Items from this source <em>{items.length}</em></span></div>
          <ul className="rd-sv-items">
            {items.map((i) => (
              <li key={i.id} className="rd-delrow"><button onClick={() => { const e = (r.view.evidenceByItem[i.id] || [])[0]; if (e) jump(e); onSelectItem?.(i.id); }}><b>{ITEM_TYPES[i.type].label}</b> {shortText(i.title, 70)}</button>
                <button className="rd-del" title="Delete this item (you can undo)" aria-label={`Delete ${i.title}`} onClick={() => r.removeItem(i.id)}><Trash2 size={12} /></button></li>
            ))}
            {!items.length && <li className="rd-fine">Nothing extracted yet.</li>}
          </ul>
          <div className="rd-actions wrap">
            {doc.hasText && <button className="rd-btn" disabled={Boolean(r.busy)} onClick={() => r.extractDocument(doc.id)} data-testid="extract-doc"><Sparkles size={13} /> {doc.status === 'extracted' ? 'Extract again' : 'Extract with AI'}</button>}
            {confirmDelete
              ? <><button className="rd-btn danger" onClick={() => { r.removeDocument(doc.id); onClose(); }}>Remove with its items</button><button className="rd-btn ghost" onClick={() => setConfirmDelete(false)}>Keep</button></>
              : <button className="rd-btn ghost" onClick={() => setConfirmDelete(true)}><Trash2 size={13} /> Remove source</button>}
          </div>
        </div>
        <div className="rd-sv-main">
          {!doc.hasText ? (
            <div className="rd-sv-notext">
              <strong>No text for this source yet</strong>
              <p>Paste the text of the paper here so claims and quotes can be checked against it. Nothing is ever quoted from a source without its text.</p>
              <textarea rows={10} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste the paper’s text…" aria-label="Source text" />
              <div className="rd-actions"><button className="rd-btn primary" disabled={!pasted.trim()} onClick={async () => { await r.addTextToSource(doc.id, pasted); setPasted(''); }}>Save text</button></div>
            </div>
          ) : !pages ? <p className="rd-fine">Loading text…</p> : !current ? <p className="rd-fine">No readable text was stored for this source.</p> : (
            <>
              <div className="rd-sv-bar">
                <button className="icon-btn" disabled={pages.indexOf(current) <= 0} onClick={() => { setPage(pages[pages.indexOf(current) - 1].page); setQuote(''); }} aria-label="Previous"><ChevronLeft size={16} /></button>
                <select value={current.page} onChange={(e) => { setPage(Number(e.target.value)); setQuote(''); }} aria-label={unit}>{pages.map((p) => <option key={p.page} value={p.page}>{unit} {p.page}</option>)}</select>
                <span>of {pages.length}</span>
                <button className="icon-btn" disabled={pages.indexOf(current) >= pages.length - 1} onClick={() => { setPage(pages[pages.indexOf(current) + 1].page); setQuote(''); }} aria-label="Next"><ChevronRight size={16} /></button>
                <span className="rd-fine grow">{doc.pageUnit === 'section' ? 'Pasted text has no real page numbers; sections are used instead.' : doc.pageUnit === 'abstract' ? 'Only the abstract is stored. Paste or download the full text to work with the whole paper.' : 'Select a passage to turn it into an item.'}</span>
              </div>
              {picked && (
                <div className="rd-pick" data-testid="pick-bar">
                  <span>“{shortText(picked, 70)}”</span>
                  <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Item type">{EXTRACTABLE.map((t) => <option key={t} value={t}>{ITEM_TYPES[t].label}</option>)}</select>
                  <button className="rd-btn primary" onClick={addPicked} data-testid="pick-add"><Plus size={13} /> Add as item</button>
                </div>
              )}
              <pre className="rd-pagetext" ref={textRef} onMouseUp={readSelection} onKeyUp={readSelection} data-testid="page-text"><Highlighted text={current.text} quote={quote} /></pre>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
