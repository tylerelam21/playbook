import { useEffect, useState } from 'react';
import { useStore } from './store';
import { Editor } from './editor/Editor';
import { Sidebar } from './ui/Sidebar';
import { Inspector } from './ui/Inspector';
import { Toolbar } from './ui/Toolbar';
import { ExportDialog, ImportDialog } from './ui/Dialogs';
import { I } from './ui/Icons';
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

export default function App() {
  const { workspace, setTheme, setRuleset, setPacketName, undo, redo, past, future } = useStore();
  const [dialog, setDialog] = useState<'import' | 'export' | null>(null);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <circle cx="6" cy="17" r="3" />
              <path d="M9 14c3-6 6-8 10-9" />
              <path d="M15 4.5l4 .5-.5 4" />
            </svg>
          </span>
          Playbook
        </div>
        <input className="packet-name" value={workspace.packetName} onChange={(e) => setPacketName(e.target.value)} aria-label="Packet name" />
        <SavedBadge />
        <div className="spacer" />
        <button className="mini" onClick={undo} disabled={!past.length} title="Undo (⌘Z)">
          {I.undo()}
        </button>
        <button className="mini" onClick={redo} disabled={!future.length} title="Redo (⇧⌘Z)">
          {I.redo()}
        </button>
        <div className="divider" />
        <div className="themes" title="Screen style (doesn’t change the card’s meaning)">
          {(Object.keys(THEMES) as ThemeId[]).map((t) => (
            <button
              key={t}
              className={`theme-swatch${workspace.theme === t ? ' on' : ''}`}
              style={{ background: THEMES[t].paper, borderColor: THEMES[t].frame }}
              onClick={() => setTheme(t)}
              title={THEMES[t].name}
            >
              <span style={{ background: THEMES[t].ink.red }} />
              <span style={{ background: THEMES[t].ink.blue }} />
            </button>
          ))}
        </div>
        <select className="ruleset" value={workspace.ruleset} onChange={(e) => setRuleset(e.target.value as Ruleset)} title="Hash spacing">
          {(Object.keys(RULESET_LABEL) as Ruleset[]).map((r) => (
            <option key={r} value={r}>
              {RULESET_LABEL[r]} hashes
            </option>
          ))}
        </select>
        <button className="btn primary" onClick={() => setDialog('export')}>
          {I.download()} Export
        </button>
      </header>

      <Sidebar onImport={() => setDialog('import')} />
      <main className="main">
        <Toolbar />
        <Editor />
      </main>
      <Inspector />

      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} />}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
      <Toasts />
    </div>
  );
}
