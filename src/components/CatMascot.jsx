import React from 'react';

// "Miso", the Threadkeeper cat. An original character: a round cream cat with a leaf
// sprout, a mint scarf and a ball of lavender yarn.
//
// variant: 'sit'  – whole cat sitting (panel corner, recorder)
//          'peek' – head + paws, made to rest on a ledge (top bar)
//          'face' – head only (the draggable tab)
// mood:    'happy' | 'sleepy' | 'alert' | 'love'
const OUT = '#a0805f';
const CREAM = '#fff8ea';
const PINK = '#f4c3bb';
const EYE = '#5a4638';
const BOXES = { sit: [0, 0, 120, 120], peek: [0, 0, 120, 88], face: [12, 0, 96, 86] };

function Eyes({ mood }) {
  if (mood === 'sleepy') {
    return (
      <g fill="none" stroke={EYE} strokeWidth="2.4" strokeLinecap="round">
        <path d="M40.5 55 Q46 59.5 51.5 55" />
        <path d="M68.5 55 Q74 59.5 79.5 55" />
      </g>
    );
  }
  if (mood === 'love') {
    const heart = 'M0 5 C-7 -1 -4.5 -6.5 -1.4 -6.5 C-0.4 -6.5 0 -5.6 0 -5 C0 -5.6 0.4 -6.5 1.4 -6.5 C4.5 -6.5 7 -1 0 5Z';
    return (
      <g fill="#e07a7a">
        <path d={heart} transform="translate(46 54)" />
        <path d={heart} transform="translate(74 54)" />
      </g>
    );
  }
  const big = mood === 'alert';
  const rx = big ? 4.3 : 3.6;
  const ry = big ? 5.6 : 4.7;
  return (
    <g className="cat-eyes">
      <ellipse cx="46" cy="54" rx={rx} ry={ry} fill={EYE} />
      <ellipse cx="74" cy="54" rx={rx} ry={ry} fill={EYE} />
      <circle cx="47.3" cy="52.2" r="1.45" fill="#fff" />
      <circle cx="75.3" cy="52.2" r="1.45" fill="#fff" />
    </g>
  );
}

