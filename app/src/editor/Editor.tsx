import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { activeCard, PATH_PRESETS, useStore } from '../store';
import { CardSvg } from '../render/CardSvg';
import { THEMES } from '../render/themes';
import { CARD_H, CARD_W, FIELD, describeSpot, fieldLimits, makeFrame, snap } from '../model/field';
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
  | null;

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
  const theme = THEMES[workspace.theme];
  const frame = useMemo(() => makeFrame(card.hash, workspace.ruleset), [card.hash, workspace.ruleset]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture>(null);
  const [fit, setFit] = useState(0.8);
  const [cursor, setCursor] = useState<Pt | null>(null); // yards
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [readout, setReadout] = useState<{ at: Pt; text: string } | null>(null);
  const [marquee, setMarquee] = useState<{ a: Pt; b: Pt } | null>(null);
  const [inline, setInline] = useState<InlineEdit | null>(null);
  const [guide, setGuide] = useState<Pt | null>(null);

  const scale = fit * zoom;

  // Fit the card to the available space.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth - 48;
      const h = el.clientHeight - 48;
      setFit(Math.max(0.2, Math.min(w / CARD_W, h / CARD_H)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Leaving the path tool or switching cards cancels an unfinished path.
  useEffect(() => {
    setDrawing(null);
  }, [tool, card.id]);
  useEffect(() => {
    setInline(null);
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

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest('input')) return;
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

    if (tool === 'path') {
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
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
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
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }

    // Empty space: box select
    if (!e.shiftKey) st.select([]);
    gesture.current = { type: 'marquee', start: toCardUnits(e), cur: toCardUnits(e), additive: e.shiftKey };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
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

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
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
    const kind = target?.getAttribute('data-kind');
    const tid = target?.getAttribute('data-id') ?? '';
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
      const yd = toYards(e);
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

  const preview = (() => {
    if (!drawing) return null;
    const owner = drawing.ownerId ? playerById(drawing.ownerId) : undefined;
    const pts = [...(owner ? [{ x: owner.x, y: owner.y }] : []), ...drawing.points, ...(cursor ? [cursor] : [])];
    const style = PATH_PRESETS.find((p) => p.key === preset)!.style;
    const geom = buildPath(pts.map(frame.to), { curved: style.curved, zigzag: style.line === 'zigzag', trimStart: owner ? 22 : 0 });
    return { geom, color: theme.ink[style.ink], pts: drawing.points.map(frame.to), dashed: style.line === 'dashed' };
  })();

  const hidden = { O: !layers.O.visible, D: !layers.D.visible };
  const hint =
    tool === 'path'
      ? drawing
        ? 'Click to add bends · double-click or Enter to finish · Esc to cancel'
        : 'Click a player to start their path (or empty space for a free line)'
      : tool === 'offense'
        ? 'Click the field to place an offensive player'
        : tool === 'defense'
          ? 'Click the field to place a defender, then type their label'
          : tool === 'note'
            ? 'Click to place a note'
            : 'Drag to move · double-click a player to rename · double-click a line to add a bend';

  return (
    <div className={`editor tool-${tool}`} ref={wrapRef}>
      <div className="stage" style={{ width: CARD_W * scale, height: CARD_H * scale }}>
        <div className="paper-shadow" />
        <div
          className="svg-host"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => !gesture.current && setCursor(null)}
          onDoubleClick={onDoubleClick}
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
            {tool !== 'select' && cursor && !gesture.current && (
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
      <div className="hint">{hint}</div>
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
