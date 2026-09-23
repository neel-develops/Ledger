import { formatPaise } from '@shared/money';
import type { Statement } from './bill';

/**
 * Draws a statement as a picture you can send — a receipt in the app's own
 * style: rainbow strip, ticket notches, a torn bottom edge, and Chillar at the
 * foot. Canvas, not a screenshot library, so it is exact and costs nothing.
 */

export interface BillOptions {
  statement: Statement;
  personName: string;
  fromName: string;
  theme: 'light' | 'dark';
  /** A standalone SVG of Chillar, drawn at the foot. Optional. */
  mascotSvg?: string;
}

const W = 1080;
const PAD = 64;
const CARD_X = 40;
const CARD_W = W - CARD_X * 2;
const ROW_H = 104;

const PALETTES = {
  dark: {
    canvas: '#0b0c10',
    card: '#16171e',
    text: '#f3f3f6',
    soft: '#a9a9b6',
    muted: '#7d7d8b',
    line: 'rgba(255,255,255,0.09)',
    zebra: 'rgba(255,255,255,0.025)',
    chip: '#23233a',
    chipText: '#a5a3ff',
    owed: '#ffb547',
    paid: '#34d399',
    total: '#2fd3e0',
    glowA: 'rgba(133,131,240,0.35)',
    glowB: 'rgba(255,111,177,0.22)',
  },
  light: {
    canvas: '#eef0f7',
    card: '#ffffff',
    text: '#16161a',
    soft: '#5c5c66',
    muted: '#8e8e98',
    line: 'rgba(16,16,26,0.08)',
    zebra: 'rgba(16,16,26,0.025)',
    chip: '#ececfb',
    chipText: '#4644b8',
    owed: '#c26a00',
    paid: '#1c8f5f',
    total: '#5856d6',
    glowA: 'rgba(88,86,214,0.18)',
    glowB: 'rgba(255,111,177,0.14)',
  },
};

const RAINBOW = ['#6a4dff', '#d54bff', '#ff7a59', '#ffb547', '#34d399', '#2fd3e0', '#5b8cff'];

