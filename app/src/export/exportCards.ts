import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Card, Workspace } from '../model/types';
import { CardSvg, symbolRadius } from '../render/CardSvg';
import { THEMES, type Theme } from '../render/themes';
import { CARD_H, CARD_W, TEACHING_PANEL, layoutFor, makeFrame, type Rect } from '../model/field';
import { COLS, COL_GAP, CONT_BOX, PAD, colWidth, layoutTeaching, type TeachingPage } from '../render/teachingLayout';
import { buildPath, teeBar } from '../render/pathGeom';
import boldUrl from '@expo-google-fonts/barlow-condensed/700Bold/BarlowCondensed_700Bold.ttf?url';
import semiUrl from '@expo-google-fonts/barlow-condensed/600SemiBold/BarlowCondensed_600SemiBold.ttf?url';

export interface ExportOptions {
  theme: 'print' | 'mono';
  includeDrafts: boolean;
}

export function exportPlan(cards: Card[], includeDrafts: boolean) {
  const included = cards.filter((c) => includeDrafts || c.status === 'ready');
  const omitted = cards.filter((c) => !included.includes(c));
  return { included, omitted };
}

// Inside a claude.ai artifact the page can't download directly; it asks the
// host to save the file. Everywhere else, a normal browser download.
type ClaudeHost = { use: (n: string) => Promise<{ save: (r: { filename: string; data: Blob }) => Promise<unknown> } | null> };
async function saveFile(data: Blob, filename: string) {
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  if (host?.use) {
    const downloads = await host.use('downloads');
    if (downloads) {
      await downloads.save({ filename, data });
      return;
    }
  }
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const footerFor = (c: Card, ws: Workspace) => `${ws.packetName} · card ${c.id.slice(0, 6)} v${c.version}`;
const isDraft = (c: Card) => c.status !== 'ready';
const fileBase = (ws: Workspace) => ws.packetName.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'packet';

// ---- PDF (vector, one card per page) ----------------------------------------

async function fontB64(url: string) {
  const buf = await (await fetch(url)).arrayBuffer();
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function exportPdf(cards: Card[], ws: Workspace, opts: ExportOptions) {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  doc.addFileToVFS('BarlowCondensed-SemiBold.ttf', await fontB64(semiUrl));
  doc.addFont('BarlowCondensed-SemiBold.ttf', 'Barlow Condensed', 'normal');
  doc.addFileToVFS('BarlowCondensed-Bold.ttf', await fontB64(boldUrl));
  doc.addFont('BarlowCondensed-Bold.ttf', 'Barlow Condensed', 'bold');

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;width:1100px;height:850px;';
  document.body.appendChild(host);
  try {
    const theme = THEMES[opts.theme];
    let first = true;
    for (const c of cards) {
      // Install cards print continuation pages instead of shrinking notes.
      const pages = layoutTeaching(c).totalPages;
      for (let page = 0; page < pages; page++) {
        if (!first) doc.addPage('letter', 'landscape');
        first = false;
        host.innerHTML = renderToStaticMarkup(
          createElement(CardSvg, {
            card: c,
            theme,
            ruleset: ws.ruleset,
            page,
            watermark: isDraft(c) ? 'DRAFT' : undefined,
            footer: footerFor(c, ws),
          }),
        );
        const svg = host.querySelector('svg')!;
        await svg2pdf(svg, doc, { x: 0, y: 0, width: 792, height: 612 });
      }
    }
  } finally {
    host.remove();
  }
  doc.setProperties({ title: ws.packetName, creator: 'Playbook' });
  await saveFile(doc.output('blob'), `${fileBase(ws)}.pdf`);
}

// ---- PowerPoint (native, editable shapes) ----------------------------------

const IN = (u: number) => u / 100; // card units are 1/100 inch
const hex = (c: string) => {
  const h = c.replace('#', '');
  return h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
};
const PPT_FONT = 'Arial Narrow';

export async function exportPptx(cards: Card[], ws: Workspace, opts: ExportOptions) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'CARD', width: CARD_W / 100, height: CARD_H / 100 });
  pptx.layout = 'CARD';
  pptx.title = ws.packetName;
  const theme = THEMES[opts.theme];
  for (const c of cards) addSlide(pptx, c, ws, theme);
  const blob = (await pptx.write({ outputType: 'blob' })) as Blob;
  await saveFile(blob, `${fileBase(ws)}.pptx`);
}

