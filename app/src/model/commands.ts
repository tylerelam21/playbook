import type { Draft } from 'immer';
import type { Card, Hash, Look, Player, Side } from './types';
import { DEFENSE_LOOKS, OFFENSE_LOOKS, id } from './samples';
import { normalize } from './looks';

// Turns a typed or dictated sentence into card changes, entirely in the
// browser. It understands a fixed set of football phrasings; anything it
// can't map is reported back instead of guessed (PRD: make uncertainty
// visible, keep the original words).
//
//   "corners at 7"                    "mike rush the a gap"
//   "move both corners back one"      "nickel over number 2"
//   "will 3 left"                     "free safety drop to deep middle"
//   "hash left"  "defense chop"       "apply chop"  "on cards 3 and 7 …"

// ---- Who ------------------------------------------------------------------

export interface Who {
  words: string; // as spoken, for messages
  labels: string[];
  filter?: 'line' | 'off'; // nose vs nickel (both often labeled N)
  team?: Side; // position names imply a side ("corner" is defense, not the center "C")
  side?: 'left' | 'right';
  plural: boolean;
}

const NAMES: { re: RegExp; labels: string[]; filter?: 'line' | 'off'; plural?: boolean; team?: Side }[] = [
  { re: /^(linebackers|backers|lbs)$/, labels: ['M', 'W', 'S'], plural: true },
  { re: /^(safeties)$/, labels: ['F', '$'], plural: true },
  { re: /^(free safety|free|fs)$/, labels: ['F'] },
  { re: /^(strong safety|money|dollar|ss|\$)$/, labels: ['$'] },
  { re: /^(nickel|nickel back|nickelback|star)$/, labels: ['N'], filter: 'off' },
  { re: /^(nose|nose tackle|nose guard|noseguard)$/, labels: ['N'], filter: 'line' },
  { re: /^(mike|mic|mike backer)$/, labels: ['M'] },
  { re: /^(will|will backer)$/, labels: ['W'] },
  { re: /^(sam|sam backer)$/, labels: ['S'] },
  { re: /^(tackle|three technique|3 technique|3 tech)$/, labels: ['T'] },
  { re: /^(tackles)$/, labels: ['T'], plural: true },
  { re: /^(end|defensive end)$/, labels: ['E'] },
  { re: /^(ends|defensive ends)$/, labels: ['E'], plural: true },
  { re: /^(corner|cornerback|corner back|cb)$/, labels: ['C'] },
  { re: /^(corners|cornerbacks|corner backs|cbs)$/, labels: ['C'], plural: true },
  { re: /^(quarterback|qb)$/, labels: ['Q'], team: 'O' },
  { re: /^(center|centre)$/, labels: ['C'], team: 'O' },
];

