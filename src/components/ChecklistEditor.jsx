import React, { useRef, useState } from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';

const newId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `ci-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/**
 * The checklist inside a "Task / checklist" note. Items are plain to-dos (no deadlines: a deadline is a Reminder
 * note). Tick, edit in place, delete one (trash, or Backspace on an empty line), add with Enter, clear the done ones.
 */
export default function ChecklistEditor({ items = [], onChange }) {
  const [draft, setDraft] = useState('');
  const refs = useRef({});
  const addRef = useRef(null);
  const done = items.filter((i) => i.done).length;
  const set = (next) => onChange(next);
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    set([...items, { id: newId(), text, done: false }]);
    setDraft('');
    setTimeout(() => addRef.current?.focus(), 0);
  };
  const update = (id, patch) => set(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const remove = (id) => {
    const at = items.findIndex((i) => i.id === id);
    set(items.filter((i) => i.id !== id));
    const prev = items[at - 1];
    setTimeout(() => (prev ? refs.current[prev.id]?.focus() : addRef.current?.focus()), 0);
  };
  return (
    <div className="checklist-editor" data-testid="checklist">
      <div className="checklist-head">
        <strong>Checklist</strong>
        <span>{items.length ? `${done} of ${items.length} done` : 'No items yet'}</span>
        {done > 0 && <button className="checklist-clear" onClick={() => set(items.filter((i) => !i.done))} data-testid="checklist-clear"><X size={11} /> Clear done</button>}
      </div>
      {items.length > 0 && (
        <ul className="checklist-items">
          {items.map((i) => (
            <li key={i.id} className={i.done ? 'is-done' : ''}>
              <button className="checklist-box" role="checkbox" aria-checked={i.done} aria-label={i.done ? 'Mark not done' : 'Mark done'} onClick={() => update(i.id, { done: !i.done })}>{i.done && <Check size={12} />}</button>
              <input
                ref={(el) => { refs.current[i.id] = el; }}
                value={i.text}
                onChange={(e) => update(i.id, { text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addRef.current?.focus(); }
                  if (e.key === 'Backspace' && !i.text) { e.preventDefault(); remove(i.id); }
                }}
                aria-label="Checklist item"
              />
              <button className="checklist-del" title="Delete item" aria-label={`Delete ${i.text || 'item'}`} onClick={() => remove(i.id)} data-testid="checklist-del"><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="checklist-add">
        <Plus size={14} />
        <input ref={addRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="Add an item and press Enter" aria-label="New checklist item" data-testid="checklist-new" />
        {draft.trim() && <button className="checklist-add-btn" onClick={add}>Add</button>}
      </div>
    </div>
  );
}
