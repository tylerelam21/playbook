import type { Card, Ink, Player } from '../model/types';
import { CARD_H, TEACHING_PANEL } from '../model/field';

// Lays out an install card's teaching notes at a fixed, readable size.
// Text is never shrunk to fit (PRD R13): whatever doesn't fit in the panel
// under the field flows onto continuation pages.

export const TEXT_SIZE = 15; // 0.15 in ≈ 11 pt
export const LINE_H = 19;
export const HEAD_SIZE = 13;
export const HEAD_H = 24;
export const COLS = 3;
export const COL_GAP = 24;
export const PAD = 14;
export const LABEL_GUTTER = 46;
export const BULLET_GUTTER = 16;

// Continuation pages: a slim header, then the whole page for notes.
export const CONT_BOX = { x: 40, y: 150, w: 1020, h: CARD_H - 150 - 38 };

const FONT_FAMILY = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";
let ctx: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, number>();

export function measure(text: string, size = TEXT_SIZE, bold = false) {
  const key = `${bold ? 'b' : 'n'}${size}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (ctx === undefined) ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  let w: number;
  if (ctx) {
    ctx.font = `${bold ? 700 : 600} ${size}px ${FONT_FAMILY}`;
    w = ctx.measureText(text).width;
  } else w = text.length * size * (bold ? 0.5 : 0.47);
  cache.set(key, w);
  return w;
}

export function wrap(text: string, width: number, size = TEXT_SIZE, bold = false): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next, size, bold) <= width) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      // A single word wider than the column is broken by characters.
      let w = word;
      while (measure(w, size, bold) > width && w.length > 1) {
        let k = w.length - 1;
        while (k > 1 && measure(w.slice(0, k), size, bold) > width) k--;
        out.push(w.slice(0, k));
        w = w.slice(k);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

export type TLine =
  | { kind: 'heading'; text: string; h: number }
  | { kind: 'assign'; label: string | null; ink?: Ink; side?: 'O' | 'D'; orphan?: boolean; text: string; h: number }
  | { kind: 'bullet'; first: boolean; text: string; h: number };

export interface PlacedLine {
  line: TLine;
  y: number; // offset from the top of the column
}

export interface TeachingPage {
  columns: PlacedLine[][];
}

export interface TeachingLayout {
  pages: TeachingPage[]; // pages[0] = panel on the card, then continuation pages
  totalPages: number; // printed pages for this card (1 + continuations)
  empty: boolean;
}

export const colWidth = (boxW: number) => (boxW - 2 * PAD - (COLS - 1) * COL_GAP) / COLS;

export function assignmentLabel(card: Card, playerId: string | null, fallback: string) {
  const p: Player | undefined = playerId ? card.players.find((x) => x.id === playerId) : undefined;
  return { label: p ? p.label || '•' : fallback || '—', player: p, orphan: !!playerId && !p };
}

function blocks(card: Card, colW: number): TLine[][] {
  const t = card.teaching;
  if (!t) return [];
  const out: TLine[][] = [];
  const rows = t.assignments.filter((a) => a.text.trim());
  if (rows.length) {
    out.push([{ kind: 'heading', text: 'ASSIGNMENTS', h: HEAD_H }]);
    for (const a of rows) {
      const { label, player, orphan } = assignmentLabel(card, a.playerId, a.label);
      const lines = wrap(a.text.trim(), colW - LABEL_GUTTER);
      out.push(
        lines.map((text, i) => ({
          kind: 'assign' as const,
          label: i === 0 ? label : null,
          ink: player?.ink,
          side: player?.side,
          orphan,
          text,
          h: LINE_H,
        })),
      );
    }
  }
  const cues = t.cues
    .split('\n')
    .map((c) => c.replace(/^\s*[-•*]\s*/, '').trim())
    .filter(Boolean);
  if (cues.length) {
    out.push([{ kind: 'heading', text: 'COACHING POINTS', h: HEAD_H }]);
    for (const c of cues) out.push(wrap(c, colW - BULLET_GUTTER).map((text, i) => ({ kind: 'bullet' as const, first: i === 0, text, h: LINE_H })));
  }
  return out;
}

export function layoutTeaching(card: Card): TeachingLayout {
  if (card.mode !== 'install') return { pages: [], totalPages: 1, empty: true };
  const colW = colWidth(TEACHING_PANEL.w);
  const all = blocks(card, colW);
  const capFirst = TEACHING_PANEL.h - 2 * PAD;
  const capCont = CONT_BOX.h - 2 * PAD;

  const pages: TeachingPage[] = [{ columns: [[]] }];
  let used = 0;
  const cap = () => (pages.length === 1 ? capFirst : capCont);
  const nextColumn = () => {
    const page = pages[pages.length - 1];
    if (page.columns.length < COLS) page.columns.push([]);
    else pages.push({ columns: [[]] });
    used = 0;
  };
  const place = (line: TLine) => {
    const page = pages[pages.length - 1];
    page.columns[page.columns.length - 1].push({ line, y: used });
    used += line.h;
  };

  for (let bi = 0; bi < all.length; bi++) {
    const block = all[bi];
    const isHeading = block[0].kind === 'heading';
    // Keep a heading with the first line after it.
    const need = block.reduce((s, l) => s + l.h, 0) + (isHeading && all[bi + 1] ? all[bi + 1][0].h : 0);
    if (used > 0 && used + need > cap() && need <= cap()) nextColumn();
    for (const line of block) {
      if (used > 0 && used + line.h > cap()) nextColumn();
      place(line);
    }
  }
  const empty = all.length === 0;
  return { pages, totalPages: empty ? 1 : pages.length, empty };
}
