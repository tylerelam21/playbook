import { memo } from 'react';
import type { Card, Note, PlayPath, Player, Ruleset, Side } from '../model/types';
import { CARD_H, CARD_W, FIELD, VIEW_BOTTOM_YD, VIEW_TOP_YD, hashOffset, makeFrame, type Frame } from '../model/field';
import { arrowHead, buildPath, teeBar } from './pathGeom';
import type { Theme } from './themes';

export const FONT = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";

export interface CardSvgProps {
  card: Card;
  theme: Theme;
  ruleset: Ruleset;
  interactive?: boolean;
  selection?: string[];
  hidden?: Partial<Record<Side, boolean>>;
  watermark?: string;
  footer?: string;
  bare?: boolean; // field only, no header (look thumbnails)
  className?: string;
  svgRef?: React.Ref<SVGSVGElement>;
}

// lw = label width in Barlow Condensed Bold 19px, for a drawn underline
// (PDF output doesn't support text-decoration).
const HEADER = [
  { key: 'playNo', label: 'PLAY #', lw: 49.9, x: 50, w: 110, align: 'start' },
  { key: 'period', label: 'PERIOD', lw: 48.5, x: 175, w: 120, align: 'start' },
  { key: 'play', label: 'PLAY', lw: 34.4, x: 315, w: 430, align: 'start' },
  { key: 'defense', label: 'DEFENSE', lw: 60.1, x: 765, w: 230, align: 'start' },
  { key: 'hash', label: 'HASH', lw: 35.4, x: 1050, w: 60, align: 'end' },
] as const;

const NOTE_SIZE = { sm: 17, md: 22, lg: 30 };

// Barlow Condensed averages about 0.47em per character at weight 600.
const fitSize = (text: string, width: number, max: number, min = 14) =>
  Math.max(min, Math.min(max, width / Math.max(1, text.length * 0.47)));

export function symbolRadius(p: Player) {
  switch (p.shape) {
    case 'lineman':
      return 20;
    case 'center':
      return 18;
    case 'letter':
      return 17;
    default:
      return 14;
  }
}

function PlayerMark({ p, f, theme, selected, interactive }: { p: Player; f: Frame; theme: Theme; selected: boolean; interactive: boolean }) {
  const cx = f.toX(p.x);
  const cy = f.toY(p.y);
  const color = p.ink ? theme.ink[p.ink] : p.side === 'O' ? theme.offense : theme.defense;
  const label = p.label;
  let body: React.ReactNode;
  switch (p.shape) {
    case 'lineman':
      body = <ellipse cx={cx} cy={cy} rx={19} ry={14.5} fill={color} />;
      break;
    case 'center':
      body = <rect x={cx - 18} y={cy - 14.5} width={36} height={29} fill={color} />;
      break;
    case 'square':
      body = <rect x={cx - 12} y={cy - 12} width={24} height={24} fill={theme.paper} stroke={color} strokeWidth={3.2} />;
      break;
    case 'triangle':
      body = (
        <polygon
          points={`${cx},${cy - 14} ${cx + 13},${cy + 10} ${cx - 13},${cy + 10}`}
          fill={theme.paper}
          stroke={color}
          strokeWidth={3.2}
          strokeLinejoin="round"
        />
      );
      break;
    case 'circle':
      body = <circle cx={cx} cy={cy} r={label.length > 0 && label.length <= 2 ? 14 : 11} fill={theme.paper} stroke={color} strokeWidth={3.2} />;
      break;
    case 'letter':
      body = null;
  }
  const isLetter = p.shape === 'letter';
  const insideLabel = p.shape === 'circle' && label.length > 0 && label.length <= 2;
  const fontSize = isLetter ? 36 : insideLabel ? (label.length > 1 ? 13 : 16) : 17;
  const labelEl = label ? (
    isLetter || insideLabel ? (
      <text
        x={cx}
        y={cy + fontSize * 0.36}
        textAnchor="middle"
        fontFamily={FONT}
        fontWeight="bold"
        fontSize={fontSize}
        fill={color}
      >
        {label}
      </text>
    ) : p.shape === 'lineman' || p.shape === 'center' ? null : (
      <text x={cx + 16} y={cy - 12} fontFamily={FONT} fontWeight="bold" fontSize={fontSize} fill={color}>
        {label}
      </text>
    )
  ) : isLetter ? (
    <circle cx={cx} cy={cy} r={6} fill={color} />
  ) : null;

  return (
    <g data-kind={interactive ? 'player' : undefined} data-id={interactive ? p.id : undefined} className={interactive ? 'pl' : undefined}>
      {interactive && (
        <circle cx={cx} cy={cy} r={26} className={selected ? 'halo on' : 'halo'} />
      )}
      {body}
      {labelEl}
    </g>
  );
}

