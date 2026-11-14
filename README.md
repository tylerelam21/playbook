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

Say or type a change: hold **M** (or the mic button) to talk, release to stop, or press **/** to type. Exact simple phrases ("corners at 7") are handled instantly in the browser by `src/model/commands.ts`. Anything else goes to Claude through the Vercel function `api/interpret.ts`, which returns proposed edits (`src/ai/protocol.ts`); the browser checks them against the card (`src/ai/applyAi.ts`) and shows a preview on the card before anything changes. Claude asks a question instead of guessing at team terms it hasn't seen.

AI setup (Vercel → Project → Settings → Environment Variables):
- `ANTHROPIC_API_KEY` (required)
- `PLAYBOOK_MODEL` (optional, default `claude-opus-5-5`)
- `PLAYBOOK_EFFORT` (optional, `low` | `medium` | `high`, default `low` for speed)

Without the key the app still works; the AI path explains it isn't set up and falls back to the built-in phrases. `npm run dev` (Vite) doesn't run the function; use `vercel dev` to test it locally.

Tests: `npm test`.

Cards and looks save to browser storage for now.
