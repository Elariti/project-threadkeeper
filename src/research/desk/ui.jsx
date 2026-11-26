import React, { useEffect } from 'react';
import { CircleHelp, Quote, Sparkles, SquareSplitHorizontal, UserCheck, X } from 'lucide-react';
import { CONFIDENCE_LABEL, ITEM_TYPES, ORIGIN_LABEL, PROVENANCE, RELATIONS } from '../model.js';

/** Escape closes the topmost dialog and nothing else (it must not tuck the whole window away). */
export function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
}

export function Modal({ title, eyebrow, onClose, children, size = 'md', className = '', footer }) {
  useEscape(onClose);
  return (
    <div className="modal-backdrop rd-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`rd-modal size-${size} ${className}`} role="dialog" aria-label={title}>
        <div className="rd-modal-head">
          <div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2></div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="rd-modal-body">{children}</div>
        {footer && <div className="rd-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export const TypeBadge = ({ type }) => <span className={`rd-type tone-${ITEM_TYPES[type]?.tone || 'butter'}`}>{ITEM_TYPES[type]?.label || type}</span>;

const PROV_ICON = { 'source-stated': Quote, 'partly-sourced': SquareSplitHorizontal, 'ai-interpretation': Sparkles, 'user-confirmed': UserCheck, unverified: CircleHelp };
export function ProvenanceBadge({ value, compact = false }) {
  const Icon = PROV_ICON[value] || CircleHelp;
  const p = PROVENANCE[value] || { label: value, hint: '' };
  if (compact) return <span className={`rd-prov is-compact prov-${value}`} title={`${p.label}. ${p.hint}`} aria-label={p.label}><Icon size={10} /></span>;
  return <span className={`rd-prov prov-${value}`} title={p.hint}><Icon size={11} />{p.label}</span>;
}

export const RelationChip = ({ relationship, proposed }) => {
  const rel = RELATIONS[relationship] || RELATIONS.related_to;
  return <span className={`rd-rel ${proposed ? 'is-proposed' : ''}`} style={{ '--rel': rel.color }}>{rel.label}{proposed ? '?' : ''}</span>;
};

export const StatusPill = ({ status }) => {
  const map = { suggested: ['Proposed', 'proposed'], confirmed: ['Stitched', 'confirmed'], rejected: ['Dismissed', 'rejected'] };
  const [label, cls] = map[status] || [status, ''];
  return <span className={`rd-status ${cls}`}><i />{label}</span>;
};

export const OriginChip = ({ origin }) => <span className="rd-chip subtle">{ORIGIN_LABEL[origin] || origin}</span>;
export const ConfidenceChip = ({ value }) => (value ? <span className={`rd-chip conf-${value}`}>{CONFIDENCE_LABEL[value] || value}</span> : null);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Find where a quote sits in page text (exact first, then tolerant of whitespace, hyphen breaks and curly quotes). */
export function findRange(text, quote) {
  if (!text || !quote) return null;
  let i = text.indexOf(quote);
  if (i >= 0) return [i, i + quote.length];
  i = text.toLowerCase().indexOf(quote.toLowerCase());
  if (i >= 0) return [i, i + quote.length];
  try {
    const words = quote.replace(/[“”"‘’']/g, ' ').split(/\s+/).filter(Boolean).map(esc);
    if (words.length < 2) return null;
    const m = new RegExp(words.join('[\\s\\u00ad\\-"“”‘’\']+'), 'i').exec(text);
    return m ? [m.index, m.index + m[0].length] : null;
  } catch { return null; }
}

export function Highlighted({ text, quote }) {
  const range = findRange(text, quote);
  if (!range) return <>{text}</>;
  return <>{text.slice(0, range[0])}<mark className="rd-mark" data-testid="quote-mark">{text.slice(range[0], range[1])}</mark>{text.slice(range[1])}</>;
}

export const Empty = ({ icon: Icon, title, children, action }) => (
  <div className="rd-empty">{Icon && <Icon size={26} />}<strong>{title}</strong>{children && <p>{children}</p>}{action}</div>
);
