import { useState } from 'react';
import { activeCard, useStore } from '../store';
import { SIDE_NAME, latest, packetQuestions, usage, type Question } from '../model/looks';
import type { Look, Side } from '../model/types';
import { LookThumb } from './LookDialogs';
import { I } from './Icons';

function QuestionItem({ q }: { q: Question }) {
  const { looks, setActive, setModal, toast } = useStore();
  const first = q.cards[0];
  const nums = q.cards.map((c) => `#${c.playNo || '—'}`).join(', ');
  const options = looks.filter((l) => l.side === q.side);

  if (q.kind === 'undefined') {
    const drawn = q.cards.find((c) => c.players.some((p) => p.side === q.side));
    return (
      <div className="q-item">
        <div className="q-top">
          <span className="q-dot undefined" />
          <span className="q-title">{q.title}</span>
          <span className="q-count">
            {q.cards.length} card{q.cards.length > 1 ? 's' : ''}
          </span>
        </div>
        <div className="muted small">Not a saved {q.side === 'D' ? 'defense' : 'formation'} yet · {nums}</div>
        <div className="q-actions">
          <button
            className="btn small-btn"
            onClick={() => {
              const target = drawn ?? first;
              setActive(target.id);
              if (drawn) setModal({ type: 'saveLook', side: q.side, name: q.title });
              else toast(`Draw the ${q.side === 'D' ? 'defense' : 'formation'} on this card, then save it from the Card panel.`, 'info');
            }}
          >
            {drawn ? `Save from #${drawn.playNo || '—'}` : 'Draw it'}
          </button>
          {options.length > 0 && (
            <select
              value=""
              onChange={(e) =>
                e.target.value &&
                setModal({
                  type: 'applyLook',
                  lookId: e.target.value,
                  cardIds: q.cards.map((c) => c.id),
                  title: `Use a saved look for “${q.title}”`,
                  alias: q.title,
                })
              }
            >
              <option value="">It’s the same as…</option>
              {options.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    );
  }

  const look = q.look!;
  return (
    <div className="q-item">
      <div className="q-top">
        <span className={`q-dot ${q.kind}`} />
        <span className="q-title">{q.title}</span>
        <span className="q-count">
          {q.cards.length} card{q.cards.length > 1 ? 's' : ''}
        </span>
      </div>
      <div className="muted small">
        {q.kind === 'unused' ? `Saved look not applied yet · ${nums}` : `v${latest(look).v} available · ${nums} on older versions`}
      </div>
      <div className="q-actions">
        <button
          className="btn small-btn"
          onClick={() =>
            setModal({
              type: 'applyLook',
              lookId: look.id,
              cardIds: q.cards.map((c) => c.id),
              title: q.kind === 'unused' ? `Apply “${look.name}”` : `Update cards to “${look.name}” v${latest(look).v}`,
            })
          }
        >
          {q.kind === 'unused' ? 'Review & apply' : 'Review & update'}
        </button>
      </div>
    </div>
  );
}

function LookItem({ look }: { look: Look }) {
  const { cards, updateLook, deleteLook, restoreLookVersion, applyLook, toast } = useStore();
  const card = useStore(activeCard);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [aliases, setAliases] = useState<string | null>(null);
  const used = usage(look, cards);
  const v = latest(look);

  return (
    <div className={`look-item${open ? ' open' : ''}`}>
      <button className="look-row" onClick={() => setOpen(!open)}>
        <div className="look-thumb">
          <LookThumb look={look} />
        </div>
        <div className="look-meta">
          <div className="look-name">{look.name}</div>
          {look.aliases.length > 0 && <div className="look-aliases">{look.aliases.join(' · ')}</div>}
          <div className="muted small">
            v{v.v} · {used.length ? `on ${used.length} card${used.length > 1 ? 's' : ''}` : 'not used yet'}
          </div>
        </div>
      </button>
      {open && (
        <div className="look-detail">
          <button
            className="btn primary"
            onClick={() => {
              applyLook(look.id, [card.id]);
              toast(`Applied “${look.name}” to card #${card.playNo || '—'}.`, 'good');
            }}
          >
            Apply to card #{card.playNo || '—'}
          </button>
          <label className="field">
            <span>Name</span>
            <input
              value={name ?? look.name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name !== null && name.trim() && name !== look.name) updateLook(look.id, { name: name.trim() });
                setName(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
            />
          </label>
          <label className="field">
            <span>Other names (comma-separated)</span>
            <input
              value={aliases ?? look.aliases.join(', ')}
              onChange={(e) => setAliases(e.target.value)}
              onBlur={() => {
                if (aliases !== null) updateLook(look.id, { aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean) });
                setAliases(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
            />
          </label>
          <div className="panel-title">History</div>
          <div className="versions">
            {[...look.versions].reverse().map((ver) => (
              <div key={ver.v} className="version">
                <span className="tag">v{ver.v}</span>
                <span className="muted small">
                  from #{ver.fromCard} · {new Date(ver.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
                {ver.v !== v.v && (
                  <button className="link" onClick={() => restoreLookVersion(look.id, ver.v)}>
                    Restore
                  </button>
                )}
              </div>
            ))}
          </div>
          <button className="btn danger-btn" onClick={() => deleteLook(look.id)}>
            {I.trash()} Delete look
          </button>
        </div>
      )}
    </div>
  );
}

export function LooksPanel() {
  const { cards, looks } = useStore();
  const [filter, setFilter] = useState<'all' | Side>('all');
  const questions = packetQuestions(cards, looks);
  const shown = looks.filter((l) => filter === 'all' || l.side === filter).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="looks-panel">
      {questions.length > 0 && (
        <section>
          <div className="section-title">
            To resolve <span className="q-badge">{questions.length}</span>
          </div>
          <div className="q-list">
            {questions.map((q) => (
              <QuestionItem key={q.key} q={q} />
            ))}
          </div>
        </section>
      )}
      <section>
        <div className="section-title">Team looks</div>
        <div className="seg">
          {(
            [
              ['all', 'All'],
              ['O', 'Formations'],
              ['D', 'Defenses'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        {shown.length ? (
          <div className="look-list">
            {shown.map((l) => (
              <LookItem key={l.id} look={l} />
            ))}
          </div>
        ) : (
          <div className="empty">
            <strong>No {filter === 'all' ? 'looks' : SIDE_NAME[filter].toLowerCase() + 's'} saved yet</strong>
            <span>Draw a defense or formation on a card, then choose “Save as team look” in the Card panel. Draw it once, reuse it on every card that calls it.</span>
          </div>
        )}
      </section>
    </div>
  );
}
