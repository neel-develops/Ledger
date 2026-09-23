import { useEffect, useMemo, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeftRight, PiggyBank } from 'lucide-react';
import { formatPaise } from '@shared/money';
import { useCelebration, type Celebration, type Scene } from '../lib/celebrate';
import { usePrefs } from '../store/prefs';
import { Mascot, type MascotMood } from './Mascot';

/**
 * Chillar's reaction to whatever was just recorded — see lib/celebrate for the
 * scenes. It never blocks: the layer ignores taps, plays for a couple of
 * seconds and fades out on its own. People who ask their phone for reduced
 * motion get none of it; the save toast still tells them it worked.
 */

const DURATION_MS = 2600;

const HUES: Record<Scene, string> = {
  rain: '#34d399',
  flyaway: '#ff5d73',
  toss: '#ffb547',
  owe: '#ff7ad9',
  cleared: '#2fd3e0',
  saved: '#b06bff',
  hop: '#5b8cff',
};

const CONFETTI = ['#ff5d73', '#ffb547', '#34d399', '#2fd3e0', '#5b8cff', '#b06bff', '#ff7ad9', '#fff1b8'];

export function CelebrationLayer() {
  const current = useCelebration((s) => s.current);
  const clear = useCelebration((s) => s.clear);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => clear(current.id), DURATION_MS);
    return () => clearTimeout(timer);
  }, [current, clear]);

  if (!current) return null;
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;

  // Keyed by id, so a second save mid-animation restarts cleanly.
  return createPortal(<Stage key={current.id} celebration={current} />, document.body);
}

/* ------------------------------------------------------------------ *
 * Particles
 * ------------------------------------------------------------------ */

/** A deterministic scatter per celebration, so a re-render never reshuffles it. */
function scatter(seed: number) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function Coin({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden>
      <defs>
        <radialGradient id="cel-gold" cx="0.35" cy="0.3" r="0.75">
          <stop offset="0" stopColor="#fff1b8" />
          <stop offset="0.55" stopColor="#f7c443" />
          <stop offset="1" stopColor="#cf8e12" />
        </radialGradient>
      </defs>
      <ellipse cx="20" cy="22" rx="18" ry="17" fill="#a86a06" />
      <ellipse cx="20" cy="19.5" rx="18" ry="17" fill="url(#cel-gold)" />
      <ellipse cx="20" cy="19.5" rx="13" ry="12" fill="none" stroke="#fff4c7" strokeOpacity="0.65" strokeWidth="1.4" />
      <text x="20" y="26" textAnchor="middle" fontSize="18" fontWeight="800" fill="#9a6206">
        ₹
      </text>
    </svg>
  );
}

const vars = (v: Record<string, string | number>) => v as CSSProperties;

function FallingCoins({ seed, count, from = 'top' }: { seed: number; count: number; from?: 'top' | 'center' }) {
  const coins = useMemo(() => {
    const r = scatter(seed);
    return Array.from({ length: count }, () => ({
      left: from === 'top' ? r() * 100 : 38 + r() * 24,
      size: 18 + r() * 20,
      delay: r() * 700,
      dur: 1200 + r() * 900,
      drift: (r() - 0.5) * 80,
      rot: (r() - 0.5) * 900,
    }));
  }, [seed, count, from]);

  return (
    <>
      {coins.map((c, i) => (
        <span
          key={i}
          className="cel-fall absolute top-0"
          style={vars({
            left: `${c.left}%`,
            '--delay': `${c.delay}ms`,
            '--dur': `${c.dur}ms`,
            '--drift': `${c.drift}px`,
            '--rot': `${c.rot}deg`,
          })}
        >
          <Coin size={c.size} />
        </span>
      ))}
    </>
  );
}

function FlyingCoins({ seed, count }: { seed: number; count: number }) {
  const coins = useMemo(() => {
    const r = scatter(seed);
    return Array.from({ length: count }, () => ({
      dx: 25 + r() * 60,
      dy: -(55 + r() * 45),
      delay: 450 + r() * 500,
      dur: 900 + r() * 500,
      rot: (r() - 0.5) * 720,
      size: 16 + r() * 16,
    }));
  }, [seed, count]);

  return (
    <>
      {coins.map((c, i) => (
        <span
          key={i}
          className="cel-away absolute"
          style={vars({
            '--dx': `${c.dx}vw`,
            '--dy': `${c.dy}vh`,
            '--delay': `${c.delay}ms`,
            '--dur': `${c.dur}ms`,
            '--rot': `${c.rot}deg`,
          })}
        >
          <Coin size={c.size} />
        </span>
      ))}
    </>
  );
}

