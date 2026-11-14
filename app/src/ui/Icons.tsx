const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const I = {
  select: () => (
    <svg {...base}>
      <path d="M5 3l14 8-6 2-2 6z" />
    </svg>
  ),
  path: () => (
    <svg {...base}>
      <path d="M4 19c4-10 10-2 14-12" />
      <path d="M14 6h4v4" />
    </svg>
  ),
  offense: () => (
    <svg {...base}>
      <circle cx="12" cy="12" r="6" />
    </svg>
  ),
  defense: () => (
    <svg {...base} strokeWidth={2.4}>
      <path d="M7 7l10 10M17 7L7 17" />
    </svg>
  ),
  note: () => (
    <svg {...base}>
      <path d="M5 6h14M12 6v13M9 19h6" />
    </svg>
  ),
  undo: () => (
    <svg {...base}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h11a5 5 0 010 10h-3" />
    </svg>
  ),
  redo: () => (
    <svg {...base}>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9a5 5 0 000 10h3" />
    </svg>
  ),
  eye: () => (
    <svg {...base}>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  eyeOff: () => (
    <svg {...base}>
      <path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6 0 10 7 10 7a17 17 0 01-3.2 3.9M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 004.4-1" />
    </svg>
  ),
  lock: () => (
    <svg {...base}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </svg>
  ),
  unlock: () => (
    <svg {...base}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 017.5-2" />
    </svg>
  ),
  plus: () => (
    <svg {...base}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  copy: () => (
    <svg {...base}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
    </svg>
  ),
  trash: () => (
    <svg {...base}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  ),
  flip: () => (
    <svg {...base}>
      <path d="M12 3v18" strokeDasharray="2 3" />
      <path d="M8 7L3 12l5 5V7zM16 7l5 5-5 5V7z" />
    </svg>
  ),
  download: () => (
    <svg {...base}>
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  ),
  paste: () => (
    <svg {...base}>
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" />
    </svg>
  ),
  check: () => (
    <svg {...base} strokeWidth={3}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  ),
  minus: () => (
    <svg {...base}>
      <path d="M5 12h14" />
    </svg>
  ),
  gear: () => (
    <svg {...base}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  ),
  cards: () => (
    <svg {...base}>
      <rect x="3" y="4" width="7" height="7" rx="1.5" />
      <rect x="14" y="4" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  sliders: () => (
    <svg {...base}>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  ),
  more: () => (
    <svg {...base}>
      <circle cx="5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="19" cy="12" r="1.3" fill="currentColor" />
    </svg>
  ),
  grip: () => (
    <svg {...base}>
      <circle cx="9" cy="6" r="1.2" fill="currentColor" />
      <circle cx="15" cy="6" r="1.2" fill="currentColor" />
      <circle cx="9" cy="12" r="1.2" fill="currentColor" />
      <circle cx="15" cy="12" r="1.2" fill="currentColor" />
      <circle cx="9" cy="18" r="1.2" fill="currentColor" />
      <circle cx="15" cy="18" r="1.2" fill="currentColor" />
    </svg>
  ),
  view: () => (
    <svg {...base}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
    </svg>
  ),
  help: () => (
    <svg {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 015 .5c0 2-2.5 2-2.5 4M12 17.5v.01" />
    </svg>
  ),
};

// Tiny line samples for the path presets.
export function PresetGlyph({ line, end, color }: { line: string; end: string; color: string }) {
  const d = line === 'zigzag' ? 'M3 16 L7 10 L11 16 L15 10 L19 14 L23 8' : 'M3 18 C 10 18, 14 8, 23 8';
  return (
    <svg width="34" height="22" viewBox="0 0 30 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round">
      <path d={d} strokeDasharray={line === 'dashed' ? '4 3' : undefined} />
      {end === 'arrow' && <path d="M23 8 l-6 -1.5 M23 8 l-3 5" />}
      {end === 'tee' && <path d="M21 4 L25 12" />}
      {end === 'dot' && <circle cx="23" cy="8" r="2.4" fill={color} />}
    </svg>
  );
}
