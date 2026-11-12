import type { ReactNode } from 'react';
import { Files, LogOut, Moon, Search, Sun, Trash2, Users } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { navigate } from '../App';

type Tab = 'files' | 'search' | 'trash' | 'users';

/** Gemeinsamer Rahmen: Serifenkopf, Pill-Navigation, helles/dunkles Design. */
export function Shell({ tab, children }: { tab: Tab; children: ReactNode }) {
  const { user, logout } = useAuth();
  const theme = (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || 'dark';

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('eduplanner.theme', next);
    // Neu zeichnen, damit die Kopfzeile die neue Einstellung kennt
    navigate(location.hash || '#/files');
    location.reload();
  }

  const tabs: Array<{ id: Tab; label: string; icon: ReactNode; hash: string; adminOnly?: boolean }> = [
    { id: 'files', label: 'Dateien', icon: <Files className="h-3.5 w-3.5" />, hash: '#/files' },
    { id: 'search', label: 'Suche', icon: <Search className="h-3.5 w-3.5" />, hash: '#/search' },
    { id: 'trash', label: 'Papierkorb', icon: <Trash2 className="h-3.5 w-3.5" />, hash: '#/trash' },
    { id: 'users', label: 'Nutzer', icon: <Users className="h-3.5 w-3.5" />, hash: '#/users', adminOnly: true },
  ];

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-[var(--line)] bg-[var(--bg)] px-4 py-3">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--accent-soft)]">
              <Files className="h-4 w-4 text-[var(--accent)]" />
            </div>
            <div>
              <p className="serif text-[19px] leading-tight">Education Planner</p>
              <p className="text-[11px] text-muted">Unterlagen für die Berufsschule</p>
            </div>
          </div>

          <nav className="pill-nav ml-auto">
            {tabs
              .filter((t) => !t.adminOnly || user?.role === 'admin')
              .map((t) => (
                <button key={t.id} className={`pill ${tab === t.id ? 'active' : ''}`} onClick={() => navigate(t.hash)}>
                  {t.icon}
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              ))}
          </nav>

          <div className="flex items-center gap-1.5">
            <span className="hidden text-[11px] text-muted md:inline">{user?.name}</span>
            <button className="btn btn-ghost !px-2 !py-1.5" onClick={toggleTheme} title="Design wechseln">
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button className="btn btn-ghost !px-2 !py-1.5" onClick={logout} title="Abmelden">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

export function PageHead({
  eyebrow,
  title,
  hint,
  action,
}: {
  eyebrow?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="serif mt-0.5 text-2xl leading-tight sm:text-[28px]">{title}</h1>
        {hint && <p className="mt-1 text-[13px] text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="serif text-lg">{title}</p>
      <p className="max-w-sm text-[13px] text-muted">{hint}</p>
      {action}
    </div>
  );
}
