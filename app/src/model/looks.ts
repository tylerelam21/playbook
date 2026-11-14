import type { Draft } from 'immer';
import type { Card, Look, LookVersion, Note, PlayPath, Player, Side } from './types';
import { id } from './samples';

// Saved team looks: a formation (offense) or defensive look drawn once and
// reused across cards. A card copies a look's players when it is applied and
// remembers which version it came from, so later changes to the look never
// rewrite a card silently (Ready cards keep their snapshot).

export const SIDE_NAME: Record<Side, string> = { O: 'Formation', D: 'Defense' };

export const normalize = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();

export const latest = (look: Look) => look.versions[look.versions.length - 1];

export function lookNames(look: Look) {
  return [look.name, ...look.aliases].map(normalize).filter(Boolean);
}

// Which saved look a card's call refers to, if any.
//   Defense: the whole defense call must match a name or alias.
//   Offense: the longest name or alias the play call starts with, by whole
//   words ("LARRY SNIFF" matches "LARRY SNIFF 23 TRAIL @ LOAD").
export function matchLook(card: Card, side: Side, looks: Look[]): { look: Look; matched: string } | null {
  const call = normalize(side === 'D' ? card.defense : card.play);
  if (!call) return null;
  let best: { look: Look; matched: string } | null = null;
  for (const look of looks) {
    if (look.side !== side) continue;
    for (const n of lookNames(look)) {
      const hit = side === 'D' ? call === n : call === n || call.startsWith(n + ' ');
      if (hit && (!best || n.length > best.matched.length)) best = { look, matched: n };
    }
  }
  return best;
}

// The side's players plus the paths they own and notes anchored to them.
export function extractSide(card: Card, side: Side) {
  const players = card.players.filter((p) => p.side === side);
  const ids = new Set(players.map((p) => p.id));
  return {
    players,
    paths: card.paths.filter((p) => p.ownerId && ids.has(p.ownerId)),
    notes: card.notes.filter((n) => n.anchorId && ids.has(n.anchorId)),
  };
}

// A stable fingerprint of a side's drawing, independent of object ids, used to
// tell whether a card has been edited since its look was applied.
export function signature(src: { players: Player[]; paths: PlayPath[]; notes: Note[] }) {
  const r = (n: number) => Math.round(n * 10) / 10;
  const order = [...src.players].sort((a, b) => a.x - b.x || a.y - b.y || a.label.localeCompare(b.label));
  const idx = new Map(order.map((p, i) => [p.id, i]));
  const ps = order.map((p) => [p.label, p.shape, r(p.x), r(p.y), p.ink ?? ''].join(':'));
  const pa = src.paths
    .map((p) => [idx.get(p.ownerId ?? ''), p.purpose, p.line, p.curved ? 1 : 0, p.end, p.ink, ...p.points.map((q) => `${r(q.x)},${r(q.y)}`)].join(':'))
    .sort();
  const no = src.notes.map((n) => [idx.get(n.anchorId ?? ''), n.text, n.size, n.ink, r(n.x), r(n.y)].join(':')).sort();
  return JSON.stringify([ps, pa, no]);
}

export const sideSignature = (card: Card, side: Side) => signature(extractSide(card, side));

export function versionFromCard(card: Card, side: Side, v: number): LookVersion {
  const src = structuredClone(extractSide(card, side));
  return { v, ...src, savedAt: Date.now(), fromCard: card.playNo || card.id.slice(0, 6) };
}

