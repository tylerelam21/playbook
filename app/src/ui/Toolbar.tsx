import { useState } from 'react';
import { PATH_PRESETS, useStore, type Tool } from '../store';
import { THEMES } from '../render/themes';
import { I, PresetGlyph } from './Icons';
import { useDevice } from './useDevice';

const TOOLS: { key: Tool; label: string; kbd: string; icon: () => React.ReactNode }[] = [
  { key: 'select', label: 'Move', kbd: 'V', icon: I.select },
  { key: 'path', label: 'Draw', kbd: 'P', icon: I.path },
  { key: 'defense', label: 'Defender', kbd: 'D', icon: I.defense },
  { key: 'offense', label: 'Offense', kbd: 'O', icon: I.offense },
  { key: 'note', label: 'Note', kbd: 'T', icon: I.note },
];

export function Toolbar() {
  const { tool, setTool, preset, setPreset, layers, toggleLayer, zoom, setZoom } = useStore();
  const device = useDevice();
  const [view, setView] = useState(false);
  const showKbd = !device.touch;

  return (
    <div className="toolbar">
      <div className="tool-group tools">
        {TOOLS.map((t) => (
          <button
            key={t.key}
            className={`tool${tool === t.key ? ' active' : ''}`}
            onClick={() => setTool(t.key)}
            title={showKbd ? `${t.label} (${t.kbd})` : t.label}
            aria-label={t.label}
          >
            {t.icon()}
            <span className="tool-label">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Line types only matter while drawing. */}
      {tool === 'path' && (
        <div className="tool-group presets live">
          {PATH_PRESETS.map((p, i) => (
            <button
              key={p.key}
              className={`preset${preset === p.key ? ' active' : ''}`}
              onClick={() => setPreset(p.key)}
              title={showKbd ? `${p.name} — ${p.hint} (${i + 1})` : p.name}
            >
              <PresetGlyph line={p.style.line} end={p.style.end} color={THEMES.night.ink[p.style.ink]} />
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="toolbar-end">
        <button className={`mini big${view ? ' on-accent' : ''}`} onClick={() => setView(!view)} title="View: layers and zoom" aria-label="View options">
          {I.view()}
        </button>
        {view && (
          <>
            <div className="pop-scrim" onPointerDown={() => setView(false)} />
            <div className="popover view-pop">
              <div className="panel-title">Layers</div>
              {(['D', 'O'] as const).map((side) => (
                <div className="layer-row" key={side}>
                  <span>{side === 'O' ? 'Offense' : 'Defense'}</span>
                  <button className={`chip-btn${layers[side].visible ? ' on' : ''}`} onClick={() => toggleLayer(side, 'visible')}>
                    {layers[side].visible ? I.eye() : I.eyeOff()} {layers[side].visible ? 'Shown' : 'Hidden'}
                  </button>
                  <button className={`chip-btn${layers[side].locked ? ' warn' : ''}`} onClick={() => toggleLayer(side, 'locked')}>
                    {layers[side].locked ? I.lock() : I.unlock()} {layers[side].locked ? 'Locked' : 'Editable'}
                  </button>
                </div>
              ))}
              <div className="panel-title">Zoom</div>
              <div className="zoom-row">
                <button className="mini big" onClick={() => setZoom(zoom - 0.15)} aria-label="Zoom out">
                  {I.minus()}
                </button>
                <button className="zoom-val" onClick={() => setZoom(1)}>
                  {Math.round(zoom * 100)}% · fit
                </button>
                <button className="mini big" onClick={() => setZoom(zoom + 0.15)} aria-label="Zoom in">
                  {I.plus()}
                </button>
              </div>
              {device.touch && <p className="muted small">Pinch the card to zoom.</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
