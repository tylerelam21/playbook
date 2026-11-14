import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import type { Card, Ink, Look, PathPurpose, Side, ThemeId, Workspace, Ruleset, PlayPath } from './model/types';
import { applyVersionTo, latest, versionFromCard } from './model/looks';
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

export type Modal =
  | { type: 'import' }
  | { type: 'export' }
  | { type: 'saveLook'; side: Side; name: string }
  | { type: 'applyLook'; lookId: string; cardIds: string[]; title: string; alias?: string }
  | null;

export interface Toast {
  id: string;
  text: string;
  tone: 'info' | 'warn' | 'good';
}

interface Snapshot {
  cards: Card[];
  looks: Look[];
  activeId: string;
}

interface Layer {
  visible: boolean;
  locked: boolean;
}

export interface State {
  workspace: Workspace;
  cards: Card[];
  looks: Look[];
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
  modal: Modal;
  // A proposed (not yet applied) version of the active card, shown on the canvas.
  ghost: Card | null;
  setGhost: (c: Card | null) => void;
  cmdHeight: number; // space the command panel takes at the bottom of the canvas
  setCmdHeight: (h: number) => void;
  sideTab: 'cards' | 'looks';
  setModal: (m: Modal) => void;
  setSideTab: (t: 'cards' | 'looks') => void;

  // Record an undo step, then change the cards. Semantic edits on a Ready card
  // return it to Draft.
  commit: (fn: (cards: Draft<Card[]>, card: Draft<Card>) => void, opts?: { semantic?: boolean }) => void;
  // For continuous gestures: call begin() once, then live() on every move.
  // One undo step that edits several cards (dictated/typed commands).
  commitCards: (cardIds: string[], fn: (card: Draft<Card>) => void) => void;
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

  // Saved team looks
  saveLook: (side: Side, name: string, aliases?: string[]) => Look | null;
  saveLookVersion: (lookId: string) => void; // from the active card
  applyLook: (lookId: string, cardIds: string[], v?: number) => void;
  updateLook: (lookId: string, patch: { name?: string; aliases?: string[] }) => void;
  deleteLook: (lookId: string) => void;
  restoreLookVersion: (lookId: string, v: number) => void;

  toast: (text: string, tone?: Toast['tone']) => void;
}

const STORAGE_KEY = 'playbook.v1';

function load(): Pick<State, 'workspace' | 'cards' | 'looks' | 'activeId'> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.cards) && data.cards.length) return { looks: [], ...data };
    }
  } catch {
    /* fall through to a fresh sample packet */
  }
  const cards = seedPacket();
  return {
    workspace: { packetName: 'Wednesday scout · sample', ruleset: 'college', orientation: 'defense-view', theme: 'print' },
    cards,
    looks: [],
    activeId: cards[0].id,
  };
}

const initial = load();
const HISTORY_LIMIT = 200;
let gestureDirty = false;

