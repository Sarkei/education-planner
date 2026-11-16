import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const TOKEN_KEY = 'eduplanner.token';

/** Demo-Zugang: ?demo=1 meldet automatisch das Demo-Konto an. */
async function start() {
  const isDemo =
    window.location.hostname.startsWith('demo-') || window.location.hostname.startsWith('demo.') ||
    new URLSearchParams(window.location.search).has('demo');
  if (isDemo && !localStorage.getItem(TOKEN_KEY)) {
    try {
      const r = await fetch('/api/auth/demo');
      if (r.ok) {
        const d = await r.json();
        localStorage.setItem(TOKEN_KEY, d.token);
        window.location.replace(window.location.pathname + window.location.search);
        return;
      }
    } catch {
      /* ohne Demo weiter */
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