export default function CatMascot({
  size = 64, variant = 'sit', mood = 'happy', wave = false, yarn = true, animated = true, className = '', title = 'Miso, the Threadkeeper cat',
}) {
  const [x, y, w, h] = BOXES[variant] || BOXES.sit;
  const full = variant === 'sit';
  const mouth = mood === 'alert'
    ? <ellipse cx="60" cy="66.5" rx="2.4" ry="2.9" fill="#c97f80" stroke="#8a6a55" strokeWidth="1.2" />
    : <path d="M60 62.5 Q60 66.5 55.4 66.2 M60 62.5 Q60 66.5 64.6 66.2" fill="none" stroke="#8a6a55" strokeWidth="1.7" strokeLinecap="round" />;

  return (
    <svg
      className={`cat-mascot ${animated ? 'is-animated' : ''} mood-${mood} ${className}`}
      width={size}
      height={(size * h) / w}
      viewBox={`${x} ${y} ${w} ${h}`}
      role="img"
      aria-label={title}
    >
      {full && <ellipse cx="60" cy="113" rx="32" ry="5" fill="#9f8465" opacity=".13" />}

      {full && (
        <g className="cat-tail">
          <path d="M84 101 Q113 102 108 77 Q106 66 97 70" fill="none" stroke={OUT} strokeWidth="11.5" strokeLinecap="round" />
          <path d="M84 101 Q113 102 108 77 Q106 66 97 70" fill="none" stroke={CREAM} strokeWidth="7.6" strokeLinecap="round" />
        </g>
      )}

      {full && (
        <g>
          <ellipse cx="60" cy="91" rx="29" ry="23" fill={CREAM} stroke={OUT} strokeWidth="2.4" />
          <ellipse cx="60" cy="96" rx="15" ry="12" fill="#fffdf6" />
        </g>
      )}

      {/* ears */}
      <g className="cat-ear-l">
        <path d="M28 46 L30 15 Q31 10.5 35.5 13 L53 27 Z" fill={CREAM} stroke={OUT} strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M33.5 37 L34.5 22.5 L46 30 Z" fill={PINK} />
      </g>
      <g className="cat-ear-r">
        <path d="M92 46 L90 15 Q89 10.5 84.5 13 L67 27 Z" fill={CREAM} stroke={OUT} strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M86.5 37 L85.5 22.5 L74 30 Z" fill={PINK} />
      </g>

      {/* head */}
      <ellipse cx="60" cy="53" rx="35" ry="29" fill={CREAM} stroke={OUT} strokeWidth="2.4" />

      {/* sprout */}
      <g className="cat-sprout">
        <path d="M60 25 Q60.5 19 60 14.5" fill="none" stroke="#709b7c" strokeWidth="2" strokeLinecap="round" />
        <path d="M60 16 Q51.5 8.5 46 14.5 Q52.5 21 60 16Z" fill="#a4d9b8" stroke="#709b7c" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M60 16 Q68.5 6.5 74.5 12.5 Q68 20 60 16Z" fill="#b9e6c8" stroke="#709b7c" strokeWidth="1.6" strokeLinejoin="round" />
      </g>

      <Eyes mood={mood} />
      <ellipse cx="35.5" cy="63" rx="6.2" ry="3.6" fill="#f6b3a4" opacity=".7" />
      <ellipse cx="84.5" cy="63" rx="6.2" ry="3.6" fill="#f6b3a4" opacity=".7" />
      <path d="M57.4 59.4 Q60 58 62.6 59.4 Q60 63.2 57.4 59.4Z" fill="#d9877f" />
      {mouth}
      <g stroke="#cdb89c" strokeWidth="1.2" strokeLinecap="round" opacity=".85">
        <path d="M27 58 L18 56" /><path d="M27 62 L18 63" />
        <path d="M93 58 L102 56" /><path d="M93 62 L102 63" />
      </g>

      {/* scarf + paws */}
      {full && (
        <g>
          <path d="M36 77 Q60 90 84 77 L82.5 85.5 Q60 98 37.5 85.5 Z" fill="#a4d9b8" stroke="#709b7c" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M70 87 L76 87.5 L74 99 L68.5 97.5Z" fill="#b9e6c8" stroke="#709b7c" strokeWidth="1.4" strokeLinejoin="round" />
          <g fill={CREAM} stroke={OUT} strokeWidth="2.2">
            <ellipse cx="46" cy="107" rx="9" ry="6.2" />
            {!wave && <ellipse cx="74" cy="107" rx="9" ry="6.2" />}
          </g>
          {wave && (
            <g className="cat-wave">
              <ellipse cx="94" cy="72" rx="7.4" ry="10.5" fill={CREAM} stroke={OUT} strokeWidth="2.2" transform="rotate(14 94 72)" />
              <path d="M91.5 66 L92.5 70 M96 66.5 L96.5 70.5" stroke={OUT} strokeWidth="1.2" strokeLinecap="round" />
            </g>
          )}
        </g>
      )}
      {full && yarn && (
        <g>
          <path d="M31 109 Q38 114 54 111" fill="none" stroke="#8f7ccc" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="24" cy="105" r="10.5" fill="#cdbdf2" stroke="#8f7ccc" strokeWidth="2" />
          <path d="M16.5 101 Q24 97 31 103 M15.5 106.5 Q24 101 32.5 108 M19 112.5 Q26 107 31 112" fill="none" stroke="#8f7ccc" strokeWidth="1.3" strokeLinecap="round" />
        </g>
      )}
      {variant === 'peek' && (
        <g fill={CREAM} stroke={OUT} strokeWidth="2.2">
          <ellipse cx="38" cy="82" rx="11" ry="7" />
          <ellipse cx="82" cy="82" rx="11" ry="7" />
          <path d="M34 79.5 L34 84 M39 79 L39 84.5 M43 80 L43 84.5 M78 80 L78 84.5 M82 79 L82 84.5 M87 79.5 L87 84" fill="none" strokeWidth="1.2" strokeLinecap="round" />
        </g>
      )}

      {mood === 'alert' && (
        <g className="cat-bang">
          <circle cx={variant === "peek" ? 94 : 98} cy="19" r="9" fill="#f9d2c8" stroke={OUT} strokeWidth="1.7" />
          <text x={variant === "peek" ? 94 : 98} y="24.2" textAnchor="middle" fontSize="14" fontWeight="800" fill="#8a4a3c" fontFamily="Manrope, sans-serif">!</text>
        </g>
      )}
      {mood === 'sleepy' && (
        <g className="cat-zzz" fill="#a58bd4" fontFamily="Manrope, sans-serif" fontWeight="800">
          <text x="92" y="22" fontSize="14">z</text>
          <text x="101" y="12" fontSize="10">z</text>
        </g>
      )}
      {mood === 'love' && (
        <g className="cat-hearts" fill="#e8858a">
          <text x="14" y="30" fontSize="12">♥</text>
          <text x="98" y="26" fontSize="10">♥</text>
          <text x="60" y="8" fontSize="9">♥</text>
        </g>
      )}
    </svg>
  );
}
