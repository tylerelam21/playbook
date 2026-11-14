import { useRef, useState } from 'react';
import { useStore } from '../store';
import { CardSvg } from '../render/CardSvg';
import { THEMES } from '../render/themes';
import type { CardStatus } from '../model/types';
import { I } from './Icons';
import { LooksPanel } from './LooksPanel';
import { packetQuestions } from '../model/looks';

export const STATUS_LABEL: Record<CardStatus, string> = { draft: 'Draft', review: 'Flagged to check', ready: 'Ready' };

export function Sidebar() {
  const { cards, looks, activeId, setActive, addCard, duplicateCard, deleteCard, moveCard, workspace, sideTab, setSideTab, setModal } = useStore();
  const toResolve = packetQuestions(cards, looks).length;
  const ready = cards.filter((c) => c.status === 'ready').length;
  const [menu, setMenu] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Drag-to-reorder by the grip, with mouse or finger (pointer events).
  const [drag, setDrag] = useState<{ from: number; to: number; y: number } | null>(null);

  const targetIndex = (clientY: number) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('.card-item') ?? [])];
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return items.length - 1;
  };

  return (
    <aside className="sidebar">
      <div className="side-tabs">
        <button className={sideTab === 'cards' ? 'on' : ''} onClick={() => setSideTab('cards')}>
          Cards <span className="count">{cards.length}</span>
        </button>
        <button className={sideTab === 'looks' ? 'on' : ''} onClick={() => setSideTab('looks')}>
          Looks <span className="count">{looks.length}</span>
          {toResolve > 0 && <span className="q-badge" title={`${toResolve} to resolve`}>{toResolve}</span>}
        </button>
      </div>
      {sideTab === 'looks' ? (
        <LooksPanel />
      ) : (
        <>
          <div className="side-head">
            <div>
              <div className="side-sub">
                {cards.length} cards · <span className="ready-count">{ready} ready to print</span>
              </div>
            </div>
            <div className="progress" title={`${ready} of ${cards.length} ready`}>
              <div style={{ width: `${(ready / cards.length) * 100}%` }} />
            </div>
          </div>

          <div className="card-list" ref={listRef}>
            {cards.map((c, i) => (
              <div
                key={c.id}
                className={`card-item${c.id === activeId ? ' active' : ''}${drag && drag.from === i ? ' dragging' : ''}${drag && drag.to === i && drag.from !== i ? (drag.to > drag.from ? ' drop-after' : ' drop-before') : ''}`}
                onClick={() => setActive(c.id)}
              >
                <div
                  className="grip"
                  title="Drag to reorder"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    setDrag({ from: i, to: i, y: e.clientY });
                  }}
                  onPointerMove={(e) => drag && setDrag({ ...drag, to: targetIndex(e.clientY), y: e.clientY })}
                  onPointerUp={() => {
                    if (drag && drag.to !== drag.from) moveCard(drag.from, drag.to);
                    setDrag(null);
                  }}
                  onPointerCancel={() => setDrag(null)}
                >
                  {I.grip()}
                </div>
                <div className="thumb">
                  <CardSvg card={c} theme={THEMES.print} ruleset={workspace.ruleset} />
                </div>
                <div className="card-meta">
                  <div className="card-row1">
                    <span className="play-no">{c.playNo || '—'}</span>
                    {c.period && <span className="period">{c.period}</span>}
                    {c.mode === 'install' && <span className="period">INSTALL</span>}
                    <span className={`status-dot ${c.status}`} title={STATUS_LABEL[c.status]} />
                  </div>
                  <div className="card-call" title={c.play}>
                    {c.play || <em>No play call</em>}
                  </div>
                  <div className="card-def">
                    {c.defense || <em>No defense</em>} <span className="hash-pill">{c.hash}</span>
                  </div>
                </div>
                <button
                  className="mini card-more"
                  aria-label="Card actions"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenu(menu === c.id ? null : c.id);
                  }}
                >
                  {I.more()}
                </button>
                {menu === c.id && (
                  <>
                    <div className="pop-scrim" onPointerDown={(e) => (e.stopPropagation(), setMenu(null))} onClick={(e) => e.stopPropagation()} />
                    <div className="popover card-menu" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => (duplicateCard(c.id), setMenu(null))}>{I.copy()} Duplicate</button>
                      <button disabled={i === 0} onClick={() => (moveCard(i, i - 1), setMenu(null))}>↑ Move up</button>
                      <button disabled={i === cards.length - 1} onClick={() => (moveCard(i, i + 1), setMenu(null))}>↓ Move down</button>
                      <button className="danger" onClick={() => (deleteCard(c.id), setMenu(null))}>{I.trash()} Delete</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="side-foot">
            <button className="btn primary" onClick={() => addCard(activeId)}>
              {I.plus()} New card
            </button>
            <button className="btn" onClick={() => setModal({ type: 'import' })}>
              {I.paste()} Paste script
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
