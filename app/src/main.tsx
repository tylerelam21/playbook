import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import './index.css';
import App from './App';

// Install-card notes are wrapped by measuring text, so wait (briefly) for the
// card font before the first render.
const fontsLoaded = Promise.all([
  document.fonts.load("600 15px 'Barlow Condensed'"),
  document.fonts.load("700 15px 'Barlow Condensed'"),
]);
const timeout = new Promise((r) => setTimeout(r, 1500));

Promise.race([fontsLoaded, timeout]).finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
