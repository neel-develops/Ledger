/**
 * Draws the app icon — Chillar, grinning, in a burst of loose change — and
 * renders every size the web app and the Android shell need.
 *
 *   npx tsx scripts/build-icons.ts
 *
 * One SVG source, so the favicon, the PWA icons and the launcher icons can
 * never drift apart. The outputs are committed; this only needs running again
 * when the design changes.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const ROOT = path.resolve(import.meta.dirname, '..');

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

const defs = `
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#6a4dff"/>
    <stop offset="0.5" stop-color="#d54bff"/>
    <stop offset="1" stop-color="#ff7a59"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#fff6c9" stop-opacity="0.95"/>
    <stop offset="0.45" stop-color="#ffd86b" stop-opacity="0.35"/>
    <stop offset="1" stop-color="#ffd86b" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="face" x1="0" y1="0" x2="0.9" y2="1">
    <stop offset="0" stop-color="#b3b1ff"/>
    <stop offset="0.55" stop-color="#6f6cf0"/>
    <stop offset="1" stop-color="#4642c4"/>
  </linearGradient>
  <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#3a37a8"/>
    <stop offset="1" stop-color="#231f78"/>
  </linearGradient>
  <radialGradient id="gloss" cx="0.32" cy="0.24" r="0.55">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0.8"/>
    <stop offset="0.45" stop-color="#ffffff" stop-opacity="0.12"/>
    <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="gold" cx="0.35" cy="0.3" r="0.75">
    <stop offset="0" stop-color="#fff1b8"/>
    <stop offset="0.55" stop-color="#f7c443"/>
    <stop offset="1" stop-color="#cf8e12"/>
  </radialGradient>
  <clipPath id="mouth">
    <path d="M40 72 Q60 70 80 72 Q78 100 60 101 Q42 100 40 72 Z"/>
  </clipPath>
</defs>`;

/** Sixteen alternating rays from the centre: the "crazy" in the brief. */
function rays(cx: number, cy: number, length: number): string {
  const wedges: string[] = [];
  const count = 16;
  for (let i = 0; i < count; i += 2) {
    const a0 = (i / count) * Math.PI * 2;
    const a1 = ((i + 1) / count) * Math.PI * 2;
    const p = (a: number) => `${(cx + Math.cos(a) * length).toFixed(1)} ${(cy + Math.sin(a) * length).toFixed(1)}`;
    wedges.push(`<path d="M${cx} ${cy} L${p(a0)} L${p(a1)} Z"/>`);
  }
  return `<g fill="#ffffff" opacity="0.13">${wedges.join('')}</g>`;
}

/** A four-point sparkle. */
function sparkle(x: number, y: number, r: number, opacity = 1): string {
  const k = r * 0.2;
  return `<path transform="translate(${x} ${y})" fill="#ffffff" opacity="${opacity}" d="M0 ${-r} Q${k} ${-k} ${r} 0 Q${k} ${k} 0 ${r} Q${-k} ${k} ${-r} 0 Q${-k} ${-k} 0 ${-r} Z"/>`;
}

/** A little gold rupee coin, tumbling past. */
function miniCoin(x: number, y: number, r: number, tilt: number): string {
  return `
  <g transform="translate(${x} ${y}) rotate(${tilt})">
    <ellipse cx="0" cy="${r * 0.14}" rx="${r}" ry="${r * 0.92}" fill="#b0730a"/>
    <ellipse cx="0" cy="0" rx="${r}" ry="${r * 0.92}" fill="url(#gold)"/>
    <ellipse cx="0" cy="0" rx="${r * 0.74}" ry="${r * 0.68}" fill="none" stroke="#fff4c7" stroke-opacity="0.6" stroke-width="${r * 0.07}"/>
    <text x="0" y="${r * 0.36}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="${r * 1.05}" fill="#9a6206">₹</text>
  </g>`;
}

/**
 * Chillar himself, in the mascot's own 120×124 coordinates — the same coin as
 * the in-app mascot, turned up: a wider grin, a tongue, and gold on top.
 */
const chillar = `
  <ellipse cx="60" cy="121" rx="34" ry="5.5" fill="#1b0f4a" opacity="0.28"/>

  <!-- A sticker-style outline, so the coin lifts off a background of the same hue. -->
  <path d="M60 22 C60 15 63 10 67 7" stroke="#ffffff" stroke-width="9" stroke-linecap="round" fill="none"/>
  <circle cx="68" cy="6.5" r="10.5" fill="#ffffff"/>
  <ellipse cx="60" cy="65.5" rx="49" ry="50" fill="#ffffff"/>
  <path d="M60 22 C60 15 63 10 67 7" stroke="#3a37a8" stroke-width="3.4" stroke-linecap="round" fill="none"/>
  <circle cx="68" cy="6.5" r="7.5" fill="url(#gold)"/>
  <text x="68" y="10" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="10" font-weight="800" fill="#9a6206">₹</text>
  <ellipse cx="60" cy="69" rx="45" ry="43" fill="url(#rim)"/>
  <ellipse cx="60" cy="62" rx="45" ry="42" fill="url(#face)"/>
  <ellipse cx="60" cy="62" rx="38.5" ry="36" fill="none" stroke="#ffffff" stroke-opacity="0.2" stroke-width="1.6"/>
  <ellipse cx="60" cy="62" rx="45" ry="42" fill="url(#gloss)"/>

  <ellipse cx="31" cy="75" rx="8" ry="5" fill="#ff8fb3" opacity="0.6"/>
  <ellipse cx="89" cy="75" rx="8" ry="5" fill="#ff8fb3" opacity="0.6"/>

  <g stroke="#1a1850" stroke-width="5.2" stroke-linecap="round" fill="none">
    <path d="M35 58 Q44 45 53 58"/>
    <path d="M67 58 Q76 45 85 58"/>
  </g>

  <path d="M40 72 Q60 70 80 72 Q78 100 60 101 Q42 100 40 72 Z" fill="#1a1850"/>
  <g clip-path="url(#mouth)">
    <path d="M40 71 Q60 69 80 71 L80 78 Q60 80.5 40 78 Z" fill="#ffffff"/>
    <ellipse cx="60" cy="99" rx="14" ry="10" fill="#ff6f9c"/>
    <path d="M60 91 L60 97" stroke="#d94d7c" stroke-width="1.6" stroke-linecap="round"/>
  </g>
`;