function PathMark({
  path,
  owner,
  f,
  theme,
  selected,
  interactive,
}: {
  path: PlayPath;
  owner: Player | undefined;
  f: Frame;
  theme: Theme;
  selected: boolean;
  interactive: boolean;
}) {
  const origin = owner ? { x: owner.x, y: owner.y } : path.points[0];
  const rest = owner ? path.points : path.points.slice(1);
  if (!origin) return null;
  const pts = [origin, ...rest].map(f.to);
  const geom = buildPath(pts, {
    curved: path.curved,
    zigzag: path.line === 'zigzag',
    trimStart: owner ? symbolRadius(owner) + 3 : 0,
  });
  if (!geom) return null;
  const color = theme.ink[path.ink];
  const sw = 3.4;
  const head =
    path.end === 'arrow' ? (
      <polygon points={arrowHead(geom.end, geom.angle).map((p) => `${p.x},${p.y}`).join(' ')} fill={color} />
    ) : path.end === 'tee' ? (
      (() => {
        const [a, b] = teeBar(geom.end, geom.angle);
        return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={sw} strokeLinecap="round" />;
      })()
    ) : path.end === 'dot' ? (
      <circle cx={geom.end.x} cy={geom.end.y} r={5.5} fill={color} />
    ) : null;

  return (
    <g data-kind={interactive ? 'path' : undefined} data-id={interactive ? path.id : undefined} className={interactive ? 'pa' : undefined}>
      {interactive && <path d={geom.d} className={selected ? 'path-hit on' : 'path-hit'} />}
      <path
        d={geom.d}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={path.line === 'dashed' ? '11 9' : undefined}
      />
      {head}
      {interactive && selected &&
        pts.map((p, i) =>
          i === 0 && owner ? null : (
            <circle key={i} cx={p.x} cy={p.y} r={8} className="handle" data-kind="handle" data-id={path.id} data-index={owner ? i - 1 : i} />
          ),
        )}
    </g>
  );
}

