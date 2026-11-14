import { useEffect, useState } from 'react';
import { useStore } from './store';
import { Editor } from './editor/Editor';
import { Sidebar } from './ui/Sidebar';
import { Inspector } from './ui/Inspector';
import { Toolbar } from './ui/Toolbar';
import { ExportDialog, ImportDialog } from './ui/Dialogs';
import { ApplyLookDialog, SaveLookDialog } from './ui/LookDialogs';
import { I } from './ui/Icons';
import { useDevice } from './ui/useDevice';
import { THEMES } from './render/themes';
import { RULESET_LABEL } from './model/field';
import type { Ruleset, ThemeId } from './model/types';

function SavedBadge() {
  const savedAt = useStore((s) => s.savedAt);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 15000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.round((Date.now() - savedAt) / 1000);
  return (
    <span className="saved" key={savedAt}>
      <span className="saved-dot" /> Saved {secs < 10 ? 'just now' : secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`}
    </span>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Popover({ children, onClose, className }: { children: React.ReactNode; onClose: () => void; className?: string }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <>
      <div className="pop-scrim" onPointerDown={onClose} />
      <div className={`popover ${className ?? ''}`}>{children}</div>
    </>
  );
}

function SettingsMenu({ onClose, showKeys }: { onClose: () => void; showKeys: boolean }) {
  const { workspace, setTheme, setRuleset } = useStore();
  return (
    <Popover onClose={onClose} className="settings-pop">
      <div className="panel-title">Screen style</div>
      <div className="theme-grid">
        {(Object.keys(THEMES) as ThemeId[]).map((t) => (
          <button key={t} className={`theme-choice${workspace.theme === t ? ' on' : ''}`} onClick={() => setTheme(t)}>
            <span className="theme-swatch" style={{ background: THEMES[t].paper, borderColor: THEMES[t].frame }}>
              <span style={{ background: THEMES[t].ink.red }} />
              <span style={{ background: THEMES[t].ink.blue }} />
            </span>
            {THEMES[t].name}
          </button>
        ))}
      </div>
      <p className="muted small">Only changes how cards look on screen. Exports use print colors.</p>
      <div className="panel-title">Hash marks</div>
      <div className="seg">
        {(Object.keys(RULESET_LABEL) as Ruleset[]).map((r) => (
          <button key={r} className={workspace.ruleset === r ? 'on' : ''} onClick={() => setRuleset(r)}>
            {RULESET_LABEL[r]}
          </button>
        ))}
      </div>
      {showKeys && (
        <>
          <div className="panel-title">Keyboard shortcuts</div>
          <ul className="keys">
            <li><kbd>hold M</kbd> talk · <kbd>/</kbd> type a change</li>
            <li><kbd>V</kbd> select · <kbd>P</kbd> draw · <kbd>D</kbd> / <kbd>O</kbd> add player · <kbd>T</kbd> note</li>
            <li><kbd>1</kbd>–<kbd>6</kbd> line type while drawing</li>
            <li><kbd>←</kbd><kbd>→</kbd> nudge ½ yd · <kbd>⇧</kbd> 2 yd</li>
            <li><kbd>⌥</kbd>-drag leaves a player’s path in place</li>
            <li><kbd>⌘D</kbd> duplicate · <kbd>⌘Z</kbd> undo · right-click for more</li>
          </ul>
        </>
      )}
    </Popover>
  );
}

export default function App() {
  const { workspace, setPacketName, undo, redo, past, future, modal, setModal, drawer, setDrawer, selection, activeId } = useStore();
  const device = useDevice();
  const [settings, setSettings] = useState(false);
  const close = () => setModal(null);
  const compact = device.kind !== 'desktop';

  // On tablet and phone, picking a card closes the card list.
  useEffect(() => {
    if (compact) setDrawer('none');
  }, [activeId, compact, setDrawer]);

  const selCount = selection.length;

  return (
    <div className={`app device-${device.kind}${device.touch ? ' touch' : ''}${compact && drawer !== 'none' ? ` drawer-${drawer}` : ''}`}>
      <header className="topbar">
        {compact && (
          <button className={`mini big${drawer === 'cards' ? ' on-accent' : ''}`} onClick={() => setDrawer(drawer === 'cards' ? 'none' : 'cards')} aria-label="Cards and looks" title="Cards and looks">
            {I.cards()}
          </button>
        )}
        <div className="brand">
          <span className="logo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <circle cx="6" cy="17" r="3" />
              <path d="M9 14c3-6 6-8 10-9" />
              <path d="M15 4.5l4 .5-.5 4" />
            </svg>
          </span>
          {device.kind === 'desktop' && 'Playbook'}
        </div>
        <input className="packet-name" value={workspace.packetName} onChange={(e) => setPacketName(e.target.value)} aria-label="Packet name" />
        {device.kind !== 'phone' && <SavedBadge />}
        <div className="spacer" />
        <button className="mini big" onClick={undo} disabled={!past.length} title="Undo (⌘Z)" aria-label="Undo">
          {I.undo()}
        </button>
        <button className="mini big" onClick={redo} disabled={!future.length} title="Redo (⇧⌘Z)" aria-label="Redo">
          {I.redo()}
        </button>
        <button className="mini big" onClick={() => setSettings(true)} title="Settings" aria-label="Settings">
          {I.gear()}
        </button>
        {compact && (
          <button className={`mini big${drawer === 'details' ? ' on-accent' : ''}`} onClick={() => setDrawer(drawer === 'details' ? 'none' : 'details')} aria-label="Card details" title="Card details">
            {I.sliders()}
          </button>
        )}
        <button className="btn primary" onClick={() => setModal({ type: 'export' })} aria-label="Export">
          {I.download()} {device.kind !== 'phone' && 'Export'}
        </button>
        {settings && <SettingsMenu onClose={() => setSettings(false)} showKeys={!device.touch} />}
      </header>

      <Sidebar />
      <main className="main">
        <Toolbar />
        <Editor />
        {compact && selCount > 0 && drawer !== 'details' && (
          <button className="selection-chip" onClick={() => setDrawer('details')}>
            {selCount === 1 ? '1 selected' : `${selCount} selected`} · Details
          </button>
        )}
      </main>
      <Inspector />
      {compact && drawer !== 'none' && <div className="drawer-scrim" onPointerDown={() => setDrawer('none')} />}

      {modal?.type === 'import' && <ImportDialog onClose={close} />}
      {modal?.type === 'export' && <ExportDialog onClose={close} />}
      {modal?.type === 'saveLook' && <SaveLookDialog key={modal.side + modal.name} side={modal.side} name={modal.name} onClose={close} />}
      {modal?.type === 'applyLook' && (
        <ApplyLookDialog key={modal.lookId + modal.cardIds.join()} lookId={modal.lookId} cardIds={modal.cardIds} title={modal.title} alias={modal.alias} onClose={close} />
      )}
      <Toasts />
    </div>
  );
}
