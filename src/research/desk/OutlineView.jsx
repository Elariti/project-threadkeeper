import React, { useState } from 'react';
import { Download, FileText, Sparkles } from 'lucide-react';
import { ITEM_TYPES } from '../model.js';
import { buildOutline } from '../outline.js';
import { Empty } from './ui.jsx';

function Section({ s, n, sel }) {
  return (
    <section className="rd-osec" data-testid="outline-section">
      <h3><span>{n}</span>{s.heading}{s.needsEvidence && <em className="rd-chip warn">{s.needsLabel || 'Needs evidence'}</em>}</h3>
      {s.purpose && <p className="rd-purpose">{s.purpose}</p>}
      <ul>
        {s.entries.map((e) => (
          <li key={`${e.itemId}-${e.role}`} className={e.status === 'proposed' ? 'is-proposed' : ''}>
            <div className="rd-oentry-head"><span className="rd-chip subtle">{e.role}</span>{e.status === 'proposed' && <span className="rd-chip warn">proposed, not stitched</span>}
              <button className="rd-link" onClick={() => sel.selectItem(e.itemId)}>{e.title}</button></div>
            {e.text && e.text !== e.title && <p>{e.text}</p>}
            {e.citations.map((c, i) => <blockquote key={i} className={c.verified ? '' : 'warn'}>“{c.quote}”<footer>{c.source}{c.page ? `, p. ${c.page}` : ''}{c.verified ? '' : ' · not verified against source text'}</footer></blockquote>)}
            {e.noPassage && <small className="rd-fine">No passage attached to this {ITEM_TYPES[e.type]?.label.toLowerCase() || 'item'}.</small>}
          </li>
        ))}
        {!s.entries.length && <li className="rd-fine">Nothing on your map supports this section yet.</li>}
      </ul>
    </section>
  );
}

export default function OutlineView({ r, sel }) {
  const [mode, setMode] = useState('map');
  const [includeSuggested, setInclude] = useState(false);
  const ai = r.outline?.mode === 'ai' ? r.outline : null;
  const stale = ai && r.view.history[0] && r.view.history[0].at > ai.generatedAt;
  const outline = mode === 'ai' ? ai : buildOutline(r.view, { includeSuggested });
  return (
    <div className="rd-page" data-testid="outline-view">
      <div className="rd-page-head">
        <div><div className="eyebrow">EVIDENCE-LINKED OUTLINE</div><h2>Outline</h2><p>A skeleton for a paper or review. Every entry is an item on your map, shown with the passages attached to it.</p></div>
        <div className="rd-actions"><button className="rd-btn" onClick={r.exportProject} data-testid="export"><Download size={13} /> Export Markdown</button></div>
      </div>
      <div className="rd-seg" role="tablist">
        <button role="tab" aria-selected={mode === 'map'} className={mode === 'map' ? 'is-on' : ''} onClick={() => setMode('map')}>From my stitched map</button>
        <button role="tab" aria-selected={mode === 'ai'} className={mode === 'ai' ? 'is-on' : ''} onClick={() => setMode('ai')}>AI draft</button>
      </div>
      {mode === 'map' && <label className="rd-check"><input type="checkbox" checked={includeSuggested} onChange={(e) => setInclude(e.target.checked)} /> Also show proposed threads (marked as not stitched)</label>}
      {mode === 'ai' && (
        <div className="rd-aibar">
          <button className="rd-btn primary" onClick={r.generateAiOutline} disabled={Boolean(r.busy)} data-testid="ai-outline"><Sparkles size={13} /> {ai ? 'Draft again' : 'Draft an outline with AI'}</button>
          {stale && <span className="rd-chip warn" data-testid="outline-stale">Your map changed since this draft</span>}
          <span className="rd-fine">The AI may only cite items on your map. It cannot add evidence.</span>
        </div>
      )}
      {outline ? outline.sections.map((s, n) => <Section key={s.id} s={s} n={n + 1} sel={sel} />)
        : <Empty icon={FileText} title="No AI draft yet">Draft one from your reviewed map, or use “From my stitched map” for an outline that needs no AI.</Empty>}
    </div>
  );
}
