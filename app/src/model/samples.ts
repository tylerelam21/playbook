import { nanoid } from 'nanoid';
import type { Card, Ink, Note, PlayPath, Player, PlayerShape, Pt, Side } from './types';

// Generic starting looks. These are labeled "Sample" in the UI: they are
// conveniences, not a team's approved definitions.

export const id = () => nanoid(10);

const OL_SPLIT = 2.2;
const OL_Y = -0.8;
const DL_Y = 1.3;

type Spec = [label: string, x: number, y: number, shape?: PlayerShape];

function players(side: Side, specs: Spec[]): Player[] {
  return specs.map(([label, x, y, shape]) => ({
    id: id(),
    side,
    label,
    x,
    y,
    shape: shape ?? (side === 'O' ? 'circle' : 'letter'),
  }));
}

export function offensiveLine(): Player[] {
  return players('O', [
    ['LT', -2 * OL_SPLIT, OL_Y, 'lineman'],
    ['LG', -OL_SPLIT, OL_Y, 'lineman'],
    ['C', 0, OL_Y, 'center'],
    ['RG', OL_SPLIT, OL_Y, 'lineman'],
    ['RT', 2 * OL_SPLIT, OL_Y, 'lineman'],
  ]);
}

export interface LookTemplate {
  key: string;
  name: string;
  side: Side;
  build: () => Player[];
}

// Card x is "as printed" (defense view), so the offense's right is card-left.
export const OFFENSE_LOOKS: LookTemplate[] = [
  {
    key: 'o-2x2',
    name: '2x2 Gun',
    side: 'O',
    build: () => [
      ...offensiveLine(),
      ...players('O', [
        ['X', 21, -1],
        ['H', 12, -1.8],
        ['Y', -12, -1.8],
        ['Z', -21, -1],
        ['Q', 0, -5],
        ['R', -1.8, -5],
      ]),
    ],
  },
  {
    key: 'o-3x1',
    name: 'Trips Gun',
    side: 'O',
    build: () => [
      ...offensiveLine(),
      ...players('O', [
        ['Z', -21, -1],
        ['H', -15, -1.8],
        ['Y', -9, -1.8],
        ['X', 21, -1],
        ['Q', 0, -5],
        ['R', 1.8, -5],
      ]),
    ],
  },
  {
    key: 'o-pistol',
    name: 'Pistol 2x1 Wing',
    side: 'O',
    build: () => [
      ...offensiveLine(),
      ...players('O', [
        ['X', 21, -1],
        ['H', 13, -1.8],
        ['Y', -6.6, OL_Y],
        ['Z', -18, -1],
        ['Q', 0, -3.5],
        ['R', 0, -6],
      ]),
    ],
  },
  {
    key: 'o-i',
    name: 'I-Form Pro',
    side: 'O',
    build: () => [
      ...offensiveLine(),
      ...players('O', [
        ['X', 19, -1],
        ['Y', -6.6, OL_Y],
        ['Z', -19, -1.6],
        ['Q', 0, -1.6],
        ['F', 0, -4.5],
        ['T', 0, -6.2],
      ]),
    ],
  },
  {
    key: 'o-ol',
    name: 'Line only',
    side: 'O',
    build: () => offensiveLine(),
  },
];

export const DEFENSE_LOOKS: LookTemplate[] = [
  {
    key: 'd-425',
    name: '4-2-5',
    side: 'D',
    build: () =>
      players('D', [
        ['E', -6.8, DL_Y],
        ['N', -1, DL_Y],
        ['T', 3.3, DL_Y],
        ['E', 6.6, DL_Y],
        ['M', -2, 4.6],
        ['W', 2.6, 4.6],
        ['N', -12, 4.2],
        ['$', -8, 9.5],
        ['C', -20, 6.5],
        ['C', 20, 6.5],
        ['F', 7, 10],
      ]),
  },
  {
    key: 'd-335',
    name: '3-3-5 Stack',
    side: 'D',
    build: () =>
      players('D', [
        ['E', -4.4, DL_Y],
        ['N', 0, DL_Y],
        ['E', 4.4, DL_Y],
        ['S', -4.4, 4.6],
        ['M', 0, 4.6],
        ['W', 4.4, 4.6],
        ['N', -12, 4.5],
        ['$', 12, 4.5],
        ['C', -20, 6.5],
        ['C', 20, 6.5],
        ['F', 0, 10],
      ]),
  },
  {
    key: 'd-43',
    name: '4-3 Over',
    side: 'D',
    build: () =>
      players('D', [
        ['E', -6.8, DL_Y],
        ['T', -3.3, DL_Y],
        ['N', 1, DL_Y],
        ['E', 6.8, DL_Y],
        ['S', -7.5, 4],
        ['M', 0, 4.6],
        ['W', 4, 4.6],
        ['$', -6, 9.5],
        ['C', -20, 6.5],
        ['C', 20, 6.5],
        ['F', 6, 10.5],
      ]),
  },
];

