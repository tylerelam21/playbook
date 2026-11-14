import { useSyncExternalStore } from 'react';

// Which layout fits this screen:
//   desktop - mouse/trackpad and room for three panels
//   tablet  - touch, or a narrower window: the card fills the screen and
//             panels slide in on demand
//   phone   - small screens: review, talk, and edit details
export type DeviceKind = 'desktop' | 'tablet' | 'phone';

export interface Device {
  kind: DeviceKind;
  touch: boolean; // primary pointer is a finger
}

const queries = typeof window !== 'undefined'
  ? { coarse: window.matchMedia('(pointer: coarse)'), phone: window.matchMedia('(max-width: 640px)'), narrow: window.matchMedia('(max-width: 1100px)') }
  : null;

let cached: Device = compute();

function compute(): Device {
  if (!queries) return { kind: 'desktop', touch: false };
  const touch = queries.coarse.matches;
  const kind: DeviceKind = queries.phone.matches ? 'phone' : touch || queries.narrow.matches ? 'tablet' : 'desktop';
  return { kind, touch };
}

function subscribe(cb: () => void) {
  if (!queries) return () => {};
  const on = () => {
    const next = compute();
    if (next.kind !== cached.kind || next.touch !== cached.touch) {
      cached = next;
      cb();
    }
  };
  Object.values(queries).forEach((q) => q.addEventListener('change', on));
  return () => Object.values(queries).forEach((q) => q.removeEventListener('change', on));
}

export function useDevice(): Device {
  return useSyncExternalStore(subscribe, () => cached, () => cached);
}

export function currentDevice(): Device {
  return cached;
}
