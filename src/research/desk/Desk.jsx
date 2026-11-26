import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, BookOpen, Check, ChevronRight, Trash2, Download, FilePlus2, History as HistoryIcon, ListTree, LoaderCircle, MessagesSquare, Network, Pencil, Plus, Sparkles, Telescope, TriangleAlert, Waypoints, X, ScrollText, Layers,
} from 'lucide-react';
import CatMascot from '../../components/CatMascot';
import { docLabel, shortText } from '../model.js';
import { pendingThreads } from '../store.js';
import { AddSourceModal, NewItemModal, ProjectModal } from './Modals.jsx';
import MapView from './MapView.jsx';
import ListView from './ListView.jsx';
import ThreadsView, { ThreadShiftBanner } from './ThreadsView.jsx';
import GapsView from './GapsView.jsx';
import OutlineView from './OutlineView.jsx';
import AskView from './AskView.jsx';
import ItemPanel from './ItemPanel.jsx';
import SourceViewer from './SourceViewer.jsx';
import './desk.css';

const AI_CHIP = {
  unknown: ['Checking AI…', 'idle', 'Looking for the optional AI service.'],
  offline: ['AI offline', 'off', 'The optional AI service is not running. Everything except extraction, AI threads, investigation help, gaps, AI outlines and Ask still works. Click to check again.'],
  'no-model': ['AI has no key', 'warn', 'The AI service is running but no model key is set in backend/.env. Click to check again.'],
  ready: ['AI connected', 'ok', 'The AI service and a model key are available. Click to check again.'],
};

