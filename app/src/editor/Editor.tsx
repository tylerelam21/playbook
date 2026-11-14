import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { activeCard, PATH_PRESETS, useStore } from '../store';
import { CardSvg } from '../render/CardSvg';
import { THEMES } from '../render/themes';
import { CARD_H, CARD_W, describeSpot, fieldLimits, layoutFor, makeFrame, snap } from '../model/field';
import { layoutTeaching } from '../render/teachingLayout';
import { CommandBar } from './CommandBar';
import { useDevice } from '../ui/useDevice';
import { id } from '../model/samples';
import type { Card, Pt } from '../model/types';
import { buildPath } from '../render/pathGeom';

type Gesture =
  | {
      type: 'move';
      primary: string;
      start: Pt;
      players: Map<string, Pt>;
      notes: Map<string, Pt>;
      paths: Map<string, Pt[]>;
      moved: boolean;
    }
  | { type: 'handle'; pathId: string; index: number; moved: boolean }
  | { type: 'marquee'; start: Pt; cur: Pt; additive: boolean }
  | { type: 'draw'; ownerId: string; pts: Pt[]; moved: boolean } // drag from a player to draw
  | null;

interface Menu {
  left: number; // px inside the editor
  top: number;
  kind: string; // player | path | note | paper
  id: string;
  at: Pt; // yards
}

interface Drawing {
  ownerId: string | null;
  points: Pt[]; // yards; for a free path the first point is the origin
}

interface InlineEdit {
  kind: 'player' | 'note';
  id: string;
  value: string;
}