// ---- Seed packet modeled on the supplied scout cards -----------------------

function path(
  owner: Player | null,
  purpose: PlayPath['purpose'],
  points: Pt[],
  o: Partial<PlayPath> = {},
): PlayPath {
  const defaults: Record<PlayPath['purpose'], Pick<PlayPath, 'line' | 'end' | 'ink' | 'curved'>> = {
    rush: { line: 'solid', end: 'arrow', ink: 'red', curved: true },
    drop: { line: 'solid', end: 'arrow', ink: 'blue', curved: true },
    motion: { line: 'zigzag', end: 'none', ink: 'blue', curved: false },
    route: { line: 'solid', end: 'arrow', ink: 'ink', curved: true },
    block: { line: 'solid', end: 'tee', ink: 'ink', curved: false },
    other: { line: 'solid', end: 'arrow', ink: 'ink', curved: false },
  };
  return { id: id(), ownerId: owner?.id ?? null, purpose, points, ...defaults[purpose], ...o };
}

function note(text: string, x: number, y: number, ink: Ink, anchor: Player | null = null): Note {
  return { id: id(), text, x, y, ink, size: 'sm', anchorId: anchor?.id ?? null };
}

function blank(over: Partial<Card>): Card {
  return {
    id: id(),
    playNo: '',
    period: '',
    play: '',
    defense: '',
    hash: 'M',
    status: 'draft',
    players: [],
    paths: [],
    notes: [],
    version: 1,
    updatedAt: Date.now(),
    ...over,
  };
}

export function blankCard(playNo = ''): Card {
  return blank({ playNo, players: offensiveLine() });
}

function find(ps: Player[], label: string, nth = 0) {
  return ps.filter((p) => p.label === label)[nth];
}

