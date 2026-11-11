import type { Hash, Pt, Ruleset } from './types';

// Card canvas in 1/100 inch: an 11 x 8.5 landscape page.
export const CARD_W = 1100;
export const CARD_H = 850;

export const FIELD = { x: 40, y: 150, w: 1020, h: 662 };

export const FIELD_WIDTH_YD = 160 / 3; // 53 1/3 yards
export const VIEW_TOP_YD = -7; // offensive backfield shown
export const VIEW_BOTTOM_YD = 12; // defensive depth shown

// Cards compress the field laterally (as hand-drawn cards do) so the depth
// that matters stays readable. Horizontal and vertical scales differ.
export const SX = FIELD.w / FIELD_WIDTH_YD;
export const SY = FIELD.h / (VIEW_BOTTOM_YD - VIEW_TOP_YD);

// Distance from the middle of the field to each hash, in yards.
const HASH_OFFSET: Record<Ruleset, number> = {
  hs: (FIELD_WIDTH_YD - 2 * (160 / 9)) / 2, // hashes 53'4" from each sideline
  college: 40 / 3 / 2, // hashes 40' apart
  nfl: 18.5 / 3 / 2, // hashes 18'6" apart
};

export const RULESET_LABEL: Record<Ruleset, string> = {
  hs: 'High school',
  college: 'College',
  nfl: 'NFL',
};

export function hashOffset(ruleset: Ruleset) {
  return HASH_OFFSET[ruleset];
}

// Where the ball sits, in yards from the middle of the field, as printed.
// Defense view: the offense's left hash appears on the right of the card.
export function ballOffset(hash: Hash, ruleset: Ruleset) {
  const h = HASH_OFFSET[ruleset];
  return hash === 'L' ? h : hash === 'R' ? -h : 0;
}

export interface Frame {
  ball: number; // ball offset from field center (yd)
  toX: (x: number) => number;
  toY: (y: number) => number;
  fromX: (cx: number) => number;
  fromY: (cy: number) => number;
  to: (p: Pt) => Pt;
}

export function makeFrame(hash: Hash, ruleset: Ruleset): Frame {
  const ball = ballOffset(hash, ruleset);
  const toX = (x: number) => FIELD.x + (FIELD_WIDTH_YD / 2 + ball + x) * SX;
  const toY = (y: number) => FIELD.y + (y - VIEW_TOP_YD) * SY;
  return {
    ball,
    toX,
    toY,
    fromX: (cx) => (cx - FIELD.x) / SX - FIELD_WIDTH_YD / 2 - ball,
    fromY: (cy) => (cy - FIELD.y) / SY + VIEW_TOP_YD,
    to: (p) => ({ x: toX(p.x), y: toY(p.y) }),
  };
}

// Lateral limits of the field relative to the ball, for off-field warnings.
export function fieldLimits(hash: Hash, ruleset: Ruleset) {
  const ball = ballOffset(hash, ruleset);
  return { min: -FIELD_WIDTH_YD / 2 - ball, max: FIELD_WIDTH_YD / 2 - ball };
}

export const snap = (v: number, step = 0.5) => Math.round(v / step) * step;

// Human-readable alignment, e.g. "5 yd deep · 3½ right of ball"
export function describeSpot(x: number, y: number) {
  const fmt = (n: number) => {
    const a = Math.abs(n);
    const whole = Math.floor(a);
    const half = a - whole >= 0.25 && a - whole < 0.75;
    const rounded = half ? whole : Math.round(a);
    return half ? `${whole === 0 ? '' : whole}½` : `${rounded}`;
  };
  const depth =
    Math.abs(y) < 0.25 ? 'on the ball' : y > 0 ? `${fmt(y)} yd deep` : `${fmt(y)} yd off ball`;
  const lat =
    Math.abs(x) < 0.25 ? 'head up' : `${fmt(x)} ${x > 0 ? 'right' : 'left'}`;
  return `${depth} · ${lat}`;
}

// Keep players inside the sidelines (used when placing generic sample looks).
export function clampToField<T extends { x: number }>(players: T[], hash: Hash, ruleset: Ruleset, margin = 1.5): T[] {
  const lim = fieldLimits(hash, ruleset);
  return players.map((p) => ({ ...p, x: Math.min(lim.max - margin, Math.max(lim.min + margin, p.x)) }));
}
