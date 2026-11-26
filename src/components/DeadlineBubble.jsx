import React from 'react';
import { Check, X } from 'lucide-react';
import { describeDue } from '../lib/deadlines';

/**
 * The cat's speech bubble. Two flavours:
 *  - alerts:  deadlines that need attention. Stays until the user dismisses it.
 *  - message: a short chat from the cat (greeting / "all caught up"); fades on its own.
 * `side` is where the bubble sits relative to the tab, so the tail points back at the cat.
 */
export default function DeadlineBubble({ alerts = [], message = '', side = 'left', onDismiss, onOpen, onDone }) {
  const isAlert = alerts.length > 0;
  const shown = alerts.slice(0, 3);
  const extra = alerts.length - shown.length;
  return (
    <div className={`cat-bubble side-${side} ${isAlert ? 'is-alert' : 'is-message'}`} role={isAlert ? 'alert' : 'status'} aria-live="polite" data-no-drag>
      <button className="bubble-x" aria-label={isAlert ? 'Dismiss deadline reminder' : 'Close'} title="Dismiss" onClick={onDismiss}><X size={13} /></button>
      {isAlert ? (
        <>
          <div className="bubble-title">{alerts.every((a) => a.bucket === 'overdue') ? (alerts.length === 1 ? 'This one is overdue' : `${alerts.length} reminders are overdue`) : alerts.length === 1 ? 'Psst, coming up in a few minutes' : `Psst, ${alerts.length} reminders need you`}</div>
          <ul className="bubble-list">
            {shown.map(({ task, bucket }) => (
              <li key={task.id} className={`bubble-item bucket-${bucket}`}>
                <span className="bubble-dot" />
                <button className="bubble-item-main" onClick={() => onOpen?.(task.id)} title="Open this reminder">
                  <strong>{task.title}</strong>
                  <small>{describeDue(task, bucket)}</small>
                </button>
                <button className="bubble-done" aria-label={`Mark "${task.title}" done`} title="Mark done" onClick={() => onDone?.(task.id)}><Check size={13} /></button>
              </li>
            ))}
          </ul>
          {extra > 0 && <div className="bubble-more">+{extra} more</div>}
          <div className="bubble-actions">
            <button className="bubble-btn" onClick={() => onOpen?.(alerts[0]?.task.id)}>Open</button>
            <button className="bubble-btn primary" onClick={onDismiss}>Dismiss</button>
          </div>
        </>
      ) : (
        <div className="bubble-message">{message}</div>
      )}
      <span className="bubble-tail" />
    </div>
  );
}
