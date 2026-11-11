import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import type { Card, Ink, PathPurpose, Side, ThemeId, Workspace, Ruleset, PlayPath } from './model/types';
import { blankCard, id, seedPacket } from './model/samples';

export type Tool = 'select' | 'path' | 'offense' | 'defense' | 'note';

export interface PathPreset {
  key: PathPurpose;
  name: string;
  hint: string;
  style: Pick<PlayPath, 'line' | 'end' | 'ink' | 'curved'>;
}

export const PATH_PRESETS: PathPreset[] = [
  { key: 'rush', name: 'Rush', hint: 'Solid, arrow', style: { line: 'solid', end: 'arrow', ink: 'red', curved: true } },
  { key: 'drop', name: 'Drop', hint: 'Solid, arrow', style: { line: 'solid', end: 'arrow', ink: 'blue', curved: true } },
  { key: 'motion', name: 'Movement', hint: 'Wavy line', style: { line: 'zigzag', end: 'none', ink: 'blue', curved: false } },
  { key: 'route', name: 'Route', hint: 'Solid, arrow', style: { line: 'solid', end: 'arrow', ink: 'ink', curved: false } },
  { key: 'block', name: 'Block', hint: 'Solid, tee', style: { line: 'solid', end: 'tee', ink: 'ink', curved: false } },
  { key: 'other', name: 'Read / key', hint: 'Dashed', style: { line: 'dashed', end: 'none', ink: 'ink', curved: false } },
];

export interface Toast {
  id: string;
  text: string;
  tone: 'info' | 'warn' | 'good';
}

interface Snapshot {
  cards: Card[];
  activeId: string;
}

interface Layer {
  visible: boolean;
  locked: boolean;
}

export interface State {
  workspace: Workspace;
  cards: Card[];
  activeId: string;
  selection: string[];
  tool: Tool;
  preset: PathPurpose;
  layers: Record<Side, Layer>;
  past: Snapshot[];
  future: Snapshot[];
  toasts: Toast[];
  savedAt: number;
  zoom: number;

  // Record an undo step, then change the cards. Semantic edits on a Ready card
  // return it to Draft.
  commit: (fn: (cards: Draft<Card[]>, card: Draft<Card>) => void, opts?: { semantic?: boolean }) => void;
  // For continuous gestures: call begin() once, then live() on every move.
  begin: () => void;
  live: (fn: (cards: Draft<Card[]>, card: Draft<Card>) => void) => void;
  end: () => void;
  undo: () => void;
  redo: () => void;

  setActive: (id: string) => void;
  select: (ids: string[]) => void;
  setTool: (t: Tool) => void;
  setPreset: (p: PathPurpose) => void;
  setTheme: (t: ThemeId) => void;
  setRuleset: (r: Ruleset) => void;
  setPacketName: (n: string) => void;
  toggleLayer: (side: Side, key: keyof Layer) => void;
  setZoom: (z: number) => void;

  addCard: (afterId?: string, card?: Card) => void;
  duplicateCard: (cardId: string) => void;
  deleteCard: (cardId: string) => void;
  moveCard: (from: number, to: number) => void;
  insertCards: (cards: Card[]) => void;

  toast: (text: string, tone?: Toast['tone']) => void;
}

const STORAGE_KEY = 'playbook.v1';

function load(): Pick<State, 'workspace' | 'cards' | 'activeId'> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.cards) && data.cards.length) return data;
    }
  } catch {
    /* fall through to a fresh sample packet */
  }
  const cards = seedPacket();
  return {
    workspace: { packetName: 'Wednesday scout · sample', ruleset: 'college', orientation: 'defense-view', theme: 'print' },
    cards,
    activeId: cards[0].id,
  };
}

const initial = load();
const HISTORY_LIMIT = 200;
let gestureDirty = false;