// Replace one side of a card with a look version (fresh ids for every object).
export function applyVersionTo(card: Draft<Card> | Card, look: Look, version: LookVersion) {
  const side = look.side;
  const gone = new Set(card.players.filter((p) => p.side === side).map((p) => p.id));
  const goneLabels = new Map(card.players.filter((p) => p.side === side).map((p) => [p.id, p.label]));
  const map = new Map<string, string>();
  const players = version.players.map((p) => {
    const nid = id();
    map.set(p.id, nid);
    return { ...structuredClone(p), id: nid, side };
  });
  const paths = version.paths.map((p) => ({ ...structuredClone(p), id: id(), ownerId: p.ownerId ? map.get(p.ownerId) ?? null : null }));
  const notes = version.notes.map((n) => ({ ...structuredClone(n), id: id(), anchorId: n.anchorId ? map.get(n.anchorId) ?? null : null }));
  card.players = [...card.players.filter((p) => !gone.has(p.id)), ...players];
  card.paths = [...card.paths.filter((p) => !(p.ownerId && gone.has(p.ownerId))), ...paths];
  card.notes = [...card.notes.filter((n) => !(n.anchorId && gone.has(n.anchorId))), ...notes];
  for (const n of card.notes) if (n.anchorId && gone.has(n.anchorId)) n.anchorId = null;
  // Install assignments follow the new player with the same label (if exactly
  // one); otherwise they stay unlinked and the card flags them.
  for (const as of card.teaching?.assignments ?? []) {
    if (!as.playerId || !gone.has(as.playerId)) continue;
    const label = goneLabels.get(as.playerId) || as.label;
    const matches = players.filter((p) => p.label && p.label === label);
    as.playerId = matches.length === 1 ? matches[0].id : null;
    if (!as.playerId) as.label = label;
  }
  card.looks = { ...(card.looks ?? {}), [side]: { lookId: look.id, v: version.v, sig: signature({ players, paths, notes }) } };
}

export type SideState =
  | { kind: 'applied'; look: Look; v: number; outdated: boolean; edited: boolean }
  | { kind: 'deleted'; v: number; edited: boolean }
  | { kind: 'matched'; look: Look; matched: string }
  | { kind: 'unknown'; call: string }
  | { kind: 'none' };

export function sideState(card: Card, side: Side, looks: Look[]): SideState {
  const ref = card.looks?.[side];
  if (ref) {
    const look = looks.find((l) => l.id === ref.lookId);
    const edited = sideSignature(card, side) !== ref.sig;
    if (!look) return { kind: 'deleted', v: ref.v, edited };
    return { kind: 'applied', look, v: ref.v, outdated: ref.v < latest(look).v, edited };
  }
  const m = matchLook(card, side, looks);
  if (m) return { kind: 'matched', look: m.look, matched: m.matched };
  const call = side === 'D' ? normalize(card.defense) : '';
  return call ? { kind: 'unknown', call } : { kind: 'none' };
}

export interface Question {
  key: string;
  kind: 'undefined' | 'unused' | 'outdated';
  side: Side;
  title: string;
  look?: Look;
  cards: Card[];
}

// Packet-level to-dos, grouped so one answer can resolve many cards.
export function packetQuestions(cards: Card[], looks: Look[]): Question[] {
  const groups = new Map<string, Question>();
  const add = (key: string, q: Omit<Question, 'cards' | 'key'>, c: Card) => {
    const g = groups.get(key) ?? { key, ...q, cards: [] };
    g.cards.push(c);
    groups.set(key, g);
  };
  for (const c of cards) {
    for (const side of ['D', 'O'] as const) {
      const st = sideState(c, side, looks);
      if (st.kind === 'unknown') add(`u:${side}:${st.call}`, { kind: 'undefined', side, title: st.call }, c);
      else if (st.kind === 'matched') add(`m:${st.look.id}`, { kind: 'unused', side, title: st.look.name, look: st.look }, c);
      else if (st.kind === 'applied' && st.outdated && c.status !== 'ready')
        add(`o:${st.look.id}`, { kind: 'outdated', side, title: st.look.name, look: st.look }, c);
    }
  }
  const rank = { undefined: 0, unused: 1, outdated: 2 };
  return [...groups.values()].sort((a, b) => rank[a.kind] - rank[b.kind] || b.cards.length - a.cards.length);
}

export function usage(look: Look, cards: Card[]) {
  return cards.filter((c) => c.looks?.[look.side]?.lookId === look.id);
}