/* ------------------------------------------------------------------ *
 * Compositions
 * ------------------------------------------------------------------ */

/** Chillar, scaled and tilted about the given centre. */
function placeChillar(cx: number, cy: number, scale: number, tilt = -9): string {
  const x = cx - 60 * scale;
  const y = cy - 62 * scale;
  return `<g transform="rotate(${tilt} ${cx} ${cy}) translate(${x} ${y}) scale(${scale})">${chillar}</g>`;
}

function burst(size: number, content: number): string {
  const c = size / 2;
  const s = content; // 1 = full composition; maskable shrinks it into the safe zone.
  return `
    ${rays(c, c * 1.04, size)}
    <circle cx="${c}" cy="${c * 1.04}" r="${size * 0.42 * s}" fill="url(#glow)"/>
    ${miniCoin(c - size * 0.33 * s, c - size * 0.28 * s, size * 0.075 * s, -24)}
    ${miniCoin(c + size * 0.35 * s, c + size * 0.2 * s, size * 0.062 * s, 28)}
    ${miniCoin(c - size * 0.3 * s, c + size * 0.33 * s, size * 0.05 * s, 14)}
    ${sparkle(c + size * 0.3 * s, c - size * 0.3 * s, size * 0.055 * s)}
    ${sparkle(c - size * 0.4 * s, c + size * 0.05 * s, size * 0.032 * s, 0.9)}
    ${sparkle(c + size * 0.17 * s, c + size * 0.41 * s, size * 0.028 * s, 0.85)}
    ${sparkle(c + size * 0.42 * s, c - size * 0.05 * s, size * 0.022 * s, 0.8)}
    ${placeChillar(c, c * 1.03, (size / 124) * 0.62 * s)}
  `;
}

const svg = (size: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${defs}${body}</svg>`;

/** The standard icon: a rounded square, for browsers and home screens that do not mask. */
const rounded = svg(
  1024,
  `<clipPath id="sq"><rect width="1024" height="1024" rx="230"/></clipPath>
   <g clip-path="url(#sq)"><rect width="1024" height="1024" fill="url(#bg)"/>${burst(1024, 1)}</g>`,
);

/** Full-bleed, everything inside the central 80% — the OS cuts its own shape. */
const maskable = svg(1024, `<rect width="1024" height="1024" fill="url(#bg)"/>${burst(1024, 0.8)}`);

/** Android adaptive icon layers: 108dp canvas, 66dp guaranteed visible. */
const androidBackground = svg(
  432,
  `<rect width="432" height="432" fill="url(#bg)"/>${rays(216, 224, 432)}<circle cx="216" cy="224" r="150" fill="url(#glow)"/>`,
);
const androidForeground = svg(
  432,
  `${miniCoin(216 - 92, 216 - 80, 20, -24)}${miniCoin(216 + 96, 216 + 58, 17, 28)}
   ${sparkle(216 + 88, 216 - 88, 16)}${sparkle(216 - 104, 216 + 30, 10, 0.9)}
   ${placeChillar(216, 222, (432 / 124) * 0.43)}`,
);

/** A 32-unit favicon: no rays or confetti, which turn to mud at 16px. */
const favicon = svg(
  1024,
  `<rect width="1024" height="1024" rx="230" fill="url(#bg)"/>${placeChillar(512, 530, (1024 / 124) * 0.8, -6)}`,
);

/* ------------------------------------------------------------------ *
 * Render
 * ------------------------------------------------------------------ */

function png(source: string, width: number, file: string, circle = false): void {
  const input = circle
    ? source.replace(
        /<svg([^>]*)>/,
        `<svg$1><clipPath id="round"><circle cx="50%" cy="50%" r="50%"/></clipPath><g clip-path="url(#round)">`,
      ).replace(/<\/svg>$/, '</g></svg>')
    : source;
  const rendered = new Resvg(input, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
  }).render();
  const out = path.join(ROOT, file);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, rendered.asPng());
  console.log(`  ${file} (${width}px)`);
}

console.log('Drawing Chillar…');

writeFileSync(path.join(ROOT, 'public/favicon.svg'), favicon);
writeFileSync(path.join(ROOT, 'public/logo.svg'), rounded);
console.log('  public/favicon.svg, public/logo.svg');

png(rounded, 192, 'public/icons/icon-192.png');
png(rounded, 512, 'public/icons/icon-512.png');
png(maskable, 512, 'public/icons/icon-maskable-512.png');
// iOS rounds the corners itself and shows transparency as black, so it gets the full-bleed square.
png(maskable, 180, 'public/apple-touch-icon.png');

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 } as const;
for (const [density, scale] of Object.entries(densities)) {
  const dir = `android/app/src/main/res/mipmap-${density}`;
  png(rounded, 48 * scale, `${dir}/ic_launcher.png`);
  png(maskable, 48 * scale, `${dir}/ic_launcher_round.png`, true);
  png(androidForeground, 108 * scale, `${dir}/ic_launcher_foreground.png`);
  png(androidBackground, 108 * scale, `${dir}/ic_launcher_background.png`);
}

console.log('Done.');
