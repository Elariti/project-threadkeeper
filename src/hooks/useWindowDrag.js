import { useEffect, useRef } from 'react';

const INTERACTIVE = 'button, a, input, textarea, select, label, audio, video, [data-no-drag]';

/**
 * Pointer handlers that move the whole Electron window (the cat head, or the open panel via its header).
 * A press that never travels `threshold` px counts as a click, so the same element can both open the app and be
 * dragged anywhere on the desktop.
 *
 * The main process moves the window; the page only reports where the window was grabbed and when the drag ends.
 * The end is detected robustly: on Windows a window that moves under the pointer can lose pointer capture (which
 * used to end the drag after a few pixels, so the cat seemed to jump back). While dragging, losing capture is
 * ignored; the drag ends on the button being released anywhere (pointerup / mouseup on the window, or any pointer
 * event reporting that no button is held).
 *
 * Spread the result onto the element. Presses on buttons/inputs inside it are ignored so header controls keep working.
 */
export function useWindowDrag({ onClick, threshold = 4 } = {}) {
  const drag = useRef(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;
  const bridge = () => window.threadkeeper;

  const detach = () => {
    const s = drag.current;
    if (s?.listeners) for (const [type, fn] of s.listeners) window.removeEventListener(type, fn, true);
  };
  const end = (e, { cancelled = false } = {}) => {
    const s = drag.current;
    if (!s) return;
    detach();
    drag.current = null;
    try { s.el?.releasePointerCapture?.(s.id); } catch { /* already released */ }
    if (s.dragging) {
      bridge()?.dragEnd?.();
      document.body.classList.remove('is-dragging');
    } else if (!cancelled && e) {
      clickRef.current?.(e);
    }
  };
  const begin = (s, dx, dy) => {
    s.dragging = true;
    bridge()?.dragStart?.({ dx, dy, ox: s.ox, oy: s.oy });
    document.body.classList.add('is-dragging');
  };
  const move = (e) => {
    const s = drag.current;
    if (!s) return;
    if (e.buttons === 0 && e.type !== 'pointerdown') { end(e, { cancelled: !s.dragging }); return; } // released somewhere we did not hear about
    if (s.dragging) return; // the main process follows the cursor
    const dx = e.screenX - s.sx;
    const dy = e.screenY - s.sy;
    if (Math.hypot(dx, dy) >= threshold) begin(s, dx, dy);
  };

  useEffect(() => () => { // unmounting mid-drag (e.g. the tab turns into the panel): finish cleanly
    const s = drag.current;
    if (s) { detach(); drag.current = null; if (s.dragging) { bridge()?.dragEnd?.(); document.body.classList.remove('is-dragging'); } }
  }, []);

  return {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      const inner = e.target.closest?.(INTERACTIVE);
      if (inner && inner !== e.currentTarget) return;
      if (drag.current) end(null, { cancelled: true });
      const el = e.currentTarget;
      // clientX/Y is where inside the window the pointer went down: the main process keeps that point under the cursor.
      const s = { id: e.pointerId, el, sx: e.screenX, sy: e.screenY, ox: e.clientX, oy: e.clientY, dragging: false };
      const onUp = (ev) => end(ev);
      const onKey = (ev) => { if (ev.key === 'Escape') end(null, { cancelled: true }); };
      s.listeners = [['pointerup', onUp], ['mouseup', onUp], ['pointermove', move], ['mousemove', move], ['keydown', onKey]];
      for (const [type, fn] of s.listeners) window.addEventListener(type, fn, true);
      drag.current = s;
      try { el.setPointerCapture?.(e.pointerId); } catch { /* not supported */ }
    },
    onPointerMove: move,
    onPointerUp: (e) => end(e),
    // Losing capture or a cancel only matters before the drag starts (then it is not a click either).
    onPointerCancel: () => { if (drag.current && !drag.current.dragging) end(null, { cancelled: true }); },
    onLostPointerCapture: () => { if (drag.current && !drag.current.dragging) end(null, { cancelled: true }); },
    onDragStart: (e) => e.preventDefault(), // never start a native drag-and-drop of the picture
  };
}
