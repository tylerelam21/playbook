import Anthropic from '@anthropic-ai/sdk';
import { InterpretRequest, InterpretResult, RESULT_JSON_SCHEMA, SYSTEM_PROMPT, renderUserMessage } from '../src/ai/protocol';

// Vercel Function: POST /api/interpret
// Turns a coach's instruction into proposed card edits with Claude. The key
// stays on the server (ANTHROPIC_API_KEY in the Vercel project settings).

const MODEL = process.env.PLAYBOOK_MODEL || 'claude-opus-5-5';
const EFFORT = (process.env.PLAYBOOK_EFFORT || 'low') as 'low' | 'medium' | 'high';
const MAX_BODY = 400_000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

let client: Anthropic | null = null;

export async function POST(request: Request): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return json(503, { error: 'not_configured', message: 'AI isn’t set up yet: add ANTHROPIC_API_KEY in the Vercel project settings.' });
  }
  // Only the app itself may call this (not other sites in a visitor's browser).
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return json(403, { error: 'forbidden', message: 'Cross-site requests are not allowed.' });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(413, { error: 'too_large', message: 'Too many cards to send at once.' });
  let parsed: InterpretRequest;
  try {
    parsed = InterpretRequest.parse(JSON.parse(raw));
  } catch {
    return json(400, { error: 'bad_request', message: 'Request didn’t match the expected format.' });
  }

  client ??= new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // A declined request is retried on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: EFFORT, format: { type: 'json_schema', schema: RESULT_JSON_SCHEMA } },
      // The instructions never change, so they're cached across requests.
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: renderUserMessage(parsed) }],
    });

    if (response.stop_reason === 'refusal') {
      return json(200, { question: 'I can’t help with that request.', summary: [], changes: [] });
    }
    if (response.stop_reason === 'max_tokens') {
      return json(502, { error: 'truncated', message: 'The answer was cut off. Try a shorter instruction or fewer cards.' });
    }
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    const result = InterpretResult.safeParse(JSON.parse(text));
    if (!result.success) return json(502, { error: 'bad_output', message: 'The AI’s answer didn’t match the expected format. Try again.' });
    return json(200, result.data);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json(429, { error: 'rate_limited', message: 'Too many requests right now. Wait a moment and try again.' });
    if (err instanceof Anthropic.AuthenticationError) return json(503, { error: 'bad_key', message: 'The ANTHROPIC_API_KEY in Vercel was rejected.' });
    if (err instanceof Anthropic.BadRequestError) return json(502, { error: 'api_rejected', message: `The AI request was rejected: ${err.message}` });
    if (err instanceof Anthropic.APIError) return json(502, { error: 'api_error', message: `AI service error (${err.status ?? 'network'}). Try again.` });
    if (err instanceof SyntaxError) return json(502, { error: 'bad_output', message: 'The AI’s answer wasn’t valid JSON. Try again.' });
    throw err;
  }
}
