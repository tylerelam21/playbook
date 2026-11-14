import { useMemo, useState } from 'react';
import { activeCard, useStore } from '../store';
import { CardSvg } from '../render/CardSvg';
import { THEMES } from '../render/themes';
import { SIDE_NAME, latest, matchLook, normalize, sideSignature } from '../model/looks';
import type { Card, Look, LookVersion } from '../model/types';
import { Modal } from './Dialogs';

// Field-only drawing of one look version.
export function LookThumb({ look, version }: { look: Look; version?: LookVersion }) {
  const workspace = useStore((s) => s.workspace);
  const v = version ?? latest(look);
  const card = useMemo<Card>(
    () => ({
      id: `thumb-${look.id}-${v.v}`,
      playNo: '',
      period: '',
      play: '',
      defense: '',
      hash: 'M',
      status: 'draft',
      players: v.players,
      paths: v.paths,
      notes: v.notes,
      version: 1,
      updatedAt: 0,
    }),
    [look.id, v],
  );
  return <CardSvg card={card} theme={THEMES.print} ruleset={workspace.ruleset} bare />;
}

const splitAliases = (s: string) =>
  s
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);

// ---- Save the current card's offense or defense as a team look -------------

export function SaveLookDialog({ side, name: initial, onClose }: { side: 'O' | 'D'; name: string; onClose: () => void }) {
  const { looks, cards, saveLook, setModal, toast } = useStore();
  const card = useStore(activeCard);
  const [name, setName] = useState(initial);
  const [aliases, setAliases] = useState('');
  const clash = looks.find((l) => l.side === side && [l.name, ...l.aliases].some((n) => normalize(n) === normalize(name)));
  const count = card.players.filter((p) => p.side === side).length;

  const save = () => {
    const look = saveLook(side, name, splitAliases(aliases));
    if (!look) return;
    toast(`Saved “${look.name}” to your team looks.`, 'good');
    // Offer it everywhere else the script calls it.
    const after = useStore.getState().looks;
    const others = cards.filter((c) => c.id !== card.id && !c.looks?.[side] && matchLook(c, side, after)?.look.id === look.id);
    if (others.length) {
      setModal({ type: 'applyLook', lookId: look.id, cardIds: others.map((c) => c.id), title: `Use “${look.name}” on the other cards that call it?` });
    } else onClose();
  };

  return (
    <Modal title={`Save ${side === 'O' ? 'formation' : 'defense'} as a team look`} onClose={onClose}>
      <p className="muted">
        Saves the {count} {side === 'O' ? 'offensive players' : 'defenders'} on card #{card.playNo || '—'}, with their paths and notes. Cards whose{' '}
        {side === 'O' ? 'play call starts with' : 'defense call matches'} this name will find it.
      </p>
      <label className="field">
        <span>Name (as it appears in your script)</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && !clash && save()} />
      </label>
      <label className="field">
        <span>Other names for it (optional, comma-separated)</span>
        <input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder={side === 'D' ? 'e.g. CHOP 3, CHOPPER' : 'e.g. LARRY, LAR'} />
      </label>
      {clash && <div className="omitted">“{clash.name}” already uses that name. Pick another, or update that look from its panel.</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!name.trim() || !!clash} onClick={save}>
          Save look
        </button>
      </div>
    </Modal>
  );
}

// ---- Apply a look to several cards, with a preview -------------------------

export function ApplyLookDialog({
  lookId,
  cardIds,
  title,
  alias,
  onClose,
}: {
  lookId: string;
  cardIds: string[];
  title: string;
  alias?: string;
  onClose: () => void;
}) {
  const { looks, cards, applyLook, updateLook, toast } = useStore();
  const look = looks.find((l) => l.id === lookId);
  const rows = cards
    .filter((c) => cardIds.includes(c.id))
    .map((c) => {
      const ref = look ? c.looks?.[look.side] : undefined;
      const edited = !!ref && sideSignature(c, look!.side) !== ref.sig;
      const ready = c.status === 'ready';
      const note = ready
        ? 'Ready — keeps its current version unless you include it'
        : edited
          ? 'Has changes made on this card — they’d be replaced'
          : ref && look && ref.lookId === look.id
            ? `On v${ref.v}`
            : c.players.some((p) => p.side === look?.side)
              ? `Replaces the ${look?.side === 'O' ? 'offense' : 'defense'} drawn now`
              : 'Nothing drawn yet';
      return { c, note, defaultOn: !ready && !edited };
    });
  const [on, setOn] = useState<Set<string>>(() => new Set(rows.filter((r) => r.defaultOn).map((r) => r.c.id)));
  const [remember, setRemember] = useState(true);
  if (!look) return null;
  const v = latest(look);

  const apply = () => {
    if (alias && remember && !look.aliases.some((a) => normalize(a) === normalize(alias)) && normalize(look.name) !== normalize(alias)) {
      updateLook(look.id, { aliases: [...look.aliases, alias] });
    }
    applyLook(look.id, [...on]);
    toast(`Applied “${look.name}” v${v.v} to ${on.size} card${on.size === 1 ? '' : 's'}.`, 'good');
    onClose();
  };

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="apply-head">
        <div className="look-thumb big">
          <LookThumb look={look} />
        </div>
        <div>
          <div className="look-name">
            {look.name} <span className="tag">v{v.v}</span>
          </div>
          <div className="muted small">
            {SIDE_NAME[look.side]} · {v.players.length} players · saved from card #{v.fromCard}
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            Only the {look.side === 'O' ? 'offense' : 'defense'} changes. Calls, hash, notes and the other side stay as they are. ⌘Z undoes it.
          </p>
        </div>
      </div>
      <div className="apply-list">
        {rows.map(({ c, note }) => (
          <label key={c.id} className={`apply-row${on.has(c.id) ? ' on' : ''}`}>
            <input
              type="checkbox"
              checked={on.has(c.id)}
              onChange={(e) => {
                const n = new Set(on);
                if (e.target.checked) n.add(c.id);
                else n.delete(c.id);
                setOn(n);
              }}
            />
            <span className="play-no">{c.playNo || '—'}</span>
            <span className="apply-call">
              <strong>{c.play || 'No play call'}</strong>
              <span className="muted">{c.defense}</span>
            </span>
            <span className={`apply-note${c.status === 'ready' ? ' warn' : ''}`}>{note}</span>
          </label>
        ))}
      </div>
      {alias && (
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember “{alias}” as another name for {look.name}
        </label>
      )}
      <div className="modal-foot">
        <span className="muted small">
          {on.size} of {rows.length} selected
        </span>
        <button className="btn" onClick={onClose}>
          Not now
        </button>
        <button className="btn primary" disabled={!on.size} onClick={apply}>
          Apply to {on.size} card{on.size === 1 ? '' : 's'}
        </button>
      </div>
    </Modal>
  );
}
