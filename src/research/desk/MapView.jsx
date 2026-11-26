import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BaseEdge, Background, Controls, EdgeLabelRenderer, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, useInternalNode, useNodesState, useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Crosshair, Orbit, Search, Sparkles, X } from 'lucide-react';
import { ITEM_TYPES, ITEM_TYPE_ORDER, RELATIONS, docLabel, shortText } from '../model.js';
import { affectedItems, neighborhood, pendingThreads } from '../store.js';
import { HUB_ID, INNER_TYPES, NODE_SIZE, ringLayout } from '../layout.js';
import { ProvenanceBadge, TypeBadge } from './ui.jsx';

// Circles connect centre to centre, so each node has one hidden handle in its middle; the edges compute their own
// end points on the circles' rims ("floating" edges).
const CentreHandles = () => (
  <>
    <Handle id="c" type="source" position={Position.Top} isConnectable={false} className="rd-handle rd-handle-centre" />
    <Handle id="c" type="target" position={Position.Top} isConnectable={false} className="rd-handle rd-handle-centre" />
  </>
);

function ItemCircle({ data }) {
  const { item, docText, flagged, pending, dim, match, selected, ring } = data;
  const tone = ITEM_TYPES[item.type]?.tone || 'butter';
  const size = NODE_SIZE[ring];
  return (
    <div className={`rd-circle ring-${ring} tone-${tone} ${selected ? 'is-selected' : ''} ${dim ? 'is-dim' : ''} ${match ? 'is-match' : ''} ${flagged ? 'is-flagged' : ''}`}
      style={{ width: size, height: size }} data-testid={`node-${item.id}`} data-flagged={flagged ? 'true' : undefined}
      title={`${ITEM_TYPES[item.type]?.label}: ${item.title}${item.content ? `\n\n${shortText(item.content, 220)}` : ''}${docText ? `\n\n${docText}` : ''}`}>
      <CentreHandles />
      <span className="rd-circle-type">{ITEM_TYPES[item.type]?.label}</span>
      <span className="rd-circle-title">{item.title}</span>
      <span className="rd-circle-prov"><ProvenanceBadge value={item.provenance} compact /></span>
      {pending > 0 && <span className="rd-circle-badge" title={`${pending} proposed thread${pending === 1 ? '' : 's'} to review`}>{pending}</span>}
      {flagged && <span className="rd-circle-flag" title={flagged === 'contested' ? 'Possibly contested' : 'Needs a second look'}>!</span>}
    </div>
  );
}

function SourceCircle({ data }) {
  const { doc, dim, count, hub } = data;
  const size = NODE_SIZE[hub ? 'hub' : 'source'];
  return (
    <div className={`rd-circle rd-circle-source ${hub ? 'is-hub' : ''} ${dim ? 'is-dim' : ''}`} style={{ width: size, height: size }}
      data-testid={hub ? 'node-hub' : `node-doc-${doc.id}`} title={hub ? 'Your own items (not from a source)' : `${docLabel(doc)}\n${doc.title || ''}\nDrag to move this paper and everything around it.`}>
      <CentreHandles />
      <span className="rd-circle-type">{hub ? 'Your items' : 'Source'}</span>
      <span className="rd-circle-title">{hub ? 'Not from a paper' : docLabel(doc)}</span>
      <span className="rd-circle-sub">{count} item{count === 1 ? '' : 's'}{!hub && !doc.hasText ? ' · no text' : ''}{!hub && doc.verified === false ? ' · unverified' : ''}</span>
    </div>
  );
}

/** Faint guide circles: the inner ring (claims, findings) and the outer ring (everything else) of one cluster. */
function RingGuide({ data }) {
  return <div className={`rd-ring-guide ${data.outer ? 'is-outer' : ''}`} style={{ width: data.r * 2, height: data.r * 2 }} aria-hidden="true" />;
}

