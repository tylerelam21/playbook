import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { DEFENSE_LOOKS, OFFENSE_LOOKS, id } from '../model/samples';
import type { Card, Hash } from '../model/types';
import { exportPdf, exportPptx, exportPlan } from '../export/exportCards';
import { clampToField } from '../model/field';
import { I } from './Icons';

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className={`modal${wide ? ' wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="mini" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---- Paste script ----------------------------------------------------------

type Col = 'playNo' | 'period' | 'play' | 'defense' | 'hash' | 'skip';
const COL_LABEL: Record<Col, string> = { playNo: 'Play #', period: 'Period', play: 'Play', defense: 'Defense', hash: 'Hash', skip: 'Ignore' };

function guessCol(h: string): Col | null {
  const x = h.toLowerCase().replace(/[^a-z#]/g, '');
  if (/^(play#|#|no|num|playno|playnumber|rep)$/.test(x)) return 'playNo';
  if (/^(period|per|pd)$/.test(x)) return 'period';
  if (/^(play|playcall|call|offense|off)$/.test(x)) return 'play';
  if (/^(defense|def|look|front|coverage)$/.test(x)) return 'defense';
  if (/^(hash|h)$/.test(x)) return 'hash';
  return null;
}

function normHash(v: string): Hash | null {
  const x = v.trim().toUpperCase();
  if (['L', 'LT', 'LEFT', 'LH'].includes(x)) return 'L';
  if (['R', 'RT', 'RIGHT', 'RH'].includes(x)) return 'R';
  if (['M', 'MID', 'MIDDLE', 'C', 'CENTER'].includes(x)) return 'M';
  return null;
}

function splitRow(line: string) {
  if (line.includes('\t')) return line.split('\t');
  // Simple CSV with quoted cells.
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { insertCards, toast, workspace } = useStore();
  const [text, setText] = useState('');
  const [offense, setOffense] = useState('o-ol');
  const [defense, setDefense] = useState('');

  const parsed = useMemo(() => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return null;
    const rows = lines.map(splitRow);
    const guesses = rows[0].map(guessCol);
    const hasHeader = guesses.filter(Boolean).length >= 2;
    const width = Math.max(...rows.map((r) => r.length));
    const defaultOrder: Col[] = ['playNo', 'period', 'play', 'defense', 'hash'];
    const cols: Col[] = Array.from({ length: width }, (_, i) => (hasHeader ? guesses[i] ?? 'skip' : defaultOrder[i] ?? 'skip'));
    return { rows: hasHeader ? rows.slice(1) : rows, cols, hasHeader };
  }, [text]);

  const [override, setOverride] = useState<Record<number, Col>>({});
  const cols = parsed?.cols.map((c, i) => override[i] ?? c) ?? [];

  const records = (parsed?.rows ?? []).map((r) => {
    const rec = { playNo: '', period: '', play: '', defense: '', hash: '' };
    cols.forEach((c, i) => {
      if (c !== 'skip') rec[c] = (r[i] ?? '').trim();
    });
    const hash = normHash(rec.hash);
    const issues: string[] = [];
    if (!rec.play) issues.push('no play call');
    if (rec.hash && !hash) issues.push(`hash “${rec.hash}” not recognized`);
    if (!rec.hash) issues.push('no hash');
    return { ...rec, hashNorm: hash, issues };
  });

  const create = () => {
    const off = OFFENSE_LOOKS.find((l) => l.key === offense);
    const def = DEFENSE_LOOKS.find((l) => l.key === defense);
    const cards: Card[] = records.map((r) => ({
      id: id(),
      playNo: r.playNo,
      period: r.period,
      play: r.play, // kept exactly as written
      defense: r.defense,
      hash: r.hashNorm ?? 'M',
      status: r.issues.length ? 'review' : 'draft',
      players: clampToField([...(off ? off.build() : []), ...(def ? def.build() : [])], r.hashNorm ?? 'M', workspace.ruleset),
      paths: [],
      notes: [],
      version: 1,
      updatedAt: Date.now(),
    }));
    insertCards(cards);
    const flagged = records.filter((r) => r.issues.length).length;
    toast(`Added ${cards.length} cards${flagged ? ` · ${flagged} marked Needs review` : ''}.`, flagged ? 'warn' : 'good');
    onClose();
  };

  return (
    <Modal title="Paste a practice script" onClose={onClose} wide>
      <p className="muted">
        Copy rows from your spreadsheet (or CSV) and paste them here. Calls are kept exactly as written; repeated play numbers are fine.
      </p>
      <textarea
        className="paste"
        autoFocus
        placeholder={'PLAY #\tPERIOD\tPLAY\tDEFENSE\tHASH\n1\tWIT\tLARRY SNIFF 23 TRAIL @ LOAD\tM FS TRAIL\tL'}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOverride({});
        }}
      />
      {parsed && (
        <>
          <div className="preview-table">
            <table>
              <thead>
                <tr>
                  {cols.map((c, i) => (
                    <th key={i}>
                      <select value={c} onChange={(e) => setOverride({ ...override, [i]: e.target.value as Col })}>
                        {(Object.keys(COL_LABEL) as Col[]).map((k) => (
                          <option key={k} value={k}>
                            {COL_LABEL[k]}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.map((r, ri) => (
                  <tr key={ri} className={records[ri].issues.length ? 'warn' : ''}>
                    {cols.map((_, ci) => (
                      <td key={ci}>{r[ci] || <span className="blank">blank</span>}</td>
                    ))}
                    <td className="issue">{records[ri].issues.join(', ') || '✓'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid2">
            <label className="field">
              <span>Start each card with offense</span>
              <select value={offense} onChange={(e) => setOffense(e.target.value)}>
                <option value="">Nothing</option>
                {OFFENSE_LOOKS.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.name} (sample)
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>…and defense</span>
              <select value={defense} onChange={(e) => setDefense(e.target.value)}>
                <option value="">Nothing — I’ll draw it</option>
                {DEFENSE_LOOKS.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.name} (sample)
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      )}
      <div className="modal-foot">
        <span className="muted small">{records.length ? `${records.length} rows` : ''}</span>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!records.length} onClick={create}>
          Create {records.length || ''} cards
        </button>
      </div>
    </Modal>
  );
}

// ---- Export ----------------------------------------------------------------

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { cards, workspace, toast } = useStore();
  const [format, setFormat] = useState<'pdf' | 'pptx'>('pdf');
  const [includeDrafts, setIncludeDrafts] = useState(cards.every((c) => c.status !== 'ready'));
  const [theme, setTheme] = useState<'print' | 'mono'>('print');
  const [busy, setBusy] = useState(false);
  const plan = exportPlan(cards, includeDrafts);

  const run = async () => {
    setBusy(true);
    try {
      const opts = { theme, includeDrafts };
      if (format === 'pdf') await exportPdf(plan.included, workspace, opts);
      else await exportPptx(plan.included, workspace, opts);
      toast(`Exported ${plan.included.length} card${plan.included.length === 1 ? '' : 's'}.`, 'good');
      onClose();
    } catch (err) {
      console.error(err);
      toast('Export failed — your cards are safe. Try again.', 'warn');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Export packet" onClose={onClose}>
      <div className="choice-row">
        {(
          [
            ['pdf', 'PDF', 'One card per page, ready to print'],
            ['pptx', 'PowerPoint', 'Players, lines and text stay editable'],
          ] as const
        ).map(([k, name, desc]) => (
          <button key={k} className={`choice${format === k ? ' on' : ''}`} onClick={() => setFormat(k)}>
            <strong>{name}</strong>
            <span>{desc}</span>
          </button>
        ))}
      </div>
      <label className="field">
        <span>Ink</span>
        <div className="seg">
          <button className={theme === 'print' ? 'on' : ''} onClick={() => setTheme('print')}>
            Color
          </button>
          <button className={theme === 'mono' ? 'on' : ''} onClick={() => setTheme('mono')}>
            Grayscale
          </button>
        </div>
      </label>
      <label className="check">
        <input type="checkbox" checked={includeDrafts} onChange={(e) => setIncludeDrafts(e.target.checked)} />
        Include cards that aren’t Ready (they print with a DRAFT label)
      </label>
      <div className="plan">
        <div>
          <strong>{plan.included.length}</strong> of {cards.length} cards will export, in packet order.
        </div>
        {plan.omitted.length > 0 && (
          <div className="omitted">
            Left out (not Ready): {plan.omitted.map((c) => `#${c.playNo || '—'}`).join(', ')}
          </div>
        )}
        {format === 'pptx' && (
          <div className="muted small">PowerPoint is a copy — edits made there don’t come back to the app.</div>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!plan.included.length || busy} onClick={run}>
          {I.download()} {busy ? 'Exporting…' : `Export ${format.toUpperCase()}`}
        </button>
      </div>
    </Modal>
  );
}
