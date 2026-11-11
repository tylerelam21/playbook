import { useState } from 'react';
import { activeCard, PATH_PRESETS, useStore } from '../store';
import { DEFENSE_LOOKS, OFFENSE_LOOKS } from '../model/samples';
import { clampToField, fieldLimits, describeSpot } from '../model/field';
import type { Card, CardStatus, EndCap, Hash, Ink, LineStyle, Note, PathPurpose, PlayPath, Player, PlayerShape } from '../model/types';
import { INK_ORDER, THEMES } from '../render/themes';
import { I } from './Icons';
import { STATUS_LABEL } from './Sidebar';

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: React.ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.v} className={value === o.v ? 'on' : ''} onClick={() => onChange(o.v)} title={o.title}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Inks({ value, onChange }: { value: Ink | undefined; onChange: (v: Ink) => void }) {
  const t = THEMES.night;
  return (
    <div className="inks">
      {INK_ORDER.map((k) => (
        <button key={k} className={`ink${value === k ? ' on' : ''}`} style={{ background: t.ink[k] }} title={k} onClick={() => onChange(k)} />
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

// Text input that records one undo step per edit session instead of per keystroke.
function TextIn({ value, onCommit, placeholder, mono, area }: { value: string; onCommit: (v: string) => void; placeholder?: string; mono?: boolean; area?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const props = {
    value: draft ?? value,
    placeholder,
    className: mono ? 'mono' : undefined,
    onFocus: () => setDraft(value),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: () => {
      if (draft !== null && draft !== value) onCommit(draft);
      setDraft(null);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !(area && e.shiftKey)) (e.target as HTMLElement).blur();
      if (e.key === 'Escape') {
        setDraft(null);
        (e.target as HTMLElement).blur();
      }
    },
  };
  return area ? <textarea rows={3} {...props} /> : <input {...props} />;
}

function NumIn({ value, onCommit, step = 0.5 }: { value: number; onCommit: (v: number) => void; step?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      step={step}
      className="num"
      value={draft ?? String(Math.round(value * 10) / 10)}
      onFocus={() => setDraft(String(Math.round(value * 10) / 10))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = parseFloat(draft ?? '');
        if (!Number.isNaN(n) && n !== value) onCommit(n);
        setDraft(null);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
    />
  );
}

export function Inspector() {
  const card = useStore(activeCard);
  const selection = useStore((s) => s.selection);
  const sel = new Set(selection);
  const players = card.players.filter((p) => sel.has(p.id));
  const paths = card.paths.filter((p) => sel.has(p.id));
  const notes = card.notes.filter((n) => sel.has(n.id));

  let body: React.ReactNode;
  if (!selection.length) body = <CardPanel card={card} />;
  else if (players.length === 1 && selection.length === 1) body = <PlayerPanel p={players[0]} card={card} />;
  else if (paths.length === 1 && selection.length === 1) body = <PathPanel path={paths[0]} card={card} />;
  else if (notes.length === 1 && selection.length === 1) body = <NotePanel n={notes[0]} card={card} />;
  else body = <MultiPanel count={selection.length} players={players} />;

  return <aside className="inspector">{body}</aside>;
}

const edit = (fn: Parameters<ReturnType<typeof useStore.getState>['commit']>[0], semantic = true) =>
  useStore.getState().commit(fn, { semantic });

// ---- Card ------------------------------------------------------------------

function CardPanel({ card }: { card: Card }) {
  const { toast, workspace, duplicateCard } = useStore();
  const [justReady, setJustReady] = useState(false);

  const setField = (k: 'playNo' | 'period' | 'play' | 'defense', v: string) =>
    edit((_, c) => {
      c[k] = v;
    });

  const setHash = (h: Hash) => {
    edit((_, c) => {
      c.hash = h;
    });
    const lim = fieldLimits(h, workspace.ruleset);
    const off = card.players.filter((p) => p.x < lim.min || p.x > lim.max).length;
    if (off) toast(`On the ${h === 'M' ? 'middle' : h === 'L' ? 'left' : 'right'} hash, ${off} player${off > 1 ? 's land' : ' lands'} off the field. Adjust their split.`, 'warn');
  };

  const setStatus = (s: CardStatus) => {
    edit((_, c) => {
      c.status = s;
    }, false);
    if (s === 'ready') {
      setJustReady(true);
      setTimeout(() => setJustReady(false), 900);
    }
  };

  const applyLook = (side: 'O' | 'D', key: string) => {
    const look = (side === 'O' ? OFFENSE_LOOKS : DEFENSE_LOOKS).find((l) => l.key === key);
    if (!look) return;
    const fresh = clampToField(look.build(), card.hash, workspace.ruleset);
    edit((_, c) => {
      const gone = new Set(c.players.filter((p) => p.side === side).map((p) => p.id));
      c.players = [...c.players.filter((p) => p.side !== side), ...fresh];
      c.paths = c.paths.filter((p) => !(p.ownerId && gone.has(p.ownerId)));
      for (const n of c.notes) if (n.anchorId && gone.has(n.anchorId)) n.anchorId = null;
    });
    toast(`Applied sample “${look.name}”. ⌘Z to undo.`, 'good');
  };

  const flip = () => {
    edit((_, c) => {
      for (const p of c.players) p.x = -p.x;
      for (const pa of c.paths) pa.points = pa.points.map((q) => ({ x: -q.x, y: q.y }));
      for (const n of c.notes) n.x = -n.x;
      c.status = 'review';
    });
    toast('Flipped the drawing. Play and defense calls weren’t renamed — card marked Needs review.', 'warn');
  };

  const counts = {
    O: card.players.filter((p) => p.side === 'O').length,
    D: card.players.filter((p) => p.side === 'D').length,
  };

  return (
    <div className="panel">
      <div className="panel-title">Card</div>
      <div className="grid2">
        <Field label="Play #">
          <TextIn value={card.playNo} onCommit={(v) => setField('playNo', v)} />
        </Field>
        <Field label="Period">
          <TextIn value={card.period} onCommit={(v) => setField('period', v)} />
        </Field>
      </div>
      <Field label="Play call">
        <TextIn value={card.play} onCommit={(v) => setField('play', v)} placeholder="Exactly as scripted" />
      </Field>
      <Field label="Defense">
        <TextIn value={card.defense} onCommit={(v) => setField('defense', v)} placeholder="Front / coverage / pressure" />
      </Field>
      <Field label="Hash">
        <Seg<Hash>
          value={card.hash}
          onChange={setHash}
          options={[
            { v: 'L', label: 'Left' },
            { v: 'M', label: 'Middle' },
            { v: 'R', label: 'Right' },
          ]}
        />
      </Field>

      <div className="panel-title">Status</div>
      <div className={`status-row${justReady ? ' celebrate' : ''}`}>
        <Seg<CardStatus>
          value={card.status}
          onChange={setStatus}
          options={(['draft', 'review', 'ready'] as const).map((s) => ({
            v: s,
            label: (
              <>
                <span className={`status-dot ${s}`} /> {STATUS_LABEL[s]}
              </>
            ),
          }))}
        />
        {justReady && <span className="burst">{I.check()}</span>}
      </div>
      <p className="muted small">Any change to the drawing or calls sends a Ready card back to Draft.</p>

      <div className="panel-title">
        Starting looks <span className="tag">Sample</span>
      </div>
      <p className="muted small">Generic placements to start from. Replaces that side’s players.</p>
      <div className="grid2">
        <select value="" onChange={(e) => applyLook('O', e.target.value)}>
          <option value="">Offense… ({counts.O})</option>
          {OFFENSE_LOOKS.map((l) => (
            <option key={l.key} value={l.key}>
              {l.name}
            </option>
          ))}
        </select>
        <select value="" onChange={(e) => applyLook('D', e.target.value)}>
          <option value="">Defense… ({counts.D})</option>
          {DEFENSE_LOOKS.map((l) => (
            <option key={l.key} value={l.key}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div className="panel-title">Actions</div>
      <div className="stack">
        <button className="btn" onClick={() => duplicateCard(card.id)}>
          {I.copy()} Duplicate card
        </button>
        <button className="btn" onClick={flip}>
          {I.flip()} Flip left ↔ right
        </button>
      </div>

      <div className="tips">
        <div className="panel-title">Quick keys</div>
        <ul>
          <li><kbd>P</kbd> then click a player to draw · <kbd>1</kbd>–<kbd>6</kbd> line type</li>
          <li><kbd>D</kbd> / <kbd>O</kbd> drop a defender / offensive player</li>
          <li><kbd>←</kbd><kbd>→</kbd> nudge ½ yd · <kbd>⇧</kbd> for 2 yd</li>
          <li><kbd>⌥</kbd>-drag a player to leave their path in place</li>
          <li><kbd>⌘D</kbd> duplicate · <kbd>⌘Z</kbd> undo</li>
        </ul>
      </div>
    </div>
  );
}

// ---- Player ----------------------------------------------------------------

const SHAPES: { v: PlayerShape; label: string }[] = [
  { v: 'letter', label: 'Letter' },
  { v: 'circle', label: '○' },
  { v: 'lineman', label: '⬬' },
  { v: 'center', label: '■' },
  { v: 'triangle', label: '△' },
  { v: 'square', label: '□' },
];

function PlayerPanel({ p, card }: { p: Player; card: Card }) {
  const { setTool, layers } = useStore();
  const locked = layers[p.side].locked;
  const update = (fn: (x: Player) => void) =>
    edit((_, c) => {
      const x = c.players.find((q) => q.id === p.id);
      if (x) fn(x);
    });
  const moveTo = (nx: number, ny: number) => {
    const dx = nx - p.x;
    const dy = ny - p.y;
    edit((_, c) => {
      const x = c.players.find((q) => q.id === p.id);
      if (!x) return;
      x.x = nx;
      x.y = ny;
      for (const pa of c.paths) if (pa.ownerId === p.id) pa.points = pa.points.map((q) => ({ x: q.x + dx, y: q.y + dy }));
      for (const n of c.notes)
        if (n.anchorId === p.id) {
          n.x += dx;
          n.y += dy;
        }
    });
  };
  const owned = card.paths.filter((pa) => pa.ownerId === p.id).length;

  return (
    <div className={`panel${locked ? ' locked' : ''}`}>
      <div className="panel-title">
        {p.side === 'O' ? 'Offensive player' : 'Defender'}
        {locked && <span className="tag">Locked</span>}
      </div>
      <div className="grid2">
        <Field label="Label">
          <TextIn value={p.label} onCommit={(v) => update((x) => (x.label = v.slice(0, 4)))} mono />
        </Field>
        <Field label="Side">
          <Seg
            value={p.side}
            onChange={(v) => update((x) => (x.side = v))}
            options={[
              { v: 'O', label: 'Off' },
              { v: 'D', label: 'Def' },
            ]}
          />
        </Field>
      </div>
      <Field label="Symbol">
        <Seg value={p.shape} onChange={(v) => update((x) => (x.shape = v))} options={SHAPES} />
      </Field>

      <div className="panel-title">Alignment</div>
      <div className="grid2">
        <Field label={p.x >= 0 ? 'Yards right of ball' : 'Yards left of ball'}>
          <NumIn value={Math.abs(p.x)} onCommit={(v) => moveTo(p.x < 0 ? -v : v, p.y)} />
        </Field>
        <Field label={p.y >= 0 ? 'Depth (yd)' : 'Yards off ball'}>
          <NumIn value={Math.abs(p.y)} onCommit={(v) => moveTo(p.x, p.y < 0 ? -v : v)} />
        </Field>
      </div>
      <div className="spot">{describeSpot(p.x, p.y)}</div>

      <div className="panel-title">Color</div>
      <Inks value={p.ink} onChange={(v) => update((x) => (x.ink = v))} />
      <p className="muted small">Color is for readability only — it doesn’t change meaning.</p>

      <div className="panel-title">Paths</div>
      <p className="muted small">{owned ? `${owned} path${owned > 1 ? 's' : ''} attached.` : 'No path yet.'}</p>
      <button
        className="btn"
        onClick={() => {
          setTool('path');
        }}
      >
        {I.path()} Draw a path (P)
      </button>
    </div>
  );
}

// ---- Path ------------------------------------------------------------------

function PathPanel({ path, card }: { path: PlayPath; card: Card }) {
  const owner = card.players.find((p) => p.id === path.ownerId);
  const update = (fn: (x: PlayPath) => void) =>
    edit((_, c) => {
      const x = c.paths.find((q) => q.id === path.id);
      if (x) fn(x);
    });
  return (
    <div className="panel">
      <div className="panel-title">Path {owner ? <span className="tag">{owner.label || (owner.side === 'O' ? 'Offense' : 'Defender')}</span> : <span className="tag">Free line</span>}</div>
      <Field label="What it shows">
        <select value={path.purpose} onChange={(e) => update((x) => (x.purpose = e.target.value as PathPurpose))}>
          {PATH_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Line">
        <Seg<LineStyle>
          value={path.line}
          onChange={(v) => update((x) => (x.line = v))}
          options={[
            { v: 'solid', label: 'Solid' },
            { v: 'dashed', label: 'Dashed' },
            { v: 'zigzag', label: 'Wavy' },
          ]}
        />
      </Field>
      <Field label="Shape">
        <Seg
          value={path.curved ? 'c' : 's'}
          onChange={(v) => update((x) => (x.curved = v === 'c'))}
          options={[
            { v: 's', label: 'Straight' },
            { v: 'c', label: 'Curved' },
          ]}
        />
      </Field>
      <Field label="End">
        <Seg<EndCap>
          value={path.end}
          onChange={(v) => update((x) => (x.end = v))}
          options={[
            { v: 'arrow', label: '→' , title: 'Arrow' },
            { v: 'tee', label: '⊣', title: 'Block' },
            { v: 'dot', label: '•', title: 'Dot / spot' },
            { v: 'none', label: 'None' },
          ]}
        />
      </Field>
      <Field label="Color">
        <Inks value={path.ink} onChange={(v) => update((x) => (x.ink = v))} />
      </Field>
      <p className="muted small">Drag the white handles to reshape. Double-click the line to add a bend; ⌥-click a handle to remove it.</p>
    </div>
  );
}

// ---- Note ------------------------------------------------------------------

function NotePanel({ n, card }: { n: Note; card: Card }) {
  const update = (fn: (x: Note) => void) =>
    edit((_, c) => {
      const x = c.notes.find((q) => q.id === n.id);
      if (x) fn(x);
    });
  return (
    <div className="panel">
      <div className="panel-title">Note</div>
      <Field label="Text">
        <TextIn area value={n.text} onCommit={(v) => update((x) => (x.text = v))} />
      </Field>
      <Field label="Size">
        <Seg
          value={n.size}
          onChange={(v) => update((x) => (x.size = v))}
          options={[
            { v: 'sm', label: 'S' },
            { v: 'md', label: 'M' },
            { v: 'lg', label: 'L' },
          ]}
        />
      </Field>
      <Field label="Color">
        <Inks value={n.ink} onChange={(v) => update((x) => (x.ink = v))} />
      </Field>
      <Field label="Moves with">
        <select value={n.anchorId ?? ''} onChange={(e) => update((x) => (x.anchorId = e.target.value || null))}>
          <option value="">Nothing (stays put)</option>
          {card.players
            .filter((p) => p.label)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.side === 'D' ? 'Defender' : 'Offense'} {p.label}
              </option>
            ))}
        </select>
      </Field>
    </div>
  );
}

// ---- Multiple --------------------------------------------------------------

function MultiPanel({ count, players }: { count: number; players: Player[] }) {
  const selection = useStore((s) => s.selection);
  const sel = new Set(selection);
  const alignDepth = () => {
    const y = players[0].y;
    edit((_, c) => {
      for (const p of c.players)
        if (sel.has(p.id)) {
          const dy = y - p.y;
          p.y = y;
          for (const pa of c.paths) if (pa.ownerId === p.id) pa.points = pa.points.map((q) => ({ x: q.x, y: q.y + dy }));
        }
    });
  };
  const setInk = (ink: Ink) =>
    edit((_, c) => {
      for (const p of c.players) if (sel.has(p.id)) p.ink = ink;
      for (const p of c.paths) if (sel.has(p.id)) p.ink = ink;
      for (const n of c.notes) if (sel.has(n.id)) n.ink = ink;
    });
  return (
    <div className="panel">
      <div className="panel-title">{count} selected</div>
      <p className="muted small">Drag any of them to move together, or nudge with arrow keys.</p>
      <Field label="Color">
        <Inks value={undefined} onChange={setInk} />
      </Field>
      {players.length > 1 && (
        <button className="btn" onClick={alignDepth}>
          Line up at same depth
        </button>
      )}
    </div>
  );
}
