import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import CatMascot from './CatMascot';
import DeadlineBubble from './DeadlineBubble';
import { useWindowDrag } from '../hooks/useWindowDrag';

/**
 * The tucked-away state: only Miso's head, floating on the desktop.
 *  - drag the head anywhere; click it to open Threadkeeper
 *  - right-click it to pet it (and hear how your deadlines look)
 *  - when deadlines are close the cat perks up and a badge counts them; the speech bubble with the list only pops
 *    out when a reminder fires (`alertsOpen`) or when you rest the pointer on the head, so the rest of the time the
 *    app really is just the head
 * The cluster reports its own size so the window can wrap it exactly (head + bubble).
 */
export default function TabCluster({ dock, alerts, alertsOpen = false, message, onOpen, onPet, onDismissAlerts, onDismissMessage, onDone, onOpenChecklist }) {
  const clusterRef = useRef(null);
  const columnRef = useRef(null);
  const [awake, setAwake] = useState(true);
  const [petting, setPetting] = useState(false);
  const [hover, setHover] = useState(false);
  const [peek, setPeek] = useState(false);
  const wakeTimer = useRef(null);
  const petTimer = useRef(null);
  const peekTimer = useRef(null);

  const hasAlerts = alerts.length > 0;
  const showAlerts = hasAlerts && (alertsOpen || peek);
  const bubbleVisible = showAlerts || Boolean(message);
  const startPeek = () => { clearTimeout(peekTimer.current); if (hasAlerts && !document.body.classList.contains('is-dragging')) peekTimer.current = setTimeout(() => setPeek(true), 650); };
  const stopPeek = () => { clearTimeout(peekTimer.current); peekTimer.current = setTimeout(() => setPeek(false), 900); };
  useEffect(() => () => clearTimeout(peekTimer.current), []);
  const bubbleSide = dock === 'right' ? 'left' : 'right';

  const wake = () => {
    setAwake(true);
    clearTimeout(wakeTimer.current);
    wakeTimer.current = setTimeout(() => setAwake(false), 25000);
  };
  useEffect(() => { wake(); return () => { clearTimeout(wakeTimer.current); clearTimeout(petTimer.current); }; }, []);

  const pet = () => {
    wake();
    setPetting(true);
    clearTimeout(petTimer.current);
    petTimer.current = setTimeout(() => setPetting(false), 1600);
    onPet?.();
  };

  const headDrag = useWindowDrag({ onClick: onOpen });

  // Tell the main process how big the head (+ bubble) is so the window wraps it exactly.
  useLayoutEffect(() => {
    const el = clusterRef.current;
    if (!el) return undefined;
    const report = () => {
      const r = el.getBoundingClientRect();
      const c = columnRef.current?.getBoundingClientRect();
      window.threadkeeper?.setTabLayout?.({
        width: Math.ceil(r.width), height: Math.ceil(r.height),
        tabWidth: Math.ceil(c?.width || r.width), tabHeight: Math.ceil(c?.height || r.height),
      });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dock]);

  const mood = hasAlerts ? 'alert' : (petting || hover) ? 'love' : awake ? 'happy' : 'sleepy';
  const bubble = bubbleVisible && (
    <DeadlineBubble
      alerts={showAlerts ? alerts : []}
      message={message}
      side={bubbleSide}
      onDismiss={showAlerts ? () => { setPeek(false); onDismissAlerts(); } : onDismissMessage}
      onOpen={onOpenChecklist}
      onDone={onDone}
    />
  );

  return (
    <div className={`tab-root dock-${dock}`} onPointerEnter={wake}>
      <div className="tab-cluster" ref={clusterRef} onPointerEnter={() => { if (peek) clearTimeout(peekTimer.current); }} onPointerLeave={stopPeek}>
        {dock === 'right' && bubble}
        <div className="tab-column" ref={columnRef}>
          <div
            className={`tab-cat ${hasAlerts ? 'is-hopping' : ''}`}
            {...headDrag}
            onPointerEnter={() => { setHover(true); startPeek(); }}
            onPointerLeave={() => { setHover(false); }}
            onPointerDownCapture={() => clearTimeout(peekTimer.current)}
            onContextMenu={(e) => { e.preventDefault(); pet(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
            role="button"
            tabIndex={0}
            aria-label={hasAlerts ? `Open Threadkeeper. ${alerts.length} deadline${alerts.length === 1 ? '' : 's'} need you.` : 'Open Threadkeeper'}
            title={hasAlerts ? 'Click to open · drag to move · rest here to see deadlines' : 'Click to open · drag to move · right-click to pet'}
          >
            <CatMascot variant="face" size={66} mood={mood} />
            {hasAlerts && <span className="tab-badge" aria-hidden="true">{alerts.length}</span>}
          </div>
        </div>
        {dock === 'left' && bubble}
      </div>
    </div>
  );
}