export function Editor() {
  const card = useStore(activeCard);
  const { workspace, selection, tool, preset, layers, zoom } = useStore();
  const ghost = useStore((s) => (s.ghost && s.ghost.id === card.id ? s.ghost : null));
  const cmdHeight = useStore((s) => s.cmdHeight);
  const theme = THEMES[workspace.theme];
  const frame = useMemo(() => makeFrame(card.hash, workspace.ruleset, layoutFor(card)), [card.hash, workspace.ruleset, card.mode]);
  const FIELD = frame.field;
  // Install cards whose notes overflow print extra pages; preview them here.
  const totalPages = useMemo(() => layoutTeaching(card).totalPages, [card]);
  const [pageSel, setPage] = useState(0);
  const page = pageSel < totalPages ? pageSel : 0;

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture>(null);
  const [fit, setFit] = useState(0.8);
  const [cursor, setCursor] = useState<Pt | null>(null); // yards
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [drawTrail, setDrawTrail] = useState<Pt[] | null>(null);
  const [readout, setReadout] = useState<{ at: Pt; text: string } | null>(null);
  const [marquee, setMarquee] = useState<{ a: Pt; b: Pt } | null>(null);
  const [inline, setInline] = useState<InlineEdit | null>(null);
  const [guide, setGuide] = useState<Pt | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const device = useDevice();
  // Touch bookkeeping: pinch zoom, long-press menus, double-tap.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const tap = useRef<{ kind: string; id: string; time: number; x: number; y: number } | null>(null);
  const lastTap = useRef<{ kind: string; id: string; time: number } | null>(null);

  const scale = fit * zoom;

  // Fit the card to the available space (leaving room for the command panel).
  const [avail, setAvail] = useState({ w: 800, h: 600 });
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const w = avail.w - 48;
    const h = avail.h - 48 - (cmdHeight ? cmdHeight + 8 : 0);
    setFit(Math.max(0.2, Math.min(w / CARD_W, h / CARD_H)));
  }, [avail, cmdHeight]);

  // Leaving the path tool or switching cards cancels an unfinished path.
  useEffect(() => {
    setDrawing(null);
  }, [tool, card.id]);
  useEffect(() => {
    setInline(null);
    setPage(0);
  }, [card.id]);

  const toCardUnits = (e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = svg.getScreenCTM()!.inverse();
    const r = pt.matrixTransform(m);
    return { x: r.x, y: r.y };
  };
  const toYards = (e: { clientX: number; clientY: number }): Pt => {
    const c = toCardUnits(e);
    return { x: frame.fromX(c.x), y: frame.fromY(c.y) };
  };

  const playerById = (pid: string) => card.players.find((p) => p.id === pid);
  const lockedSide = (pid: string) => {
    const p = playerById(pid);
    return p ? layers[p.side].locked : false;
  };

  // ---- Path drawing ---------------------------------------------------------

  const finishPath = () => {
    if (!drawing) return;
    const need = drawing.ownerId ? 1 : 2;
    if (drawing.points.length < need) {
      setDrawing(null);
      return;
    }
    const style = PATH_PRESETS.find((p) => p.key === preset)!.style;
    const pathId = id();
    useStore.getState().commit((_, c) => {
      c.paths.push({ id: pathId, ownerId: drawing.ownerId, purpose: preset, points: drawing.points, ...style });
    });
    setDrawing(null);
    flash(pathId);
  };

  const [fresh, setFresh] = useState<string | null>(null);
  const flash = (fid: string) => {
    setFresh(fid);
    setTimeout(() => setFresh((f) => (f === fid ? null : f)), 700);
  };

  // ---- Pointer handling ----------------------------------------------------

  const openMenu = (clientX: number, clientY: number, kind: string, tid: string, at: Pt) => {
    const box = wrapRef.current!.getBoundingClientRect();
    setMenu({ left: clientX - box.left + wrapRef.current!.scrollLeft, top: clientY - box.top + wrapRef.current!.scrollTop, kind, id: tid, at });
  };
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  const abortGesture = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g && (g.type === 'move' || g.type === 'handle')) useStore.getState().end();
    setReadout(null);
    setGuide(null);
    setMarquee(null);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('input')) return;
    setMenu(null);
    if (e.pointerType !== 'mouse') {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 2) {
        // Second finger: pinch to zoom instead of whatever the first started.
        cancelPress();
        abortGesture();
        setDrawing(null);
        const [a, b] = [...pointers.current.values()];
        pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: useStore.getState().zoom };
        return;
      }
    }
    if (e.button !== 0) return;
    // Keep focus where it is (e.g. a label box that was just opened).
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();
    const target = (e.target as Element).closest('[data-kind]') as HTMLElement | SVGElement | null;
    const kind = target?.getAttribute('data-kind') ?? 'paper';
    const tid = target?.getAttribute('data-id') ?? '';
    const yd = toYards(e);
    const spot = { x: snap(yd.x), y: snap(yd.y) };
    const st = useStore.getState();
    setInline(null);
    tap.current = { kind, id: tid, time: Date.now(), x: e.clientX, y: e.clientY };

    // Long-press (touch/pen) opens the same menu as right-click.
    if (e.pointerType !== 'mouse') {
      cancelPress();
      const cx = e.clientX;
      const cy = e.clientY;
      press.current = {
        x: cx,
        y: cy,
        timer: setTimeout(() => {
          press.current = null;
          abortGesture();
          setDrawing(null);
          tap.current = null;
          if (kind === 'player' || kind === 'note' || kind === 'path') st.select([tid]);
          openMenu(cx, cy, kind === 'handle' ? 'path' : kind, tid, yd);
        }, 520),
      };
    }

    if (tool === 'path') {
      // Press on a player and drag: draw the path in one motion.
      if (!drawing && kind === 'player' && !lockedSide(tid)) {
        const p = playerById(tid)!;
        gesture.current = { type: 'draw', ownerId: tid, pts: [{ x: p.x, y: p.y }], moved: false };
        capture(e);
        return;
      }
      if (!drawing) {
        if (kind === 'player' && !lockedSide(tid)) setDrawing({ ownerId: tid, points: [] });
        else setDrawing({ ownerId: null, points: [spot] });
      } else {
        const last = drawing.points[drawing.points.length - 1];
        if (last && Math.abs(last.x - spot.x) < 0.01 && Math.abs(last.y - spot.y) < 0.01) finishPath();
        else setDrawing({ ...drawing, points: [...drawing.points, spot] });
      }
      return;
    }

    if (tool === 'offense' || tool === 'defense') {
      const side = tool === 'offense' ? 'O' : 'D';
      if (layers[side].locked) {
        st.toast(`${side === 'O' ? 'Offense' : 'Defense'} layer is locked.`, 'warn');
        return;
      }
      const pid = id();
      st.commit((_, c) => {
        c.players.push({ id: pid, side, label: side === 'D' ? '' : '', shape: side === 'O' ? 'circle' : 'letter', x: spot.x, y: spot.y });
      });
      st.select([pid]);
      st.setTool('select');
      st.select([pid]);
      setInline({ kind: 'player', id: pid, value: '' });
      return;
    }

    if (tool === 'note') {
      const nid = id();
      st.commit((_, c) => {
        c.notes.push({ id: nid, text: 'NOTE', x: spot.x, y: spot.y, ink: 'ink', size: 'sm', anchorId: null });
      });
      st.setTool('select');
      st.select([nid]);
      setInline({ kind: 'note', id: nid, value: '' });
      return;
    }

    // Select tool
    if (kind === 'handle') {
      const idx = Number(target!.getAttribute('data-index'));
      if (e.altKey) {
        st.commit((_, c) => {
          const p = c.paths.find((x) => x.id === tid);
          if (p && p.points.length > 1) p.points.splice(idx, 1);
        });
        return;
      }
      st.begin();
      gesture.current = { type: 'handle', pathId: tid, index: idx, moved: false };
      capture(e);
      return;
    }

    if (kind === 'player' || kind === 'note' || kind === 'path') {
      if (kind === 'player' && lockedSide(tid)) {
        st.toast('That layer is locked. Unlock it in the toolbar to edit.', 'warn');
        return;
      }
      let sel = selection;
      if (e.shiftKey) sel = selection.includes(tid) ? selection.filter((x) => x !== tid) : [...selection, tid];
      else if (!selection.includes(tid)) sel = [tid];
      st.select(sel);
      if (e.shiftKey && !sel.includes(tid)) return;

      // Gather everything that moves with this drag.
      const players = new Map<string, Pt>();
      const notes = new Map<string, Pt>();
      const paths = new Map<string, Pt[]>();
      for (const sid of sel) {
        const p = card.players.find((x) => x.id === sid);
        if (p && !layers[p.side].locked) players.set(p.id, { x: p.x, y: p.y });
        const n = card.notes.find((x) => x.id === sid);
        if (n) notes.set(n.id, { x: n.x, y: n.y });
        const pa = card.paths.find((x) => x.id === sid);
        if (pa && !pa.ownerId) paths.set(pa.id, pa.points.map((q) => ({ ...q })));
      }
      if (!e.altKey) {
        for (const pa of card.paths) if (pa.ownerId && players.has(pa.ownerId)) paths.set(pa.id, pa.points.map((q) => ({ ...q })));
        for (const n of card.notes) if (n.anchorId && players.has(n.anchorId)) notes.set(n.id, { x: n.x, y: n.y });
      }
      if (!players.size && !notes.size && !paths.size) return;
      st.begin();
      gesture.current = { type: 'move', primary: tid, start: yd, players, notes, paths, moved: false };
      capture(e);
      return;
    }

    // Empty space: box select
    if (!e.shiftKey) st.select([]);
    gesture.current = { type: 'marquee', start: toCardUnits(e), cur: toCardUnits(e), additive: e.shiftKey };
    capture(e);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.dist > 0) useStore.getState().setZoom(pinch.current.zoom * (d / pinch.current.dist));
      return;
    }
    if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) cancelPress();
    const yd = toYards(e);
    const step = e.shiftKey ? 0.1 : 0.5;
    setCursor({ x: snap(yd.x), y: snap(yd.y) });
    const g = gesture.current;
    if (!g) return;
    const st = useStore.getState();

    if (g.type === 'move') {
      const origin = g.players.get(g.primary) ?? g.notes.get(g.primary) ?? g.paths.get(g.primary)?.[0];
      if (!origin) return;
      const dx = snap(origin.x + yd.x - g.start.x, step) - origin.x;
      const dy = snap(origin.y + yd.y - g.start.y, step) - origin.y;
      if (!g.moved && Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
      g.moved = true;
      st.live((_, c) => {
        for (const p of c.players) {
          const o = g.players.get(p.id);
          if (o) {
            p.x = o.x + dx;
            p.y = o.y + dy;
          }
        }
        for (const n of c.notes) {
          const o = g.notes.get(n.id);
          if (o) {
            n.x = o.x + dx;
            n.y = o.y + dy;
          }
        }
        for (const pa of c.paths) {
          const o = g.paths.get(pa.id);
          if (o) pa.points = o.map((q) => ({ x: q.x + dx, y: q.y + dy }));
        }
      });
      const prim = g.players.get(g.primary);
      if (prim) {
        const at = { x: prim.x + dx, y: prim.y + dy };
        setGuide(at);
        setReadout({ at, text: describeSpot(at.x, at.y) });
      }
      return;
    }

    if (g.type === 'draw') {
      const last = g.pts[g.pts.length - 1];
      if (Math.hypot(yd.x - last.x, yd.y - last.y) > 0.35) {
        g.pts.push({ x: yd.x, y: yd.y });
        if (!g.moved && Math.hypot(yd.x - g.pts[0].x, yd.y - g.pts[0].y) > 1.2) g.moved = true;
        setDrawTrail([...g.pts]);
      }
      return;
    }

    if (g.type === 'handle') {
      g.moved = true;
      const at = { x: snap(yd.x, step), y: snap(yd.y, step) };
      st.live((_, c) => {
        const pa = c.paths.find((x) => x.id === g.pathId);
        if (pa) pa.points[g.index] = at;
      });
      setReadout({ at, text: describeSpot(at.x, at.y) });
      return;
    }

    if (g.type === 'marquee') {
      g.cur = toCardUnits(e);
      setMarquee({ a: g.start, b: g.cur });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null;
      return;
    }
    cancelPress();
    // Double-tap (touch): rename a player or note, or add a bend to a line.
    const t = tap.current;
    tap.current = null;
    const stillTap = t && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 10 && Date.now() - t.time < 400;
    if (e.pointerType !== 'mouse' && stillTap && tool === 'select') {
      const prev = lastTap.current;
      if (prev && prev.kind === t.kind && prev.id === t.id && t.time - prev.time < 350 && t.kind !== 'paper') {
        lastTap.current = null;
        abortGesture();
        activate(t.kind, t.id, toYards(e));
        return;
      }
      lastTap.current = { kind: t.kind, id: t.id, time: t.time };
    }
    const g = gesture.current;
    gesture.current = null;
    setDrawTrail(null);
    if (g?.type === 'draw') {
      if (!g.moved) {
        // A tap on a player: fall back to click-to-place points.
        setDrawing({ ownerId: g.ownerId, points: [] });
        return;
      }
      const pts = simplify(g.pts, 0.7).slice(1).map((q) => ({ x: snap(q.x), y: snap(q.y) }));
      const trimmed = pts.length > 4 ? [...pts.slice(0, 3), pts[pts.length - 1]] : pts;
      const style = PATH_PRESETS.find((p) => p.key === preset)!.style;
      const pathId = id();
      useStore.getState().commit((_, c) => {
        c.paths.push({ id: pathId, ownerId: g.ownerId, purpose: preset, points: trimmed, ...style, curved: trimmed.length > 1 ? true : style.curved });
      });
      flash(pathId);
      return;
    }
    setReadout(null);
    setGuide(null);
    setMarquee(null);
    if (!g) return;
    const st = useStore.getState();
    if (g.type === 'move' || g.type === 'handle') {
      st.end();
      if (g.type === 'move' && g.moved) warnOffField(useStore.getState().cards.find((c) => c.id === card.id)!);
    }
    if (g.type === 'marquee') {
      const x0 = Math.min(g.start.x, g.cur.x);
      const x1 = Math.max(g.start.x, g.cur.x);
      const y0 = Math.min(g.start.y, g.cur.y);
      const y1 = Math.max(g.start.y, g.cur.y);
      if (x1 - x0 < 4 && y1 - y0 < 4) return;
      const inside = (p: Pt) => {
        const q = frame.to(p);
        return q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1;
      };
      const ids = [
        ...card.players.filter((p) => !layers[p.side].locked && layers[p.side].visible && inside(p)).map((p) => p.id),
        ...card.notes.filter(inside).map((n) => n.id),
        ...card.paths.filter((p) => !p.ownerId && p.points.every(inside)).map((p) => p.id),
      ];
      st.select(g.additive ? [...new Set([...selection, ...ids])] : ids);
    }
  };

  const warnOffField = (c: Card) => {
    const lim = fieldLimits(c.hash, workspace.ruleset);
    const off = c.players.filter((p) => p.x < lim.min || p.x > lim.max).length;
    if (off) useStore.getState().toast(`${off} player${off > 1 ? 's are' : ' is'} off the field.`, 'warn');
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    // In the path tool, the second click of a double-click lands on the last
    // point, which already finishes the path in onPointerDown.
    if (tool === 'path') return;
    const target = (e.target as Element).closest('[data-kind]');
    activate(target?.getAttribute('data-kind') ?? 'paper', target?.getAttribute('data-id') ?? '', toYards(e));
  };

  // Double-click / double-tap: rename, edit text, or add a bend.
  const activate = (kind: string, tid: string, yd: Pt) => {
    if (kind === 'player') {
      const p = playerById(tid);
      if (p && !layers[p.side].locked) setInline({ kind: 'player', id: tid, value: p.label });
    } else if (kind === 'note') {
      const n = card.notes.find((x) => x.id === tid);
      if (n) setInline({ kind: 'note', id: tid, value: n.text });
    } else if (kind === 'path') {
      // Insert a bend point where the user double-clicked.
      const pa = card.paths.find((x) => x.id === tid);
      if (!pa) return;
      const owner = pa.ownerId ? playerById(pa.ownerId) : undefined;
      const all = owner ? [{ x: owner.x, y: owner.y }, ...pa.points] : pa.points;
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < all.length - 1; i++) {
        const d = distToSeg(yd, all[i], all[i + 1]);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      const insertAt = owner ? best : best + 1;
      useStore.getState().commit((_, c) => {
        const p = c.paths.find((x) => x.id === tid);
        p?.points.splice(insertAt, 0, { x: snap(yd.x), y: snap(yd.y) });
      });
      useStore.getState().select([tid]);
    }
  };

  // ---- Keyboard ------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]')) return;
      const st = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();

      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && k === 'y') {
        e.preventDefault();
        st.redo();
        return;
      }
      if (mod && k === 'a') {
        e.preventDefault();
        st.select(card.players.filter((p) => !layers[p.side].locked).map((p) => p.id));
        return;
      }
      if (mod && k === 'd') {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if (mod) return;

      if (k === 'escape') {
        if (drawing) setDrawing(null);
        else st.select([]);
        st.setTool('select');
        return;
      }
      if (k === 'enter' && drawing) {
        finishPath();
        return;
      }
      if ((k === 'delete' || k === 'backspace') && st.selection.length) {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (k.startsWith('arrow') && st.selection.length) {
        e.preventDefault();
        const d = e.shiftKey ? 2 : 0.5;
        const dx = k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0;
        const dy = k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0;
        nudge(dx, dy);
        return;
      }
      const toolKeys: Record<string, typeof tool> = { v: 'select', p: 'path', o: 'offense', d: 'defense', t: 'note' };
      if (toolKeys[k]) {
        st.setTool(toolKeys[k]);
        return;
      }
      const n = Number(k);
      if (n >= 1 && n <= PATH_PRESETS.length) st.setPreset(PATH_PRESETS[n - 1].key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const nudge = (dx: number, dy: number) => {
    const sel = new Set(useStore.getState().selection);
    useStore.getState().commit((_, c) => {
      const moved = new Set<string>();
      for (const p of c.players)
        if (sel.has(p.id) && !layers[p.side].locked) {
          p.x += dx;
          p.y += dy;
          moved.add(p.id);
        }
      for (const pa of c.paths)
        if ((pa.ownerId && moved.has(pa.ownerId)) || (!pa.ownerId && sel.has(pa.id)))
          pa.points = pa.points.map((q) => ({ x: q.x + dx, y: q.y + dy }));
      for (const n of c.notes)
        if (sel.has(n.id) || (n.anchorId && moved.has(n.anchorId))) {
          n.x += dx;
          n.y += dy;
        }
    });
  };

  const deleteSelection = () => {
    const st = useStore.getState();
    const sel = new Set(st.selection);
    st.commit((_, c) => {
      const gone = new Set(c.players.filter((p) => sel.has(p.id) && !layers[p.side].locked).map((p) => p.id));
      c.players = c.players.filter((p) => !gone.has(p.id));
      c.paths = c.paths.filter((p) => !sel.has(p.id) && !(p.ownerId && gone.has(p.ownerId)));
      c.notes = c.notes.filter((n) => !sel.has(n.id));
      for (const n of c.notes) if (n.anchorId && gone.has(n.anchorId)) n.anchorId = null;
    });
    st.select([]);
  };

  const duplicateSelection = () => {
    const st = useStore.getState();
    const sel = new Set(st.selection);
    if (!sel.size) return;
    const map = new Map<string, string>();
    const newIds: string[] = [];
    st.commit((_, c) => {
      const off = 1;
      for (const p of c.players.filter((x) => sel.has(x.id))) {
        const nid = id();
        map.set(p.id, nid);
        newIds.push(nid);
        c.players.push({ ...p, id: nid, x: p.x + off, y: p.y + off });
      }
      for (const pa of c.paths.filter((x) => sel.has(x.id) || (x.ownerId && map.has(x.ownerId)))) {
        const nid = id();
        if (sel.has(pa.id)) newIds.push(nid);
        c.paths.push({
          ...pa,
          id: nid,
          ownerId: pa.ownerId ? map.get(pa.ownerId) ?? pa.ownerId : null,
          points: pa.points.map((q) => ({ x: q.x + off, y: q.y + off })),
        });
      }
      for (const n of c.notes.filter((x) => sel.has(x.id))) {
        const nid = id();
        newIds.push(nid);
        c.notes.push({ ...n, id: nid, x: n.x + off, y: n.y + off });
      }
    });
    st.select(newIds);
  };

  // ---- Inline label editing ------------------------------------------------

  const commitInline = () => {
    if (!inline) return;
    const v = inline.value;
    useStore.getState().commit((_, c) => {
      if (inline.kind === 'player') {
        const p = c.players.find((x) => x.id === inline.id);
        if (p) p.label = v.trim();
      } else {
        const n = c.notes.find((x) => x.id === inline.id);
        if (n) {
          if (v.trim()) n.text = v;
          else c.notes = c.notes.filter((x) => x.id !== inline.id);
        }
      }
    });
    setInline(null);
  };

  const inlinePos = (() => {
    if (!inline) return null;
    const obj = inline.kind === 'player' ? playerById(inline.id) : card.notes.find((n) => n.id === inline.id);
    if (!obj) return null;
    return { left: frame.toX(obj.x) * scale, top: frame.toY(obj.y) * scale };
  })();

  // ---- Drawing preview -----------------------------------------------------

  const menuActions = {
    rename: (pid: string) => {
      const p = playerById(pid);
      if (p) setInline({ kind: 'player', id: pid, value: p.label });
      else {
        const n = card.notes.find((x) => x.id === pid);
        if (n) setInline({ kind: 'note', id: pid, value: n.text });
      }
    },
    drawFrom: (pid: string) => {
      useStore.getState().setTool('path');
      setTimeout(() => setDrawing({ ownerId: pid, points: [] }), 0);
    },
    bend: (pathId: string, at: Pt) => activate('path', pathId, at),
    read: (pid: string, n: number) =>
      useStore.getState().commit((_, c) => {
        const p = c.players.find((x) => x.id === pid);
        if (p) p.read = n || undefined;
      }),
    duplicate: () => duplicateSelection(),
    remove: () => deleteSelection(),
    add: (what: 'D' | 'O' | 'note', at: Pt) => {
      const st = useStore.getState();
      const spot = { x: snap(at.x), y: snap(at.y) };
      const nid = id();
      if (what === 'note') {
        st.commit((_, c) => void c.notes.push({ id: nid, text: 'NOTE', x: spot.x, y: spot.y, ink: 'ink', size: 'sm', anchorId: null }));
        st.select([nid]);
        setInline({ kind: 'note', id: nid, value: '' });
      } else {
        st.commit((_, c) => void c.players.push({ id: nid, side: what, label: '', shape: what === 'O' ? 'circle' : 'letter', x: spot.x, y: spot.y }));
        st.select([nid]);
        setInline({ kind: 'player', id: nid, value: '' });
      }
    },
    details: () => useStore.getState().setDrawer('details'),
    compact: device.kind !== 'desktop',
    readOf: (pid: string) => playerById(pid)?.read ?? 0,
  };

  const preview = (() => {
    if (!drawing) return null;
    const owner = drawing.ownerId ? playerById(drawing.ownerId) : undefined;
    const pts = [...(owner ? [{ x: owner.x, y: owner.y }] : []), ...drawing.points, ...(cursor ? [cursor] : [])];
    const style = PATH_PRESETS.find((p) => p.key === preset)!.style;
    const geom = buildPath(pts.map(frame.to), { curved: style.curved, zigzag: style.line === 'zigzag', trimStart: owner ? 22 : 0 });
    return { geom, color: theme.ink[style.ink], pts: drawing.points.map(frame.to), dashed: style.line === 'dashed' };
  })();

  const hidden = { O: !layers.O.visible, D: !layers.D.visible };
  // Only guide when a tool is active; Move is self-explanatory.
  const tapWord = device.touch ? 'Tap' : 'Click';
  const hint =
    tool === 'path'
      ? drawing
        ? `${tapWord} to add bends · ${device.touch ? 'tap the last point' : 'double-click or Enter'} to finish`
        : `Drag from a player to draw their path, or ${tapWord.toLowerCase()} points one at a time`
      : tool === 'offense'
        ? `${tapWord} the field to place an offensive player`
        : tool === 'defense'
          ? `${tapWord} the field to place a defender, then type their label`
          : tool === 'note'
            ? `${tapWord} to place a note`
            : '';

  return (
    <div className={`editor tool-${tool}`} ref={wrapRef} style={cmdHeight ? { paddingBottom: 24 + cmdHeight + 8 } : undefined}>
      {totalPages > 1 && (
        <div className="page-tabs">
          {Array.from({ length: totalPages }, (_, i) => (
            <button key={i} className={page === i ? 'on' : ''} onClick={() => setPage(i)}>
              {i === 0 ? 'Card' : `Page ${i + 1} · continued`}
            </button>
          ))}
        </div>
      )}
      {ghost && page === 0 ? (
        <div className="stage" style={{ width: CARD_W * scale, height: CARD_H * scale }}>
          <div className="paper-shadow ghost-glow" />
          <div className="svg-host">
            <CardSvg card={ghost} theme={theme} ruleset={workspace.ruleset} />
          </div>
          <div className="ghost-badge">Preview · not applied yet</div>
        </div>
      ) : page > 0 ? (
        <div className="stage" style={{ width: CARD_W * scale, height: CARD_H * scale }}>
          <div className="paper-shadow" />
          <div className="svg-host">
            <CardSvg card={card} theme={theme} ruleset={workspace.ruleset} page={page} />
          </div>
        </div>
      ) : (
      <div className="stage" style={{ width: CARD_W * scale, height: CARD_H * scale }}>
        <div className="paper-shadow" />
        <div
          className="svg-host"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={(e) => {
            pointers.current.delete(e.pointerId);
            pinch.current = null;
            cancelPress();
            abortGesture();
            setDrawTrail(null);
          }}
          onPointerLeave={() => !gesture.current && setCursor(null)}
          onDoubleClick={onDoubleClick}
          onContextMenu={(e) => {
            e.preventDefault();
            const target = (e.target as Element).closest('[data-kind]');
            const kind = target?.getAttribute('data-kind') ?? 'paper';
            const tid = target?.getAttribute('data-id') ?? '';
            if (kind === 'player' || kind === 'note' || kind === 'path') useStore.getState().select([tid]);
            openMenu(e.clientX, e.clientY, kind === 'handle' ? 'path' : kind, tid, toYards(e));
          }}
        >
          <CardSvg
            key={card.id}
            svgRef={svgRef}
            card={card}
            theme={theme}
            ruleset={workspace.ruleset}
            interactive
            selection={selection}
            hidden={hidden}
            className={`card-svg${fresh ? ' has-fresh' : ''}`}
          />
          <svg className="overlay" viewBox={`0 0 ${CARD_W} ${CARD_H}`}>
            {guide && (
              <g className="guides">
                <line x1={FIELD.x} x2={FIELD.x + FIELD.w} y1={frame.toY(guide.y)} y2={frame.toY(guide.y)} />
                <line y1={FIELD.y} y2={FIELD.y + FIELD.h} x1={frame.toX(guide.x)} x2={frame.toX(guide.x)} />
              </g>
            )}
            {preview?.geom && (
              <g className="preview">
                <path d={preview.geom.d} stroke={preview.color} strokeDasharray={preview.dashed ? '11 9' : undefined} />
                {preview.pts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={5} fill={preview.color} />
                ))}
              </g>
            )}
            {drawTrail && drawTrail.length > 1 && (
              <polyline className="draw-trail" points={drawTrail.map((q) => `${frame.toX(q.x)},${frame.toY(q.y)}`).join(' ')} stroke={theme.ink[PATH_PRESETS.find((p) => p.key === preset)!.style.ink]} />
            )}
            {tool !== 'select' && cursor && !gesture.current && !device.touch && (
              <circle className="cursor-dot" cx={frame.toX(cursor.x)} cy={frame.toY(cursor.y)} r={5} />
            )}
            {marquee && (
              <rect
                className="marquee"
                x={Math.min(marquee.a.x, marquee.b.x)}
                y={Math.min(marquee.a.y, marquee.b.y)}
                width={Math.abs(marquee.a.x - marquee.b.x)}
                height={Math.abs(marquee.a.y - marquee.b.y)}
              />
            )}
          </svg>
          {readout && (
            <div className="readout" style={{ left: frame.toX(readout.at.x) * scale, top: frame.toY(readout.at.y) * scale - 44 }}>
              {readout.text}
            </div>
          )}
          {inline && inlinePos && (
            <input
              className={`inline-edit ${inline.kind}`}
              style={{ left: inlinePos.left, top: inlinePos.top }}
              autoFocus
              value={inline.value}
              maxLength={inline.kind === 'player' ? 4 : 80}
              placeholder={inline.kind === 'player' ? 'Label' : 'Note text'}
              onChange={(e) => setInline({ ...inline, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitInline();
                if (e.key === 'Escape') setInline(null);
                e.stopPropagation();
              }}
              onBlur={commitInline}
            />
          )}
        </div>
      </div>
      )}
      {menu && <CanvasMenu menu={menu} onClose={() => setMenu(null)} actions={menuActions} />}
      <CommandBar />
      {(page > 0 || hint) && !cmdHeight && (
        <div className="hint">{page > 0 ? 'Notes that don’t fit on the card continue here at the same size. Edit them in the Card panel.' : hint}</div>
      )}
    </div>
  );
}

function distToSeg(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Pointer capture keeps a drag going when the finger leaves the card; it can
// throw for synthetic or already-ended pointers, which is harmless.
function capture(e: React.PointerEvent) {
  try {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
}

// Douglas-Peucker: keep the corners of a hand-drawn line, drop the wobble.
function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  let idx = 0;
  let max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSeg(pts[i], pts[0], pts[pts.length - 1]);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

type MenuActions = {
  rename: (id: string) => void;
  drawFrom: (id: string) => void;
  bend: (id: string, at: Pt) => void;
  read: (id: string, n: number) => void;
  duplicate: () => void;
  remove: () => void;
  add: (what: 'D' | 'O' | 'note', at: Pt) => void;
  details: () => void;
  compact: boolean;
  readOf: (id: string) => number;
};

// Right-click (mouse) or long-press (touch) menu on the card.
function CanvasMenu({ menu, onClose, actions }: { menu: Menu; onClose: () => void; actions: MenuActions }) {
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  let items: React.ReactNode;
  if (menu.kind === 'player') {
    const read = actions.readOf(menu.id);
    items = (
      <>
        <button onClick={run(() => actions.rename(menu.id))}>Rename</button>
        <button onClick={run(() => actions.drawFrom(menu.id))}>Draw a path</button>
        <div className="menu-row">
          <span>Read</span>
          {[0, 1, 2, 3].map((n) => (
            <button key={n} className={read === n ? 'on' : ''} onClick={run(() => actions.read(menu.id, n))}>
              {n === 0 ? '–' : n}
            </button>
          ))}
        </div>
        <button onClick={run(actions.duplicate)}>Duplicate</button>
        {actions.compact && <button onClick={run(actions.details)}>Details…</button>}
        <button className="danger" onClick={run(actions.remove)}>Delete</button>
      </>
    );
  } else if (menu.kind === 'path') {
    items = (
      <>
        <button onClick={run(() => actions.bend(menu.id, menu.at))}>Add a bend here</button>
        {actions.compact && <button onClick={run(actions.details)}>Line style…</button>}
        <button className="danger" onClick={run(actions.remove)}>Delete line</button>
      </>
    );
  } else if (menu.kind === 'note') {
    items = (
      <>
        <button onClick={run(() => actions.rename(menu.id))}>Edit text</button>
        <button className="danger" onClick={run(actions.remove)}>Delete note</button>
      </>
    );
  } else {
    items = (
      <>
        <button onClick={run(() => actions.add('D', menu.at))}>Add a defender here</button>
        <button onClick={run(() => actions.add('O', menu.at))}>Add an offensive player here</button>
        <button onClick={run(() => actions.add('note', menu.at))}>Add a note here</button>
      </>
    );
  }
  return (
    <>
      <div className="pop-scrim" onPointerDown={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} />
      <div className="popover canvas-menu" style={{ left: menu.left, top: menu.top }}>
        {items}
      </div>
    </>
  );
}
