import type { Draft } from 'immer';
import type { Card, Look, Player, Ruleset } from '../model/types';
import type { AiOp } from './protocol';
import { id, DEFENSE_LOOKS, OFFENSE_LOOKS } from '../model/samples';
import { applyVersionTo, latest, normalize } from '../model/looks';
import { clampToField } from '../model/field';
import { moveWithPaths } from '../model/commands';
import { PATH_PRESETS } from '../store';

// Applies Claude's proposed operations to one card, checking each against the
// card as it actually is. Anything that doesn't fit (unknown player id,
// coordinates off the page, a look that doesn't exist) is skipped and
// reported, never forced.

const okNum = (n: number | null, min: number, max: number): n is number => n !== null && Number.isFinite(n) && n >= min && n <= max;
const X = [-35, 35] as const;
const Y = [-12, 16] as const;
const clip = (s: string | null, n: number) => (s ?? '').trim().slice(0, n);

export interface AiContext {
  looks: Look[];
  ruleset: Ruleset;
}

export function applyAiOps(card: Draft<Card>, ops: AiOp[], ctx: AiContext): string[] {
  const problems: string[] = [];
  const temp = new Map<string, string>(); // "new1" -> real id
  const where = `card #${card.playNo || '—'}`;
  const findPlayer = (pid: string | null): Draft<Player> | undefined => {
    if (!pid) return undefined;
    const real = temp.get(pid) ?? pid;
    return card.players.find((p) => p.id === real);
  };
  const needPlayer = (op: AiOp) => {
    const p = findPlayer(op.playerId);
    if (!p) problems.push(`Skipped a ${op.type} on ${where}: that player isn’t on the card`);
    return p;
  };

  for (const op of ops) {
    switch (op.type) {
      case 'move': {
        const p = needPlayer(op);
        if (!p) break;
        const nx = op.x === null ? p.x : op.x;
        const ny = op.y === null ? p.y : op.y;
        if (!okNum(nx, ...X) || !okNum(ny, ...Y)) {
          problems.push(`Skipped moving ${p.label || 'a player'} on ${where}: position off the card`);
          break;
        }
        moveWithPaths(card, p, nx - p.x, ny - p.y);
        break;
      }
      case 'path': {
        const p = needPlayer(op);
        if (!p) break;
        const pts = (op.points ?? []).slice(0, 6);
        if (!pts.length || !pts.every((q) => okNum(q.x, ...X) && okNum(q.y, ...Y))) {
          problems.push(`Skipped a path for ${p.label || 'a player'} on ${where}: points off the card`);
          break;
        }
        const purpose = op.purpose ?? 'other';
        const style = PATH_PRESETS.find((x) => x.key === purpose)?.style ?? PATH_PRESETS[0].style;
        card.paths = card.paths.filter((pa) => pa.ownerId !== p.id);
        card.paths.push({
          id: id(),
          ownerId: p.id,
          purpose,
          points: pts.map((q) => ({ x: q.x, y: q.y })),
          line: op.line ?? style.line,
          end: op.end ?? style.end,
          ink: style.ink,
          curved: op.curved ?? (pts.length > 1 ? true : style.curved),
        });
        break;
      }
      case 'clearPaths': {
        const p = needPlayer(op);
        if (p) card.paths = card.paths.filter((pa) => pa.ownerId !== p.id);
        break;
      }
      case 'add': {
        if (!okNum(op.x, ...X) || !okNum(op.y, ...Y) || !op.side) {
          problems.push(`Skipped adding a player on ${where}: missing side or position`);
          break;
        }
        const nid = id();
        if (op.playerId) temp.set(op.playerId, nid);
        card.players.push({ id: nid, side: op.side, label: clip(op.label, 4), shape: op.shape ?? (op.side === 'D' ? 'letter' : 'circle'), x: op.x, y: op.y });
        break;
      }
      case 'remove': {
        const p = needPlayer(op);
        if (!p) break;
        card.players = card.players.filter((x) => x.id !== p.id);
        card.paths = card.paths.filter((pa) => pa.ownerId !== p.id);
        for (const n of card.notes) if (n.anchorId === p.id) n.anchorId = null;
        break;
      }
      case 'label': {
        const p = needPlayer(op);
        if (p) p.label = clip(op.label, 4);
        break;
      }
      case 'field': {
        if (!op.field) break;
        card[op.field] = clip(op.value, 80).toUpperCase();
        break;
      }
      case 'hash': {
        const v = clip(op.value, 1).toUpperCase();
        if (v === 'L' || v === 'M' || v === 'R') card.hash = v;
        else problems.push(`Skipped a hash change on ${where}: “${op.value}” isn’t L, M or R`);
        break;
      }
      case 'look': {
        const want = normalize(op.lookName ?? '');
        const look = ctx.looks.find((l) => [l.name, ...l.aliases].some((n) => normalize(n) === want));
        if (look) {
          applyVersionTo(card, look, latest(look));
          break;
        }
        const sample = [...OFFENSE_LOOKS, ...DEFENSE_LOOKS].find((l) => normalize(l.name) === want);
        if (sample) {
          const fresh = clampToField(sample.build(), card.hash, ctx.ruleset);
          const gone = new Set(card.players.filter((p) => p.side === sample.side).map((p) => p.id));
          card.players = [...card.players.filter((p) => p.side !== sample.side), ...fresh];
          card.paths = card.paths.filter((p) => !(p.ownerId && gone.has(p.ownerId)));
          if (card.looks) delete card.looks[sample.side];
        } else problems.push(`No saved look named “${op.lookName}”`);
        break;
      }
      case 'assignment': {
        const p = needPlayer(op);
        const text = clip(op.text, 300);
        if (!p || !text) break;
        card.mode = 'install';
        card.teaching ??= { assignments: [], cues: '' };
        const row = card.teaching.assignments.find((a) => a.playerId === p.id);
        if (row) row.text = text;
        else card.teaching.assignments.push({ id: id(), playerId: p.id, label: p.label, text });
        break;
      }
      case 'cue': {
        const text = clip(op.text, 300);
        if (!text) break;
        card.mode = 'install';
        card.teaching ??= { assignments: [], cues: '' };
        card.teaching.cues = card.teaching.cues ? `${card.teaching.cues}\n${text}` : text;
        break;
      }
      case 'read': {
        const p = needPlayer(op);
        if (p && okNum(op.n, 0, 9)) p.read = Math.round(op.n) || undefined;
        break;
      }
      case 'note': {
        const text = clip(op.text, 60);
        const anchor = findPlayer(op.playerId);
        const x = op.x ?? (anchor ? anchor.x : null);
        const y = op.y ?? (anchor ? anchor.y + 1.3 : null);
        if (!text || !okNum(x, ...X) || !okNum(y, ...Y)) {
          problems.push(`Skipped a note on ${where}: missing text or position`);
          break;
        }
        card.notes.push({ id: id(), text: text.toUpperCase(), x, y, ink: 'blue', size: 'sm', anchorId: anchor?.id ?? null });
        break;
      }
      case 'mode': {
        const v = clip(op.value, 10);
        if (v === 'install' || v === 'scout') {
          card.mode = v;
          if (v === 'install') card.teaching ??= { assignments: [], cues: '' };
        }
        break;
      }
    }
  }
  return problems;
}