function NoteMark({ n, f, theme, selected, interactive }: { n: Note; f: Frame; theme: Theme; selected: boolean; interactive: boolean }) {
  const size = NOTE_SIZE[n.size];
  const lines = n.text.split('\n');
  const x = f.toX(n.x);
  const y = f.toY(n.y);
  const width = Math.max(...lines.map((l) => l.length)) * size * 0.5;
  return (
    <g data-kind={interactive ? 'note' : undefined} data-id={interactive ? n.id : undefined} className={interactive ? 'nt' : undefined}>
      {interactive && (
        <rect
          x={x - width / 2 - 6}
          y={y - size * 0.9}
          width={width + 12}
          height={lines.length * size * 1.05 + 8}
          rx={5}
          className={selected ? 'note-hit on' : 'note-hit'}
        />
      )}
      <text x={x} y={y} textAnchor="middle" fontFamily={FONT} fontWeight="bold" fontSize={size} fill={theme.ink[n.ink]}>
        {lines.map((l, i) => (
          <tspan key={i} x={x} dy={i === 0 ? 0 : size * 1.05}>
            {l}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function Field({ f, theme, ruleset }: { f: Frame; theme: Theme; ruleset: Ruleset }) {
  const h = hashOffset(ruleset);
  const ticks: React.ReactNode[] = [];
  for (let yd = VIEW_TOP_YD + 1; yd < VIEW_BOTTOM_YD; yd++) {
    const y = f.toY(yd) + 0.0;
    for (const side of [-1, 1]) {
      const cx = FIELD.x + FIELD.w / 2 + side * h * (FIELD.w / (160 / 3));
      ticks.push(<line key={`${yd}${side}`} x1={cx - 15} x2={cx + 15} y1={y} y2={y} stroke={theme.hash} strokeWidth={2.4} />);
    }
  }
  return (
    <g>
      <rect x={FIELD.x} y={FIELD.y} width={FIELD.w} height={FIELD.h} fill="none" stroke={theme.frame} strokeWidth={4} />
      {ticks}
    </g>
  );
}

function Header({ card, theme }: { card: Card; theme: Theme }) {
  return (
    <g>
      {HEADER.map((h) => {
        const value = String(card[h.key] ?? '');
        const size = fitSize(value, h.w, 30);
        const anchor = h.align === 'end' ? 'end' : 'start';
        return (
          <g key={h.key}>
            <text x={h.x} y={70} textAnchor={anchor} fontFamily={FONT} fontWeight="bold" fontSize={19} fill={theme.headerMuted}>
              {h.label}
            </text>
            <line
              x1={anchor === 'end' ? h.x - h.lw : h.x}
              x2={anchor === 'end' ? h.x : h.x + h.lw}
              y1={73.5}
              y2={73.5}
              stroke={theme.headerMuted}
              strokeWidth={1.6}
            />
            <text x={h.x} y={118} textAnchor={anchor} fontFamily={FONT} fontWeight="normal" fontSize={size} fill={theme.header}>
              {value}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function CardSvgImpl({ card, theme, ruleset, interactive = false, selection = [], hidden = {}, watermark, footer, bare, className, svgRef }: CardSvgProps) {
  const f = makeFrame(card.hash, ruleset);
  const byId = new Map(card.players.map((p) => [p.id, p]));
  const sel = new Set(selection);
  const visiblePlayers = card.players.filter((p) => !hidden[p.side]);
  const visiblePaths = card.paths.filter((p) => {
    const o = p.ownerId ? byId.get(p.ownerId) : undefined;
    return !o || !hidden[o.side];
  });

  return (
    <svg
      ref={svgRef}
      className={className}
      viewBox={bare ? `${FIELD.x - 4} ${FIELD.y - 4} ${FIELD.w + 8} ${FIELD.h + 8}` : `0 0 ${CARD_W} ${CARD_H}`}
      width={bare ? FIELD.w + 8 : CARD_W}
      height={bare ? FIELD.h + 8 : CARD_H}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x={0} y={0} width={CARD_W} height={CARD_H} fill={theme.paper} data-kind={interactive ? 'paper' : undefined} />
      {!bare && <Header card={card} theme={theme} />}
      <Field f={f} theme={theme} ruleset={ruleset} />
      {interactive && (
        <line
          x1={FIELD.x}
          x2={FIELD.x + FIELD.w}
          y1={f.toY(0)}
          y2={f.toY(0)}
          className="los"
        />
      )}
      {visiblePaths.map((p) => (
        <PathMark
          key={p.id}
          path={p}
          owner={p.ownerId ? byId.get(p.ownerId) : undefined}
          f={f}
          theme={theme}
          selected={sel.has(p.id)}
          interactive={interactive}
        />
      ))}
      {visiblePlayers.map((p) => (
        <PlayerMark key={p.id} p={p} f={f} theme={theme} selected={sel.has(p.id)} interactive={interactive} />
      ))}
      {card.notes.map((n) => (
        <NoteMark key={n.id} n={n} f={f} theme={theme} selected={sel.has(n.id)} interactive={interactive} />
      ))}
      {watermark && (
        <text
          x={CARD_W - 60}
          y={FIELD.y + 50}
          textAnchor="end"
          fontFamily={FONT}
          fontWeight="bold"
          fontSize={34}
          letterSpacing={6}
          fill="#d93a4a"
          opacity={0.55}
        >
          {watermark}
        </text>
      )}
      {footer && (
        <text x={CARD_W - 40} y={CARD_H - 14} textAnchor="end" fontFamily={FONT} fontSize={11} fill={theme.headerMuted} opacity={0.6}>
          {footer}
        </text>
      )}
    </svg>
  );
}

export const CardSvg = memo(CardSvgImpl);