function useCircle(id) {
  const n = useInternalNode(id);
  if (!n) return null;
  const w = n.measured?.width ?? n.width ?? 0; const h = n.measured?.height ?? n.height ?? 0;
  return { x: n.internals.positionAbsolute.x + w / 2, y: n.internals.positionAbsolute.y + h / 2, r: Math.min(w, h) / 2 };
}
function floatingPath(a, b, bend = 0, gap = 3) {
  const dx = b.x - a.x; const dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d; const uy = dy / d;
  const sx = a.x + ux * a.r; const sy = a.y + uy * a.r;
  const tx = b.x - ux * (b.r + gap); const ty = b.y - uy * (b.r + gap);
  const cx = (sx + tx) / 2 - uy * bend * d; const cy = (sy + ty) / 2 + ux * bend * d;
  return [`M${sx},${sy} Q${cx},${cy} ${tx},${ty}`, (sx + 2 * cx + tx) / 4, (sy + 2 * cy + ty) / 4];
}
const bendFor = (id) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) | 0; return (h & 1 ? 1 : -1) * 0.1; };

function ThreadEdge({ id, source, target, data, markerEnd }) {
  const a = useCircle(source); const b = useCircle(target);
  if (!a || !b) return null;
  const [path, lx, ly] = floatingPath(a, b, bendFor(id));
  const rel = RELATIONS[data.relationship] || RELATIONS.related_to;
  const proposed = data.status === 'suggested';
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke: rel.color, strokeWidth: data.selected ? 3.6 : 2.2, strokeDasharray: proposed ? '7 6' : undefined, opacity: data.dim ? 0.12 : 1 }} />
      <EdgeLabelRenderer>
        <button
          className={`rd-edge-label nodrag nopan ${proposed ? 'is-proposed' : 'is-confirmed'} ${data.selected ? 'is-selected' : ''}`}
          style={{ transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)`, borderColor: rel.color, opacity: data.dim ? 0.2 : 1 }}
          onClick={() => data.onSelect(data.connectionId)}
          data-testid={`edge-${data.connectionId}`}
          data-status={data.status}
          title={proposed ? 'Proposed thread (not reviewed). Click to review.' : 'Stitched thread (you confirmed it). Click to see it.'}
        >
          <span style={{ color: rel.color }}>{rel.label}{proposed ? '?' : ''}</span>{proposed && <small>proposed</small>}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

function LinkEdge({ id, source, target, data }) {
  const a = useCircle(source); const b = useCircle(target);
  if (!a || !b) return null;
  const [path] = floatingPath(a, b, 0, 0);
  return <BaseEdge id={id} path={path} style={{ stroke: '#b9a382', strokeWidth: 1.2, opacity: data?.dim ? 0.08 : 0.45 }} />;
}

const nodeTypes = { card: ItemCircle, source: SourceCircle, ring: RingGuide };
const edgeTypes = { thread: ThreadEdge, link: LinkEdge };

function FitOnChange({ signature }) {
  const { fitView } = useReactFlow();
  useEffect(() => { const t = setTimeout(() => fitView({ padding: 0.06, duration: 300, maxZoom: 1.1, minZoom: 0.2 }), 80); return () => clearTimeout(t); }, [signature, fitView]);
  return null;
}

const sizeOfNode = (id, view) => {
  if (id === HUB_ID) return NODE_SIZE.hub;
  if (id.startsWith('doc:')) return NODE_SIZE.source;
  const item = view.itemById[id.slice(5)];
  return NODE_SIZE[item && INNER_TYPES.has(item.type) ? 'inner' : 'outer'];
};
const topLeft = (centre, size) => ({ x: centre.x - size / 2, y: centre.y - size / 2 });

function Canvas({ r, sel, onFind }) {
  const { view } = r;
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState(() => new Set());
  const [hops, setHops] = useState(1);
  const toggle = (type) => setHidden((h) => { const n = new Set(h); if (n.has(type)) n.delete(type); else n.add(type); return n; });
  const flags = useMemo(() => affectedItems(view), [view]);
  const pendingByItem = useMemo(() => {
    const m = {};
    for (const c of pendingThreads(view)) { m[c.from] = (m[c.from] || 0) + 1; m[c.to] = (m[c.to] || 0) + 1; }
    return m;
  }, [view]);
  // ---- the rings layout: sources in the middle, claims/findings around them, everything else around those;
  // threads pull linked circles (and papers) together. Dragged circles are pinned; the rest settles around them.
  const structure = useMemo(() => JSON.stringify([
    view.documents.map((d) => d.id), view.items.map((i) => [i.id, i.type, i.documentId || '']),
    view.connections.filter((c) => c.status !== 'rejected').map((c) => [c.from, c.to, c.status]), view.layout,
  ]), [view]);
  const lastCentres = useRef({});
  const layout = useMemo(() => ringLayout(view, { pinned: view.layout, previous: lastCentres.current }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [structure]);
  const [shown, setShown] = useState(layout.positions); // animated centres
  useEffect(() => {
    // Glide from where things are to where they settle (the map "self-organises" rather than jumping).
    const from = lastCentres.current; const to = layout.positions;
    lastCentres.current = to;
    if (!Object.keys(from).length) { setShown(to); return undefined; }
    let frame; const t0 = performance.now(); const dur = 520;
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / dur); const e = 1 - (1 - k) ** 3;
      const next = {};
      for (const [id, p] of Object.entries(to)) { const a = from[id] || p; next[id] = { x: a.x + (p.x - a.x) * e, y: a.y + (p.y - a.y) * e }; }
      setShown(next);
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [layout]);

  const q = query.trim().toLowerCase();
  const focusSet = sel.focusId ? neighborhood(view, sel.focusId, hops) : null;

  const matches = useMemo(() => {
    if (!q) return null;
    const set = new Set();
    for (const i of view.items) {
      const hay = `${i.title} ${i.content} ${(view.evidenceByItem[i.id] || []).map((e) => e.quote).join(' ')} ${ITEM_TYPES[i.type]?.label}`.toLowerCase();
      if (hay.includes(q)) set.add(i.id);
    }
    return set;
  }, [q, view]);

  const counts = useMemo(() => { const c = {}; for (const i of view.items) c[i.type] = (c[i.type] || 0) + 1; return c; }, [view]);
  const itemVisible = (i) => !hidden.has(i.type) && (!focusSet || focusSet.has(i.id));
  const showSources = !hidden.has('source') && !focusSet;

  const derived = useMemo(() => {
    const out = [];
    const perDoc = {}; let mine = 0;
    for (const i of view.items) if (i.documentId) perDoc[i.documentId] = (perDoc[i.documentId] || 0) + 1; else mine += 1;
    const at = (id) => shown[id] || layout.positions[id];
    if (!focusSet) {
      for (const [cid, c] of Object.entries(layout.clusters)) {
        const centre = at(cid) || c;
        for (const [k, r] of [['r1', c.r1], ['r2', c.r2]]) {
          if (k === 'r2' && c.r2 === c.r1) continue;
          out.push({ id: `ring:${cid}:${k}`, type: 'ring', position: { x: centre.x - r, y: centre.y - r }, width: r * 2, height: r * 2, data: { r, outer: k === 'r2' }, draggable: false, selectable: false, focusable: false, zIndex: -1, style: { pointerEvents: 'none' } });
        }
      }
    }
    if (showSources) {
      for (const d of view.documents) {
        const p = at(`doc:${d.id}`); if (!p) continue;
        out.push({ id: `doc:${d.id}`, type: 'source', position: topLeft(p, NODE_SIZE.source), width: NODE_SIZE.source, height: NODE_SIZE.source, data: { doc: d, count: perDoc[d.id] || 0, dim: Boolean(matches) }, draggable: true });
      }
      if (mine && at(HUB_ID)) out.push({ id: HUB_ID, type: 'source', position: topLeft(at(HUB_ID), NODE_SIZE.hub), width: NODE_SIZE.hub, height: NODE_SIZE.hub, data: { hub: true, count: mine, dim: Boolean(matches) }, draggable: true });
    }
    for (const i of view.items.filter(itemVisible)) {
      const p = at(`item:${i.id}`); if (!p) continue;
      const ring = INNER_TYPES.has(i.type) ? 'inner' : 'outer';
      const flag = flags.get(i.id);
      out.push({
        id: `item:${i.id}`, type: 'card', position: topLeft(p, NODE_SIZE[ring]), width: NODE_SIZE[ring], height: NODE_SIZE[ring],
        data: {
          item: i, ring, docText: i.documentId ? docLabel(view.docById[i.documentId]) : '', flagged: flag ? (flag.some((f) => f.kind === 'affected') && !flag.some((f) => f.kind === 'contested') ? 'affected' : 'contested') : null,
          pending: pendingByItem[i.id] || 0, dim: Boolean(matches) && !matches.has(i.id), match: Boolean(matches) && matches.has(i.id), selected: sel.itemId === i.id,
        },
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, hidden, focusSet?.size, sel.focusId, matches, sel.itemId, flags, shown, layout, pendingByItem, showSources]);

  const [nodes, setNodes, onNodesChange] = useNodesState(derived);
  useEffect(() => {
    setNodes((prev) => { const old = new Map(prev.map((n) => [n.id, n])); return derived.map((n) => (old.get(n.id)?.measured ? { ...n, measured: old.get(n.id).measured } : n)); });
  }, [derived, setNodes]);

  const edges = useMemo(() => {
    const present = new Set(derived.map((n) => n.id));
    const list = [];
    if (showSources) {
      for (const i of view.items) {
        const centre = i.documentId ? `doc:${i.documentId}` : HUB_ID;
        if (!present.has(`item:${i.id}`) || !present.has(centre)) continue;
        list.push({ id: `src:${i.id}`, source: centre, target: `item:${i.id}`, sourceHandle: 'c', targetHandle: 'c', type: 'link', selectable: false, zIndex: 0, data: { dim: Boolean(matches) } });
      }
    }
    for (const c of view.connections) {
      if (c.status === 'rejected' || !present.has(`item:${c.from}`) || !present.has(`item:${c.to}`)) continue;
      const rel = RELATIONS[c.relationship] || RELATIONS.related_to;
      list.push({
        id: `conn:${c.id}`, source: `item:${c.from}`, target: `item:${c.to}`, sourceHandle: 'c', targetHandle: 'c', type: 'thread',
        markerEnd: { type: MarkerType.ArrowClosed, color: rel.color, width: 16, height: 16 }, zIndex: sel.edgeId === c.id ? 10 : 1,
        data: { connectionId: c.id, relationship: c.relationship, status: c.status, selected: sel.edgeId === c.id, onSelect: sel.selectEdge, dim: Boolean(matches) && !(matches.has(c.from) || matches.has(c.to)) },
      });
    }
    return list;
  }, [derived, view.connections, view.items, sel.edgeId, matches, showSources]);

  // Dragging a source (or "Your items") carries its whole cluster with it; dropping pins it and the map re-settles.
  const dragRef = useRef(null);
  const onNodeDragStart = (_, node) => { dragRef.current = { id: node.id, last: { ...node.position } }; };
  const onNodeDrag = (_, node) => {
    const d = dragRef.current;
    if (!d || d.id !== node.id || !(node.id.startsWith('doc:') || node.id === HUB_ID)) return;
    const dx = node.position.x - d.last.x; const dy = node.position.y - d.last.y;
    d.last = { ...node.position };
    if (!dx && !dy) return;
    const cluster = new Set(view.items.filter((i) => (node.id === HUB_ID ? !i.documentId : `doc:${i.documentId}` === node.id)).map((i) => `item:${i.id}`));
    setNodes((ns) => ns.map((n) => (cluster.has(n.id) || n.id.startsWith(`ring:${node.id}:`) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)));
  };
  const onNodeDragStop = (_, node) => {
    dragRef.current = null;
    if (node.id.startsWith('ring:')) return;
    const size = sizeOfNode(node.id, view);
    const centre = { x: Math.round(node.position.x + size / 2), y: Math.round(node.position.y + size / 2) };
    const save = { [node.id]: centre };
    if (node.id.startsWith('doc:') || node.id === HUB_ID) {
      // keep the items where they were dragged to, relative to their source, so nothing jumps back
      const prev = lastCentres.current[node.id];
      if (prev) {
        const dx = centre.x - prev.x; const dy = centre.y - prev.y;
        const next = { ...lastCentres.current };
        for (const i of view.items) {
          const id = `item:${i.id}`;
          const mineCluster = node.id === HUB_ID ? !i.documentId : `doc:${i.documentId}` === node.id;
          if (mineCluster && next[id]) next[id] = { x: next[id].x + dx, y: next[id].y + dy };
        }
        next[node.id] = centre;
        lastCentres.current = next;
      }
    }
    r.saveLayout(save);
  };

  const signature = `${view.project?.id}|${derived.length}|${sel.focusId || ''}|${[...hidden].join(',')}`;

  return (
    <div className="rd-map" data-testid="map-view">
      <div className="rd-map-bar">
        <label className="rd-search"><Search size={13} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the map…" aria-label="Search the map" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={12} /></button>}</label>
        {matches && <span className="rd-count" data-testid="search-count">{matches.size} match{matches.size === 1 ? '' : 'es'}</span>}
        <div className="rd-filters" role="group" aria-label="Show or hide types">
          <button className={`rd-filter ${hidden.has('source') ? 'is-off' : ''}`} onClick={() => toggle('source')} aria-pressed={!hidden.has('source')}><i className="dot tone-ink" />Sources</button>
          {ITEM_TYPE_ORDER.filter((t) => counts[t]).map((t) => (
            <button key={t} className={`rd-filter ${hidden.has(t) ? 'is-off' : ''}`} onClick={() => toggle(t)} aria-pressed={!hidden.has(t)} title={`${hidden.has(t) ? 'Show' : 'Hide'} ${ITEM_TYPES[t].plural.toLowerCase()}`}>
              <i className={`dot tone-${ITEM_TYPES[t].tone}`} />{ITEM_TYPES[t].plural} <em>{counts[t]}</em>
            </button>
          ))}
        </div>
        <div className="rd-map-actions">
          {sel.focusId
            ? <><span className="rd-chip focus">Focus: {shortText(view.itemById[sel.focusId]?.title, 28)}</span>
              <button className="rd-btn ghost" onClick={() => setHops((h) => (h === 1 ? 2 : 1))} title="How many steps away to show">{hops} step{hops === 1 ? '' : 's'}</button>
              <button className="rd-btn ghost" onClick={() => sel.setFocusId(null)}>Show everything</button></>
            : <button className="rd-btn ghost" disabled={!sel.itemId} onClick={() => sel.setFocusId(sel.itemId)} title="Show only the selected item and what it connects to"><Crosshair size={13} /> Focus on selected</button>}
          <button className="rd-btn ghost" onClick={() => { lastCentres.current = {}; r.resetLayout(); }} title="Unpin everything you dragged and let the map arrange itself again"><Orbit size={13} /> Re-arrange</button>
          <button className="rd-btn primary" onClick={() => onFind()} disabled={Boolean(r.busy)}><Sparkles size={13} /> Find threads</button>
        </div>
      </div>
      <div className="rd-canvas">
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange}
          nodesConnectable={false} elementsSelectable deleteKeyCode={null} minZoom={0.15} maxZoom={1.6} proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => { if (node.id.startsWith('item:')) sel.selectItem(node.id.slice(5)); else if (node.id.startsWith('doc:')) sel.openSource({ docId: node.id.slice(4) }); }}
          onPaneClick={() => sel.clear()}
          onNodeDragStart={onNodeDragStart} onNodeDrag={onNodeDrag} onNodeDragStop={onNodeDragStop}
        >
          <Background gap={22} size={1.2} color="#d9c9aa" />
          <Controls showInteractive={false} position="bottom-right" />
          <MiniMap pannable zoomable position="bottom-left" nodeColor={(n) => (n.type === 'ring' ? 'transparent' : n.type === 'source' ? '#d8c6a3' : '#c9b8fa')} nodeStrokeColor={(n) => (n.type === 'ring' ? 'transparent' : '#9b8a70')} nodeBorderRadius={999} maskColor="rgba(251,246,235,.7)" style={{ width: 150, height: 96 }} />
          <FitOnChange signature={signature} />
        </ReactFlow>
        <div className="rd-legend" aria-label="Legend">
          <span><svg width="34" height="8"><line x1="0" y1="4" x2="34" y2="4" stroke="#6c7a8c" strokeWidth="2.2" /></svg> Stitched (you confirmed)</span>
          <span><svg width="34" height="8"><line x1="0" y1="4" x2="34" y2="4" stroke="#6c7a8c" strokeWidth="2.2" strokeDasharray="7 6" /></svg> Proposed (not reviewed)</span>
          <span><svg width="14" height="14"><circle cx="7" cy="7" r="6" fill="#efe3cc" stroke="#9b8a70" strokeDasharray="2 2" /></svg> Source · inner ring: claims & findings · outer ring: everything else</span>
        </div>
        {!view.items.length && <div className="rd-canvas-empty"><strong>This map is empty</strong><span>Add a source (PDF or pasted text) or create your first item. Items you create appear here.</span></div>}
      </div>
    </div>
  );
}

export default function MapView(props) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}
