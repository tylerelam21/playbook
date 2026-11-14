import { useState } from 'react';
import { activeCard, PATH_PRESETS, useStore } from '../store';
import { DEFENSE_LOOKS, OFFENSE_LOOKS } from '../model/samples';
import { clampToField, fieldLimits, describeSpot } from '../model/field';
import type { Card, CardMode, CardStatus, EndCap, Hash, Ink, LineStyle, Note, PathPurpose, PlayPath, Player, PlayerShape } from '../model/types';
import { assignmentLabel, layoutTeaching } from '../render/teachingLayout';
import { id as newId } from '../model/samples';
import { INK_ORDER, THEMES } from '../render/themes';
import { I } from './Icons';
import { SIDE_NAME, latest, sideState } from '../model/looks';
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
      if (c.looks) delete c.looks[side];
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

      <Field label="Card type">
        <Seg<CardMode>
          value={card.mode ?? 'scout'}
          onChange={(m) =>
            edit((_, c) => {
              c.mode = m;
              if (m === 'install' && !c.teaching) c.teaching = { assignments: [], cues: '' };
            })
          }
          options={[
            { v: 'scout', label: 'Scout', title: 'Field only, like your current cards' },
            { v: 'install', label: 'Install', title: 'Adds assignments and coaching points under the field' },
          ]}
        />
      </Field>
      {card.mode === 'install' && <TeachingSection card={card} />}

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

      <div className="panel-title">Looks on this card</div>
      <LookSlot card={card} side="D" onSample={(k) => applyLook('D', k)} />
      <LookSlot card={card} side="O" onSample={(k) => applyLook('O', k)} />

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

      <div className="panel-title">Read order</div>
      <Seg<string>
        value={String(p.read ?? 0)}
        onChange={(v) => update((x) => (x.read = Number(v) || undefined))}
        options={['0', '1', '2', '3', '4', '5'].map((v) => ({ v, label: v === '0' ? 'None' : v, title: v === '0' ? 'No read number' : `Read ${v}` }))}
      />
      {card.mode === 'install' && <PlayerAssignment p={p} card={card} />}

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

// ---- Saved team look for one side of the card -------------------------------

