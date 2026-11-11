import { useState } from 'react';
import { useStore } from '../store';
import { CardSvg } from '../render/CardSvg';
import { THEMES } from '../render/themes';
import type { CardStatus } from '../model/types';
import { I } from './Icons';

export const STATUS_LABEL: Record<CardStatus, string> = { draft: 'Draft', review: 'Needs review', ready: 'Ready' };

export function Sidebar({ onImport }: { onImport: () => void }) {
  const { cards, activeId, setActive, addCard, duplicateCard, deleteCard, moveCard, workspace } = useStore();
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const ready = cards.filter((c) => c.status === 'ready').length;

  return (
    <aside className="sidebar">
      <div className="side-head">
        <div>
          <div className="side-title">Packet</div>
          <div className="side-sub">
            {cards.length} cards · <span className="ready-count">{ready} ready</span>
          </div>
        </div>
        <div className="progress" title={`${ready} of ${cards.length} ready`}>
          <div style={{ width: `${(ready / cards.length) * 100}%` }} />
        </div>
      </div>

      <div className="card-list">
        {cards.map((c, i) => (
          <div
            key={c.id}
            className={`card-item${c.id === activeId ? ' active' : ''}${overIdx === i && dragIdx !== null && dragIdx !== i ? ' drop' : ''}`}
            onClick={() => setActive(c.id)}
            draggable
            onDragStart={() => setDragIdx(i)}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIdx(i);
            }}
            onDrop={() => {
              if (dragIdx !== null && dragIdx !== i) moveCard(dragIdx, i);
              setDragIdx(null);
              setOverIdx(null);
            }}
            onDragEnd={() => {
              setDragIdx(null);
              setOverIdx(null);
            }}
          >
            <div className="thumb">
              <CardSvg card={c} theme={THEMES.print} ruleset={workspace.ruleset} />
            </div>
            <div className="card-meta">
              <div className="card-row1">
                <span className="play-no">{c.playNo || '—'}</span>
                {c.period && <span className="period">{c.period}</span>}
                <span className={`status-dot ${c.status}`} title={STATUS_LABEL[c.status]} />
              </div>
              <div className="card-call" title={c.play}>
                {c.play || <em>No play call</em>}
              </div>
              <div className="card-def">
                {c.defense || <em>No defense</em>} <span className="hash-pill">{c.hash}</span>
              </div>
            </div>
            <div className="card-actions" onClick={(e) => e.stopPropagation()}>
              <button className="mini" title="Duplicate card" onClick={() => duplicateCard(c.id)}>
                {I.copy()}
              </button>
              <button className="mini danger" title="Delete card" onClick={() => deleteCard(c.id)}>
                {I.trash()}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="side-foot">
        <button className="btn primary" onClick={() => addCard(activeId)}>
          {I.plus()} New card
        </button>
        <button className="btn" onClick={onImport}>
          {I.paste()} Paste script
        </button>
      </div>
    </aside>
  );
}
