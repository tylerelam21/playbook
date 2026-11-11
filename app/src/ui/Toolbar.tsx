import { PATH_PRESETS, useStore, type Tool } from '../store';
import { THEMES } from '../render/themes';
import { I, PresetGlyph } from './Icons';

const TOOLS: { key: Tool; label: string; kbd: string; icon: () => React.ReactNode }[] = [
  { key: 'select', label: 'Select & move', kbd: 'V', icon: I.select },
  { key: 'path', label: 'Draw path', kbd: 'P', icon: I.path },
  { key: 'offense', label: 'Add offensive player', kbd: 'O', icon: I.offense },
  { key: 'defense', label: 'Add defender', kbd: 'D', icon: I.defense },
  { key: 'note', label: 'Add note', kbd: 'T', icon: I.note },
];

export function Toolbar() {
  const { tool, setTool, preset, setPreset, layers, toggleLayer, zoom, setZoom } = useStore();
  return (
    <div className="toolbar">
      <div className="tool-group">
        {TOOLS.map((t) => (
          <button
            key={t.key}
            className={`tool${tool === t.key ? ' active' : ''}`}
            onClick={() => setTool(t.key)}
            title={`${t.label} (${t.kbd})`}
          >
            {t.icon()}
            <kbd>{t.kbd}</kbd>
          </button>
        ))}
      </div>

      <div className={`tool-group presets${tool === 'path' ? ' live' : ''}`}>
        {PATH_PRESETS.map((p, i) => (
          <button
            key={p.key}
            className={`preset${tool === 'path' && preset === p.key ? ' active' : ''}`}
            onClick={() => setPreset(p.key)}
            title={`${p.name} — ${p.hint} (${i + 1})`}
          >
            <PresetGlyph line={p.style.line} end={p.style.end} color={THEMES.night.ink[p.style.ink]} />
            <span>{p.name}</span>
          </button>
        ))}
      </div>

      <div className="tool-group layers">
        {(['O', 'D'] as const).map((side) => (
          <div className="layer" key={side}>
            <span className="layer-name">{side === 'O' ? 'Offense' : 'Defense'}</span>
            <button className={`mini${layers[side].visible ? '' : ' off'}`} onClick={() => toggleLayer(side, 'visible')} title={layers[side].visible ? 'Hide' : 'Show'}>
              {layers[side].visible ? I.eye() : I.eyeOff()}
            </button>
            <button className={`mini${layers[side].locked ? ' on' : ''}`} onClick={() => toggleLayer(side, 'locked')} title={layers[side].locked ? 'Unlock' : 'Lock'}>
              {layers[side].locked ? I.lock() : I.unlock()}
            </button>
          </div>
        ))}
      </div>

      <div className="tool-group zoom">
        <button className="mini" onClick={() => setZoom(zoom - 0.15)} title="Zoom out">
          {I.minus()}
        </button>
        <button className="zoom-val" onClick={() => setZoom(1)} title="Fit to screen">
          {Math.round(zoom * 100)}%
        </button>
        <button className="mini" onClick={() => setZoom(zoom + 0.15)} title="Zoom in">
          {I.plus()}
        </button>
      </div>
    </div>
  );
}
