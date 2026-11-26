import React, { useState } from 'react';
import { Check, Plus, Search, Sparkles, Telescope, X } from 'lucide-react';
import { ITEM_TYPES, shortText } from '../model.js';
import { Empty } from './ui.jsx';

const BASIS = { limitation: 'Raised by limitations', disagreement: 'Raised by a disagreement', unresolved_question: 'Raised by an open question' };

function GapCard({ r, gap, sel, onSearch }) {
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState(gap.investigatedNote || '');
  const chip = (id, weak) => {
    const it = r.view.itemById[id];
    return it ? <button key={id} className={`rd-chip ${weak ? 'warn' : ''}`} onClick={() => sel.selectItem(id)} title={it.title}>{ITEM_TYPES[it.type].label}: {shortText(it.title, 42)}</button> : null;
  };
  const status = gap.status === 'investigated' ? 'Externally investigated' : gap.status === 'added' ? 'On your map' : 'Candidate gap';
  return (
    <article className={`rd-gap status-${gap.status}`} data-testid={`gap-${gap.id}`} data-status={gap.status}>
      <header><span className={`rd-chip ${gap.status === 'investigated' ? 'ok' : 'subtle'}`}>{status}</span><span className="rd-chip subtle">{BASIS[gap.basis] || 'Raised by your items'}</span></header>
      <h3>{gap.title}</h3>
      <p>{gap.description}</p>
      <p className="rd-scope"><Telescope size={12} /> Observed in this collection of {r.view.documents.length} source{r.view.documents.length === 1 ? '' : 's'}. This is not proof that nobody has studied it.</p>
      {gap.support.length > 0 && <div className="rd-gap-block"><strong>What points to it</strong><div className="rd-chips">{gap.support.map((id) => chip(id))}</div></div>}
      {gap.counterevidence?.length > 0 && <div className="rd-gap-block"><strong>What may weaken it</strong><div className="rd-chips">{gap.counterevidence.map((id) => chip(id, true))}</div></div>}
      {gap.nextSearch?.length > 0 && <div className="rd-gap-block"><strong>Where to look next</strong><div className="rd-chips">{gap.nextSearch.map((q) => <button key={q} className="rd-chip" onClick={() => onSearch(q)}><Search size={11} /> {q}</button>)}</div></div>}
      {gap.status === 'investigated' && gap.investigatedNote && <p className="rd-fine">Your note: {gap.investigatedNote}</p>}
      {noting && (
        <div className="rd-evadd">
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where did you search and what did you find?" aria-label="What you found" />
          <div className="rd-actions"><button className="rd-btn ghost" onClick={() => setNoting(false)}>Cancel</button><button className="rd-btn primary" onClick={() => { r.updateGap(gap.id, { status: 'investigated', investigatedNote: note.trim() }); setNoting(false); }}>Mark as investigated</button></div>
        </div>
      )}
      <div className="rd-actions wrap">
        <button className="rd-btn primary" disabled={Boolean(gap.itemId)} onClick={() => { const it = r.addGapToMap(gap.id); if (it) sel.selectItem(it.id); }} data-testid="gap-add"><Plus size={13} /> {gap.itemId ? 'On your map' : 'Add to map'}</button>
        {gap.status !== 'investigated' && <button className="rd-btn" onClick={() => setNoting(true)}><Check size={13} /> I searched elsewhere</button>}
        <button className="rd-btn ghost" onClick={() => r.updateGap(gap.id, { status: 'dismissed' })}><X size={13} /> Dismiss</button>
      </div>
    </article>
  );
}

export default function GapsView({ r, sel, onSearch }) {
  const gaps = r.view.gaps.filter((g) => g.status !== 'dismissed');
  return (
    <div className="rd-page" data-testid="gaps-view">
      <div className="rd-page-head">
        <div><div className="eyebrow">CANDIDATE GAPS</div><h2>Gaps</h2><p>Places where your own collection leaves something open. Always provisional until you have searched beyond it.</p></div>
        <div className="rd-actions"><button className="rd-btn primary" onClick={r.exploreGaps} disabled={Boolean(r.busy)} data-testid="explore-gaps"><Sparkles size={13} /> Explore candidate gaps</button></div>
      </div>
      {gaps.length ? <div className="rd-thread-list">{gaps.map((g) => <GapCard key={g.id} r={r} gap={g} sel={sel} onSearch={onSearch} />)}</div>
        : <Empty icon={Telescope} title="No candidate gaps yet">Exploring gaps reads the limitations, disagreements and open questions on your map and proposes up to four candidates, each tied to the items behind it. It needs the AI service and at least a few items.</Empty>}
    </div>
  );
}