export function seedPacket(): Card[] {
  // Card 1
  const o1 = [
    ...offensiveLine(),
    ...players('O', [
      ['', 17.5, -1],
      ['', 11, -1.6],
      ['', -6.6, OL_Y],
      ['', -7.5, -1.8],
    ]),
  ];
  const d1 = DEFENSE_LOOKS[0].build();
  const [N1, T1, E2] = [find(d1, 'N'), find(d1, 'T'), find(d1, 'E', 1)];
  const M1 = find(d1, 'M');
  const W1 = find(d1, 'W');
  const F1 = find(d1, 'F');
  const C1 = find(d1, 'C');
  const C2 = find(d1, 'C', 1);
  const S1 = find(d1, '$');
  const NB1 = find(d1, 'N', 1);
  C2.x = 16.5;
  F1.x = 0.4;
  F1.y = 8;
  const card1 = blank({
    playNo: '1',
    period: 'WIT',
    play: 'LARRY SNIFF 23 TRAIL @ LOAD',
    defense: 'M FS TRAIL',
    hash: 'L',
    players: [...o1, ...d1],
    paths: [
      path(N1, 'rush', [{ x: -1.6, y: 0.2 }, { x: -1.2, y: -1.4 }]),
      path(M1, 'rush', [{ x: -0.6, y: 2.6 }, { x: 0.6, y: 0.6 }, { x: 0.8, y: -1.8 }]),
      path(T1, 'rush', [{ x: 3.6, y: 0.6 }, { x: 3.4, y: -1.2 }]),
      path(E2, 'rush', [{ x: 6.2, y: -1.1 }], { curved: false }),
      path(F1, 'drop', [{ x: 0.2, y: 2 }, { x: -0.1, y: -2.4 }]),
      path(C1, 'drop', [{ x: -20, y: 9.5 }], { curved: false }),
      path(S1, 'drop', [{ x: -5.6, y: 10.2 }, { x: -4, y: 11.4 }], { end: 'dot' }),
      path(NB1, 'motion', [{ x: -12, y: 2.8 }], { end: 'none' }),
      path(C2, 'motion', [{ x: 17.5, y: 7.6 }], { end: 'none' }),
    ],
    notes: [note('SLOW FIT', W1.x + 1.6, W1.y + 1.1, 'blue', W1)],
  });

  // Card 2
  const o2 = [
    ...offensiveLine(),
    ...players('O', [
      ['', -18, -1],
      ['', -9, -1.4],
      ['Q', -4.6, -1.6],
      ['+', 0, -5.5],
      ['Q', 17, -1.2],
    ]),
  ];
  const d2 = DEFENSE_LOOKS[0].build();
  const C3 = find(d2, 'C', 1);
  const F2 = find(d2, 'F');
  const N2 = find(d2, 'N');
  const T2 = find(d2, 'T');
  const E3 = find(d2, 'E', 1);
  const W2 = find(d2, 'W');
  C3.x = 17;
  C3.y = 1.6;
  find(d2, 'C').x = -18;
  F2.x = 12;
  F2.y = 9.5;
  const card2 = blank({
    playNo: '4b',
    period: 'WIT',
    play: 'PISTOL RICH 14 FORCE RIVER @ BROWN',
    defense: 'CHOP',
    hash: 'L',
    players: [...o2, ...d2],
    paths: [
      path(N2, 'rush', [{ x: -2.6, y: 0.4 }, { x: -2.8, y: -1.2 }], { curved: false }),
      path(T2, 'rush', [{ x: 1.4, y: 0.6 }, { x: 1.2, y: -1.4 }], { curved: false }),
      path(E3, 'rush', [{ x: 4.6, y: 0.8 }, { x: 4.4, y: -1.4 }], { curved: false }),
      path(C3, 'rush', [{ x: 8, y: -3.4 }], { curved: false, end: 'dot' }),
      path(F2, 'drop', [{ x: 16.6, y: 2.4 }], { line: 'dashed', end: 'none', curved: false }),
      path(W2, 'motion', [{ x: 1.8, y: 2.6 }], { ink: 'red', end: 'none' }),
    ],
  });

  // Card 3
  const o3 = [
    ...offensiveLine(),
    ...players('O', [
      ['', 17.5, -1.2],
      ['', 11.5, -2.2],
      ['', -4.8, -1.6],
      ['', -19.5, -0.8],
    ]),
  ];
  const ol3 = o3.slice(0, 5);
  const d3 = DEFENSE_LOOKS[0].build();
  const E4 = find(d3, 'E');
  const M3 = find(d3, 'M');
  const W3 = find(d3, 'W');
  const NB3 = find(d3, 'N', 1);
  find(d3, 'C', 1).x = 16.5;
  const card3 = blank({
    playNo: '3',
    period: 'WIT',
    play: 'ROY 25 BASH @ 9 DART',
    defense: '4 INV',
    hash: 'L',
    players: [...o3, ...d3],
    paths: [
      path(E4, 'rush', [{ x: -5.6, y: -0.6 }, { x: -4.4, y: -1.3 }], { end: 'dot' }),
      path(ol3[0], 'block', [{ x: -3.6, y: -2.1 }, { x: 1.2, y: -2.1 }], { end: 'arrow' }),
      path(ol3[1], 'block', [{ x: -1.8, y: -1.6 }, { x: 4, y: -1.6 }], { end: 'arrow' }),
      path(M3, 'drop', [{ x: -0.4, y: 4.2 }, { x: -2.6, y: 3.2 }]),
      path(W3, 'drop', [{ x: 4.6, y: 4 }, { x: 6, y: 2.8 }]),
      path(NB3, 'motion', [{ x: -12, y: 2.4 }], { end: 'none' }),
    ],
    notes: [
      note('BEND', E4.x, E4.y + 1.4, 'red', E4),
      note('RIP', NB3.x, NB3.y + 1.4, 'blue', NB3),
    ],
  });

  return [card1, card3, card2].map((c, i) => ({ ...c, updatedAt: Date.now() - i }));
}