export function parseWho(phrase: string): Who | null {
  let p = ` ${phrase.trim()} `;
  let side: Who['side'];
  let plural = false;
  const m = p.match(/ (left|right|boundary|field)( side)? /);
  if (m && (m[1] === 'left' || m[1] === 'right')) {
    side = m[1];
    p = p.replace(m[0], ' ');
  }
  if (/ (both|all|the two) /.test(p)) plural = true;
  p = p.replace(/ (the|both|all|our|two|his|her|their|my|of) /g, ' ').replace(/'s /g, ' ').trim();
  if (!p) return null;
  // Split "corners and nickel" style lists.
  const parts = p.split(/ and |, | plus /).map((x) => x.trim()).filter(Boolean);
  const labels: string[] = [];
  let filter: Who['filter'];
  let team: Side | undefined;
  for (const part of parts) {
    const named = NAMES.find((n) => n.re.test(part));
    if (named) {
      labels.push(...named.labels);
      team = named.team ?? 'D';
      if (named.filter) filter = named.filter;
      if (named.plural) plural = true;
      continue;
    }
    // A label said directly: "the m", "x", "h", "$".
    if (/^[a-z$+]{1,2}$/.test(part) && part !== 'a' && part !== 'i') {
      labels.push(part.toUpperCase());
      continue;
    }
    return null;
  }
  if (parts.length > 1) plural = true;
  return labels.length ? { words: phrase.trim(), labels, filter, team, side, plural } : null;
}

export function resolveWho(card: Card | Draft<Card>, who: Who): { players: Player[]; problem?: string } {
  let ps = card.players.filter((p) => who.labels.includes(p.label.toUpperCase())) as Player[];
  // A bare letter that both teams use ("C") means the defender: these are
  // scout cards. Position names carry their own side.
  const team = who.team ?? (ps.some((p) => p.side === 'D') ? 'D' : 'O');
  ps = ps.filter((p) => p.side === team);
  if (who.filter === 'line') ps = ps.filter((p) => p.y < 2.6 && Math.abs(p.x) < 5);
  if (who.filter === 'off') ps = ps.filter((p) => !(p.y < 2.6 && Math.abs(p.x) < 5));
  if (who.side) ps = ps.filter((p) => (who.side === 'left' ? p.x < 0 : p.x > 0));
  if (!ps.length) return { players: [], problem: `No “${who.words}” on card #${card.playNo || '—'}` };
  if (ps.length > 1 && !who.plural) {
    // "corner" with two corners: ask which one instead of moving both.
    return { players: [], problem: `${ps.length} players match “${who.words}” on card #${card.playNo || '—'} — say left or right, or “both”` };
  }
  return { players: ps };
}

// ---- Operations -------------------------------------------------------------

export type Op =
  | { t: 'depth'; who: Who; yd: number }
  | { t: 'depthBy'; who: Who; yd: number } // + = away from the line
  | { t: 'lateralBy'; who: Who; yd: number; dir: 'left' | 'right' | 'out' | 'in' }
  | { t: 'over'; who: Who; rank: number; side?: 'left' | 'right' }
  | { t: 'rush'; who: Who; gap: 'A' | 'B' | 'C' | 'D'; side?: 'left' | 'right' }
  | { t: 'drop'; who: Who; zone: Zone }
  | { t: 'read'; who: Who; n: number }
  | { t: 'clearPaths'; who: Who }
  | { t: 'field'; key: 'play' | 'defense' | 'period' | 'playNo'; value: string }
  | { t: 'hash'; value: Hash }
  | { t: 'look'; lookId: string; name: string }
  | { t: 'sample'; key: string; side: Side; name: string }
  | { t: 'add'; side: Side; label: string; x: number; y: number }
  | { t: 'assign'; who: Who; text: string }
  | { t: 'cue'; text: string };

export type Action =
  | { t: 'saveLook'; side: Side; name: string }
  | { t: 'newCard' }
  | { t: 'nextCard' }
  | { t: 'prevCard' }
  | { t: 'duplicate' }
  | { t: 'ready' }
  | { t: 'undo' };

export type Zone = 'flat' | 'hook' | 'curl' | 'deep half' | 'deep third' | 'deep middle' | 'low hole';

export type Scope = { kind: 'active' } | { kind: 'all' } | { kind: 'numbers'; numbers: string[] } | { kind: 'call'; call: string };

export interface Parsed {
  ops: Op[];
  actions: Action[];
  scope: Scope;
  unknown: string[]; // clauses we couldn't understand
}

// ---- Words to numbers --------------------------------------------------------

const UNITS: Record<string, number> = {
  zero: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const ORD: Record<string, number> = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5 };

// Converts number words, but leaves "to"/"for" alone unless they clearly sit
// where a number belongs (after "number", "at", "back", etc.).
function numberize(s: string) {
  let t = ` ${s} `;
  t = t.replace(/ (a|one) half /g, ' 0.5 ').replace(/ half a /g, ' 0.5 ');
  t = t.replace(/½/g, '.5');
  for (const [w, n] of Object.entries(UNITS)) {
    if (w === 'to' || w === 'too' || w === 'for' || w === 'won' || w === 'ate') continue;
    t = t.replace(new RegExp(` ${w} `, 'g'), ` ${n} `);
  }
  // Homophones only where a number is expected.
  t = t.replace(/ (number|#|at|back|up|out|in|over|deeper|wider|tighter|move|by) (to|too) /g, ' $1 2 ');
  t = t.replace(/ (number|#|at|back|up|out|in|over|deeper|wider|tighter|move|by) (for) /g, ' $1 4 ');
  t = t.replace(/ (\d+(?:\.\d+)?) and (a )?0?\.5 /g, (_, n) => ` ${Number(n) + 0.5} `);
  t = t.replace(/ (\d+) point (\d) /g, ' $1.$2 ');
  t = t.replace(/ (\d+)\.5(?=\D)/g, ' $1.5');
  t = t.replace(/ a (yard|yd) /g, ' 1 $1 ');
  t = t.replace(/ (yards|yard|yds|yd)\b/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;

// ---- Clauses ----------------------------------------------------------------

function parseScope(text: string): { rest: string; scope: Scope } {
  const all = text.match(/\b(on|for|to) (all|every) (the )?cards?\b/);
  if (all) return { rest: text.replace(all[0], ' '), scope: { kind: 'all' } };
  const call = text.match(/\b(on|for) (all|every) (the )?(.+?) cards\b/);
  if (call) return { rest: text.replace(call[0], ' '), scope: { kind: 'call', call: call[4] } };
  const nums = text.match(/\b(on|for) cards? ([#\w ,]+)$/);
  if (nums) {
    const numbers = nums[2].split(/,|\band\b|\s+/).map((x) => x.replace('#', '').trim()).filter(Boolean);
    if (numbers.length && numbers.every((n) => /^[0-9][0-9a-z]{0,3}$/.test(n))) return { rest: text.replace(nums[0], ' '), scope: { kind: 'numbers', numbers } };
  }
  return { rest: text, scope: { kind: 'active' } };
}

const FILLER = /^(please |ok |okay |now |and |then |also )*(move|slide|bump|push|walk|put|set|bring|align|get|have|line up|make|let's|lets)?\s*/;

const ZONES: [RegExp, Zone][] = [
  [/deep (half|halves)|half field/, 'deep half'],
  [/deep (third|3rd)|outside third|thirds?$/, 'deep third'],
  [/deep middle|middle of the field|middle third|post/, 'deep middle'],
  [/low hole|hole|robber|rat/, 'low hole'],
  [/curl|seam/, 'curl'],
  [/hook/, 'hook'],
  [/flat/, 'flat'],
];

interface Ctx {
  looks: Look[];
  lastWho: Who | null;
  pending: Who | null; // "corners and …": a name waiting for its verb
}

function mergeWho(a: Who | null, b: Who): Who {
  if (!a) return b;
  return { words: `${a.words} and ${b.words}`, labels: [...a.labels, ...b.labels], filter: b.filter ?? a.filter, team: b.team ?? a.team, side: b.side ?? a.side, plural: true };
}

function clauseOps(raw: string, ctx: Ctx, original: string): { ops: Op[]; actions: Action[]; ok: boolean } {
  const ops: Op[] = [];
  const actions: Action[] = [];
  const c = raw.trim();
  const keep = (s: string) => s.trim().toUpperCase();
  let m: RegExpMatchArray | null;

  // Card fields: keep the coach's words (uppercased like a script).
  const orig = original.trim();
  if ((m = c.match(/^play (number|#|no) (.+)$/))) return { ops: [{ t: 'field', key: 'playNo', value: keep(m[2]) }], actions, ok: true };
  if ((m = orig.match(/^play(?: call)?(?: is)?[:\s]+(.+)$/i))) return { ops: [{ t: 'field', key: 'play', value: keep(m[1]) }], actions, ok: true };
  if ((m = orig.match(/^(?:defense|defensive call|front)(?: is)?[:\s]+(.+)$/i))) return { ops: [{ t: 'field', key: 'defense', value: keep(m[1]) }], actions, ok: true };
  if ((m = orig.match(/^period(?: is)?[:\s]+(.+)$/i))) return { ops: [{ t: 'field', key: 'period', value: keep(m[1]) }], actions, ok: true };
  if ((m = c.match(/^(?:(?:the )?hash (?:is |on (?:the )?)?(left|middle|right|l|m|r|center)|(left|middle|right) hash)$/))) {
    const v = (m[1] ?? m[2])[0].toUpperCase();
    return { ops: [{ t: 'hash', value: (v === 'C' ? 'M' : v) as Hash }], actions, ok: true };
  }
  if ((m = orig.match(/^coaching points?[:\s]+(.+)$/i))) return { ops: [{ t: 'cue', text: m[1].trim() }], actions, ok: true };

  // App actions.
  if (/^(new|add a|add) card$/.test(c)) return { ops, actions: [{ t: 'newCard' }], ok: true };
  if (/^(next|go to next) card$/.test(c)) return { ops, actions: [{ t: 'nextCard' }], ok: true };
  if (/^(previous|last|go back a|back a) card$/.test(c)) return { ops, actions: [{ t: 'prevCard' }], ok: true };
  if (/^duplicate( this)?( card)?$/.test(c)) return { ops, actions: [{ t: 'duplicate' }], ok: true };
  if (/^(mark (it |this |card )?ready|ready)$/.test(c)) return { ops, actions: [{ t: 'ready' }], ok: true };
  if (/^undo( that)?$/.test(c)) return { ops, actions: [{ t: 'undo' }], ok: true };
  if ((m = orig.match(/^save (?:the |this )?(defense|formation|offense)(?: as)?[:\s]+(.+)$/i)))
    return { ops, actions: [{ t: 'saveLook', side: /defense/i.test(m[1]) ? 'D' : 'O', name: keep(m[2]) }], ok: true };

  // Looks: "apply chop", "use 4-2-5".
  if ((m = c.match(/^(?:apply|use|load|run|give me)(?: the)? (.+?)(?: look| defense| formation)?$/))) {
    const want = normalize(m[1]);
    const look = ctx.looks.find((l) => [l.name, ...l.aliases].some((n) => normalize(n) === want));
    if (look) return { ops: [{ t: 'look', lookId: look.id, name: look.name }], actions, ok: true };
    const sample = [...OFFENSE_LOOKS, ...DEFENSE_LOOKS].find((l) => normalize(l.name).replace(/[^A-Z0-9]/g, '') === want.replace(/[^A-Z0-9]/g, ''));
    if (sample) return { ops: [{ t: 'sample', key: sample.key, side: sample.side, name: sample.name }], actions, ok: true };
    return { ops, actions, ok: false };
  }

  // Add a player: "add a defender s at 6 deep 8 left".
  if ((m = c.match(new RegExp(`^add (?:a |an )?(defender|offensive player|receiver|player)? ?([a-z$+]{1,3}) (?:at )?${NUM}(?: deep| off)?(?: (?:and )?${NUM} (left|right))?$`)))) {
    const side: Side = m[1] && /offens|receiver/.test(m[1]) ? 'O' : 'D';
    const depth = Number(m[3]);
    const lat = m[4] ? Number(m[4]) * (m[5] === 'left' ? -1 : 1) : 0;
    return { ops: [{ t: 'add', side, label: m[2].toUpperCase(), x: lat, y: side === 'O' ? -depth : depth }], actions, ok: true };
  }

  // Install assignment: "mike assignment: fill the a gap" / "assignment for the mike: …"
  if ((m = orig.match(/^assignment for (.+?)[:,]\s*(.+)$/i)) || (m = orig.match(/^(.+?)(?:'s)? (?:assignment|job)(?: is)?[:\s]+(.+)$/i))) {
    const who = parseWho(numberize(m[1].toLowerCase()));
    if (who) return { ops: [{ t: 'assign', who, text: m[2].trim() }], actions, ok: true };
  }

  // Player moves and paths: "<who> <verb …>", or "<verb …>" reusing the last who.
  const s = c.replace(FILLER, '');
  const verbs = String.raw`(?:at|to|back|up|deeper|shallower|closer|out|wider|in|inside|tighter|over|left|right|rush|rushes|blitz|blitzes|slant|slants|stunt|stunts|fit|fits|fill|fills|run|runs|drop|drops|bail|bails|carry|carries|sink|sinks|plays|read|clear|no|is|are|${NUM}|[abcd] ?gap)\b`;
  // Try each place a verb could start; the words before it must name players.
  let who: Who | null = null;
  let rest = '';
  const re = new RegExp(`(^|\\s)(${verbs})`, 'g');
  for (let mm = re.exec(s); mm; mm = re.exec(s)) {
    const at = mm.index + mm[1].length;
    const prefix = s.slice(0, at).trim();
    if (!prefix) {
      if (ctx.lastWho || ctx.pending) {
        who = ctx.pending ?? ctx.lastWho;
        rest = s;
        break;
      }
      continue;
    }
    const w = parseWho(prefix);
    if (w) {
      who = mergeWho(ctx.pending, w);
      rest = s.slice(at);
      break;
    }
  }
  ctx.pending = null;
  if (!who) {
    // Just a name ("corners and"): it waits for the next clause's verb.
    const only = parseWho(s);
    if (only) {
      ctx.pending = only;
      return { ops, actions, ok: true };
    }
    return { ops, actions, ok: false };
  }
  ctx.lastWho = who;
  rest = rest.replace(/^(is|are|should|will|goes|go)\s+/, '');

  if ((m = rest.match(new RegExp(`^(?:at |to )?${NUM}(?: deep| off(?: the ball)?| depth)?$`)))) ops.push({ t: 'depth', who, yd: Number(m[1]) });
  else if ((m = rest.match(new RegExp(`^(?:back|deeper|bail)(?: by)? ${NUM}$`)))) ops.push({ t: 'depthBy', who, yd: Number(m[1]) });
  else if ((m = rest.match(new RegExp(`^${NUM} (?:back|deeper)$`)))) ops.push({ t: 'depthBy', who, yd: Number(m[1]) });
  else if ((m = rest.match(new RegExp(`^(?:up|closer|shallower|down)(?: by)? ${NUM}$`)))) ops.push({ t: 'depthBy', who, yd: -Number(m[1]) });
  else if ((m = rest.match(new RegExp(`^${NUM} (?:up|closer|shallower)$`)))) ops.push({ t: 'depthBy', who, yd: -Number(m[1]) });
  else if ((m = rest.match(new RegExp(`^(out|wider|in|inside|tighter|left|right)(?: by)? ${NUM}$`))))
    ops.push({ t: 'lateralBy', who, yd: Number(m[2]), dir: lateralDir(m[1]) });
  else if ((m = rest.match(new RegExp(`^${NUM} (out|wider|in|inside|tighter|left|right)$`))))
    ops.push({ t: 'lateralBy', who, yd: Number(m[1]), dir: lateralDir(m[2]) });
  else if ((m = rest.match(new RegExp(`^over (?:the )?(?:number |# ?|no )?(\\d|first|second|third|1st|2nd|3rd|slot|wide ?out|outside receiver)(?: receiver)?(?: (?:to the |on the )?(left|right))?$`)))) {
    const r = m[1];
    const rank = /slot/.test(r) ? 2 : /wide|outside/.test(r) ? 1 : ORD[r] ?? Number(r);
    ops.push({ t: 'over', who, rank, side: m[2] as 'left' | 'right' | undefined });
  } else if ((m = rest.match(/^(?:rush(?:es)?|blitz(?:es)?|slant(?:s)?|stunt(?:s)?|run(?:s)? through|fit(?:s)?|fill(?:s)?)?(?: (?:to|into|in|through))? ?(?:the )?([abcd]) ?gap(?: (?:to the |on the )?(left|right))?$/)))
    ops.push({ t: 'rush', who, gap: m[1].toUpperCase() as 'A', side: m[2] as 'left' | 'right' | undefined });
  else if ((m = rest.match(/^(?:drop(?:s)?|bail(?:s)?|carry|carries|sink(?:s)?|play(?:s)?)(?: to| in| into)?(?: the)? (.+)$/))) {
    const zone = ZONES.find(([re]) => re.test(m![1]))?.[1];
    if (!zone) return { ops, actions, ok: false };
    ops.push({ t: 'drop', who, zone });
  } else if ((m = rest.match(/^(?:read )?(\d|first|second|third|1st|2nd|3rd) read$|^read (\d)$/))) ops.push({ t: 'read', who, n: ORD[m[1] ?? ''] ?? Number(m[1] ?? m[2]) });
  else if (/^(clear|no)( (the )?(path|paths|line|lines|rush|drop))?$/.test(rest)) ops.push({ t: 'clearPaths', who });
  else return { ops, actions, ok: false };
  return { ops, actions, ok: true };
}

function lateralDir(w: string): 'left' | 'right' | 'out' | 'in' {
  if (w === 'left' || w === 'right') return w;
  return w === 'out' || w === 'wider' ? 'out' : 'in';
}

// Common speech-to-text slips for football words.
function fixMishearings(s: string) {
  return s
    .replace(/\b(8|eight|hey|ay) gap\b/g, 'a gap')
    .replace(/\b(be|bee) gap\b/g, 'b gap')
    .replace(/\b(see|sea) gap\b/g, 'c gap')
    .replace(/\b(dee) gap\b/g, 'd gap')
    .replace(/\b(nicole|nickle|nichol|nicol)\b/g, 'nickel')
    .replace(/\bcorner's\b/g, 'corners')
    .replace(/\b(mic|mikey)\b/g, 'mike')
    .replace(/\bsafety's\b/g, 'safeties');
}

export function parseCommand(input: string, looks: Look[]): Parsed {
  const lower = fixMishearings(input.toLowerCase().replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim());
  const { rest, scope } = parseScope(numberize(lower));
  const ctx: Ctx = { looks, lastWho: null, pending: null };
  const ops: Op[] = [];
  const actions: Action[] = [];
  const unknown: string[] = [];
  // Field commands keep original casing, so split the original the same way.
  // Sentence breaks: ". " (not decimals), ";", ",", "then", "and". A bare
  // name left over from a split ("corners and …") waits for the next verb.
  const splitter = /\s*(?:\.(?=\s|$)|;|,(?! ?\d+ (?:and|,))| and then | then | and )\s*/;
  const clauses = rest.split(splitter).filter((x) => x && x.trim());
  const origClauses = input.replace(/\s+/g, ' ').split(splitter).filter((x) => x && x.trim());
  clauses.forEach((cl, i) => {
    const orig = origClauses.length === clauses.length ? origClauses[i] : cl;
    const r = clauseOps(cl, ctx, orig);
    if (!r.ok) unknown.push(orig.trim());
    ops.push(...r.ops);
    actions.push(...r.actions);
  });
  return { ops, actions, scope, unknown };
}

// ---- Applying ---------------------------------------------------------------

const GAP_X: Record<'A' | 'B' | 'C' | 'D', number> = { A: 1.1, B: 3.3, C: 5.5, D: 7.7 };

function zoneSpot(zone: Zone, sign: number) {
  switch (zone) {
    case 'flat':
      return { x: 15 * sign, y: 5 };
    case 'hook':
      return { x: 4.5 * sign, y: 7 };
    case 'curl':
      return { x: 9 * sign, y: 8.5 };
    case 'deep half':
      return { x: 11 * sign, y: 11.5 };
    case 'deep third':
      return { x: 16 * sign, y: 11.5 };
    case 'deep middle':
      return { x: 0, y: 11.5 };
    case 'low hole':
      return { x: 0, y: 7 };
  }
}

export function moveWithPaths(card: Draft<Card>, p: Draft<Player>, dx: number, dy: number) {
  p.x += dx;
  p.y += dy;
  for (const pa of card.paths) if (pa.ownerId === p.id) pa.points = pa.points.map((q) => ({ x: q.x + dx, y: q.y + dy }));
  for (const n of card.notes)
    if (n.anchorId === p.id) {
      n.x += dx;
      n.y += dy;
    }
}

export function describeOp(op: Op): string {
  const w = 'who' in op ? op.who.words.replace(/\b(the|both|all|our)\b/gi, '').replace(/\s+/g, ' ').trim().toUpperCase() : '';
  switch (op.t) {
    case 'depth':
      return `${w} → ${op.yd} yd`;
    case 'depthBy':
      return `${w} ${op.yd > 0 ? 'back' : 'up'} ${Math.abs(op.yd)} yd`;
    case 'lateralBy':
      return `${w} ${op.dir} ${op.yd} yd`;
    case 'over':
      return `${w} over #${op.rank}${op.side ? ` ${op.side}` : ''}`;
    case 'rush':
      return `${w} rush ${op.gap} gap${op.side ? ` ${op.side}` : ''}`;
    case 'drop':
      return `${w} drop to ${op.zone}`;
    case 'read':
      return `${w} read ${op.n}`;
    case 'clearPaths':
      return `${w}: clear paths`;
    case 'field':
      return `${{ play: 'Play call', defense: 'Defense', period: 'Period', playNo: 'Play #' }[op.key]} → ${op.value}`;
    case 'hash':
      return `Hash → ${op.value === 'L' ? 'Left' : op.value === 'R' ? 'Right' : 'Middle'}`;
    case 'look':
      return `Apply team look ${op.name}`;
    case 'sample':
      return `Apply sample ${op.name}`;
    case 'add':
      return `Add ${op.side === 'D' ? 'defender' : 'offensive player'} ${op.label}`;
    case 'assign':
      return `${w} assignment: “${op.text}”`;
    case 'cue':
      return `Coaching point: “${op.text}”`;
  }
}

// Applies ops to one card in order, so a player added early can be moved by a
// later clause. Returns problems instead of throwing; the caller decides
// whether to commit.
export interface LookHooks {
  look: (card: Draft<Card>, lookId: string) => void;
  sample: (card: Draft<Card>, key: string, side: Side) => void;
}

export function applyOps(card: Draft<Card>, ops: Op[], hooks?: LookHooks): string[] {
  const problems: string[] = [];
  for (const op of ops) {
    if (op.t === 'field') {
      card[op.key] = op.value;
      continue;
    }
    if (op.t === 'hash') {
      card.hash = op.value;
      continue;
    }
    if (op.t === 'cue') {
      card.mode = 'install';
      card.teaching ??= { assignments: [], cues: '' };
      card.teaching.cues = card.teaching.cues ? `${card.teaching.cues}\n${op.text}` : op.text;
      continue;
    }
    if (op.t === 'add') {
      card.players.push({ id: id(), side: op.side, label: op.label, shape: op.side === 'O' ? 'circle' : 'letter', x: op.x, y: op.y });
      continue;
    }
    if (op.t === 'look') {
      hooks?.look(card, op.lookId);
      continue;
    }
    if (op.t === 'sample') {
      hooks?.sample(card, op.key, op.side);
      continue;
    }

    const { players, problem } = resolveWho(card, op.who);
    if (problem) {
      problems.push(problem);
      continue;
    }
    for (const p of players as Draft<Player>[]) {
      const away = p.side === 'D' ? 1 : -1; // direction away from the line
      switch (op.t) {
        case 'depth':
          moveWithPaths(card, p, 0, op.yd * away - p.y);
          break;
        case 'depthBy':
          moveWithPaths(card, p, 0, op.yd * away);
          break;
        case 'lateralBy': {
          const sgn = op.dir === 'left' ? -1 : op.dir === 'right' ? 1 : (p.x >= 0 ? 1 : -1) * (op.dir === 'out' ? 1 : -1);
          moveWithPaths(card, p, op.yd * sgn, 0);
          break;
        }
        case 'over': {
          const side = op.side ?? (p.x < 0 ? 'left' : 'right');
          const receivers = card.players
            .filter((q) => q.side !== p.side && q.shape !== 'lineman' && q.shape !== 'center' && Math.abs(q.y) < 3 && (side === 'left' ? q.x < -0.5 : q.x > 0.5))
            .sort((a, b) => Math.abs(b.x) - Math.abs(a.x));
          const target = receivers[op.rank - 1];
          if (!target) problems.push(`No #${op.rank} receiver on the ${side} of card #${card.playNo || '—'}`);
          else moveWithPaths(card, p, target.x - p.x, 0);
          break;
        }
        case 'rush': {
          const sign = op.side ? (op.side === 'left' ? -1 : 1) : p.x < 0 ? -1 : 1;
          const gx = GAP_X[op.gap] * sign;
          card.paths = card.paths.filter((pa) => pa.ownerId !== p.id);
          card.paths.push({
            id: id(), ownerId: p.id, purpose: 'rush', line: 'solid', end: 'arrow', ink: 'red', curved: true,
            points: [{ x: gx, y: 0.4 }, { x: gx, y: -1.4 }],
          });
          break;
        }
        case 'drop': {
          const spot = zoneSpot(op.zone, p.x < 0 ? -1 : 1);
          card.paths = card.paths.filter((pa) => pa.ownerId !== p.id);
          card.paths.push({ id: id(), ownerId: p.id, purpose: 'drop', line: 'solid', end: 'arrow', ink: 'blue', curved: false, points: [spot] });
          break;
        }
        case 'read':
          p.read = op.n;
          break;
        case 'clearPaths':
          card.paths = card.paths.filter((pa) => pa.ownerId !== p.id);
          break;
        case 'assign': {
          card.mode = 'install';
          card.teaching ??= { assignments: [], cues: '' };
          const row = card.teaching.assignments.find((a) => a.playerId === p.id);
          if (row) row.text = op.text;
          else card.teaching.assignments.push({ id: id(), playerId: p.id, label: p.label, text: op.text });
          break;
        }
      }
    }
  }
  return problems;
}

export function scopeCards(scope: Scope, cards: Card[], activeId: string): { cards: Card[]; problem?: string } {
  switch (scope.kind) {
    case 'active':
      return { cards: cards.filter((c) => c.id === activeId) };
    case 'all':
      return { cards };
    case 'numbers': {
      const want = scope.numbers.map((n) => n.toUpperCase());
      const hit = cards.filter((c) => want.includes(c.playNo.toUpperCase()));
      const missing = want.filter((n) => !cards.some((c) => c.playNo.toUpperCase() === n));
      return { cards: hit, problem: missing.length ? `No card numbered ${missing.join(', ')}` : undefined };
    }
    case 'call': {
      const want = normalize(scope.call);
      const hit = cards.filter((c) => normalize(c.defense) === want || normalize(c.play).startsWith(want));
      return { cards: hit, problem: hit.length ? undefined : `No cards call “${scope.call.toUpperCase()}”` };
    }
  }
}