type Pptx = InstanceType<typeof import('pptxgenjs').default>;
type Slide = ReturnType<Pptx['addSlide']>;

function addSlide(pptx: Pptx, c: Card, ws: Workspace, theme: Theme) {
  const s: Slide = pptx.addSlide();
  s.background = { color: hex(theme.paper) };
  const layout = layoutFor(c);
  const f = makeFrame(c.hash, ws.ruleset, layout);
  const FIELD = layout.field;
  const byId = new Map(c.players.map((p) => [p.id, p]));

  // Header
  const header = [
    ['PLAY #', c.playNo, 50, 110, 'left'],
    ['PERIOD', c.period, 175, 120, 'left'],
    ['PLAY', c.play, 315, 430, 'left'],
    ['DEFENSE', c.defense, 765, 230, 'left'],
    ['HASH', c.hash, 990, 60, 'right'],
  ] as const;
  for (const [label, value, x, w, align] of header) {
    s.addText(label, {
      x: IN(x), y: IN(48), w: IN(w), h: IN(30), fontFace: PPT_FONT, fontSize: 13, bold: true, underline: { style: 'sng' },
      color: hex(theme.header), align, margin: 0, valign: 'bottom',
    });
    s.addText(value || ' ', {
      x: IN(x), y: IN(86), w: IN(w), h: IN(40), fontFace: PPT_FONT, fontSize: 19, color: hex(theme.header),
      align, margin: 0, valign: 'bottom', fit: 'shrink',
    });
  }

  // Field (border and hash marks)
  s.addShape('rect', { x: IN(FIELD.x), y: IN(FIELD.y), w: IN(FIELD.w), h: IN(FIELD.h), line: { color: hex(theme.frame), width: 2.5 }, fill: { type: 'none' } as never });
  for (let yd = layout.top + 1; yd < layout.bottom; yd++) {
    for (const side of [-1, 1] as const) {
      const cx = f.hashX(side);
      s.addShape('line', { x: IN(cx - 15), y: IN(f.toY(yd)), w: IN(30), h: 0, line: { color: hex(theme.hash), width: 1.6 } });
    }
  }

  // Paths first so players sit on top.
  for (const pa of c.paths) {
    const owner = pa.ownerId ? byId.get(pa.ownerId) : undefined;
    const origin = owner ? { x: owner.x, y: owner.y } : pa.points[0];
    const rest = owner ? pa.points : pa.points.slice(1);
    if (!origin) continue;
    const geom = buildPath([origin, ...rest].map(f.to), {
      curved: pa.curved,
      zigzag: pa.line === 'zigzag',
      trimStart: owner ? symbolRadius(owner) + 3 : 0,
    });
    if (!geom) continue;
    const all = geom.cmds.flatMap((k) => (k.t === 'C' ? [k.c1, k.c2, k.p] : [k.p]));
    const minX = Math.min(...all.map((p) => p.x));
    const minY = Math.min(...all.map((p) => p.y));
    const maxX = Math.max(...all.map((p) => p.x));
    const maxY = Math.max(...all.map((p) => p.y));
    const rel = (p: { x: number; y: number }) => ({ x: IN(p.x - minX), y: IN(p.y - minY) });
    const points = geom.cmds.map((k) =>
      k.t === 'C'
        ? { ...rel(k.p), curve: { type: 'cubic' as const, x1: rel(k.c1).x, y1: rel(k.c1).y, x2: rel(k.c2).x, y2: rel(k.c2).y } }
        : { ...rel(k.p), moveTo: k.t === 'M' },
    );
    const color = hex(theme.ink[pa.ink]);
    s.addShape('custGeom' as never, {
      x: IN(minX), y: IN(minY), w: Math.max(IN(maxX - minX), 0.01), h: Math.max(IN(maxY - minY), 0.01),
      points,
      fill: { type: 'none' } as never,
      line: {
        color, width: 2.4,
        dashType: pa.line === 'dashed' ? 'dash' : 'solid',
        endArrowType: pa.end === 'arrow' ? 'triangle' : pa.end === 'dot' ? 'oval' : undefined,
      },
      objectName: `path ${pa.purpose}${owner?.label ? ` · ${owner.label}` : ''}`,
    });
    if (pa.end === 'tee') {
      const [a, b] = teeBar(geom.end, geom.angle);
      s.addShape('line', {
        x: IN(Math.min(a.x, b.x)), y: IN(Math.min(a.y, b.y)), w: IN(Math.abs(a.x - b.x)), h: IN(Math.abs(a.y - b.y)),
        flipV: (a.x - b.x) * (a.y - b.y) < 0,
        line: { color, width: 2.4 },
      });
    }
  }

  // Players: one object each so a coach can drag them in PowerPoint.
  for (const p of c.players) {
    const cx = f.toX(p.x);
    const cy = f.toY(p.y);
    const color = hex(p.ink ? theme.ink[p.ink] : p.side === 'O' ? theme.offense : theme.defense);
    const name = `${p.side === 'O' ? 'offense' : 'defense'} ${p.label || p.shape}`;
    if (p.shape === 'letter') {
      s.addText(p.label || '•', {
        x: IN(cx - 25), y: IN(cy - 22), w: IN(50), h: IN(44), align: 'center', valign: 'middle', margin: 0,
        fontFace: PPT_FONT, fontSize: 24, bold: true, color, objectName: name,
      });
      continue;
    }
    const geo = {
      lineman: { shape: 'ellipse', w: 38, h: 29, filled: true },
      center: { shape: 'rect', w: 36, h: 29, filled: true },
      circle: { shape: 'ellipse', w: 28, h: 28, filled: false },
      square: { shape: 'rect', w: 24, h: 24, filled: false },
      triangle: { shape: 'triangle', w: 26, h: 24, filled: false },
    }[p.shape];
    const inside = p.shape === 'circle' && p.label.length > 0 && p.label.length <= 2;
    s.addText(inside ? p.label : '', {
      shape: geo.shape as never,
      x: IN(cx - geo.w / 2), y: IN(cy - geo.h / 2), w: IN(geo.w), h: IN(geo.h),
      fill: geo.filled ? { color } : { color: hex(theme.paper) },
      line: { color, width: 2.2 },
      fontFace: PPT_FONT, fontSize: 10, bold: true, color, align: 'center', valign: 'middle', margin: 0,
      objectName: name,
    });
    if (p.label && !inside && p.shape !== 'lineman' && p.shape !== 'center') {
      s.addText(p.label, { x: IN(cx + 14), y: IN(cy - 32), w: IN(60), h: IN(24), fontFace: PPT_FONT, fontSize: 12, bold: true, color, margin: 0 });
    }
  }

  // Notes
  for (const n of c.notes) {
    const size = { sm: 12, md: 16, lg: 22 }[n.size];
    const lines = n.text.split('\n');
    const w = Math.max(60, Math.max(...lines.map((l) => l.length)) * size * 0.75);
    const hgt = lines.length * size * 1.5 + 6;
    s.addText(n.text, {
      x: IN(f.toX(n.x) - w / 2), y: IN(f.toY(n.y) - size * 1.2), w: IN(w), h: IN(hgt), align: 'center', valign: 'top',
      margin: 0, fontFace: PPT_FONT, fontSize: size, bold: true, color: hex(theme.ink[n.ink]), objectName: 'note',
    });
  }

  if (isDraft(c)) {
    s.addText('DRAFT', { x: IN(CARD_W - 340), y: IN(FIELD.y + 14), w: IN(280), h: IN(44), align: 'right', fontFace: PPT_FONT, fontSize: 24, bold: true, color: 'D93A4A', transparency: 45, charSpacing: 4 });
  }
  s.addText(footerFor(c, ws), { x: IN(CARD_W - 540), y: IN(CARD_H - 30), w: IN(500), h: IN(20), align: 'right', fontFace: PPT_FONT, fontSize: 7, color: '888888', margin: 0 });

  // Install cards: teaching notes as editable text, continuing on extra slides.
  const t = layoutTeaching(c);
  if (c.mode === 'install') {
    addTeachingBox(s, TEACHING_PANEL, t.pages[0], theme, t.totalPages > 1 ? 'Continued on next slide →' : null);
    for (let i = 1; i < t.totalPages; i++) {
      const cs: Slide = pptx.addSlide();
      cs.background = { color: hex(theme.paper) };
      cs.addText(`PLAY #${c.playNo || '—'} · CONTINUED`, { x: IN(50), y: IN(48), w: IN(600), h: IN(30), fontFace: PPT_FONT, fontSize: 13, bold: true, color: hex(theme.header), margin: 0 });
      cs.addText(`PAGE ${i + 1} OF ${t.totalPages}`, { x: IN(750), y: IN(48), w: IN(300), h: IN(30), align: 'right', fontFace: PPT_FONT, fontSize: 13, bold: true, color: hex(theme.header), margin: 0 });
      cs.addText(c.play || ' ', { x: IN(50), y: IN(86), w: IN(700), h: IN(40), fontFace: PPT_FONT, fontSize: 19, color: hex(theme.header), margin: 0, fit: 'shrink' });
      cs.addText(c.defense || ' ', { x: IN(760), y: IN(86), w: IN(290), h: IN(40), align: 'right', fontFace: PPT_FONT, fontSize: 19, color: hex(theme.header), margin: 0 });
      addTeachingBox(cs, CONT_BOX, t.pages[i], theme, i + 1 < t.totalPages ? 'Continued on next slide →' : null);
      cs.addText(`${footerFor(c, ws)} · page ${i + 1}/${t.totalPages}`, { x: IN(CARD_W - 540), y: IN(CARD_H - 30), w: IN(500), h: IN(20), align: 'right', fontFace: PPT_FONT, fontSize: 7, color: '888888', margin: 0 });
    }
  }
}