function LookSlot({ card, side, onSample }: { card: Card; side: 'O' | 'D'; onSample: (key: string) => void }) {
  const { looks, applyLook, saveLookVersion, setModal, toast } = useStore();
  const st = sideState(card, side, looks);
  const saved = looks.filter((l) => l.side === side);
  const samples = side === 'O' ? OFFENSE_LOOKS : DEFENSE_LOOKS;
  const hasPlayers = card.players.some((p) => p.side === side);
  const word = side === 'O' ? 'formation' : 'defense';
  const suggestedName = st.kind === 'unknown' ? st.call : side === 'D' ? card.defense.trim() : card.play.trim().split(/\s+/)[0] ?? '';

  const choose = (v: string) => {
    if (!v) return;
    if (v.startsWith('sample:')) return onSample(v.slice(7));
    const look = looks.find((l) => l.id === v);
    applyLook(v, [card.id]);
    if (look) toast(`Applied “${look.name}”. ⌘Z to undo.`, 'good');
  };

  const updateOthers = (lookId: string) => {
    // A changed look lists the other cards built from an older version.
    const s = useStore.getState();
    const look = s.looks.find((l) => l.id === lookId);
    if (!look) return;
    const others = s.cards.filter((c) => c.id !== card.id && c.looks?.[side]?.lookId === lookId && c.looks[side]!.v < latest(look).v);
    if (others.length)
      setModal({ type: 'applyLook', lookId, cardIds: others.map((c) => c.id), title: `“${look.name}” is now v${latest(look).v}. Update other cards?` });
    else toast(`Saved “${look.name}” v${latest(look).v}.`, 'good');
  };

  let status: React.ReactNode;
  let actions: React.ReactNode = null;
  switch (st.kind) {
    case 'applied':
      status = (
        <>
          <span className="slot-name">{st.look.name}</span>
          <span className="tag">v{st.v}</span>
          {st.edited && <span className="chip warn">edited on this card</span>}
          {!st.edited && st.outdated && <span className="chip">v{latest(st.look).v} available</span>}
        </>
      );
      actions = st.edited ? (
        <>
          <button
            className="btn"
            onClick={() => {
              saveLookVersion(st.look.id);
              updateOthers(st.look.id);
            }}
            title="Make this drawing the saved version everyone uses"
          >
            Save as v{latest(st.look).v + 1}
          </button>
          <button className="btn" onClick={() => applyLook(st.look.id, [card.id], st.v)} title={`Undo card-only changes (back to v${st.v})`}>
            Revert
          </button>
        </>
      ) : st.outdated ? (
        <button className="btn" onClick={() => applyLook(st.look.id, [card.id])}>
          Update to v{latest(st.look).v}
        </button>
      ) : null;
      break;
    case 'deleted':
      status = <span className="muted">From a deleted look (v{st.v})</span>;
      break;
    case 'matched':
      status = (
        <>
          <span className="muted">Call matches</span> <span className="slot-name">{st.look.name}</span>
        </>
      );
      actions = (
        <button className="btn primary" onClick={() => choose(st.look.id)}>
          Apply saved {word}
        </button>
      );
      break;
    case 'unknown':
      status = (
        <>
          <span className="chip warn">not saved</span> <span className="slot-name">{st.call}</span>
        </>
      );
      break;
    case 'none':
      status = <span className="muted">{hasPlayers ? 'Drawn on this card only' : `No ${word} yet`}</span>;
  }

  return (
    <div className="look-slot">
      <div className="slot-head">
        <span className="slot-side">{SIDE_NAME[side]}</span>
        <span className="slot-status">{status}</span>
      </div>
      {actions && <div className="slot-actions">{actions}</div>}
      <div className="slot-actions">
        <select value="" onChange={(e) => choose(e.target.value)}>
          <option value="">Use a look…</option>
          {saved.length > 0 && (
            <optgroup label="Team looks">
              {saved.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Samples (generic)">
            {samples.map((l) => (
              <option key={l.key} value={`sample:${l.key}`}>
                {l.name}
              </option>
            ))}
          </optgroup>
        </select>
        {hasPlayers && st.kind !== 'applied' && (
          <button className="btn" onClick={() => setModal({ type: 'saveLook', side, name: suggestedName })}>
            Save as team look
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Install card teaching notes --------------------------------------------

function TeachingSection({ card }: { card: Card }) {
  const t = card.teaching ?? { assignments: [], cues: '' };
  const layout = layoutTeaching(card);
  const assigned = new Set(t.assignments.map((a) => a.playerId));
  const playerName = (p: Player) => `${p.side === 'O' ? 'Off' : 'Def'} · ${p.label || p.shape}`;
  const open = card.players.filter((p) => !assigned.has(p.id));
  const orphans = t.assignments.filter((a) => assignmentLabel(card, a.playerId, a.label).orphan || !a.playerId).length;

  const editT = (fn: (a: NonNullable<Card['teaching']>) => void) =>
    edit((_, c) => {
      if (!c.teaching) c.teaching = { assignments: [], cues: '' };
      fn(c.teaching);
    });
  const addFor = (players: Player[]) =>
    editT((tt) => {
      for (const p of players) tt.assignments.push({ id: newId(), playerId: p.id, label: p.label, text: '' });
    });

  return (
    <>
      <div className="panel-title">
        Teaching
        <span className={`tag${layout.totalPages > 1 ? ' warn' : ''}`}>{layout.totalPages > 1 ? `${layout.totalPages} pages` : 'fits on card'}</span>
      </div>
      {layout.totalPages > 1 && (
        <p className="muted small">Extra notes continue on page 2 at the same size — text is never shrunk to fit.</p>
      )}
      {orphans > 0 && <div className="omitted small">{orphans} assignment{orphans > 1 ? 's aren’t' : ' isn’t'} linked to a player on this card. Pick the player or remove the row.</div>}
      <div className="assign-list">
        {t.assignments.map((a, i) => {
          const { label, orphan } = assignmentLabel(card, a.playerId, a.label);
          return (
            <div key={a.id} className={`assign-row${orphan || !a.playerId ? ' orphan' : ''}`}>
              <div className="assign-top">
                <select
                  value={a.playerId && !orphan ? a.playerId : ''}
                  onChange={(e) =>
                    editT((tt) => {
                      const p = card.players.find((x) => x.id === e.target.value);
                      tt.assignments[i].playerId = p?.id ?? null;
                      if (p) tt.assignments[i].label = p.label;
                    })
                  }
                >
                  {(!a.playerId || orphan) && <option value="">{label} (not on card)</option>}
                  {card.players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {playerName(p)}
                    </option>
                  ))}
                </select>
                <button className="mini" title="Remove" onClick={() => editT((tt) => tt.assignments.splice(i, 1))}>
                  {I.trash()}
                </button>
              </div>
              <TextIn area value={a.text} placeholder={`What ${label} does`} onCommit={(v) => editT((tt) => (tt.assignments[i].text = v))} />
            </div>
          );
        })}
      </div>
      <select value="" onChange={(e) => addFor(card.players.filter((p) => p.id === e.target.value))}>
        <option value="">Add an assignment for…</option>
        {open.map((p) => (
          <option key={p.id} value={p.id}>
            {playerName(p)}
          </option>
        ))}
      </select>
      <div className="grid2">
        <button className="btn" disabled={!open.some((p) => p.side === 'O')} onClick={() => addFor(open.filter((p) => p.side === 'O'))}>
          Rows for offense
        </button>
        <button className="btn" disabled={!open.some((p) => p.side === 'D')} onClick={() => addFor(open.filter((p) => p.side === 'D'))}>
          Rows for defense
        </button>
      </div>
      <p className="muted small">Empty rows don’t print, so add only the players this install needs.</p>
      <Field label="Coaching points (one per line)">
        <TextIn area value={t.cues} placeholder={'Eyes to #3\nSqueeze the B gap'} onCommit={(v) => editT((tt) => (tt.cues = v))} />
      </Field>
    </>
  );
}

function PlayerAssignment({ p, card }: { p: Player; card: Card }) {
  const idx = card.teaching?.assignments.findIndex((a) => a.playerId === p.id) ?? -1;
  const a = idx >= 0 ? card.teaching!.assignments[idx] : null;
  return (
    <Field label="Assignment on this install card">
      <TextIn
        area
        value={a?.text ?? ''}
        placeholder="What this player does"
        onCommit={(v) =>
          edit((_, c) => {
            if (!c.teaching) c.teaching = { assignments: [], cues: '' };
            const i = c.teaching.assignments.findIndex((x) => x.playerId === p.id);
            if (i >= 0) c.teaching.assignments[i].text = v;
            else if (v.trim()) c.teaching.assignments.push({ id: newId(), playerId: p.id, label: p.label, text: v });
          })
        }
      />
    </Field>
  );
}
