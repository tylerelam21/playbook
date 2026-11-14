import { beforeEach, describe, expect, it, vi } from 'vitest';
import { produce } from 'immer';

// Simulated Claude: records the request and returns a canned structured answer.
const calls: Record<string, unknown>[] = [];
let reply: { stop_reason: string; content: { type: string; text?: string }[] } = { stop_reason: 'end_turn', content: [] };
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status?: number;
  }
  class RateLimitError extends APIError {}
  class AuthenticationError extends APIError {}
  class BadRequestError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static RateLimitError = RateLimitError;
    static AuthenticationError = AuthenticationError;
    static BadRequestError = BadRequestError;
    beta = { messages: { create: async (params: Record<string, unknown>) => (calls.push(params), reply) } };
  }
  return { default: Anthropic };
});

import { POST } from '../../../api/interpret';
import { buildRequest, InterpretResult, renderUserMessage } from '../protocol';
import { applyAiOps } from '../applyAi';
import { DEFENSE_LOOKS, OFFENSE_LOOKS, blankCard } from '../../model/samples';
import type { Card } from '../../model/types';

const ws = { packetName: 'p', ruleset: 'college', orientation: 'defense-view', theme: 'print' } as const;
function card(): Card {
  return { ...blankCard('7'), defense: 'CHOP', players: [...OFFENSE_LOOKS[1].build(), ...DEFENSE_LOOKS[0].build()] };
}
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://app.example/api/interpret', { method: 'POST', body: JSON.stringify(body), headers: { host: 'app.example', origin: 'https://app.example', ...headers } });
const op = (o: Partial<InterpretResult['changes'][0]['ops'][0]>) => ({
  type: 'move', playerId: null, x: null, y: null, side: null, label: null, shape: null, points: null, purpose: null, line: null, end: null, curved: null, field: null, value: null, text: null, n: null, lookName: null, ...o,
}) as InterpretResult['changes'][0]['ops'][0];

beforeEach(() => {
  calls.length = 0;
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

describe('POST /api/interpret', () => {
  it('sends the card and returns validated changes', async () => {
    const c = card();
    const corner = c.players.find((p) => p.side === 'D' && p.label === 'C')!;
    const answer = { question: null, summary: ['Left corner presses at 1 yd'], changes: [{ cardId: c.id, ops: [op({ type: 'move', playerId: corner.id, y: 1 })] }] };
    reply = { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] };
    const res = await POST(req(buildRequest('left corner press', [c], c.id, [], ws, [])));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(answer);
    const sent = calls[0] as { model: string; fallbacks: string; output_config: { effort: string; format: { type: string } }; messages: { content: string }[] };
    expect(sent.model).toBe('claude-opus-5-5');
    expect(sent.fallbacks).toBe('default');
    expect(sent.output_config.format.type).toBe('json_schema');
    expect(sent.messages[0].content).toContain(corner.id);
    expect(sent.messages[0].content).toContain('<coach_said>left corner press</coach_said>');
  });

  it('explains when the key is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await POST(req({}));
    expect(res.status).toBe(503);
    expect((await res.json()).message).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('rejects cross-site calls and malformed bodies', async () => {
    expect((await POST(req({}, { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await POST(req({ text: 'hi' }))).status).toBe(400);
  });

  it('rejects answers that do not match the schema', async () => {
    const c = card();
    reply = { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ summary: 'nope' }) }] };
    const res = await POST(req(buildRequest('x', [c], c.id, [], ws, [])));
    expect(res.status).toBe(502);
  });

  it('turns a refusal into a message instead of changes', async () => {
    const c = card();
    reply = { stop_reason: 'refusal', content: [] };
    const res = await POST(req(buildRequest('x', [c], c.id, [], ws, [])));
    expect((await res.json()).changes).toEqual([]);
  });
});

describe('applyAiOps', () => {
  const ctx = { looks: [], ruleset: 'college' as const };

  it('moves players with their paths and draws new paths', () => {
    const c = card();
    const m = c.players.find((p) => p.side === 'D' && p.label === 'M')!;
    const next = produce(c, (d) => {
      const problems = applyAiOps(d, [
        op({ type: 'path', playerId: m.id, purpose: 'rush', points: [{ x: -1.1, y: 0.4 }, { x: -1.1, y: -1.4 }] }),
        op({ type: 'move', playerId: m.id, y: 3.5 }),
      ], ctx);
      expect(problems).toEqual([]);
    });
    const m2 = next.players.find((p) => p.id === m.id)!;
    expect(m2.y).toBe(3.5);
    const path = next.paths.find((p) => p.ownerId === m.id)!;
    expect(path.ink).toBe('red');
    expect(path.points[0].y).toBeCloseTo(-0.7); // moved up with the mike
  });

  it('skips unknown players and off-card positions without touching the rest', () => {
    const c = card();
    const w = c.players.find((p) => p.side === 'D' && p.label === 'W')!;
    let problems: string[] = [];
    const next = produce(c, (d) => {
      problems = applyAiOps(d, [op({ type: 'move', playerId: 'ghost', y: 4 }), op({ type: 'move', playerId: w.id, x: 400 }), op({ type: 'move', playerId: w.id, y: 6 })], ctx);
    });
    expect(problems).toHaveLength(2);
    expect(next.players.find((p) => p.id === w.id)!.y).toBe(6);
  });

  it('lets later ops use a player added earlier', () => {
    const c = card();
    const next = produce(c, (d) => {
      applyAiOps(d, [op({ type: 'add', playerId: 'new1', side: 'D', label: 'R', x: 0, y: 7 }), op({ type: 'path', playerId: 'new1', purpose: 'drop', points: [{ x: 0, y: 10 }] })], ctx);
    });
    const r = next.players.find((p) => p.side === 'D' && p.label === 'R')!;
    expect(next.paths.some((p) => p.ownerId === r.id)).toBe(true);
  });

  it('describes the active card in the prompt and lists other cards', () => {
    const a = card();
    const b = { ...card(), id: 'other', playNo: '9' };
    const text = renderUserMessage(buildRequest('hi', [a, b], a.id, [], ws, [{ said: 'x', reply: 'y' }]));
    expect(text).toContain('[ACTIVE]');
    expect(text).toContain('<other_cards>');
    expect(text).toContain('<recent_exchange>');
  });
});