/** Coins thrown in an arc: an outer layer moves across, an inner one rises and falls. */
function ArcingCoins({
  seed,
  count,
  distance,
  land = 0,
  fadeAtEnd = true,
}: {
  seed: number;
  count: number;
  distance: string;
  land?: number;
  fadeAtEnd?: boolean;
}) {
  const coins = useMemo(() => {
    const r = scatter(seed);
    return Array.from({ length: count }, (_, i) => ({
      delay: 250 + i * 150 + r() * 60,
      dur: 780 + r() * 160,
      peak: 90 + r() * 70,
      size: 20 + r() * 8,
    }));
  }, [seed, count]);

  return (
    <>
      {coins.map((c, i) => (
        <span
          key={i}
          className="cel-arc-x absolute"
          style={vars({ '--dx': distance, '--delay': `${c.delay}ms`, '--dur': `${c.dur}ms` })}
        >
          <span
            className={fadeAtEnd ? 'cel-arc-y cel-arc-fade block' : 'cel-arc-y block'}
            style={vars({ '--peak': `${c.peak}px`, '--land': `${land}px`, '--delay': `${c.delay}ms`, '--dur': `${c.dur}ms` })}
          >
            <Coin size={c.size} />
          </span>
        </span>
      ))}
    </>
  );
}

