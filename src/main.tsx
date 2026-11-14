import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getToken, setToken } from './lib/api';
import { isDemoRequest, markDemo } from './lib/demo';
import './styles.css';

/** Demo-Betrieb über demo-*-Domain oder ?demo=1: anonymes Beispielkonto holen. */
async function startDemo(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/demo', { method: 'GET' });
    if (!res.ok) return false;
    const data = (await res.json()) as { token?: string };
    if (!data?.token) return false;
    setToken(data.token);
    markDemo(true);
    const clean = window.location.pathname + window.location.hash;
    window.history.replaceState({}, '', clean);
    return true;
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  if (isDemoRequest() && !getToken()) {
    await startDemo();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
