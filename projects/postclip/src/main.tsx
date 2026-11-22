import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root element');
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// S2 (A11, UC04): register the app-shell service worker so the app is
// installable and, after the first load, works with the network disabled.
// Production builds only: dev serves no precache-manifest (it is generated
// by `npm run build`). A transient failure (e.g. a dropped connection while
// fetching the worker script) must not cost the whole session's
// installability, so registration retries with backoff; if it still fails
// the app degrades to always-online (fail closed, no console noise — the
// core flow never depends on the worker, and no analytics exist).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void (async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await navigator.serviceWorker.register('/sw.js');
          return;
        } catch {
          if (attempt === 3) return; // degrade to the online app, silently
          await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        }
      }
    })();
  });
}
