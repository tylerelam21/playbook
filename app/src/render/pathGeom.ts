import type { Pt } from '../model/types';

// Geometry for a drawn path, in card units. Shared by the SVG renderer and the
// PowerPoint exporter so both draw the same line.

export type Cmd =
  | { t: 'M'; p: Pt }
  | { t: 'L'; p: Pt }
  | { t: 'C'; c1: Pt; c2: Pt; p: Pt };

export interface PathGeom {
  cmds: Cmd[];
  d: string;
  end: Pt;
  angle: number; // direction of travel at the end, radians
}

const sub = (a: Pt, b: Pt) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a: Pt) => Math.hypot(a.x, a.y);
const lerp = (a: Pt, b: Pt, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function bezierAt(a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
  };
}

// Smooth curve through every point (Catmull-Rom converted to cubic Béziers).
function smooth(pts: Pt[]): Cmd[] {
  const cmds: Cmd[] = [{ t: 'M', p: pts[0] }];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const k = 1 / 6;
    cmds.push({
      t: 'C',
      c1: { x: p1.x + (p2.x - p0.x) * k, y: p1.y + (p2.y - p0.y) * k },
      c2: { x: p2.x - (p3.x - p1.x) * k, y: p2.y - (p3.y - p1.y) * k },
      p: p2,
    });
  }
  return cmds;
}

function flatten(cmds: Cmd[]): Pt[] {
  const out: Pt[] = [];
  let cur: Pt = { x: 0, y: 0 };
  for (const c of cmds) {
    if (c.t === 'M' || c.t === 'L') {
      out.push(c.p);
      cur = c.p;
    } else {
      for (let i = 1; i <= 16; i++) out.push(bezierAt(cur, c.c1, c.c2, c.p, i / 16));
      cur = c.p;
    }
  }
  return out;
}

// A wavy line that follows the polyline, finishing with a short straight run
// so the end cap reads cleanly.
function zigzag(poly: Pt[]): Cmd[] {
  const total = poly.slice(1).reduce((s, p, i) => s + len(sub(p, poly[i])), 0);
  const tail = Math.min(18, total * 0.3);
  const wave = 13;
  const amp = 5.5;
  const cmds: Cmd[] = [{ t: 'M', p: poly[0] }];
  let dist = 0;
  let next = wave / 2;
  let sign = 1;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i];
    const b = poly[i + 1];
    const seg = len(sub(b, a));
    if (seg === 0) continue;
    const n = { x: -(b.y - a.y) / seg, y: (b.x - a.x) / seg };
    while (next <= dist + seg && next < total - tail) {
      const p = lerp(a, b, (next - dist) / seg);
      cmds.push({ t: 'L', p: { x: p.x + n.x * amp * sign, y: p.y + n.y * amp * sign } });
      sign = -sign;
      next += wave / 2;
    }
    dist += seg;
  }
  cmds.push({ t: 'L', p: poly[poly.length - 1] });
  return cmds;
}

export function toD(cmds: Cmd[]) {
  const f = (n: number) => n.toFixed(1);
  return cmds
    .map((c) =>
      c.t === 'C'
        ? `C${f(c.c1.x)} ${f(c.c1.y)} ${f(c.c2.x)} ${f(c.c2.y)} ${f(c.p.x)} ${f(c.p.y)}`
        : `${c.t}${f(c.p.x)} ${f(c.p.y)}`,
    )
    .join(' ');
}

export function buildPath(
  rawPts: Pt[],
  opts: { curved: boolean; zigzag: boolean; trimStart: number },
): PathGeom | null {
  const pts = rawPts.filter((p, i) => i === 0 || len(sub(p, rawPts[i - 1])) > 0.5);
  if (pts.length < 2) return null;

  // Start just outside the player's symbol instead of under it.
  const first = sub(pts[1], pts[0]);
  const fl = len(first);
  if (opts.trimStart > 0 && fl > opts.trimStart * 1.5) {
    pts[0] = lerp(pts[0], pts[1], opts.trimStart / fl);
  }

  let cmds: Cmd[] =
    opts.curved && pts.length >= 3
      ? smooth(pts)
      : [{ t: 'M', p: pts[0] }, ...pts.slice(1).map((p) => ({ t: 'L' as const, p }))];

  if (opts.zigzag) cmds = zigzag(flatten(cmds));

  const poly = flatten(cmds);
  const end = poly[poly.length - 1];
  let k = poly.length - 2;
  while (k > 0 && len(sub(end, poly[k])) < 4) k--;
  const before = poly[Math.max(0, k)];
  const angle = Math.atan2(end.y - before.y, end.x - before.x);

  return { cmds, d: toD(cmds), end, angle };
}

export function arrowHead(end: Pt, angle: number, size = 15) {
  const back = { x: end.x - Math.cos(angle) * size, y: end.y - Math.sin(angle) * size };
  const w = size * 0.5;
  const nx = -Math.sin(angle) * w;
  const ny = Math.cos(angle) * w;
  return [end, { x: back.x + nx, y: back.y + ny }, { x: back.x - nx, y: back.y - ny }];
}

export function teeBar(end: Pt, angle: number, size = 22) {
  const nx = -Math.sin(angle) * (size / 2);
  const ny = Math.cos(angle) * (size / 2);
  return [
    { x: end.x + nx, y: end.y + ny },
    { x: end.x - nx, y: end.y - ny },
  ];
}