export const useStore = create<State>((set, get) => {
  const snap = (): Snapshot => ({ cards: get().cards, looks: get().looks, activeId: get().activeId });

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
    modal: null,
    ghost: null,
    setGhost: (ghost) => set({ ghost }),
    cmdHeight: 0,
    setCmdHeight: (cmdHeight) => set({ cmdHeight }),
    sideTab: 'cards',
    setModal: (modal) => set({ modal }),
    setSideTab: (sideTab) => set({ sideTab }),

    commit: (fn, opts) => {
      const { cards, activeId } = get();
      const { next, demoted } = applyTo(cards, activeId, fn, opts?.semantic ?? true);
      if (next === cards) return;
      set((s) => ({ cards: next, past: [...s.past, snap()].slice(-HISTORY_LIMIT), future: [] }));
      if (demoted) get().toast('Edited a Ready card — it’s back to Draft for review.', 'warn');
    },

    commitCards: (cardIds, fn) => {
      const ids = new Set(cardIds);
      let demoted = 0;
      const prev = get().cards;
      const next = produce(prev, (draft) => {
        for (const c of draft) {
          if (!ids.has(c.id)) continue;
          const before = JSON.stringify(c);
          fn(c);
          if (JSON.stringify(c) === before) continue;
          c.updatedAt = Date.now();
          c.version += 1;
          if (c.status === 'ready') {
            c.status = 'draft';
            demoted++;
          }
        }
      });
      if (next === prev) return;
      set((s) => ({ cards: next, past: [...s.past, snap()].slice(-HISTORY_LIMIT), future: [] }));
      if (demoted) get().toast(`${demoted} Ready card${demoted > 1 ? 's' : ''} changed — back to Draft for review.`, 'warn');
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
        teaching: src.teaching && {
          cues: src.teaching.cues,
          assignments: src.teaching.assignments.map((a) => ({ ...a, id: id(), playerId: a.playerId ? map.get(a.playerId) ?? null : null })),
        },
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

    saveLook: (side, name, aliases = []) => {
      const { cards, activeId, looks } = get();
      const card = cards.find((c) => c.id === activeId);
      const clean = name.trim();
      if (!card || !clean) return null;
      if (!card.players.some((p) => p.side === side)) {
        get().toast(`This card has no ${side === 'O' ? 'offensive players' : 'defenders'} to save.`, 'warn');
        return null;
      }
      const version = versionFromCard(card, side, 1);
      const look: Look = { id: id(), side, name: clean, aliases, versions: [version], createdAt: Date.now() };
      // Link this card to the new look (not a semantic change: the drawing is the same).
      const nextCards = produce(cards, (draft) => {
        const c = draft.find((x) => x.id === activeId)!;
        applyVersionTo(c, look, version);
      });
      set((s) => ({ looks: [...looks, look], cards: nextCards, past: [...s.past, snap()].slice(-HISTORY_LIMIT), future: [] }));
      return look;
    },

    saveLookVersion: (lookId) => {
      const { cards, activeId, looks } = get();
      const card = cards.find((c) => c.id === activeId);
      const look = looks.find((l) => l.id === lookId);
      if (!card || !look) return;
      const version = versionFromCard(card, look.side, latest(look).v + 1);
      const updated = { ...look, versions: [...look.versions, version] };
      const nextCards = produce(cards, (draft) => {
        const c = draft.find((x) => x.id === activeId)!;
        applyVersionTo(c, updated, version);
      });
      set((s) => ({
        looks: looks.map((l) => (l.id === lookId ? updated : l)),
        cards: nextCards,
        past: [...s.past, snap()].slice(-HISTORY_LIMIT),
        future: [],
      }));
    },

    applyLook: (lookId, cardIds, v) => {
      const look = get().looks.find((l) => l.id === lookId);
      if (!look || !cardIds.length) return;
      const version = (v ? look.versions.find((x) => x.v === v) : undefined) ?? latest(look);
      const ids = new Set(cardIds);
      let demoted = 0;
      const nextCards = produce(get().cards, (draft) => {
        for (const c of draft) {
          if (!ids.has(c.id)) continue;
          applyVersionTo(c, look, version);
          c.version += 1;
          c.updatedAt = Date.now();
          if (c.status === 'ready') {
            c.status = 'draft';
            demoted++;
          }
        }
      });
      set((s) => ({ cards: nextCards, past: [...s.past, snap()].slice(-HISTORY_LIMIT), future: [] }));
      if (demoted) get().toast(`${demoted} Ready card${demoted > 1 ? 's' : ''} changed — back to Draft for review.`, 'warn');
    },

    updateLook: (lookId, patch) =>
      set((s) => ({
        looks: s.looks.map((l) => (l.id === lookId ? { ...l, ...patch } : l)),
        past: [...s.past, snap()].slice(-HISTORY_LIMIT),
        future: [],
      })),

    deleteLook: (lookId) => {
      set((s) => ({ looks: s.looks.filter((l) => l.id !== lookId), past: [...s.past, snap()].slice(-HISTORY_LIMIT), future: [] }));
      get().toast('Look deleted. Cards that used it keep their drawing. ⌘Z to undo.', 'info');
    },

    restoreLookVersion: (lookId, v) => {
      const look = get().looks.find((l) => l.id === lookId);
      const old = look?.versions.find((x) => x.v === v);
      if (!look || !old) return;
      const restored = { ...structuredClone(old), v: latest(look).v + 1, savedAt: Date.now() };
      set((s) => ({
        looks: s.looks.map((l) => (l.id === lookId ? { ...l, versions: [...l.versions, restored] } : l)),
        past: [...s.past, snap()].slice(-HISTORY_LIMIT),
        future: [],
      }));
      get().toast(`Restored v${v} as v${restored.v}. Cards aren’t changed until you update them.`, 'good');
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
  if (s.cards === prev.cards && s.looks === prev.looks && s.workspace === prev.workspace && s.activeId === prev.activeId) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { workspace, cards, looks, activeId } = useStore.getState();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ workspace, cards, looks, activeId }));
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