// One text box per column, so a coach can edit the notes as normal text.
function addTeachingBox(s: Slide, box: Rect, page: TeachingPage | undefined, theme: Theme, more: string | null) {
  s.addShape('rect', { x: IN(box.x), y: IN(box.y), w: IN(box.w), h: IN(box.h), line: { color: hex(theme.frame), width: 1.6 }, fill: { type: 'none' } as never });
  const colW = colWidth(box.w);
  const ink = hex(theme.header);
  page?.columns.slice(0, COLS).forEach((col, ci) => {
    type Run = { text: string; options: Record<string, unknown> };
    const paras: Run[][] = [];
    for (const { line } of col) {
      if (line.kind === 'heading') paras.push([{ text: line.text, options: { bold: true, fontSize: 9.5, color: ink, charSpacing: 1 } }]);
      else if (line.kind === 'assign') {
        if (line.label !== null) {
          const lc = line.orphan ? 'D93A4A' : hex(line.ink ? theme.ink[line.ink] : line.side === 'D' ? theme.defense : theme.header);
          paras.push([
            { text: `${line.label}  `, options: { bold: true, color: lc } },
            { text: line.text, options: { color: ink } },
          ]);
        } else paras[paras.length - 1]?.push({ text: ` ${line.text}`, options: { color: ink } });
      } else if (line.first) paras.push([{ text: line.text, options: { color: ink, bullet: true } }]);
      else paras[paras.length - 1]?.push({ text: ` ${line.text}`, options: { color: ink } });
    }
    const runs = paras.flatMap((p) => p.map((r, i) => (i === p.length - 1 ? { ...r, options: { ...r.options, breakLine: true } } : r)));
    if (!runs.length) return;
    s.addText(runs as never, {
      x: IN(box.x + PAD + ci * (colW + COL_GAP)), y: IN(box.y + PAD), w: IN(colW), h: IN(box.h - 2 * PAD),
      fontFace: PPT_FONT, fontSize: 10.5, valign: 'top', margin: 0, paraSpaceAfter: 2, objectName: 'teaching notes',
    });
  });
  if (more) s.addText(more, { x: IN(box.x + box.w - 300), y: IN(box.y + box.h - 18), w: IN(290), h: IN(16), align: 'right', fontFace: PPT_FONT, fontSize: 8.5, bold: true, color: hex(theme.header), margin: 0 });
}

