/** Demo-Betrieb erkennen: eigene demo-*-Domain oder ?demo=1 (bleibt pro Tab gemerkt). */
const FLAG = 'eduplanner.demo';

export function isDemoRequest(): boolean {
  return (
    window.location.hostname.startsWith('demo-') ||
    new URLSearchParams(window.location.search).get('demo') === '1'
  );
}

export function markDemo(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(FLAG, '1');
    else sessionStorage.removeItem(FLAG);
  } catch {
    /* Storage gesperrt — dann eben ohne Merker */
  }
}

export function isDemoMode(): boolean {
  if (isDemoRequest()) return true;
  try {
    return sessionStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}
