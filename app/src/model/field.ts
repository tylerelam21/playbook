import type { Hash, Pt, Ruleset } from './types';

// Card canvas in 1/100 inch: an 11 x 8.5 landscape page.
export const CARD_W = 1100;
export const CARD_H = 850;

export const FIELD_WIDTH_YD = 160 / 3; // 53 1/3 yards

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Where the field sits on the page and how much depth it shows. Cards compress
// the field laterally (as hand-drawn cards do) so the depth that matters stays
// readable: horizontal and vertical scales differ. Both layouts share the same
// lateral scale, so splits look the same on scout and install cards.
export interface Layout {
  field: Rect;
  top: number; // yards shown into the offensive backfield (negative)
  bottom: number; // yards of defensive depth shown
}

export const SCOUT_LAYOUT: Layout = { field: { x: 40, y: 150, w: 1020, h: 662 }, top: -7, bottom: 12 };
// Install cards give up some depth for a teaching panel under the field.
export const INSTALL_LAYOUT: Layout = { field: { x: 40, y: 150, w: 1020, h: 452 }, top: -7, bottom: 12 };
export const TEACHING_PANEL: Rect = { x: 40, y: 618, w: 1020, h: 194 };

export const FIELD = SCOUT_LAYOUT.field;

export const layoutFor = (card: { mode?: 'scout' | 'install' }) => (card.mode === 'install' ? INSTALL_LAYOUT : SCOUT_LAYOUT);

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
  layout: Layout;
  field: Rect;
  toX: (x: number) => number;
  toY: (y: number) => number;
  fromX: (cx: number) => number;
  fromY: (cy: number) => number;
  to: (p: Pt) => Pt;
  hashX: (side: -1 | 1) => number; // page x of a hash column
}

export function makeFrame(hash: Hash, ruleset: Ruleset, layout: Layout = SCOUT_LAYOUT): Frame {
  const ball = ballOffset(hash, ruleset);
  const F = layout.field;
  const sx = F.w / FIELD_WIDTH_YD;
  const sy = F.h / (layout.bottom - layout.top);
  const toX = (x: number) => F.x + (FIELD_WIDTH_YD / 2 + ball + x) * sx;
  const toY = (y: number) => F.y + (y - layout.top) * sy;
  return {
    ball,
    layout,
    field: F,
    toX,
    toY,
    fromX: (cx) => (cx - F.x) / sx - FIELD_WIDTH_YD / 2 - ball,
    fromY: (cy) => (cy - F.y) / sy + layout.top,
    to: (p) => ({ x: toX(p.x), y: toY(p.y) }),
    hashX: (side) => F.x + F.w / 2 + side * HASH_OFFSET[ruleset] * sx,
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