function HistoryView({ r }) {
  const list = r.view.history;
  return (
    <div className="rd-page" data-testid="history-view">
      <div className="rd-page-head"><div><div className="eyebrow">CHANGE LOG</div><h2>History</h2><p>Every extraction, stitch, edit and dismissal on this project, newest first.</p></div></div>
      <ol className="rd-history">{list.slice(0, 120).map((h) => <li key={h.id}><time>{new Date(h.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time><span>{h.summary}</span></li>)}</ol>
      {!list.length && <p className="rd-fine">Nothing yet.</p>}
    </div>
  );
}

/** Two-step delete: the first click arms it ("Delete?"), the second deletes. Everything can also be undone from the toast. */
export function DeleteButton({ armed, onArm, onConfirm, label, confirmText = 'Delete?', testid }) {
  return armed
    ? <button className="rd-del is-armed" onClick={onConfirm} title="Click again to delete (you can undo)" data-testid={testid ? `${testid}-confirm` : undefined}><Check size={12} /> {confirmText}</button>
    : <button className="rd-del" onClick={onArm} title={label} aria-label={label} data-testid={testid}><Trash2 size={12} /></button>;
}

function Welcome({ r, onSample }) {
  const [name, setName] = useState('');
  const [question, setQuestion] = useState('');
  const create = () => { if (name.trim()) r.createProject(name, question); };
  return (
    <div className="rd-welcome" data-testid="welcome">
      <div className="rd-welcome-card">
        <CatMascot variant="sit" size={96} mood="happy" wave />
        <div className="eyebrow">THE RESEARCH DESK</div>
        <h1>Turn what you read into an argument you can defend.</h1>
        <p>Add papers, let Threadkeeper pull out the claims, findings and limitations with their quotes, then stitch the connections yourself. Nothing joins your argument until you say so.</p>
        <ol className="rd-steps"><li><b>Capture</b> a paper or note</li><li><b>Extract</b> claims and evidence</li><li><b>Stitch</b> the threads you believe</li><li><b>Build</b> an outline you can cite</li></ol>
        <div className="rd-welcome-form">
          <label className="rd-field">Project name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Retrieval practice and retention" data-testid="welcome-name" onKeyDown={(e) => e.key === 'Enter' && create()} /></label>
          <label className="rd-field">Research question<textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What are you trying to find out?" data-testid="welcome-question" /></label>
          <div className="rd-actions"><button className="rd-btn primary" disabled={!name.trim()} onClick={create} data-testid="welcome-create">Start project</button><button className="rd-btn" onClick={onSample} data-testid="welcome-sample"><Sparkles size={13} /> Explore the sample project</button></div>
        </div>
        <p className="rd-fine">The sample uses four invented papers marked “(illustrative sample)”. It needs no AI and no PDFs.</p>
      </div>
    </div>
  );
}

export default function Desk({ r, tasks, onBack, onTuck, headerDrag, notify, banner = null }) {
  const { view } = r;
  const [tab, setTab] = useState('map');
  const [itemId, setItemId] = useState(null);
  const [edgeId, setEdgeId] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const [source, setSource] = useState(null);
  const [modal, setModal] = useState(null);

  const [confirmDel, setConfirmDel] = useState(null); // 'project:<id>' | 'doc:<id>' awaiting a second click
  useEffect(() => { setItemId(null); setEdgeId(null); setFocusId(null); }, [r.projectId]);
  useEffect(() => { if (!confirmDel) return undefined; const t = setTimeout(() => setConfirmDel(null), 4000); return () => clearTimeout(t); }, [confirmDel]);
  // Delete key removes the selected item (with Undo), unless you are typing.
  const itemRef = React.useRef(itemId); itemRef.current = itemId;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Delete' || !itemRef.current) return;
      const el = document.activeElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName || '') || el?.isContentEditable || document.querySelector('.rd-backdrop')) return;
      e.preventDefault();
      r.removeItem(itemRef.current); setItemId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [r]);
  const sel = useMemo(() => ({
    itemId, edgeId, focusId, setFocusId,
    selectItem: (id) => { setItemId(id); setEdgeId(null); },
    selectEdge: (id) => { setEdgeId(id); setItemId(null); },
    clear: () => { setItemId(null); setEdgeId(null); },
    openSource: (t) => setSource(t),
  }), [itemId, edgeId, focusId]);

  const onFind = async (opts) => { const res = await r.discoverThreads(opts); return res; };
  const pending = pendingThreads(view).length;
  const chip = AI_CHIP[r.ai.state] || AI_CHIP.unknown;
  const hasPanel = Boolean((itemId && view.itemById[itemId]) || (edgeId && view.connections.some((c) => c.id === edgeId)));
  const sampleNeedsPaper = view.project?.sample && !view.documents.some((d) => d.title.includes('Complex Statistics'));
  const problem = r.problem && !(modal?.kind === 'source' && ['pdf', 'search'].includes(r.problem.kind)) ? r.problem : null;

  const tabs = [
    ['map', 'Map', Network], ['list', 'List', ListTree], ['threads', 'Threads', Waypoints, pending], ['gaps', 'Gaps', Telescope],
    ['outline', 'Outline', ScrollText], ['ask', 'Ask', MessagesSquare], ['history', 'History', HistoryIcon],
  ];

  const runSample = async () => { await r.loadSample(); setTab('map'); notify('Sample project ready. Everything in it is invented for the demo.'); };
  const runNewPaper = async () => { const out = await r.addSampleNewPaper(); if (out) { setTab('map'); notify('A new (invented) paper arrived with a different result. Check the Thread Shift notice.'); } };

  return (
    <div className="rd-shell" data-testid="desk">
      <header className="rd-header drag-region" {...headerDrag} title="Drag to move">
        <button className="rd-btn ghost back" onClick={onBack} data-testid="desk-back"><ArrowLeft size={14} /> Notes</button>
        <div className="rd-brand"><CatMascot variant="face" size={34} mood={pending ? 'alert' : 'happy'} /><div><div className="eyebrow">RESEARCH DESK</div><strong>{view.project?.name || 'Threadkeeper'}</strong></div></div>
        <span className="grow" />
        {r.busy && <span className="rd-busy" role="status" data-testid="busy"><LoaderCircle size={14} className="spin" /> {r.busy}</span>}
        <button className={`rd-ai ${chip[1]}`} title={chip[2]} onClick={r.checkAi} data-testid="ai-status"><i />{chip[0]}</button>
        {view.project && <>
          <button className="rd-btn" onClick={() => setModal({ kind: 'item' })} data-testid="new-item"><Plus size={13} /> Item</button>
          <button className="rd-btn" onClick={() => setModal({ kind: 'source' })} data-testid="add-source"><FilePlus2 size={13} /> Source</button>
          <button className="rd-btn ghost" onClick={r.exportProject} title="Export this project as Markdown"><Download size={13} /></button>
        </>}
        <button className="icon-btn tuck-btn" title="Tuck away into the little tab" onClick={onTuck}><ChevronRight size={15} /></button>
      </header>

      {banner}
      {!view.project ? <Welcome r={r} onSample={runSample} /> : (
        <div className="rd-main">
          <aside className="rd-side">
            <div className="rd-side-block">
              <div className="rd-side-title"><span>Projects</span><button className="tiny-icon" onClick={() => setModal({ kind: 'project' })} title="New project" data-testid="new-project"><Plus size={14} /></button></div>
              <ul className="rd-projects">
                {r.research.projects.map((p) => (
                  <li key={p.id} className="rd-delrow">
                    <button className={p.id === view.project.id ? 'is-on' : ''} onClick={() => r.selectProject(p.id)} data-testid={`project-${p.id}`}><BookOpen size={13} /><span>{p.name}</span>{p.sample && <em>sample</em>}</button>
                    <DeleteButton armed={confirmDel === `project:${p.id}`} label={`Delete project ${p.name}`} confirmText="Delete project?" testid={`project-del-${p.id}`}
                      onArm={() => setConfirmDel(`project:${p.id}`)} onConfirm={() => { setConfirmDel(null); r.removeProject(p.id); }} />
                  </li>
                ))}
              </ul>
            </div>
            <div className="rd-side-block">
              <div className="rd-side-title"><span>Research question</span><button className="tiny-icon" onClick={() => setModal({ kind: 'editProject' })} title="Edit project" data-testid="edit-project"><Pencil size={13} /></button></div>
              <p className="rd-question">{view.project.researchQuestion || <em>Not set yet. Add one so extraction and threads know what matters.</em>}</p>
            </div>
            <div className="rd-side-block grow">
              <div className="rd-side-title"><span>Sources <em>{view.documents.length}</em></span><button className="tiny-icon" onClick={() => setModal({ kind: 'source' })} title="Add a source"><Plus size={14} /></button></div>
              <ul className="rd-sources">
                {view.documents.map((d) => {
                  const n = view.items.filter((i) => i.documentId === d.id).length;
                  return (
                    <li key={d.id} className="rd-delrow">
                      <DeleteButton armed={confirmDel === `doc:${d.id}`} label={`Remove source ${docLabel(d)}`} confirmText={n ? `Remove + ${n} item${n === 1 ? '' : 's'}?` : 'Remove?'} testid={`source-del-${d.id}`}
                        onArm={() => setConfirmDel(`doc:${d.id}`)} onConfirm={() => { setConfirmDel(null); r.removeDocument(d.id); }} />
                      <button onClick={() => setSource({ docId: d.id })} data-testid={`source-${d.id}`}>
                        <strong>{docLabel(d)}</strong><span>{shortText(d.title, 62)}</span>
                        <small>{n} item{n === 1 ? '' : 's'}{d.hasText ? (d.pageUnit === 'abstract' ? ' · abstract only' : '') : ' · no text'}{d.verified === false ? ' · unverified' : ''}{d.hasText && d.status !== 'extracted' ? ' · not extracted' : ''}</small>
                      </button>
                    </li>
                  );
                })}
                {!view.documents.length && <li className="rd-fine">No sources yet. Add a PDF, paste text, or search.</li>}
              </ul>
            </div>
            {sampleNeedsPaper && (
              <div className="rd-demo">
                <strong><Layers size={13} /> Thread Shift demo</strong>
                <p>Add a new (invented) paper whose result differs from the sample claim and see what the map flags.</p>
                <button className="rd-btn primary" onClick={runNewPaper} data-testid="demo-new-paper">Add the new paper</button>
              </div>
            )}
            {r.research.projects.every((p) => !p.sample) && <button className="rd-btn ghost" onClick={runSample} data-testid="load-sample"><Sparkles size={13} /> Explore the sample project</button>}
          </aside>

          <section className="rd-center">
            <nav className="rd-tabs" role="tablist" aria-label="Research views">
              {tabs.map(([k, label, Icon, badge]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)} data-testid={`tab-${k}`}><Icon size={14} />{label}{badge > 0 && <em data-testid={`badge-${k}`}>{badge}</em>}</button>
              ))}
            </nav>
            {problem && (
              <div className={`rd-problem ${problem.kind === 'warning' ? 'soft' : ''}`} role="alert" data-testid="problem">
                <TriangleAlert size={15} /><span>{problem.message}</span>
                {problem.retry && <button className="rd-btn" onClick={() => { const run = problem.retry.run; r.setProblem(null); run(); }} data-testid="problem-retry">{problem.retry.label}</button>}
                <button className="icon-btn" onClick={() => r.setProblem(null)} aria-label="Dismiss message"><X size={14} /></button>
              </div>
            )}
            <ThreadShiftBanner r={r} sel={sel} compact={tab !== 'map'} goThreads={() => setTab('threads')} />
            <div className="rd-content">
              <div className="rd-view">
                {tab === 'map' && <MapView r={r} sel={sel} onFind={onFind} />}
                {tab === 'list' && <ListView r={r} sel={sel} />}
                {tab === 'threads' && <ThreadsView r={r} sel={sel} onFind={onFind} />}
                {tab === 'gaps' && <GapsView r={r} sel={sel} onSearch={(q) => setModal({ kind: 'source', tab: 'search', query: q })} />}
                {tab === 'outline' && <OutlineView r={r} sel={sel} />}
                {tab === 'ask' && <AskView r={r} sel={sel} />}
                {tab === 'history' && <HistoryView r={r} />}
              </div>
              {hasPanel && <ItemPanel r={r} sel={sel} tasks={tasks} onFind={onFind} />}
            </div>
          </section>
        </div>
      )}

      {modal?.kind === 'project' && <ProjectModal onClose={() => setModal(null)} onSave={({ name, researchQuestion }) => { r.createProject(name, researchQuestion); setModal(null); setTab('map'); }} />}
      {modal?.kind === 'editProject' && <ProjectModal project={view.project} onClose={() => setModal(null)} onSave={(patch) => { r.updateProject(view.project.id, { name: patch.name.trim(), researchQuestion: patch.researchQuestion.trim() }); setModal(null); }} onDelete={() => { r.removeProject(view.project.id); setModal(null); }} />}
      {modal?.kind === 'item' && <NewItemModal r={r} onClose={() => setModal(null)} onCreated={(it) => it && sel.selectItem(it.id)} />}
      {modal?.kind === 'source' && <AddSourceModal r={r} initialTab={modal.tab || 'pdf'} initialQuery={modal.query || ''} onClose={() => setModal(null)} onAdded={(d) => { if (d?.hasText) setSource({ docId: d.id }); }} />}
      {source && view.docById[source.docId] && <SourceViewer r={r} target={source} onClose={() => setSource(null)} onSelectItem={(id) => { sel.selectItem(id); }} />}
    </div>
  );
}