function Confetti({ seed, count }: { seed: number; count: number }) {
  const bits = useMemo(() => {
    const r = scatter(seed);
    return Array.from({ length: count }, () => {
      const angle = r() * Math.PI * 2;
      const reach = 18 + r() * 30;
      return {
        dx: Math.cos(angle) * reach,
        dy: Math.sin(angle) * reach - 12,
        rot: (r() - 0.5) * 1080,
        delay: r() * 180,
        dur: 1500 + r() * 700,
        color: CONFETTI[Math.floor(r() * CONFETTI.length)]!,
        w: 6 + r() * 6,
        h: 9 + r() * 8,
        round: r() > 0.7,
      };
    });
  }, [seed, count]);

  return (
    <>
      {bits.map((b, i) => (
        <span
          key={i}
          className="cel-burst absolute"
          style={vars({
            width: b.w,
            height: b.round ? b.w : b.h,
            borderRadius: b.round ? 9999 : 2,
            background: b.color,
            '--dx': `${b.dx}vw`,
            '--dy': `${b.dy}vh`,
            '--rot': `${b.rot}deg`,
            '--delay': `${b.delay}ms`,
            '--dur': `${b.dur}ms`,
          })}
        />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Scenes
 * ------------------------------------------------------------------ */

function headline(c: Celebration, amount: string | null): { title: string; caption: string } {
  switch (c.scene) {
    case 'rain':
      return { title: amount ? `+${amount}` : 'Money in!', caption: 'Money in! Chillar approves 🤑' };
    case 'flyaway':
      return { title: amount ? `−${amount}` : 'Spent', caption: 'Bye bye, money 👋' };
    case 'toss':
      return { title: amount ? `${amount} lent` : 'Lent', caption: 'It’ll come back… right? 🪃' };
    case 'owe':
      return { title: amount ? `You owe ${amount}` : 'You owe', caption: 'Don’t forget to pay it back 😅' };
    case 'cleared':
      return c.direction === 'in'
        ? { title: amount ? `${amount} back!` : 'Paid back!', caption: 'Debt cleared 🎉' }
        : { title: amount ? `${amount} paid back` : 'Paid back', caption: 'You’re square now 🎉' };
    case 'saved':
      return { title: amount ? `Saved ${amount}!` : 'Saved!', caption: 'Future-you says thanks 🐷' };
    case 'hop':
      return { title: amount ? `${amount} moved` : 'Moved', caption: 'Shuffled around, still yours' };
  }
}

const MOODS: Record<Scene, MascotMood> = {
  rain: 'happy',
  flyaway: 'sad',
  toss: 'happy',
  owe: 'sad',
  cleared: 'happy',
  saved: 'happy',
  hop: 'idle',
};

function Stage({ celebration: c }: { celebration: Celebration }) {
  const hidden = usePrefs((s) => s.balancesHidden);
  const amount = !hidden && c.amount > 0 ? formatPaise(c.amount) : null;
  const { title, caption } = headline(c, amount);
  const hue = HUES[c.scene];
  const seed = c.id * 7919;

  // How Chillar enters or leaves, per scene.
  const chillarMotion =
    c.scene === 'rain' || c.scene === 'owe'
      ? 'cel-drop'
      : c.scene === 'flyaway'
        ? 'cel-flyaway'
        : c.scene === 'cleared'
          ? 'cel-jump'
          : 'cel-pop';

  let particles: ReactNode = null;
  let props: ReactNode = null;

  switch (c.scene) {
    case 'rain':
      particles = <FallingCoins seed={seed} count={28} />;
      break;
    case 'owe':
      particles = <FallingCoins seed={seed} count={8} from="center" />;
      break;
    case 'flyaway':
      particles = (
        <span className="absolute left-1/2 top-[38%]">
          <FlyingCoins seed={seed} count={12} />
        </span>
      );
      break;
    case 'toss':
      particles = (
        <span className="absolute left-[34%] top-[36%]">
          <ArcingCoins seed={seed} count={6} distance="70vw" land={220} />
        </span>
      );
      break;
    case 'cleared':
      particles = (
        <span className="absolute left-1/2 top-[36%]">
          <Confetti seed={seed} count={60} />
        </span>
      );
      break;
    case 'saved':
    case 'hop':
      particles = (
        <span className="absolute left-[18%] top-[40%]">
          <ArcingCoins seed={seed} count={5} distance="56vw" land={10} />
        </span>
      );
      props = (
        <span
          className="cel-target absolute right-[12%] top-[38%] grid size-[74px] place-items-center rounded-full text-white [&>svg]:size-9"
          style={{ background: hue, boxShadow: `0 0 0 6px color-mix(in oklab, ${hue} 25%, transparent), 0 0 40px ${hue}` }}
        >
          {c.scene === 'saved' ? <PiggyBank strokeWidth={2.2} /> : <ArrowLeftRight strokeWidth={2.2} />}
        </span>
      );
      break;
  }

  const chillarLeft = c.scene === 'saved' || c.scene === 'hop' ? 'left-[6%]' : c.scene === 'toss' ? 'left-[10%]' : 'left-1/2 -translate-x-1/2';

  return (
    <div aria-hidden className="cel-layer pointer-events-none fixed inset-0 z-[65] overflow-hidden">
      <div
        className="cel-flash absolute inset-0"
        style={{ background: `radial-gradient(60% 45% at 50% 38%, color-mix(in oklab, ${hue} 32%, transparent), transparent 70%)` }}
      />

      {particles}
      {props}

      <div className={`absolute top-[26%] ${chillarLeft}`}>
        <div className={chillarMotion}>
          <div className="relative">
            <Mascot size={118} mood={MOODS[c.scene]} />
            {c.scene === 'owe' && <span className="cel-sweat absolute right-3 top-9 h-4 w-3 rounded-[50%_50%_50%_50%/60%_60%_40%_40%] bg-[#7cc7ff]" />}
          </div>
        </div>
      </div>

      <div className="absolute inset-x-0 top-[50%] flex justify-center px-6">
        <div
          className="cel-headline rounded-[22px] border px-6 py-3.5 text-center backdrop-blur-xl"
          style={{
            background: 'color-mix(in srgb, var(--popover-bg) 86%, transparent)',
            borderColor: `color-mix(in oklab, ${hue} 45%, transparent)`,
            boxShadow: `0 18px 48px -16px color-mix(in oklab, ${hue} 80%, transparent)`,
          }}
        >
          <p className="tnum text-[30px] leading-tight font-extrabold tracking-[-0.03em]" style={{ color: hue }}>
            {title}
          </p>
          <p className="mt-0.5 text-[14.5px] font-medium text-ink-soft">{caption}</p>
        </div>
      </div>
    </div>
  );
}
