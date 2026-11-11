import type { Ink, ThemeId } from '../model/types';

export interface Theme {
  id: ThemeId;
  name: string;
  paper: string;
  frame: string; // field border
  hash: string; // hash marks
  ink: Record<Ink, string>;
  offense: string; // linemen and offensive symbols
  defense: string; // defensive letters
  header: string;
  headerMuted: string;
  printable: boolean;
}

const COLOR_INKS: Record<Ink, string> = {
  ink: '#16181d',
  red: '#d93a4a',
  blue: '#2563d9',
  green: '#178a4c',
  orange: '#e0700f',
  purple: '#7a4fd1',
};

export const THEMES: Record<ThemeId, Theme> = {
  print: {
    id: 'print',
    name: 'Print',
    paper: '#ffffff',
    frame: '#16181d',
    hash: '#16181d',
    ink: COLOR_INKS,
    offense: '#16181d',
    defense: '#16181d',
    header: '#16181d',
    headerMuted: '#16181d',
    printable: true,
  },
  mono: {
    id: 'mono',
    name: 'Grayscale',
    paper: '#ffffff',
    frame: '#000000',
    hash: '#000000',
    ink: { ink: '#000', red: '#000', blue: '#444', green: '#222', orange: '#333', purple: '#555' },
    offense: '#000000',
    defense: '#000000',
    header: '#000000',
    headerMuted: '#000000',
    printable: true,
  },
  chalk: {
    id: 'chalk',
    name: 'Chalkboard',
    paper: '#1f3a2e',
    frame: '#e9efe6',
    hash: '#c9d6c7',
    ink: {
      ink: '#f4f6ef',
      red: '#ff8a8a',
      blue: '#8cc8ff',
      green: '#b6f09c',
      orange: '#ffc078',
      purple: '#d2b4ff',
    },
    offense: '#f4f6ef',
    defense: '#ffe680',
    header: '#f4f6ef',
    headerMuted: '#b8c9b5',
    printable: false,
  },
  night: {
    id: 'night',
    name: 'Night',
    paper: '#12151c',
    frame: '#3a4252',
    hash: '#4b5468',
    ink: {
      ink: '#e8ebf2',
      red: '#ff5d6c',
      blue: '#5b9bff',
      green: '#3ddc84',
      orange: '#ffab40',
      purple: '#b48cff',
    },
    offense: '#e8ebf2',
    defense: '#ffd54a',
    header: '#e8ebf2',
    headerMuted: '#8a93a6',
    printable: false,
  },
};

export const INK_ORDER: Ink[] = ['ink', 'red', 'blue', 'green', 'orange', 'purple'];
