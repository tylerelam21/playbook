# playbook
AI-powered football play creation, editing, and playbook management for coaches.

## App (`app/`)

Scout-card editor for practice packets (PRD Milestone 1: card model, editor, PDF/PowerPoint export). No AI yet.

```bash
cd app
npm install
npm run dev
```

- `src/model/` — card data. Positions are stored in yards from the ball, never pixels.
- `src/render/` — one SVG renderer shared by the editor, thumbnails, and PDF export.
- `src/editor/` — canvas interactions (drag, draw paths, box select, keyboard).
- `src/export/` — vector PDF (jsPDF + svg2pdf) and native-shape PowerPoint (pptxgenjs).

Cards save to browser storage for now.