export const useStore = create<State>((set, get) => {
  const snap = (): Snapshot => ({ cards: get().cards, activeId: get().activeId });

  const applyTo = (
    cards: Card[],
    activeId: string,
    fn: (cards: Draft<Card[]>, card: Draft<Card>) => void,
    semantic: boolean,
  ) => {
    let demoted = false;
    const next = produce(cards, (draft) => {
      const card = draft.find((c) => c.id === activeId);
      if (!card) return;
      fn(draft, card);
      if (semantic) {
        card.updatedAt = Date.now();
        card.version += 1;
        if (card.status === 'ready') {
          card.status = 'draft';
          demoted = true;
        }
      }
    });
    return { next, demoted };
  };

  return {
    ...initial,
    selection: [],
    tool: 'select',
    preset: 'rush',
    layers: { O: { visible: true, locked: false }, D: { visible: true, locked: false } },
    past: [],
    future: [],
    toasts: [],
    savedAt: Date.now(),
    zoom: 1,

    commit: (fn, opts) => {
      const { cards, activeId } = get();
      const { next, demoted } = applyTo(cards, activeId, fn, opts?.semantic ?? true);
      if (next === cards) return;
      set((s) => ({ cards: next, past: [...s.past, snap()].slice(-HISTORY_LIMIT), future: [] }));
      if (demoted) get().toast('Edited a Ready card — it’s back to Draft for review.', 'warn');
    },

    begin: () => {
      gestureDirty = false;
      set((s) => ({ past: [...s.past, snap()].slice(-HISTORY_LIMIT), future: [] }));
    },
    live: (fn) => {
      const { cards, activeId } = get();
      const { next } = applyTo(cards, activeId, fn, false);
      if (next !== cards) {
        gestureDirty = true;
        set({ cards: next });
      }
    },
    end: () => {
      if (!gestureDirty) {
        set((s) => ({ past: s.past.slice(0, -1) }));
        return;
      }
      // Count the whole gesture as one semantic edit.
      const { next, demoted } = applyTo(get().cards, get().activeId, () => {}, true);
      set({ cards: next });
      if (demoted) get().toast('Edited a Ready card — it’s back to Draft for review.', 'warn');
    },

    undo: () => {
      const { past } = get();
      if (!past.length) return;
      const prev = past[past.length - 1];
      set((s) => ({ ...prev, past: s.past.slice(0, -1), future: [snap(), ...s.future], selection: [] }));
    },
    redo: () => {
      const { future } = get();
      if (!future.length) return;
      const nxt = future[0];
      set((s) => ({ ...nxt, future: s.future.slice(1), past: [...s.past, snap()], selection: [] }));
    },

    setActive: (cid) => set({ activeId: cid, selection: [] }),
    select: (ids) => set({ selection: ids }),
    setTool: (tool) => set({ tool, selection: tool === 'path' ? get().selection : [] }),
    setPreset: (preset) => set({ preset, tool: 'path' }),
    setTheme: (theme) => set((s) => ({ workspace: { ...s.workspace, theme } })),
    setRuleset: (ruleset) => set((s) => ({ workspace: { ...s.workspace, ruleset } })),
    setPacketName: (packetName) => set((s) => ({ workspace: { ...s.workspace, packetName } })),
    toggleLayer: (side, key) =>
      set((s) => ({ layers: { ...s.layers, [side]: { ...s.layers[side], [key]: !s.layers[side][key] } } })),
    setZoom: (zoom) => set({ zoom: Math.min(2.5, Math.max(0.4, zoom)) }),

    addCard: (afterId, card) => {
      const { cards } = get();
      const idx = afterId ? cards.findIndex((c) => c.id === afterId) : cards.length - 1;
      const nums = cards.map((c) => parseInt(c.playNo, 10)).filter((n) => !Number.isNaN(n));
      const fresh = card ?? blankCard(String((nums.length ? Math.max(...nums) : 0) + 1));
      const next = [...cards.slice(0, idx + 1), fresh, ...cards.slice(idx + 1)];
      set((s) => ({ cards: next, activeId: fresh.id, selection: [], past: [...s.past, snap()], future: [] }));
    },
    duplicateCard: (cardId) => {
      const src = get().cards.find((c) => c.id === cardId);
      if (!src) return;
      // New ids for every object; paths and notes keep pointing at the right copies.
      const map = new Map<string, string>();
      const players = src.players.map((p) => {
        const nid = id();
        map.set(p.id, nid);
        return { ...p, id: nid };
      });
      const copy: Card = {
        ...structuredClone(src),
        id: id(),
        status: 'draft',
        version: 1,
        updatedAt: Date.now(),
        players,
        paths: src.paths.map((p) => ({ ...structuredClone(p), id: id(), ownerId: p.ownerId ? map.get(p.ownerId) ?? null : null })),
        notes: src.notes.map((n) => ({ ...n, id: id(), anchorId: n.anchorId ? map.get(n.anchorId) ?? null : null })),
      };
      get().addCard(cardId, copy);
      get().toast(`Duplicated card ${src.playNo || ''}`.trim(), 'good');
    },
    deleteCard: (cardId) => {
      const { cards, activeId } = get();
      if (cards.length <= 1) {
        get().toast('A packet needs at least one card.', 'warn');
        return;
      }
      const idx = cards.findIndex((c) => c.id === cardId);
      const next = cards.filter((c) => c.id !== cardId);
      const nextActive = activeId === cardId ? next[Math.min(idx, next.length - 1)].id : activeId;
      set((s) => ({ cards: next, activeId: nextActive, selection: [], past: [...s.past, snap()], future: [] }));
      get().toast('Card deleted — press ⌘Z to bring it back.', 'info');
    },
    moveCard: (from, to) => {
      const cards = [...get().cards];
      const [c] = cards.splice(from, 1);
      cards.splice(to, 0, c);
      set((s) => ({ cards, past: [...s.past, snap()], future: [] }));
    },
    insertCards: (newCards) => {
      if (!newCards.length) return;
      set((s) => ({
        cards: [...s.cards, ...newCards],
        activeId: newCards[0].id,
        selection: [],
        past: [...s.past, snap()],
        future: [],
      }));
    },

    toast: (text, tone = 'info') => {
      const t = { id: id(), text, tone };
      set((s) => ({ toasts: [...s.toasts.slice(-3), t] }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), 3600);
    },
  };
});

// Autosave (debounced) to this browser.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, prev) => {
  if (s.cards === prev.cards && s.workspace === prev.workspace && s.activeId === prev.activeId) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { workspace, cards, activeId } = useStore.getState();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ workspace, cards, activeId }));
      useStore.setState({ savedAt: Date.now() });
    } catch {
      /* storage unavailable (private mode, sandboxed frame) — keep working in memory */
    }
  }, 400);
});

export const activeCard = (s: State) => s.cards.find((c) => c.id === s.activeId) ?? s.cards[0];

export function inkFor(purpose: PathPurpose): Ink {
  return PATH_PRESETS.find((p) => p.key === purpose)?.style.ink ?? 'ink';
}
