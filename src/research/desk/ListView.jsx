import React, { useMemo, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { ATTRIBUTION_LABEL, ITEM_TYPES, ITEM_TYPE_ORDER, docLabel, shortText } from '../model.js';
import { affectedItems, findDuplicateItems } from '../store.js';
import { Empty, ProvenanceBadge } from './ui.jsx';

/** The same map as an accessible outline: grouped by type, searchable, nothing hidden behind a canvas. */
export default function ListView({ r, sel }) {
  const { view } = r;
  const [q, setQ] = useState('');
  const [bulk, setBulk] = useState(null); // item type whose "Delete all" is armed
  const [showDups, setShowDups] = useState(false);
  const dups = useMemo(() => findDuplicateItems(view), [view]);
  const flags = useMemo(() => affectedItems(view), [view]);
  const needle = q.trim().toLowerCase();
  const match = (i) => !needle || `${i.title} ${i.content}`.toLowerCase().includes(needle);
  const degree = (id) => view.connections.filter((c) => c.status !== 'rejected' && (c.from === id || c.to === id)).length;
  const groups = ITEM_TYPE_ORDER.map((t) => [t, view.items.filter((i) => i.type === t && match(i))]).filter(([, l]) => l.length);
  return (
    <div className="rd-page" data-testid="list-view">
      <div className="rd-page-head">
        <div><div className="eyebrow">OUTLINE VIEW</div><h2>All items</h2><p>The same map as a list. Pick an item to read its evidence and threads.</p></div>
        <label className="rd-search"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter items…" aria-label="Filter items" /></label>
      </div>
      {dups.length > 0 && (
        <div className="rd-dups" data-testid="dups">
          <div className="rd-dups-head"><strong>{dups.length} likely duplicate{dups.length === 1 ? '' : 's'}</strong><span>Items that restate the same point (same quote, or near-identical wording from one source). Duplicates clutter the map and produce useless threads.</span>
            <button className="rd-btn small" onClick={() => setShowDups(!showDups)}>{showDups ? 'Hide' : 'Review'}</button>
            <button className="rd-btn danger small" onClick={() => r.removeItems(dups.map(([, drop]) => drop.id))} data-testid="dups-remove-all">Remove all {dups.length}</button></div>
          {showDups && <ul>{dups.map(([keep, drop]) => (
            <li key={drop.id}><span><b>Keep:</b> {shortText(keep.title, 70)}</span><span><b>Remove:</b> {shortText(drop.title, 70)}</span>
              <button className="rd-btn ghost small" onClick={() => r.removeItem(drop.id)}><Trash2 size={12} /> Remove</button></li>
          ))}</ul>}
        </div>
      )}
      {groups.map(([type, list]) => (
        <section key={type} className="rd-group">
          <h3><i className={`dot tone-${ITEM_TYPES[type].tone}`} />{ITEM_TYPES[type].plural} <em>{list.length}</em>
            {list.length > 1 && (bulk === type
              ? <span className="rd-bulk"><button className="rd-btn danger small" onClick={() => { setBulk(null); if (list.some((i) => i.id === sel.itemId)) sel.clear(); r.removeItems(list.map((i) => i.id)); }} data-testid={`bulk-del-${type}`}>Delete all {list.length} {needle ? 'shown' : ''}</button><button className="rd-btn ghost small" onClick={() => setBulk(null)}>Keep</button></span>
              : <button className="rd-link subtle" onClick={() => setBulk(type)} data-testid={`bulk-${type}`}>Delete all…</button>)}
          </h3>
          <ul>
            {list.map((i) => (
              <li key={i.id} className="rd-listitem">
                <button className={`rd-listrow ${sel.itemId === i.id ? 'is-selected' : ''}`} onClick={() => sel.selectItem(i.id)} data-testid={`row-${i.id}`}>
                  <span className="rd-listrow-main"><strong>{i.title}</strong><span>{shortText(i.content, 140)}</span></span>
                  <span className="rd-listrow-meta">
                    {flags.has(i.id) && <span className="rd-chip warn">Needs a second look</span>}
                    {i.attribution === 'cited' && <span className="rd-chip subtle">{ATTRIBUTION_LABEL.cited}</span>}
                    <ProvenanceBadge value={i.provenance} />
                    <small>{i.documentId ? docLabel(view.docById[i.documentId]) : 'Yours'} · {degree(i.id)} thread{degree(i.id) === 1 ? '' : 's'}</small>
                  </span>
                </button>
                <button className="rd-row-del" title="Delete this item (you can undo)" aria-label={`Delete ${i.title}`} onClick={() => { if (sel.itemId === i.id) sel.clear(); r.removeItem(i.id); }} data-testid={`row-del-${i.id}`}><Trash2 size={13} /></button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!groups.length && <Empty title={needle ? 'Nothing matches' : 'No items yet'}>{needle ? 'Try a different word.' : 'Add a source or create an item to get started.'}</Empty>}
    </div>
  );
}
