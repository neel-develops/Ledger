import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../lib/cn';

/**
 * Chillar — the assistant, drawn as a thick glossy coin with a face.
 *
 * "Chillar" is Hindi for loose change. The depth is faked with layers rather
 * than a 3D engine: a darker rim offset below the face reads as the coin's
 * edge, a radial highlight gives it gloss, and a soft ground shadow sits it on
 * the page. It costs a few hundred bytes of SVG instead of a WebGL context.
 *
 * Motion is decorative, so it is gentle, and it stops completely under
 * prefers-reduced-motion (the global rule in index.css handles that).
 */

export type MascotMood = 'idle' | 'thinking' | 'happy' | 'sad';

export interface MascotProps {
  size?: number;
  mood?: MascotMood;
  /** Eyes follow the pointer. For the large mascot only — it listens to the window. */
  trackPointer?: boolean;
  className?: string;
  /** For screen readers; decorative by default. */
  label?: string;
}

export function Mascot({ size = 96, mood = 'idle', trackPointer = false, className, label }: MascotProps) {
  const id = useId().replace(/:/g, '');
  const root = useRef<SVGSVGElement>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!trackPointer || mood !== 'idle') {
      setLook({ x: 0, y: 0 });
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = root.current?.getBoundingClientRect();
        if (!box) return;
        const dx = event.clientX - (box.left + box.width / 2);
        const dy = event.clientY - (box.top + box.height / 2);
        const distance = Math.hypot(dx, dy) || 1;
        // Pupils travel at most ~3 units inside the eye, easing off with distance.
        const reach = Math.min(1, distance / 240) * 3;
        setLook({ x: (dx / distance) * reach, y: (dy / distance) * reach });
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
    };
  }, [trackPointer, mood]);

  // Thinking looks up and away, the way people do when working something out.
  const pupil = mood === 'thinking' ? { x: 2.4, y: -2.6 } : look;

  return (
    <svg
      ref={root}
      viewBox="0 0 120 124"
      width={size}
      height={size * (124 / 120)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('mascot select-none', `mascot-${mood}`, className)}
    >
      <defs>
        <linearGradient id={`${id}-face`} x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#a3a1ff" />
          <stop offset="0.55" stopColor="#6f6cf0" />
          <stop offset="1" stopColor="#4d4acb" />
        </linearGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f3cb0" />
          <stop offset="1" stopColor="#2b2987" />
        </linearGradient>
        <radialGradient id={`${id}-gloss`} cx="0.32" cy="0.26" r="0.55">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.75" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-antenna`} cx="0.35" cy="0.3" r="0.7">
          <stop offset="0" stopColor="#ffe9a8" />
          <stop offset="0.6" stopColor="#f5c24b" />
          <stop offset="1" stopColor="#d59a1c" />
        </radialGradient>
      </defs>

      {/* Ground shadow: shrinks as the coin floats up, so it reads as height. */}
      <ellipse className="mascot-shadow" cx="60" cy="116" rx="30" ry="5" fill="currentColor" opacity="0.14" />

      <g className="mascot-body">
        {/* Antenna, topped with a little gold coin. */}
        <g className="mascot-antenna">
          <path d="M60 22 C60 16 62 12 65 9" stroke="#4d4acb" strokeWidth="3" strokeLinecap="round" fill="none" />
          <g className="mascot-coin">
            <circle cx="66" cy="8" r="6" fill={`url(#${id}-antenna)`} />
            <text x="66" y="10.8" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#a8740c">
              ₹
            </text>
          </g>
        </g>

        {/* The coin's edge, then its face on top, offset up: that gap is the thickness. */}
        <ellipse cx="60" cy="68" rx="44" ry="42" fill={`url(#${id}-rim)`} />
        <ellipse cx="60" cy="62" rx="44" ry="41" fill={`url(#${id}-face)`} />
        <ellipse cx="60" cy="62" rx="37.5" ry="35" fill="none" stroke="#ffffff" strokeOpacity="0.18" strokeWidth="1.5" />
        <ellipse cx="60" cy="62" rx="44" ry="41" fill={`url(#${id}-gloss)`} />

        {/* Cheeks */}
        <ellipse cx="34" cy="74" rx="6.5" ry="4" fill="#ff8fb3" opacity={mood === 'sad' ? 0.18 : 0.42} />
        <ellipse cx="86" cy="74" rx="6.5" ry="4" fill="#ff8fb3" opacity={mood === 'sad' ? 0.18 : 0.42} />

        <Eyes mood={mood} pupil={pupil} />
        <Mouth mood={mood} />
      </g>

      {mood === 'thinking' && (
        <g className="mascot-dots" fill="#8583f0">
          <circle cx="98" cy="30" r="3" />
          <circle cx="107" cy="21" r="2.3" />
          <circle cx="113" cy="13" r="1.6" />
        </g>
      )}
    </svg>
  );
}

function Eyes({ mood, pupil }: { mood: MascotMood; pupil: { x: number; y: number } }) {
  if (mood === 'happy') {
    // Content, squinting arcs: "^ ^".
    return (
      <g stroke="#1f1d5c" strokeWidth="4" strokeLinecap="round" fill="none">
        <path d="M38 58 Q45 49 52 58" />
        <path d="M68 58 Q75 49 82 58" />
      </g>
    );
  }

  const droop = mood === 'sad';

  return (
    <g className="mascot-eyes">
      {[45, 75].map((cx) => (
        <g key={cx}>
          <ellipse cx={cx} cy="57" rx="9" ry={droop ? 9 : 11} fill="#ffffff" />
          <g
            style={{
              transform: `translate(${pupil.x}px, ${pupil.y}px)`,
              transition: 'transform 140ms cubic-bezier(0.23, 1, 0.32, 1)',
            }}
          >
            <circle cx={cx + 1} cy={droop ? 60 : 58} r="5.4" fill="#1f1d5c" />
            <circle cx={cx + 2.8} cy={droop ? 57.6 : 55.4} r="1.9" fill="#ffffff" />
          </g>
          {droop && (
            // Heavy lids for a sad face.
            <path
              d={`M${cx - 10} ${cx < 60 ? 53 : 50} L${cx + 10} ${cx < 60 ? 50 : 53}`}
              stroke="#4d4acb"
              strokeWidth="5"
              strokeLinecap="round"
            />
          )}
        </g>
      ))}
    </g>
  );
}

function Mouth({ mood }: { mood: MascotMood }) {
  switch (mood) {
    case 'happy':
      return (
        <g>
          <path d="M47 76 Q60 92 73 76 Z" fill="#1f1d5c" />
          <path d="M53 84 Q60 89 67 84" fill="#ff7aa2" />
        </g>
      );
    case 'thinking':
      return <ellipse cx="62" cy="80" rx="3.6" ry="3" fill="#1f1d5c" />;
    case 'sad':
      return <path d="M50 84 Q60 76 70 84" stroke="#1f1d5c" strokeWidth="3.4" strokeLinecap="round" fill="none" />;
    default:
      return <path d="M50 77 Q60 86 70 77" stroke="#1f1d5c" strokeWidth="3.4" strokeLinecap="round" fill="none" />;
  }
}
