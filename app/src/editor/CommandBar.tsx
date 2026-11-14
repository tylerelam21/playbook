import { useEffect, useRef, useState } from 'react';
import { produce, type Draft } from 'immer';
import { activeCard, useStore } from '../store';
import { applyOps, describeOp, parseCommand, scopeCards, type Action } from '../model/commands';
import { applyVersionTo, latest } from '../model/looks';
import { DEFENSE_LOOKS, OFFENSE_LOOKS, blankCard } from '../model/samples';
import { clampToField } from '../model/field';
import type { Card, Side } from '../model/types';
import { buildRequest, type InterpretResult } from '../ai/protocol';
import { applyAiOps } from '../ai/applyAi';
import { useDevice } from '../ui/useDevice';

// Say or type a change.
//  - Hold M (or the mic button) to talk; release to stop. A quick tap keeps
//    listening until you tap again.
//  - Exact simple commands ("corners at 7") are handled instantly in the
//    browser. Everything else goes to Claude through /api/interpret.
//  - Nothing changes until you apply the preview.

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

const getSpeechCtor = (): (new () => Recognition) | undefined => {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

const EXAMPLES = [
  'Corners press, outside leverage',
  'Bring the nickel down to apex and bail the corners at the snap',
  'Mike and Will scrape over the top, Mike fills the A gap',
  'Rotate to cloud on the boundary side',
  'Slant the line to the field',
  'Free safety rolls down into the robber hole',
  'On all CHOP cards, corners at 8',
  'New card: play Larry Sniff 23, defense chop, hash right',
  'Mike assignment: fill the A gap fast',
];

const TAP_MS = 300;

interface Plan {
  source: 'quick' | 'ai';
  text: string;
  lines: string[];
  targets: Card[];
  problems: string[];
  question: string | null;
  note?: string;
  apply: () => void;
  ghost: Card | null;
}

const ACTION_TEXT: Record<Action['t'], string> = {
  saveLook: 'Save as team look',
  newCard: 'New card',
  nextCard: 'Go to next card',
  prevCard: 'Go to previous card',
  duplicate: 'Duplicate this card',
  ready: 'Mark Ready',
  undo: 'Undo last change',
};
const NAV = new Set<Action['t']>(['newCard', 'duplicate', 'nextCard', 'prevCard']);

function lookHooks(ruleset: 'hs' | 'college' | 'nfl') {
  return {
    look: (card: Draft<Card>, lookId: string) => {
      const look = useStore.getState().looks.find((l) => l.id === lookId);
      if (look) applyVersionTo(card, look, latest(look));
    },
    sample: (card: Draft<Card>, key: string, side: Side) => {
      const tpl = [...OFFENSE_LOOKS, ...DEFENSE_LOOKS].find((l) => l.key === key);
      if (!tpl) return;
      const fresh = clampToField(tpl.build(), card.hash, ruleset);
      const gone = new Set(card.players.filter((p) => p.side === side).map((p) => p.id));
      card.players = [...card.players.filter((p) => p.side !== side), ...fresh];
      card.paths = card.paths.filter((p) => !(p.ownerId && gone.has(p.ownerId)));
      for (const n of card.notes) if (n.anchorId && gone.has(n.anchorId)) n.anchorId = null;
      if (card.looks) delete card.looks[side];
    },
  };
}

// ---- Plans --------------------------------------------------------------------

// The built-in interpreter. Returns null unless it understood every word.
function quickPlan(text: string): Plan | null {
  const st = useStore.getState();
  const parsed = parseCommand(text, st.looks);
  if (parsed.unknown.length || (!parsed.ops.length && !parsed.actions.length)) return null;
  const navFirst = parsed.actions.some((a) => NAV.has(a.t));
  const { cards: targets, problem } = scopeCards(parsed.scope, st.cards, st.activeId);
  if (problem) return null;
  const hooks = lookHooks(st.workspace.ruleset);
  const problems: string[] = [];
  let ghost: Card | null = null;
  if (parsed.ops.length && !navFirst) {
    for (const c of targets) {
      const next = produce(c, (d) => void problems.push(...applyOps(d, parsed.ops, hooks)));
      if (c.id === st.activeId) ghost = next;
    }
  }
  if (problems.length) return null; // let Claude try (it can ask a better question)
  const lines = [
    ...parsed.actions.filter((a) => NAV.has(a.t)).map((a) => ACTION_TEXT[a.t]),
    ...parsed.ops.map(describeOp),
    ...parsed.actions.filter((a) => !NAV.has(a.t)).map((a) => (a.t === 'saveLook' ? `Save ${a.side === 'D' ? 'defense' : 'formation'} as “${a.name}”` : ACTION_TEXT[a.t])),
  ];
  return {
    source: 'quick',
    text,
    lines,
    targets: navFirst ? [] : targets,
    problems: [],
    question: null,
    ghost,
    apply: () => {
      for (const a of parsed.actions.filter((x) => NAV.has(x.t))) {
        const s = useStore.getState();
        const idx = s.cards.findIndex((c) => c.id === s.activeId);
        if (a.t === 'newCard') s.addCard(s.activeId);
        else if (a.t === 'duplicate') s.duplicateCard(s.activeId);
        else if (a.t === 'nextCard' && idx < s.cards.length - 1) s.setActive(s.cards[idx + 1].id);
        else if (a.t === 'prevCard' && idx > 0) s.setActive(s.cards[idx - 1].id);
      }
      if (parsed.ops.length) {
        const s = useStore.getState();
        const ids = navFirst ? [s.activeId] : targets.map((c) => c.id);
        s.commitCards(ids, (d) => void applyOps(d, parsed.ops, lookHooks(s.workspace.ruleset)));
      }
      for (const a of parsed.actions) {
        const s = useStore.getState();
        if (a.t === 'ready') s.commit((_, c) => void (c.status = 'ready'), { semantic: false });
        else if (a.t === 'undo') s.undo();
        else if (a.t === 'saveLook') s.setModal({ type: 'saveLook', side: a.side, name: a.name });
      }
    },
  };
}

function aiPlan(text: string, result: InterpretResult): Plan {
  const st = useStore.getState();
  const ctx = { looks: st.looks, ruleset: st.workspace.ruleset };
  const known = result.changes.filter((ch) => ch.cardId === 'new' || st.cards.some((c) => c.id === ch.cardId));
  const problems: string[] = [];
  if (known.length < result.changes.length) problems.push('Skipped changes for a card that isn’t in this packet');
  let ghost: Card | null = null;
  for (const ch of known) {
    const base = ch.cardId === 'new' ? blankCard('') : st.cards.find((c) => c.id === ch.cardId)!;
    const next = produce(base, (d) => void problems.push(...applyAiOps(d, ch.ops, ctx)));
    if (ch.cardId === st.activeId) ghost = next;
  }
  return {
    source: 'ai',
    text,
    lines: result.summary,
    targets: st.cards.filter((c) => known.some((ch) => ch.cardId === c.id)),
    problems: [...new Set(problems)],
    question: result.question,
    ghost,
    apply: () => {
      const s = useStore.getState();
      for (const ch of known.filter((c) => c.cardId === 'new')) {
        s.addCard(s.activeId);
        const nid = useStore.getState().activeId;
        useStore.getState().commitCards([nid], (d) => void applyAiOps(d, ch.ops, ctx));
      }
      const rest = known.filter((c) => c.cardId !== 'new');
      if (rest.length) {
        const byId = new Map(rest.map((c) => [c.cardId, c.ops]));
        useStore.getState().commitCards([...byId.keys()], (d) => void applyAiOps(d, byId.get(d.id)!, ctx));
      }
    },
  };
}

// ---- Component -------------------------------------------------------------------

export function CommandBar() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [interim, setInterim] = useState('');
  const [listening, setListening] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [thinking, setThinking] = useState(false);
  const [help, setHelp] = useState(false);
  const recRef = useRef<Recognition | null>(null);
  const pressAt = useRef(0);
  const sticky = useRef(false); // tapped (not held): keep listening until tapped again
  const abortRef = useRef<AbortController | null>(null);
  const history = useRef<{ said: string; reply: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const card = useStore(activeCard);
  const setGhost = useStore((s) => s.setGhost);
  const speech = getSpeechCtor();
  const device = useDevice();
  const setCmdHeight = useStore((s) => s.setCmdHeight);
  const panelRef = useRef<HTMLDivElement>(null);

  // Tell the canvas how much room the panel needs so the card stays visible.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) {
      setCmdHeight(0);
      return;
    }
    const ro = new ResizeObserver(() => setCmdHeight(el.offsetHeight));
    ro.observe(el);
    return () => {
      ro.disconnect();
      setCmdHeight(0);
    };
  }, [open, setCmdHeight]);

  const showPlan = (p: Plan | null) => {
    setPlan(p);
    setGhost(p?.ghost ?? null);
  };

  // When the AI can't be reached, show what the built-in interpreter made of it.
  const fallbackPlan = (input: string, note: string): Plan => {
    const st = useStore.getState();
    const parsed = parseCommand(input, st.looks);
    const { cards: targets } = scopeCards(parsed.scope, st.cards, st.activeId);
    return {
      source: 'quick',
      text: input,
      lines: parsed.ops.map(describeOp),
      targets,
      problems: parsed.unknown.map((u) => `Didn’t understand “${u}”`),
      question: null,
      note,
      ghost: null,
      apply: () => {
        if (parsed.ops.length) {
          const s = useStore.getState();
          s.commitCards(targets.map((c) => c.id), (d) => void applyOps(d, parsed.ops, lookHooks(s.workspace.ruleset)));
        }
      },
    };
  };

  const submit = async (raw = text) => {
    const input = raw.trim();
    if (!input) return;
    abortRef.current?.abort();
    const quick = quickPlan(input);
    if (quick) {
      showPlan(quick);
      return;
    }
    const st = useStore.getState();
    const body = buildRequest(input, st.cards, st.activeId, st.looks, st.workspace, history.current.slice(-4));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setThinking(true);
    showPlan(null);
    try {
      const res = await fetch('/api/interpret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.error) {
        const why = res.status === 404 ? 'AI isn’t available here (no server function in this preview).' : data?.message ?? `AI request failed (${res.status}).`;
        showPlan(fallbackPlan(input, why));
        return;
      }
      const result = data as InterpretResult;
      history.current = [...history.current, { said: input, reply: result.question ?? result.summary.join('; ') }].slice(-4);
      showPlan(aiPlan(input, result));
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      showPlan(fallbackPlan(input, 'Couldn’t reach the AI. Check your connection.'));
    } finally {
      if (abortRef.current === ctrl) setThinking(false);
    }
  };

  const apply = () => {
    if (!plan || !plan.lines.length || plan.question) return;
    plan.apply();
    const n = plan.targets.length;
    useStore.getState().toast(n > 1 ? `Applied to ${n} cards. ⌘Z to undo.` : 'Applied. ⌘Z to undo.', 'good');
    showPlan(null);
    setText('');
    inputRef.current?.blur(); // so ⌘Z undoes the change, not the typing
  };

  const cancel = () => {
    abortRef.current?.abort();
    setThinking(false);
    showPlan(null);
  };

  // ---- Speech: hold to talk ----

  const startListening = () => {
    if (recRef.current) return;
    if (!speech) {
      useStore.getState().toast('Speech isn’t available in this browser. Type the change, or use Chrome, Edge or Safari.', 'warn');
      setOpen(true);
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    setOpen(true);
    cancel();
    setText('');
    const rec = new speech();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = true; // keep listening while held, through pauses
    let finalText = '';
    let liveText = '';
    rec.onresult = (e) => {
      let live = '';
      finalText = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += `${r[0].transcript} `;
        else live += r[0].transcript;
      }
      liveText = live;
      setInterim(live);
      setText(finalText.trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
        useStore.getState().toast('Microphone access was blocked. Allow it in the browser’s site settings, or type instead.', 'warn');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') useStore.getState().toast(`Speech stopped (${e.error}). Try again or type it.`, 'warn');
    };
    rec.onend = () => {
      recRef.current = null;
      sticky.current = false;
      setListening(false);
      setInterim('');
      const all = `${finalText} ${liveText}`.replace(/\s+/g, ' ').trim();
      setText(all);
      if (all) void submit(all);
    };
    recRef.current = rec;
    pressAt.current = Date.now();
    setListening(true);
    rec.start();
  };
  const stopListening = () => recRef.current?.stop();

  // Press: start (or stop, if a tap left it listening). Release: stop, unless it was a tap.
  const press = () => {
    if (recRef.current && sticky.current) {
      stopListening();
      return;
    }
    startListening();
  };
  const release = () => {
    if (!recRef.current) return;
    if (Date.now() - pressAt.current < TAP_MS) sticky.current = true;
    else stopListening();
  };

  useEffect(() => {
    const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement).closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey;
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        if (!e.repeat) press();
      } else if (e.key === 'Enter' && plan) {
        e.preventDefault();
        apply();
      } else if (e.key === 'Escape' && (plan || thinking)) {
        cancel();
      } else if (e.key === '/') {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'm' || e.key === 'M') release();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  });

  // Switching cards drops a stale preview; leaving clears the canvas preview.
  const cardId = card.id;
  useEffect(() => {
    abortRef.current?.abort();
    setThinking(false);
    setPlan(null);
    setGhost(null);
  }, [cardId, setGhost]);

  // Touch screens: a big hold-to-talk button, plus a small one to type.
  if (!open && device.touch)
    return (
      <div className="fab-wrap">
        <button
          className="fab-type"
          aria-label="Type a change"
          onClick={() => {
            setOpen(true);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
        >
          Aa
        </button>
        <button
          className="fab"
          aria-label="Hold to talk"
          onPointerDown={(e) => {
            e.preventDefault();
            press();
          }}
          onPointerUp={release}
          onContextMenu={(e) => e.preventDefault()}
        >
          <MicIcon />
        </button>
      </div>
    );

  if (!open)
    return (
      <button
        className="cmd-pill"
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        title="Say or type a change (hold M to talk, / to type)"
      >
        <MicIcon /> Say or type a change <kbd>hold M</kbd>
      </button>
    );

  const canApply = !!plan && plan.lines.length > 0 && !plan.question;

  return (
    <div className="cmd" ref={panelRef} onPointerDown={(e) => e.stopPropagation()}>
      {thinking && (
        <div className="cmd-preview thinking">
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
          <span className="thinking-text">Working out “{text}”…</span>
          <button className="link" onClick={cancel}>
            Cancel
          </button>
        </div>
      )}
      {plan && (
        <div className="cmd-preview">
          <div className="cmd-heard">
            <span className={`src ${plan.source}`}>{plan.source === 'ai' ? 'AI' : 'Quick'}</span>“{plan.text}”
            <span className="muted">
              {plan.targets.length > 1
                ? ` · ${plan.targets.length} cards: ${plan.targets.map((c) => `#${c.playNo || '—'}`).join(', ')}`
                : plan.targets.length === 1 && plan.targets[0].id !== card.id
                  ? ` · card #${plan.targets[0].playNo || '—'}`
                  : ''}
            </span>
          </div>
          {plan.question && <div className="cmd-question">{plan.question}</div>}
          {plan.lines.length > 0 && (
            <ul className="cmd-lines">
              {plan.lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
          {plan.note && <div className="cmd-problem">{plan.note}</div>}
          {plan.problems.map((p, i) => (
            <div key={i} className="cmd-problem">
              {p}
            </div>
          ))}
          <div className="cmd-actions">
            {plan.question ? (
              <span className="muted small">Answer by {device.touch ? 'holding the mic' : 'holding M'} or typing below.</span>
            ) : (
              <button
                className="btn"
                onClick={() => {
                  setText(plan.text);
                  showPlan(null);
                  setTimeout(() => inputRef.current?.focus(), 0);
                }}
              >
                Edit
              </button>
            )}
            <button className="btn" onClick={cancel}>
              {plan.question ? 'Dismiss' : 'Cancel'}
            </button>
            {!plan.question && (
              <button className="btn primary" disabled={!canApply} onClick={apply}>
                {plan.problems.length ? 'Apply the rest' : 'Apply'} {!device.touch && <kbd>↵</kbd>}
              </button>
            )}
          </div>
        </div>
      )}
      {help && (
        <div className="cmd-help">
          <div className="panel-title">Talk like you would to an assistant</div>
          <ul>
            {EXAMPLES.map((x) => (
              <li key={x}>
                <button
                  className="link"
                  onClick={() => {
                    setText(x);
                    setHelp(false);
                    inputRef.current?.focus();
                  }}
                >
                  {x}
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small">
            Left and right are as the card prints. Team terms the app hasn’t seen (like a call name) get a question back instead of a guess — save the look first and it’ll know it.
          </p>
        </div>
      )}
      <div className={`cmd-bar${listening ? ' listening' : ''}`}>
        <button
          className={`cmd-mic${listening ? ' on' : ''}`}
          onPointerDown={(e) => {
            e.preventDefault();
            press();
          }}
          onPointerUp={release}
          title={speech ? 'Hold to talk (or hold M). Tap to keep listening.' : 'Speech isn’t available in this browser'}
        >
          <MicIcon />
        </button>
        <input
          ref={inputRef}
          value={listening ? `${text}${interim ? (text ? ' ' : '') + interim : ''}` : text}
          placeholder={listening ? 'Listening… release to stop' : device.touch ? 'Hold the mic and talk, or type a change' : 'Hold M and talk, or type: “corners press, bail at the snap”'}
          onChange={(e) => {
            setText(e.target.value);
            if (plan) showPlan(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              if (plan && plan.text === text.trim() && canApply) apply();
              else void submit();
            }
            if (e.key === 'Escape') {
              if (plan || thinking) cancel();
              else setOpen(false);
            }
          }}
          readOnly={listening}
        />
        <button className="mini" onClick={() => setHelp(!help)} title="Examples">
          ?
        </button>
        <button
          className="mini"
          onClick={() => {
            stopListening();
            cancel();
            setOpen(false);
          }}
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3" />
    </svg>
  );
}
