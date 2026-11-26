import React, { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import CatMascot from './CatMascot';
import { NOTE_TYPES } from '../lib/noteTypes';

/**
 * The one general "New note" chooser. Pick what kind of note you want, press Create.
 * Opened from every "+" in the app and with Ctrl/Cmd+N, as often as you like.
 */
export default function NewNoteModal({ defaultType = 'text', onClose, onCreate }) {
  const [type, setType] = useState(defaultType);
  const [remindAt, setRemindAt] = useState('');
  const chosen = NOTE_TYPES.find((t) => t.id === type);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const submit = () => onCreate({ type, remindAt: type === 'reminder' && remindAt ? remindAt : null });

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal new-note-modal" role="dialog" aria-label="New note">
        <div className="modal-head">
          <div className="new-note-title">
            <CatMascot variant="face" size={40} mood="happy" />
            <div><div className="eyebrow">MAKE A LITTLE MEMORY</div><h2>New note</h2></div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <p className="modal-sub">Choose the kind of note you want. Make as many as you like, of any type.</p>
        <div className="type-list" role="radiogroup" aria-label="Note type">
          {NOTE_TYPES.map(({ id, label, hint, Icon, tone }) => (
            <button
              key={id}
              role="radio"
              aria-checked={type === id}
              className={`type-option ${type === id ? 'is-chosen' : ''}`}
              onClick={() => setType(id)}
              onDoubleClick={() => { setType(id); onCreate({ type: id, remindAt: null }); }}
            >
              <span className={`type-tile tone-${tone}`}><Icon size={17} /></span>
              <span className="type-text"><strong>{label}</strong><small>{hint}</small></span>
              <span className="type-check">{type === id && <Check size={14} />}</span>
            </button>
          ))}
        </div>
        {type === 'reminder' && (
          <label className="reminder-field">Remind me at <span className="optional">(optional)</span>
            <input type="datetime-local" value={remindAt} onChange={(e) => setRemindAt(e.target.value)} />
          </label>
        )}
        {['image', 'voice', 'video'].includes(type) && (
          <p className="modal-hint">
            {type === 'image' ? 'Nothing is saved until you review the capture and press Save note.' : 'Recording starts only after you press Start. You review it before it is saved.'}
          </p>
        )}
        <div className="form-actions">
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" onClick={submit} autoFocus>
            {['image', 'voice', 'video'].includes(type) ? `Continue to ${chosen.label.toLowerCase()}` : `Create ${chosen.label.toLowerCase()}`} <Check size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
