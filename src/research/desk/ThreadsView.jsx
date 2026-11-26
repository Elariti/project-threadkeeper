import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Brain, Check, FlaskConical, Pencil, RotateCcw, ShieldCheck, Sparkles, Trash2, Waypoints, X } from 'lucide-react';
import { ASSESSMENT_LABEL, CONTEXT_FACTORS, RELATIONS, RELATION_KEYS, docLabel, shortText } from '../model.js';
import { affectedItems, pendingThreads } from '../store.js';
import { ConfidenceChip, Empty, OriginChip, RelationChip, StatusPill, TypeBadge } from './ui.jsx';

const FACTOR_HELP = {
  population: 'Who or what was studied',
  definitions: 'How key terms are defined',
  conditions: 'Setting, timing, intervention',
  data: 'Sample size and measures',
  outcomes: 'What was actually measured',
};

const notStated = (t) => /^not stated/i.test(String(t || ''));

function InvestigatePanel({ r, conn, onClose }) {
  const saved = conn.investigation;
  const blank = Object.fromEntries(CONTEXT_FACTORS.map((f) => [f, { a: '', b: '', note: '' }]));
  const [ctx, setCtx] = useState(() => (saved?.context ? { ...blank, ...Object.fromEntries(saved.context.map((c) => [c.factor, { a: c.a || '', b: c.b || '', note: c.note || '' }])) } : blank));
  const [assessment, setAssessment] = useState(saved?.assessment || '');
  const [ai, setAi] = useState(saved?.ai || null);
  const [notes, setNotes] = useState(saved?.notes || '');
  const [relationship, setRelationship] = useState(conn.relationship);
  const [explanation, setExplanation] = useState(saved?.qualifiedStatement || conn.explanation);
  const a = r.view.itemById[conn.from]; const b = r.view.itemById[conn.to];

  const askAi = async () => {
    const res = await r.investigate(conn.id);
    if (!res) return;
    setCtx(Object.fromEntries(res.context.map((c) => [c.factor, { a: notStated(c.a) ? '' : c.a, b: notStated(c.b) ? '' : c.b, note: c.note || '' }])));
    setAi({ assessment: res.assessment, rationale: res.rationale, checks: res.checks, qualified: res.qualified_statement });
    if (!assessment) setAssessment(res.assessment);
    if (res.qualified_statement) setExplanation(res.qualified_statement);
  };
  const payload = () => ({
    context: CONTEXT_FACTORS.map((f) => ({ factor: f, ...ctx[f] })), assessment, notes, qualifiedStatement: explanation,
    ai: ai ? { ...ai } : null, rationale: ai?.rationale || '', checks: ai?.checks || [],
  });
  const save = () => { r.saveInvestigation(conn.id, payload()); onClose(); };
  const stitchQualified = () => { r.saveInvestigation(conn.id, payload()); r.stitch(conn.id, { relationship, explanation }); onClose(); };

  return (
    <div className="rd-investigate" data-testid="investigate-panel">
      <div className="rd-inv-head">
        <strong>Investigate this thread</strong>
        <button className="rd-btn ghost" onClick={askAi} disabled={Boolean(r.busy)}><Sparkles size={13} /> Ask AI to fill in what the texts say</button>
      </div>
      <p className="rd-hint">Two items can look opposed because they studied different things. Compare the context before you decide. Leave a box empty if the sources do not say.</p>
      <table className="rd-ctx">
        <thead><tr><th>Context</th><th>{shortText(a?.title, 34)}</th><th>{shortText(b?.title, 34)}</th></tr></thead>
        <tbody>
          {CONTEXT_FACTORS.map((f) => (
            <tr key={f}>
              <th scope="row"><span>{f[0].toUpperCase() + f.slice(1)}</span><small>{FACTOR_HELP[f]}</small></th>
              <td><textarea aria-label={`${f}, first item`} value={ctx[f].a} placeholder="Not recorded" rows={2} onChange={(e) => setCtx({ ...ctx, [f]: { ...ctx[f], a: e.target.value } })} /></td>
              <td><textarea aria-label={`${f}, second item`} value={ctx[f].b} placeholder="Not recorded" rows={2} onChange={(e) => setCtx({ ...ctx, [f]: { ...ctx[f], b: e.target.value } })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {ai && <p className="rd-ai-note"><Sparkles size={12} /> The AI filled in the table from the item text and quotes. Check it against the papers. {ai.rationale}</p>}
      {ai?.checks?.length > 0 && <div className="rd-checks"><strong>Worth checking in the full papers</strong><ul>{ai.checks.map((c) => <li key={c}>{c}</li>)}</ul></div>}
      <div className="rd-assess" role="radiogroup" aria-label="Your assessment">
        <strong>What do you think?</strong>
        {Object.entries(ASSESSMENT_LABEL).map(([k, label]) => (
          <label key={k} className={assessment === k ? 'is-chosen' : ''}><input type="radio" name={`assess-${conn.id}`} checked={assessment === k} onChange={() => setAssessment(k)} /> {label}{ai?.assessment === k && <em> · AI’s view</em>}</label>
        ))}
      </div>
      <label className="rd-field">Your notes<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did you check? What is still unclear?" /></label>
      <div className="rd-decide">
        <strong>Stitch it, with the qualification you believe</strong>
        <div className="rd-row">
          <label className="rd-field inline">Relationship
            <select value={relationship} onChange={(e) => setRelationship(e.target.value)} data-testid="qualify-relationship">{RELATION_KEYS.map((k) => <option key={k} value={k}>{RELATIONS[k].label}</option>)}</select>
          </label>
        </div>
        <label className="rd-field">In one careful sentence<textarea rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} data-testid="qualify-explanation" placeholder="e.g. The benefit may hold for recall but not for transfer on complex material." /></label>
      </div>
      <div className="rd-actions">
        <button className="rd-btn ghost" onClick={onClose}>Close</button>
        <button className="rd-btn" onClick={save}>Save investigation</button>
        <button className="rd-btn primary" onClick={stitchQualified} data-testid="stitch-qualified"><Check size={13} /> Stitch with this qualification</button>
      </div>
    </div>
  );
}

function EditForm({ r, conn, onClose }) {
  const [relationship, setRelationship] = useState(conn.relationship);
  const [explanation, setExplanation] = useState(conn.explanation);
  const [swap, setSwap] = useState(false);
  const a = r.view.itemById[conn.from]; const b = r.view.itemById[conn.to];
  const [from, to] = swap ? [b, a] : [a, b];
  return (
    <div className="rd-editform">
      <p className="rd-edit-preview"><b>{shortText(from?.title, 60)}</b> <RelationChipInline relationship={relationship} /> <b>{shortText(to?.title, 60)}</b></p>
      <div className="rd-row">
        <label className="rd-field inline">Relationship
          <select value={relationship} onChange={(e) => setRelationship(e.target.value)} data-testid="edit-relationship">{RELATION_KEYS.map((k) => <option key={k} value={k}>{RELATIONS[k].label}</option>)}</select>
        </label>
        <button type="button" className={`rd-btn ${swap ? 'is-on' : 'ghost'}`} onClick={() => setSwap(!swap)} data-testid="edit-swap" title="Reverse which item comes first"><ArrowLeftRight size={13} /> Swap direction</button>
      </div>
      <label className="rd-field">Explanation<textarea rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} data-testid="edit-explanation" /></label>
      <div className="rd-actions"><button className="rd-btn ghost" onClick={onClose}>Cancel</button><button className="rd-btn primary" data-testid="edit-save" onClick={() => { r.stitch(conn.id, { relationship, explanation, swap }); onClose(); }}><Check size={13} /> Stitch with my changes</button></div>
    </div>
  );
}
const RelationChipInline = ({ relationship }) => <span className="rd-rel" style={{ '--rel': RELATIONS[relationship]?.color }}>{RELATIONS[relationship]?.label}</span>;

export function ThreadCard({ r, conn, sel, defaultMode = null }) {
  const { view } = r;
  const [mode, setMode] = useState(defaultMode);
  const a = view.itemById[conn.from]; const b = view.itemById[conn.to];
  if (!a || !b) return null;
  const proposed = conn.status === 'suggested';
  const evidenceFor = (itemId, quote) => (view.evidenceByItem[itemId] || []).find((e) => e.quote === quote);
  const ItemLink = ({ item }) => <button className="rd-itemlink" onClick={() => sel.selectItem(item.id)}><TypeBadge type={item.type} /><span>{item.title}</span></button>;
  const inv = conn.investigation;
  return (
    <article className={`rd-thread status-${conn.status} ${sel.edgeId === conn.id ? 'is-selected' : ''}`} data-testid={`thread-${conn.id}`} data-status={conn.status} data-relationship={conn.relationship}>
      <header><StatusPill status={conn.status} /><OriginChip origin={conn.origin} /><ConfidenceChip value={conn.confidence} />
        {conn.crossSource === true && <span className="rd-chip cross">Different papers</span>}
        {conn.crossSource === false && <span className="rd-chip subtle">Same paper</span>}
        {conn.checked === 'fixed' && <span className="rd-chip checked" title={conn.checkNote}><ShieldCheck size={11} /> Corrected on a second reading</span>}
        {conn.checked === 'kept' && <span className="rd-chip checked" title={conn.checkNote}><ShieldCheck size={11} /> Double-checked</span>}
        {conn.editedByUser && <span className="rd-chip subtle">Edited by you</span>}</header>
      <div className="rd-thread-sentence"><ItemLink item={a} /><RelationChip relationship={conn.relationship} proposed={proposed} /><ItemLink item={b} /></div>
      {conn.explanation && <p className="rd-explain">{conn.explanation}</p>}
      {conn.evidence?.length > 0 && (
        <div className="rd-quotes">
          {conn.evidence.map((e, n) => {
            const ev = evidenceFor(e.itemId, e.quote);
            const doc = ev ? view.docById[ev.documentId] : null;
            return (
              <blockquote key={n}>“{e.quote}”<footer>{view.itemById[e.itemId]?.title}{doc ? ` · ${docLabel(doc)}${ev.page ? `, p. ${ev.page}` : ''}` : ''}
                {ev && ev.documentId && <button className="rd-link" onClick={() => sel.openSource({ docId: ev.documentId, page: ev.page, quote: e.quote })}>View in source</button>}</footer></blockquote>
            );
          })}
        </div>
      )}
      {conn.evidenceMissing && proposed && <p className="rd-warn"><AlertTriangle size={12} /> No supporting passage was found for this suggestion. Treat it as a hunch until you have checked the sources.</p>}
      {conn.uncertainty && <p className="rd-uncertain"><strong>What is uncertain:</strong> {conn.uncertainty}</p>}
      {(conn.reasoning || conn.checkNote) && (
        <details className="rd-reasoning">
          <summary><Brain size={12} /> How the AI reasoned</summary>
          {conn.reasoning && <p>{conn.reasoning}</p>}
          {conn.checkNote && <p><b>Second reading:</b> {conn.checkNote}</p>}
        </details>
      )}
      {conn.similarity != null && <small className="rd-fine">Text similarity {conn.similarity}. Similarity only finds candidates; it does not show how two items relate.</small>}
      {inv && <p className="rd-invsum"><FlaskConical size={12} /> Investigated {new Date(inv.at).toLocaleDateString()}{inv.assessment ? ` · you judged: ${ASSESSMENT_LABEL[inv.assessment].toLowerCase()}` : ''}{inv.qualifiedStatement ? ` · “${shortText(inv.qualifiedStatement, 120)}”` : ''}</p>}

      {mode === 'edit' && <EditForm r={r} conn={conn} onClose={() => setMode(null)} />}
      {mode === 'investigate' && <InvestigatePanel r={r} conn={conn} onClose={() => setMode(null)} />}
      {!mode && (
        <div className="rd-actions">
          {proposed && <>
            <button className="rd-btn primary" onClick={() => r.stitch(conn.id)} data-testid="stitch"><Check size={13} /> Stitch</button>
            <button className="rd-btn" onClick={() => setMode('investigate')} data-testid="investigate"><FlaskConical size={13} /> Investigate</button>
            <button className="rd-btn" onClick={() => setMode('edit')} data-testid="edit"><Pencil size={13} /> Edit</button>
            <button className="rd-btn ghost" onClick={() => r.dismiss(conn.id)} data-testid="dismiss"><X size={13} /> Dismiss</button>
          </>}
          {conn.status === 'confirmed' && <>
            <button className="rd-btn" onClick={() => setMode('edit')}><Pencil size={13} /> Edit</button>
            <button className="rd-btn" onClick={() => setMode('investigate')}><FlaskConical size={13} /> Investigate</button>
            <button className="rd-btn ghost" onClick={() => r.removeConnection(conn.id)}><Trash2 size={13} /> Remove</button>
          </>}
          {conn.status === 'rejected' && <button className="rd-btn" onClick={() => r.restore(conn.id)}><RotateCcw size={13} /> Restore as proposed</button>}
        </div>
      )}
    </article>
  );
}

/** Thread Shift: shown whenever new or changed evidence puts something you rely on in question. */
export function ThreadShiftBanner({ r, sel, goThreads, compact = false }) {
  const flags = useMemo(() => affectedItems(r.view), [r.view]);
  if (!flags.size) return null;
  const entries = [...flags.entries()].map(([id, reasons]) => ({ item: r.view.itemById[id], reasons }));
  const contested = entries.filter((e) => e.reasons.some((x) => x.kind === 'contested'));
  const affected = entries.filter((e) => !e.reasons.some((x) => x.kind === 'contested'));
  const open = pendingThreads(r.view).filter((c) => c.relationship === 'contradicts').length;
  return (
    <div className={`rd-shift ${compact ? 'is-compact' : ''}`} role="status" data-testid="thread-shift">
      <div className="rd-shift-icon"><Waypoints size={18} /></div>
      <div className="rd-shift-body">
        <strong>Thread Shift: new evidence may change your argument</strong>
        {!compact && <p>{open ? `${open} proposed thread${open === 1 ? '' : 's'} may conflict with something you rely on. ` : 'A conflicting thread is on your map. '}This is a possible conflict, not a verdict: the studies may differ in who, how or when. Review the thread before changing anything.</p>}
        {!compact && <div className="rd-shift-chips">
          {contested.map(({ item }) => <button key={item.id} onClick={() => sel.selectItem(item.id)} className="rd-chip warn">Possibly contested: {shortText(item.title, 46)}</button>)}
          {affected.map(({ item }) => <button key={item.id} onClick={() => sel.selectItem(item.id)} className="rd-chip warn soft">Affected: {shortText(item.title, 46)}</button>)}
        </div>}
      </div>
      <button className="rd-btn primary" onClick={goThreads} data-testid="shift-review">Review threads</button>
    </div>
  );
}

export default function ThreadsView({ r, sel, onFind }) {
  const [filter, setFilter] = useState('suggested');
  const conns = r.view.connections;
  const by = { suggested: conns.filter((c) => c.status === 'suggested'), confirmed: conns.filter((c) => c.status === 'confirmed'), rejected: conns.filter((c) => c.status === 'rejected') };
  const rank = { high: 0, medium: 1, low: 2 };
  const list = [...by[filter]].sort((x, y) => (y.relationship === 'contradicts') - (x.relationship === 'contradicts') || (rank[x.confidence] ?? 3) - (rank[y.confidence] ?? 3));
  const tabs = [['suggested', 'Proposed'], ['confirmed', 'Stitched'], ['rejected', 'Dismissed']];
  return (
    <div className="rd-page" data-testid="threads-view">
      <div className="rd-page-head">
        <div><div className="eyebrow">THREAD DISCOVERY</div><h2>Threads</h2><p>The AI proposes how your items relate. Nothing joins your argument until you stitch it.</p></div>
        <div className="rd-actions"><button className="rd-btn primary" onClick={() => onFind()} disabled={Boolean(r.busy)}><Sparkles size={13} /> Find threads</button></div>
      </div>
      <div className="rd-seg" role="tablist">{tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'is-on' : ''} onClick={() => setFilter(k)}>{label} <em>{by[k].length}</em></button>)}</div>
      {list.length ? <div className="rd-thread-list">{list.map((c) => <ThreadCard key={c.id} r={r} conn={c} sel={sel} />)}</div>
        : <Empty title={filter === 'suggested' ? 'Nothing waiting for review' : filter === 'confirmed' ? 'No stitched threads yet' : 'Nothing dismissed'}>
          {filter === 'suggested' ? 'Press “Find threads” after adding sources or items, or connect two items yourself from an item’s panel.' : filter === 'confirmed' ? 'Stitch a proposed thread, or connect two items yourself, and it will appear here as a solid line on the map.' : 'Dismissed suggestions are kept here so they are never proposed again.'}
        </Empty>}
    </div>
  );
}
