import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { applyOps, parseCommand, scopeCards } from '../commands';
import { DEFENSE_LOOKS, OFFENSE_LOOKS, blankCard } from '../samples';
import type { Card, Look } from '../types';

function card(): Card {
  const c = blankCard('7');
  return { ...c, players: [...OFFENSE_LOOKS[1].build(), ...DEFENSE_LOOKS[0].build()] }; // Trips + 4-2-5
}
const run = (text: string, c = card(), looks: Look[] = []) => {
  const parsed = parseCommand(text, looks);
  let problems: string[] = [];
  const next = produce(c, (d) => {
    problems = applyOps(d, parsed.ops);
  });
  return { parsed, next, problems };
};
const get = (c: Card, label: string, i = 0) => c.players.filter((p) => p.side === 'D' && p.label === label)[i];

describe('parseCommand', () => {
  it('sets depth for a plural group', () => {
    const { next, problems } = run('corners at seven');
    expect(problems).toEqual([]);
    expect(next.players.filter((p) => p.side === 'D' && p.label === 'C').map((p) => p.y)).toEqual([7, 7]);
  });

  it('handles "and a half" and leading verbs', () => {
    const { next } = run('move the mike to four and a half');
    expect(get(next, 'M').y).toBe(4.5);
  });

  it('moves relative depth and keeps paths attached', () => {
    const c = run('mike rush the a gap').next;
    const { next } = run('move both corners back one and the mike up 1', c);
    expect(get(next, 'C').y).toBe(7.5);
    expect(get(next, 'M').y).toBeCloseTo(3.6);
    const m = get(next, 'M');
    const path = next.paths.find((p) => p.ownerId === m.id)!;
    expect(path.points[0].y).toBeCloseTo(-0.6); // moved up with the mike
  });

  it('asks instead of guessing when a singular name matches two players', () => {
    const { problems, next } = run('corner at 9');
    expect(problems[0]).toMatch(/2 players match/);
    expect(get(next, 'C').y).toBe(6.5);
    expect(run('left corner at 9').next.players.find((p) => p.side === 'D' && p.label === 'C' && p.x < 0)!.y).toBe(9);
  });

  it('tells nose and nickel apart', () => {
    const { next } = run('nickel at 6 and nose up 0.5');
    const ns = next.players.filter((p) => p.side === 'D' && p.label === 'N');
    expect(ns.find((p) => Math.abs(p.x) > 5)!.y).toBe(6);
    expect(ns.find((p) => Math.abs(p.x) < 5)!.y).toBeCloseTo(0.8);
  });

  it('aligns over a numbered receiver', () => {
    const { next, problems } = run('nickel over number 2');
    expect(problems).toEqual([]);
    expect(get(next, 'N', 1).x).toBe(-15); // trips #2 on the left
  });

  it('draws rushes and drops', () => {
    const { next } = run('will blitz the b gap, free safety drop to deep middle');
    const w = get(next, 'W');
    const f = get(next, 'F');
    expect(next.paths.find((p) => p.ownerId === w.id)!.points[0].x).toBeCloseTo(3.3);
    expect(next.paths.find((p) => p.ownerId === f.id)!.points[0]).toEqual({ x: 0, y: 11.5 });
  });

  it('carries a name list across clauses', () => {
    const { next } = run('corners and nickel back 2');
    expect(get(next, 'C').y).toBe(8.5);
    expect(get(next, 'N', 1).y).toBe(6.2);
  });

  it('reuses the last player for a follow-up clause', () => {
    const { next } = run('will at 5 and 2 left');
    expect(get(next, 'W').y).toBe(5);
    expect(get(next, 'W').x).toBeCloseTo(0.6); // started 2.6 right of the ball
  });

  it('sets card fields, keeping the words', () => {
    const { next } = run('hash left. defense chop 3. play call Larry Sniff 23 Trail');
    expect(next.hash).toBe('L');
    expect(next.defense).toBe('CHOP 3');
    expect(next.play).toBe('LARRY SNIFF 23 TRAIL');
  });

  it('adds a player and moves them later in the same sentence', () => {
    const { next } = run('add a defender R at 6 deep 8 left and R back 1');
    const r = get(next, 'R');
    expect(r).toBeTruthy();
    expect(r.x).toBe(-8);
    expect(r.y).toBe(7);
  });

  it('writes install assignments and coaching points', () => {
    const { next } = run('mike assignment: fill the A gap fast. coaching point: eyes on the guard');
    expect(next.mode).toBe('install');
    expect(next.teaching!.assignments[0].text).toBe('fill the A gap fast');
    expect(next.teaching!.cues).toBe('eyes on the guard');
  });

  it('reports what it did not understand', () => {
    const { parsed } = run('corners at 7 and do a barrel roll');
    expect(parsed.ops).toHaveLength(1);
    expect(parsed.unknown).toEqual(['do a barrel roll']);
  });

  it('finds saved looks and samples by name', () => {
    const look: Look = { id: 'l1', side: 'D', name: 'CHOP', aliases: ['4 INV'], versions: [], createdAt: 0 };
    expect(parseCommand('apply chop', [look]).ops[0]).toMatchObject({ t: 'look', lookId: 'l1' });
    expect(parseCommand('use 4 inv', [look]).ops[0]).toMatchObject({ t: 'look' });
    expect(parseCommand('use 4-2-5', []).ops[0]).toMatchObject({ t: 'sample', key: 'd-425' });
  });

  it('parses scope', () => {
    const p = parseCommand('corners at 7 on cards 3, 4 and 7', []);
    expect(p.scope).toEqual({ kind: 'numbers', numbers: ['3', '4', '7'] });
    expect(parseCommand('corners at 7 on all chop cards', []).scope).toEqual({ kind: 'call', call: 'chop' });
    const cards = [card(), { ...card(), playNo: '3', defense: 'CHOP' }];
    expect(scopeCards({ kind: 'call', call: 'chop' }, cards, cards[0].id).cards).toHaveLength(1);
  });

  it('fixes common speech slips', () => {
    const { next } = run('Nicole at 6 and mike rush the 8 gap');
    expect(get(next, 'N', 1).y).toBe(6);
    expect(next.paths.find((p) => p.ownerId === get(next, 'M').id)!.points[0].x).toBeCloseTo(-1.1);
  });

  it('recognizes app actions', () => {
    expect(parseCommand('next card', []).actions).toEqual([{ t: 'nextCard' }]);
    expect(parseCommand('save defense as chop', []).actions).toEqual([{ t: 'saveLook', side: 'D', name: 'CHOP' }]);
    expect(parseCommand('mark it ready', []).actions).toEqual([{ t: 'ready' }]);
  });
});
