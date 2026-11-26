import React, { useEffect, useRef, useState } from 'react';
import CatMascot from './CatMascot';

const LINES = ['Hi!', 'Need a note?', 'Purr…', 'I kept your thread.', 'Tiny steps count.', 'Snack break?'];

/** Miso sitting at the bottom of the panel. Says hi when you open the app; click to pet. */
export default function PocketCat() {
  const [say, setSay] = useState('Hi!');
  const [open, setOpen] = useState(true);
  const [love, setLove] = useState(false);
  const idx = useRef(0);
  const hideTimer = useRef(null);
  const loveTimer = useRef(null);

  const showFor = (ms) => { clearTimeout(hideTimer.current); hideTimer.current = setTimeout(() => setOpen(false), ms); };
  useEffect(() => { showFor(4200); return () => { clearTimeout(hideTimer.current); clearTimeout(loveTimer.current); }; }, []);

  const pet = () => {
    idx.current = (idx.current + 1) % LINES.length;
    setSay(LINES[idx.current]);
    setOpen(true);
    setLove(true);
    showFor(3200);
    clearTimeout(loveTimer.current);
    loveTimer.current = setTimeout(() => setLove(false), 1700);
  };

  return (
    <div className="pocket-cat">
      {open && <div className="hi-bubble" key={say}>{say}</div>}
      <button className="pocket-cat-btn" onClick={pet} aria-label="Pet the cat" title="Pet Miso">
        <CatMascot size={86} mood={love ? 'love' : 'happy'} wave={!love} />
      </button>
    </div>
  );
}
