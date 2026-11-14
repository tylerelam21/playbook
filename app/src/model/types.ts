// Canonical card state. Every renderer (editor canvas, thumbnails, PDF, PPTX)
// reads from these records, so football meaning lives in one place.
//
// Coordinates are in yards, relative to the ball:
//   x: lateral yards, positive = right side of the card as printed
//   y: yards from the line of scrimmage, positive = toward the defense
//      (down the card), negative = offensive backfield.
// Screen zoom and export size never change these numbers.

export type Side = 'O' | 'D';

export type PlayerShape =
  | 'lineman' // filled oval
  | 'center' // filled square
  | 'circle' // hollow circle (skill player)
  | 'letter' // label only (defense default)
  | 'triangle'
  | 'square';

export interface Player {
  id: string;
  side: Side;
  label: string;
  shape: PlayerShape;
  x: number;
  y: number;
  ink?: Ink; // optional emphasis; color never carries meaning on its own
}

export type PathPurpose = 'route' | 'rush' | 'drop' | 'motion' | 'block' | 'other';
export type LineStyle = 'solid' | 'dashed' | 'zigzag';
export type EndCap = 'arrow' | 'tee' | 'dot' | 'none';

// Ink is a palette token, not a hex value, so themes (print, mono, chalk)
// can restyle a card without changing what it means.
export type Ink = 'ink' | 'red' | 'blue' | 'green' | 'orange' | 'purple';

export interface Pt {
  x: number;
  y: number;
}

export interface PlayPath {
  id: string;
  ownerId: string | null; // null = free annotation
  purpose: PathPurpose;
  // Points after the origin. The origin is the owner's position (or the first
  // point, for a free annotation).
  points: Pt[];
  line: LineStyle;
  curved: boolean;
  end: EndCap;
  ink: Ink;
}

export interface Note {
  id: string;
  text: string;
  x: number;
  y: number;
  ink: Ink;
  size: 'sm' | 'md' | 'lg';
  anchorId: string | null; // moves with this player when set
}

export type Hash = 'L' | 'M' | 'R';
export type CardStatus = 'draft' | 'review' | 'ready';

export interface Card {
  id: string;
  playNo: string;
  period: string;
  play: string; // preserved exactly as the coach wrote it
  defense: string;
  hash: Hash;
  status: CardStatus;
  players: Player[];
  paths: PlayPath[];
  notes: Note[];
  version: number;
  updatedAt: number;
  // Which saved look each side was copied from, if any.
  looks?: Partial<Record<Side, LookRef>>;
}

export interface LookRef {
  lookId: string;
  v: number; // look version this card was built from
  sig: string; // drawing fingerprint at apply time, to detect card-only edits
}

// One saved version of a team look. Never changed after it is saved.
export interface LookVersion {
  v: number;
  players: Player[];
  paths: PlayPath[];
  notes: Note[];
  savedAt: number;
  fromCard: string; // play # it was saved from
}

export interface Look {
  id: string;
  side: Side;
  name: string; // matched against the script's call text
  aliases: string[];
  versions: LookVersion[];
  createdAt: number;
}

export type Ruleset = 'hs' | 'college' | 'nfl';
export type ThemeId = 'print' | 'mono' | 'chalk' | 'night';

export interface Workspace {
  packetName: string;
  ruleset: Ruleset;
  // 'defense-view': offense at the top of the card, viewed from behind the
  // defense, so the offense's left hash prints on the right.
  orientation: 'defense-view';
  theme: ThemeId;
}