function fontStack(): string {
  if (typeof document === 'undefined') return 'system-ui, sans-serif';
  return getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export async function renderBill(options: BillOptions): Promise<Blob> {
  const { statement, personName, fromName, theme, mascotSvg } = options;
  const c = PALETTES[theme];
  const font = fontStack();
  const first = personName.trim().split(/\s+/)[0] || personName;

  const rows = statement.lines.length + (statement.broughtForward !== 0 ? 1 : 0);
  const HEADER = 230;
  const HERO = 330;
  const TABLE_HEAD = 76;
  const TOTAL = 150;
  const FOOTER = 280;
  const ZIGZAG = 28;
  const cardTop = 40;
  const cardH = HEADER + HERO + TABLE_HEAD + rows * ROW_H + TOTAL + FOOTER;
  const H = cardTop + cardH + ZIGZAG + 40;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This phone could not draw the bill.');

  /* Backdrop with two soft glows. */
  ctx.fillStyle = c.canvas;
  ctx.fillRect(0, 0, W, H);
  for (const [x, y, r, color] of [
    [180, 120, 520, c.glowA],
    [W - 120, H - 260, 560, c.glowB],
  ] as const) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* The card: rounded top, zigzag bottom like a torn-off receipt. */
  const bottom = cardTop + cardH;
  const radius = 44;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(CARD_X + radius, cardTop);
  ctx.lineTo(CARD_X + CARD_W - radius, cardTop);
  ctx.quadraticCurveTo(CARD_X + CARD_W, cardTop, CARD_X + CARD_W, cardTop + radius);
  ctx.lineTo(CARD_X + CARD_W, bottom);
  const teeth = 24;
  const tooth = CARD_W / teeth;
  for (let i = teeth; i > 0; i--) {
    ctx.lineTo(CARD_X + (i - 0.5) * tooth, bottom + ZIGZAG);
    ctx.lineTo(CARD_X + (i - 1) * tooth, bottom);
  }
  ctx.lineTo(CARD_X, cardTop + radius);
  ctx.quadraticCurveTo(CARD_X, cardTop, CARD_X + radius, cardTop);
  ctx.closePath();
  ctx.shadowColor = theme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(16,16,26,0.12)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 24;
  ctx.fillStyle = c.card;
  ctx.fill();
  ctx.restore();

  /* Rainbow strip across the top. */
  const strip = ctx.createLinearGradient(CARD_X, 0, CARD_X + CARD_W, 0);
  RAINBOW.forEach((color, i) => strip.addColorStop(i / (RAINBOW.length - 1), color));
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(CARD_X + radius, cardTop);
  ctx.lineTo(CARD_X + CARD_W - radius, cardTop);
  ctx.quadraticCurveTo(CARD_X + CARD_W, cardTop, CARD_X + CARD_W, cardTop + radius);
  ctx.lineTo(CARD_X + CARD_W, cardTop + 14);
  ctx.lineTo(CARD_X, cardTop + 14);
  ctx.lineTo(CARD_X, cardTop + radius);
  ctx.quadraticCurveTo(CARD_X, cardTop, CARD_X + radius, cardTop);
  ctx.fillStyle = strip;
  ctx.fill();
  ctx.restore();

  const left = CARD_X + PAD;
  const right = CARD_X + CARD_W - PAD;
  let y = cardTop + 14;

  /* Header: brand and a STATEMENT chip. */
  const logo = await loadImage('/logo.svg');
  if (logo) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(left, y + 56, 104, 104, 26);
    ctx.clip();
    ctx.drawImage(logo, left, y + 56, 104, 104);
    ctx.restore();
  }
  ctx.fillStyle = c.text;
  ctx.font = `800 46px ${font}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Ledger', left + 132, y + 112);
  ctx.fillStyle = c.muted;
  ctx.font = `500 26px ${font}`;
  ctx.fillText(`Issued ${day(new Date().toISOString())}`, left + 132, y + 150);

  ctx.font = `800 22px ${font}`;
  const chipText = 'STATEMENT';
  const chipW = ctx.measureText(chipText).width + 44;
  ctx.fillStyle = c.chip;
  ctx.beginPath();
  ctx.roundRect(right - chipW, y + 78, chipW, 50, 25);
  ctx.fill();
  ctx.fillStyle = c.chipText;
  ctx.textAlign = 'center';
  ctx.fillText(chipText, right - chipW / 2, y + 111);
  ctx.textAlign = 'left';
  y += HEADER;

  /* Hero: who, and how much. */
  ctx.fillStyle = c.soft;
  ctx.font = `600 34px ${font}`;
  ctx.fillText(`Hi ${first} 👋`, left, y + 20);
  ctx.fillStyle = c.muted;
  ctx.font = `500 28px ${font}`;
  ctx.fillText(fitText(ctx, `Here’s what’s between you and ${fromName}.`, right - left), left, y + 66);

  ctx.fillStyle = c.muted;
  ctx.font = `700 24px ${font}`;
  ctx.fillText('AMOUNT DUE', left, y + 146);
  ctx.save();
  ctx.fillStyle = c.total;
  ctx.shadowColor = c.total;
  ctx.shadowBlur = theme === 'dark' ? 40 : 0;
  ctx.font = `800 118px ${font}`;
  ctx.fillText(fitText(ctx, formatPaise(statement.total), right - left), left - 4, y + 262);
  ctx.restore();
  y += HERO;

  /* Dashed divider with ticket notches cut into both edges. */
  const notch = (atY: number) => {
    ctx.fillStyle = c.canvas;
    for (const x of [CARD_X, CARD_X + CARD_W]) {
      ctx.beginPath();
      ctx.arc(x, atY, 22, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.setLineDash([14, 12]);
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(CARD_X + 36, atY);
    ctx.lineTo(CARD_X + CARD_W - 36, atY);
    ctx.stroke();
    ctx.restore();
  };
  notch(y - 16);

  /* Table. */
  ctx.fillStyle = c.muted;
  ctx.font = `700 22px ${font}`;
  ctx.fillText('WHAT', left, y + 42);
  ctx.textAlign = 'right';
  ctx.fillText('AMOUNT', right - 200, y + 42);
  ctx.fillText('BALANCE', right, y + 42);
  ctx.textAlign = 'left';
  y += TABLE_HEAD;

  const drawRow = (index: number, title: string, sub: string, change: string, changeColor: string, balance: string) => {
    if (index % 2 === 0) {
      ctx.fillStyle = c.zebra;
      ctx.fillRect(CARD_X + 24, y, CARD_W - 48, ROW_H);
    }
    ctx.fillStyle = c.text;
    ctx.font = `600 30px ${font}`;
    ctx.fillText(fitText(ctx, title, right - left - 420), left, y + 46);
    ctx.fillStyle = c.muted;
    ctx.font = `500 24px ${font}`;
    ctx.fillText(sub, left, y + 80);
    ctx.textAlign = 'right';
    ctx.fillStyle = changeColor;
    ctx.font = `700 30px ${font}`;
    ctx.fillText(change, right - 200, y + 62);
    ctx.fillStyle = c.soft;
    ctx.font = `600 28px ${font}`;
    ctx.fillText(balance, right, y + 62);
    ctx.textAlign = 'left';
    y += ROW_H;
  };

  let index = 0;
  if (statement.broughtForward !== 0) {
    drawRow(index++, 'Earlier balance', 'Brought forward', '', c.soft, formatPaise(statement.broughtForward));
  }
  for (const line of statement.lines) {
    const adds = line.change > 0;
    drawRow(
      index++,
      line.description,
      day(line.date),
      `${adds ? '+' : '−'}${formatPaise(Math.abs(line.change))}`,
      adds ? c.owed : c.paid,
      formatPaise(line.balance),
    );
  }

  /* Total. */
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, y + 20);
  ctx.lineTo(right, y + 20);
  ctx.stroke();
  ctx.fillStyle = c.text;
  ctx.font = `800 36px ${font}`;
  ctx.fillText('Total due', left, y + 92);
  ctx.textAlign = 'right';
  ctx.fillStyle = c.total;
  ctx.font = `800 48px ${font}`;
  ctx.fillText(formatPaise(statement.total), right, y + 96);
  ctx.textAlign = 'left';
  y += TOTAL;

  notch(y);

  /* Footer: a friendly line and Chillar. */
  ctx.fillStyle = c.text;
  ctx.font = `700 34px ${font}`;
  ctx.fillText('No rush — settle whenever you can 🙂', left, y + 90);
  ctx.fillStyle = c.muted;
  ctx.font = `500 25px ${font}`;
  ctx.fillText(`Sent by ${fromName} from Ledger`, left, y + 136);
  ctx.fillText('Chillar keeps every rupee honest.', left, y + 172);

  if (mascotSvg) {
    const mascot = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(mascotSvg)}`);
    if (mascot) ctx.drawImage(mascot, right - 190, y + 30, 190, 196);
  }

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The bill could not be drawn.'))), 'image/png'),
  );
}
