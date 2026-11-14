# playbook
AI-powered football play creation, editing, and playbook management for coaches.

## App (`app/`)

Scout-card editor for practice packets (PRD Milestone 1: card model, editor, PDF/PowerPoint export). No AI yet.

```bash
cd app
npm install
npm run dev
```

- `src/model/` — card data (`looks.ts`: saved team looks and matching). Positions are stored in yards from the ball, never pixels.
- `src/render/` — one SVG renderer shared by the editor, thumbnails, and PDF export.
- `src/editor/` — canvas interactions (drag, draw paths, box select, keyboard).
- `src/export/` — vector PDF (jsPDF + svg2pdf) and native-shape PowerPoint (pptxgenjs).

Saved team looks: save a card's defense or formation once and reuse it. Defense calls match a look's name or aliases exactly; play calls match the longest look name they start with. Cards copy a look version, so changing a look never rewrites a card silently; the Looks tab lists undefined calls and cards on older versions.

Install cards: switch a card to Install to add player assignments and coaching points under the field. Notes print at a fixed size; anything that doesn't fit continues on extra pages (PDF and PowerPoint) instead of shrinking. Players can carry a read-order number.

Say or type a change: press **M** to talk (browser speech recognition) or **/** to type, e.g. "corners at 7, mike rush the A gap", "nickel over number 2", "corners at 8 on all chop cards". The words are interpreted in the browser by `src/model/commands.ts` (no AI, no server), shown as a preview, and applied as one undoable change. Unrecognized words are reported, not guessed. Note: Chrome and Edge send the audio itself to their speech service.

Tests: `npm test`.

Cards and looks save to browser storage for now.
