import { useEffect, useRef, useState } from 'react';
import type { Draft } from 'immer';
import { activeCard, useStore } from '../store';
import { applyOps, describeOp, parseCommand, scopeCards, type Action, type Parsed } from '../model/commands';
import { applyVersionTo, latest } from '../model/looks';
import { DEFENSE_LOOKS, OFFENSE_LOOKS } from '../model/samples';
import { clampToField } from '../model/field';
import type { Card, Side } from '../model/types';
import { produce } from 'immer';

// Say or type a change. Speech uses the browser's built-in recognition
// (Chrome/Edge send audio to their speech service; Safari may transcribe on
// device). Understanding the words happens here, in model/commands.ts.

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

const SpeechCtor: (new () => Recognition) | undefined =
  typeof window !== 'undefined'
    ? ((window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition)
    : undefined;

const EXAMPLES = [
  'corners at 7',
  'move both corners back one',
  'nickel over number 2',
  'mike rush the A gap, will drop to the hook',
  'free safety drop to deep middle',
  'will 2 left',
  'hash left, defense chop',
  'apply chop',
  'corners at 8 on cards 3, 4 and 7',
  'corners at 8 on all chop cards',
  'add a defender R at 6 deep 8 left',
  'mike assignment: fill the A gap fast',
  'new card, play call Larry Sniff 23, defense chop',
  'next card · mark it ready · undo',
];

interface Preview {
  text: string;
  parsed: Parsed;
  lines: string[];
  targets: Card[];
  problems: string[];
}

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

const ACTION_TEXT: Record<Action['t'], string> = {
  saveLook: 'Save as team look',
  newCard: 'New card',
  nextCard: 'Go to next card',
  prevCard: 'Go to previous card',
  duplicate: 'Duplicate this card',
  ready: 'Mark Ready',
  undo: 'Undo last change',
};

export function CommandBar() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [interim, setInterim] = useState('');
  const [listening, setListening] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [help, setHelp] = useState(false);
  const recRef = useRef<Recognition | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const card = useStore(activeCard);

  const build = (input: string): Preview | null => {
    const st = useStore.getState();
    const parsed = parseCommand(input, st.looks);
    if (!parsed.ops.length && !parsed.actions.length && !parsed.unknown.length) return null;
    // Cards created or chosen by actions come first, so their ops target the new card.
    const navFirst = parsed.actions.some((a) => a.t === 'newCard' || a.t === 'duplicate' || a.t === 'nextCard' || a.t === 'prevCard');
    const { cards: targets, problem } = scopeCards(parsed.scope, st.cards, st.activeId);
    const problems: string[] = problem ? [problem] : [];
    if (parsed.ops.length && !navFirst) {
      // Dry run on copies to surface problems before anything changes.
      const hooks = lookHooks(st.workspace.ruleset);
      for (const c of targets) produce(c, (d) => void problems.push(...applyOps(d, parsed.ops, hooks)));
    }
    const lines = [...parsed.actions.filter((a) => navFirst && a.t !== 'saveLook' && a.t !== 'ready' && a.t !== 'undo').map((a) => ACTION_TEXT[a.t]), ...parsed.ops.map(describeOp)];
    lines.push(...parsed.actions.filter((a) => !navFirst || a.t === 'saveLook' || a.t === 'ready' || a.t === 'undo').map((a) => (a.t === 'saveLook' ? `Save ${a.side === 'D' ? 'defense' : 'formation'} as “${a.name}”` : ACTION_TEXT[a.t])));
    return { text: input, parsed, lines, targets: navFirst ? [] : targets, problems: [...new Set(problems)] };
  };

  const submit = (input = text) => {
    const p = build(input.trim());
    setPreview(p);
    if (!p) useStore.getState().toast('Nothing to do — try one of the examples (click ?).', 'info');
  };

  const apply = () => {
    if (!preview) return;
    const st = useStore.getState();
    const { parsed } = preview;
    const navFirst = parsed.actions.filter((a) => ['newCard', 'duplicate', 'nextCard', 'prevCard'].includes(a.t));
    for (const a of navFirst) {
      const s = useStore.getState();
      const idx = s.cards.findIndex((c) => c.id === s.activeId);
      if (a.t === 'newCard') s.addCard(s.activeId);
      else if (a.t === 'duplicate') s.duplicateCard(s.activeId);
      else if (a.t === 'nextCard' && idx < s.cards.length - 1) s.setActive(s.cards[idx + 1].id);
      else if (a.t === 'prevCard' && idx > 0) s.setActive(s.cards[idx - 1].id);
    }
    if (parsed.ops.length) {
      const s = useStore.getState();
      const targets = navFirst.length ? [s.activeId] : preview.targets.map((c) => c.id);
      const hooks = lookHooks(s.workspace.ruleset);
      s.commitCards(targets, (d) => void applyOps(d, parsed.ops, hooks));
    }
    for (const a of parsed.actions) {
      const s = useStore.getState();
      if (a.t === 'ready') s.commit((_, c) => void (c.status = 'ready'), { semantic: false });
      else if (a.t === 'undo') s.undo();
      else if (a.t === 'saveLook') s.setModal({ type: 'saveLook', side: a.side, name: a.name });
    }
    const n = preview.targets.length;
    st.toast(n > 1 ? `Applied to ${n} cards. ⌘Z to undo.` : 'Applied. ⌘Z to undo.', 'good');
    setPreview(null);
    setText('');
    // Hand the keyboard back to the card so ⌘Z undoes the change.
    inputRef.current?.blur();
  };

  const startListening = () => {
    if (!SpeechCtor) {
      useStore.getState().toast('Speech isn’t available in this browser. Type the change instead, or use Chrome, Edge or Safari.', 'warn');
      setOpen(true);
      return;
    }
    setOpen(true);
    setPreview(null);
    const rec = new SpeechCtor();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    rec.onresult = (e) => {
      let live = '';
      finalText = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else live += r[0].transcript;
      }
      setInterim(live);
      setText(finalText);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
        useStore.getState().toast('Microphone access was blocked. Allow it in the browser’s site settings, or type instead.', 'warn');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') useStore.getState().toast(`Speech stopped (${e.error}). Try again or type it.`, 'warn');
    };
    rec.onend = () => {
      setListening(false);
      setInterim('');
      recRef.current = null;
      if (finalText.trim()) submit(finalText);
    };
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  const stopListening = () => recRef.current?.stop();

  // M = talk, / = type
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        if (listening) stopListening();
        else startListening();
      } else if (e.key === 'Enter' && preview) {
        e.preventDefault();
        apply();
      } else if (e.key === '/') {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Switching cards drops a stale preview.
  useEffect(() => setPreview(null), [card.id]);

  if (!open)
    return (
      <button className="cmd-pill" onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }} title="Say or type a change (M to talk, / to type)">
        <MicIcon /> Say or type a change <kbd>M</kbd>
      </button>
    );

  return (
    <div className="cmd" onPointerDown={(e) => e.stopPropagation()}>
      {preview && (
        <div className="cmd-preview">
          <div className="cmd-heard">
            “{preview.text}”
            <span className="muted">
              {preview.targets.length > 1 ? ` · ${preview.targets.length} cards: ${preview.targets.map((c) => `#${c.playNo || '—'}`).join(', ')}` : preview.targets.length === 1 ? ` · card #${preview.targets[0].playNo || '—'}` : ''}
            </span>
          </div>
          {preview.lines.length > 0 && (
            <ul className="cmd-lines">
              {preview.lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
          {preview.problems.map((p, i) => (
            <div key={`p${i}`} className="cmd-problem">
              {p}
            </div>
          ))}
          {preview.parsed.unknown.map((u, i) => (
            <div key={`u${i}`} className="cmd-problem">
              Didn’t understand “{u}”
            </div>
          ))}
          <div className="cmd-actions">
            <button className="btn" onClick={() => { setText(preview.text); setPreview(null); setTimeout(() => inputRef.current?.focus(), 0); }}>
              Edit
            </button>
            <button className="btn" onClick={() => setPreview(null)}>
              Cancel
            </button>
            <button className="btn primary" disabled={!preview.lines.length} onClick={apply}>
              {preview.problems.length || preview.parsed.unknown.length ? 'Apply what I understood' : 'Apply'} <kbd>↵</kbd>
            </button>
          </div>
        </div>
      )}
      {help && (
        <div className="cmd-help">
          <div className="panel-title">Things you can say</div>
          <ul>
            {EXAMPLES.map((x) => (
              <li key={x}>
                <button className="link" onClick={() => { setText(x.split(' · ')[0]); setHelp(false); inputRef.current?.focus(); }}>
                  {x}
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small">Names: mike, will, sam, nickel, nose, tackle, end(s), corner(s), free safety, money/dollar, safeties, linebackers — or any label (“the H”). Left/right are as the card prints.</p>
        </div>
      )}
      <div className={`cmd-bar${listening ? ' listening' : ''}`}>
        <button className={`cmd-mic${listening ? ' on' : ''}`} onClick={listening ? stopListening : startListening} title={SpeechCtor ? (listening ? 'Stop (M)' : 'Talk (M)') : 'Speech not available in this browser'}>
          <MicIcon />
        </button>
        <input
          ref={inputRef}
          value={listening ? `${text}${interim ? (text ? ' ' : '') + interim : ''}` : text}
          placeholder={listening ? 'Listening…' : 'e.g. “corners at 7, mike rush the A gap”'}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              if (preview && preview.text === text.trim()) apply();
              else submit();
            }
            if (e.key === 'Escape') {
              if (preview) setPreview(null);
              else setOpen(false);
            }
          }}
          readOnly={listening}
        />
        <button className="mini" onClick={() => setHelp(!help)} title="Examples">
          ?
        </button>
        <button className="mini" onClick={() => { stopListening(); setOpen(false); setPreview(null); }} title="Close (Esc)">
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
