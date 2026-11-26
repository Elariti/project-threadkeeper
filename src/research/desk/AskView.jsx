import React, { useState } from 'react';
import { LoaderCircle, MessagesSquare, Send } from 'lucide-react';
import { ITEM_TYPES, docLabel } from '../model.js';
import { Empty } from './ui.jsx';

const EXAMPLES = ['What supports my main claim?', 'Where do my sources disagree?', 'Which limitations come up more than once?'];

function Answer({ r, sel, entry }) {
  const res = entry.res;
  const parts = String(res.answer || '').split(/(\[N\d+\]|\[unverified\])/g);
  const cited = Object.entries(res.refs || {});
  const itemLine = (id) => { const it = r.view.itemById[id]; return it ? `${ITEM_TYPES[it.type].label}: ${it.title}` : 'item'; };
  return (
    <div className="rd-answer" data-testid="answer">
      {!res.ok ? (
        <>
          <p className="rd-warn">{res.error} Cited answers need the AI service.</p>
          {res.nodes.length > 0 && <><strong>The closest items on your map (keyword match, not an answer)</strong><div className="rd-chips">{res.nodes.map((id) => <button key={id} className="rd-chip" onClick={() => sel.selectItem(id)}>{itemLine(id)}</button>)}</div></>}
        </>
      ) : (
        <>
          <p className="rd-answer-text">{parts.map((p, i) => {
            const m = /^\[(N\d+)\]$/.exec(p);
            if (m && res.refs[m[1]]) return <button key={i} className="rd-cite" onClick={() => sel.selectItem(res.refs[m[1]])} title={itemLine(res.refs[m[1]])} data-testid="citation">{m[1].replace('N', '')}</button>;
            return <React.Fragment key={i}>{p}</React.Fragment>;
          })}</p>
          {!res.sufficient && <p className="rd-warn" data-testid="insufficient">Your map may not hold enough to answer this fully. {res.missing}</p>}
          {cited.length > 0 && <div className="rd-cited"><strong>Cited items</strong>{cited.map(([ref, id]) => { const it = r.view.itemById[id]; return it && <button key={ref} onClick={() => sel.selectItem(id)}><span className="rd-cite static">{ref.replace('N', '')}</span>{itemLine(id)}{it.documentId ? ` · ${docLabel(r.view.docById[it.documentId])}` : ''}</button>; })}</div>}
          <small className="rd-fine">Looked at the {entry.res.nodes.length} closest item{entry.res.nodes.length === 1 ? '' : 's'}. The AI may only cite those.</small>
        </>
      )}
    </div>
  );
}

export default function AskView({ r, sel }) {
  const [q, setQ] = useState('');
  const [log, setLog] = useState([]);
  const ask = async (text) => {
    const question = text.trim();
    if (!question || r.busy) return;
    setQ('');
    const res = await r.ask(question);
    setLog((l) => [{ q: question, res }, ...l]);
  };
  return (
    <div className="rd-page" data-testid="ask-view">
      <div className="rd-page-head"><div><div className="eyebrow">MAP-AWARE Q&A</div><h2>Ask your map</h2><p>Answers use only the items on this project’s map and cite them. If the map doesn’t say, it says so.</p></div></div>
      <div className="rd-askbox">
        <textarea rows={2} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask something about your sources…" aria-label="Question" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(q); } }} />
        <button className="rd-btn primary" disabled={!q.trim() || Boolean(r.busy)} onClick={() => ask(q)} data-testid="ask-send">{r.busy ? <LoaderCircle size={14} className="spin" /> : <Send size={14} />} Ask</button>
      </div>
      <div className="rd-chips">{EXAMPLES.map((e) => <button key={e} className="rd-chip" onClick={() => ask(e)}>{e}</button>)}</div>
      {log.map((entry, n) => <div key={n} className="rd-qa"><div className="rd-q">{entry.q}</div><Answer r={r} sel={sel} entry={entry} /></div>)}
      {!log.length && <Empty icon={MessagesSquare} title="Nothing asked yet">Try one of the questions above.</Empty>}
    </div>
  );
}
