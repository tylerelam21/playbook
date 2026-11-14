import { memo } from 'react';
import type { Card, Note, PlayPath, Player, Ruleset, Side } from '../model/types';
import { CARD_H, CARD_W, TEACHING_PANEL, layoutFor, makeFrame, type Frame, type Rect } from '../model/field';
import { BULLET_GUTTER, COL_GAP, CONT_BOX, HEAD_SIZE, LABEL_GUTTER, LINE_H, PAD, TEXT_SIZE, colWidth, layoutTeaching, type TeachingPage } from './teachingLayout';
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
  page?: number; // install cards: 0 = the card, 1+ = continuation pages
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
      {p.read ? (
        <g>
          <circle cx={cx + 21} cy={cy - 20} r={10.5} fill={theme.paper} stroke={theme.ink.ink} strokeWidth={2} />
          <text x={cx + 21} y={cy - 20 + 5} textAnchor="middle" fontFamily={FONT} fontWeight="bold" fontSize={14} fill={theme.ink.ink}>
            {p.read}
          </text>
        </g>
      ) : null}
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

function Field({ f, theme }: { f: Frame; theme: Theme }) {
  const F = f.field;
  const ticks: React.ReactNode[] = [];
  for (let yd = f.layout.top + 1; yd < f.layout.bottom; yd++) {
    const y = f.toY(yd);
    for (const side of [-1, 1] as const) {
      const cx = f.hashX(side);
      ticks.push(<line key={`${yd}${side}`} x1={cx - 15} x2={cx + 15} y1={y} y2={y} stroke={theme.hash} strokeWidth={2.4} />);
    }
  }
  return (
    <g>
      <rect x={F.x} y={F.y} width={F.w} height={F.h} fill="none" stroke={theme.frame} strokeWidth={4} />
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

// Teaching notes laid out in columns inside a box (the panel under the field,
// or a whole continuation page). Font size is fixed; see teachingLayout.ts.
function TeachingBox({ box, page, theme, more }: { box: Rect; page: TeachingPage | undefined; theme: Theme; more: string | null }) {
  const colW = colWidth(box.w);
  return (
    <g>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="none" stroke={theme.frame} strokeWidth={2.5} />
      {page?.columns.map((col, ci) => {
        const x = box.x + PAD + ci * (colW + COL_GAP);
        return col.map(({ line, y }, li) => {
          const top = box.y + PAD + y;
          if (line.kind === 'heading')
            return (
              <text key={`${ci}-${li}`} x={x} y={top + 16} fontFamily={FONT} fontWeight="bold" fontSize={HEAD_SIZE} letterSpacing={1} fill={theme.headerMuted}>
                {line.text}
              </text>
            );
          const base = top + LINE_H - 5;
          if (line.kind === 'bullet')
            return (
              <g key={`${ci}-${li}`}>
                {line.first && <circle cx={x + 4} cy={base - 5} r={2.6} fill={theme.header} />}
                <text x={x + BULLET_GUTTER} y={base} fontFamily={FONT} fontWeight="normal" fontSize={TEXT_SIZE} fill={theme.header}>
                  {line.text}
                </text>
              </g>
            );
          const labelColor = line.ink ? theme.ink[line.ink] : line.side === 'D' ? theme.defense : theme.header;
          return (
            <g key={`${ci}-${li}`}>
              {line.label !== null && (
                <text x={x} y={base} fontFamily={FONT} fontWeight="bold" fontSize={TEXT_SIZE + 2} fill={line.orphan ? '#d93a4a' : labelColor}>
                  {line.label}
                </text>
              )}
              <text x={x + LABEL_GUTTER} y={base} fontFamily={FONT} fontWeight="normal" fontSize={TEXT_SIZE} fill={theme.header}>
                {line.text}
              </text>
            </g>
          );
        });
      })}
      {more && (
        <text x={box.x + box.w - PAD} y={box.y + box.h - 5} textAnchor="end" fontFamily={FONT} fontWeight="bold" fontSize={12} fill={theme.headerMuted}>
          {more}
        </text>
      )}
    </g>
  );
}

function ContinuationPage({ card, theme, page, index, total }: { card: Card; theme: Theme; page: TeachingPage | undefined; index: number; total: number }) {
  return (
    <g>
      <text x={50} y={70} fontFamily={FONT} fontWeight="bold" fontSize={19} fill={theme.headerMuted}>
        PLAY #{card.playNo || '—'} · CONTINUED
      </text>
      <text x={1050} y={70} textAnchor="end" fontFamily={FONT} fontWeight="bold" fontSize={19} fill={theme.headerMuted}>
        PAGE {index + 1} OF {total}
      </text>
      <text x={50} y={118} fontFamily={FONT} fontWeight="normal" fontSize={fitSize(card.play, 700, 30)} fill={theme.header}>
        {card.play}
      </text>
      <text x={1050} y={118} textAnchor="end" fontFamily={FONT} fontWeight="normal" fontSize={fitSize(card.defense, 280, 30)} fill={theme.header}>
        {card.defense}
      </text>
      <TeachingBox box={CONT_BOX} page={page} theme={theme} more={index + 1 < total ? `Continued on page ${index + 2}` : null} />
    </g>
  );
}

function CardSvgImpl({ card, theme, ruleset, interactive = false, selection = [], hidden = {}, watermark, footer, bare, page = 0, className, svgRef }: CardSvgProps) {
  const layout = layoutFor(card);
  const f = makeFrame(card.hash, ruleset, layout);
  const F = layout.field;
  const teaching = card.mode === 'install' && !bare ? layoutTeaching(card) : null;
  const byId = new Map(card.players.map((p) => [p.id, p]));
  const sel = new Set(selection);
  const visiblePlayers = card.players.filter((p) => !hidden[p.side]);
  const visiblePaths = card.paths.filter((p) => {
    const o = p.ownerId ? byId.get(p.ownerId) : undefined;
    return !o || !hidden[o.side];
  });
  const viewBox = bare ? `${F.x - 4} ${F.y - 4} ${F.w + 8} ${F.h + 8}` : `0 0 ${CARD_W} ${CARD_H}`;
  const extras = (
    <>
      {watermark && (
        <text x={CARD_W - 60} y={F.y + 50} textAnchor="end" fontFamily={FONT} fontWeight="bold" fontSize={34} letterSpacing={6} fill="#d93a4a" opacity={0.55}>
          {watermark}
        </text>
      )}
      {footer && (
        <text x={CARD_W - 40} y={CARD_H - 14} textAnchor="end" fontFamily={FONT} fontSize={11} fill={theme.headerMuted} opacity={0.6}>
          {footer}
          {teaching && teaching.totalPages > 1 ? ` · page ${page + 1}/${teaching.totalPages}` : ''}
        </text>
      )}
    </>
  );

  if (teaching && page > 0) {
    return (
      <svg ref={svgRef} className={className} viewBox={viewBox} width={CARD_W} height={CARD_H} xmlns="http://www.w3.org/2000/svg">
        <rect x={0} y={0} width={CARD_W} height={CARD_H} fill={theme.paper} />
        <ContinuationPage card={card} theme={theme} page={teaching.pages[page]} index={page} total={teaching.totalPages} />
        {extras}
      </svg>
    );
  }

  return (
    <svg
      ref={svgRef}
      className={className}
      viewBox={viewBox}
      width={bare ? F.w + 8 : CARD_W}
      height={bare ? F.h + 8 : CARD_H}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x={0} y={0} width={CARD_W} height={CARD_H} fill={theme.paper} data-kind={interactive ? 'paper' : undefined} />
      {!bare && <Header card={card} theme={theme} />}
      <Field f={f} theme={theme} />
      {interactive && <line x1={F.x} x2={F.x + F.w} y1={f.toY(0)} y2={f.toY(0)} className="los" />}
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
      {teaching && (
        <TeachingBox
          box={TEACHING_PANEL}
          page={teaching.pages[0]}
          theme={theme}
          more={teaching.totalPages > 1 ? 'Continued on page 2' : null}
        />
      )}
      {teaching?.empty && (
        <text x={TEACHING_PANEL.x + TEACHING_PANEL.w / 2} y={TEACHING_PANEL.y + TEACHING_PANEL.h / 2 + 5} textAnchor="middle" fontFamily={FONT} fontSize={15} fill={theme.headerMuted} opacity={0.6}>
          {interactive ? 'Add assignments and coaching points in the Card panel →' : ''}
        </text>
      )}
      {extras}
    </svg>
  );
}

export const CardSvg = memo(CardSvgImpl);
