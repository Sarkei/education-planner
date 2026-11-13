import { useState, type ReactNode } from 'react';
import { GraduationCap, LogOut, Moon, Sun } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { navigate } from '../App';

export type SectionId = 'overview' | 'files' | 'shared' | 'search' | 'trash' | 'users';

type Section = { id: SectionId; label: string; hash: string; adminOnly?: boolean };

const SECTIONS: Section[] = [
  { id: 'overview', label: 'Übersicht', hash: '#/' },
  { id: 'files', label: 'Dateien', hash: '#/files' },
  { id: 'shared', label: 'Freigaben', hash: '#/shared' },
  { id: 'search', label: 'Suche', hash: '#/search' },
  { id: 'trash', label: 'Papierkorb', hash: '#/trash' },
  { id: 'users', label: 'Nutzer', hash: '#/users', adminOnly: true },
];

function currentTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/** Gemeinsamer Rahmen: Serifenmarke, Pill-Navigation, helles/dunkles Design. */
export function Shell({ tab, children }: { tab: SectionId; children: ReactNode }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(currentTheme);

  const items = SECTIONS.filter((item) => !item.adminOnly || user?.role === 'admin');
  const active = items.find((item) => item.id === tab);
  const subtitle = active?.label ?? 'Übersicht';

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('eduplanner.theme', next);
    setTheme(next);
  }

  function go(hash: string) {
    setOpen(false);
    navigate(hash);
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-container app-header__inner">
          <button className="app-brand" onClick={() => go('#/')} title="Zur Übersicht">
            <span className="app-brand__mark">
              <GraduationCap className="h-5 w-5" />
            </span>
            <span className="app-brand__text">
              Education Planner
              <span className="app-brand__sub">{subtitle}</span>
            </span>
          </button>

          <nav className="app-nav" aria-label="Bereiche">
            {items.map((item) => (
              <button
                key={item.id}
                className={`app-nav-item${item.id === tab ? ' is-active' : ''}`}
                aria-current={item.id === tab ? 'page' : undefined}
                onClick={() => go(item.hash)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="app-actions">
            {user?.name ? <span className="hidden text-xs text-muted lg:inline">{user.name}</span> : null}
            <button
              className="app-iconbtn"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
              title={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button className="app-iconbtn" onClick={logout} aria-label="Abmelden" title="Abmelden">
              <LogOut className="h-4 w-4" />
            </button>
            <button
              className="app-iconbtn app-mobile-toggle"
              onClick={() => setOpen((value) => !value)}
              aria-label="Menü"
              aria-expanded={open}
            >
              {open ? '✕' : '☰'}
            </button>
          </div>
        </div>

        {open ? (
          <nav className="app-mobile-nav" aria-label="Bereiche">
            {items.map((item) => (
              <button
                key={item.id}
                className={item.id === tab ? 'is-active' : ''}
                onClick={() => go(item.hash)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        ) : null}
      </header>

      <main>{children}</main>

      <footer className="app-footer">
        <div className="app-container flex flex-wrap items-center justify-between gap-2">
          <span>Education Planner · Unterlagen für die Berufsschule</span>
          <span>Dateien liegen als echte Dateien auf dem NAS</span>
        </div>
      </footer>
    </div>
  );
}

/** Seitenkopf: Badge, Serif-Titel, ein Satz Einleitung. */
export function PageHead({
  label,
  eyebrow,
  title,
  intro,
  hint,
  action,
  children,
}: {
  label?: string;
  eyebrow?: string;
  title: string;
  intro?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const badge = label ?? eyebrow;
  const lede = intro ?? hint;

  return (
    <header className="app-hero app-container">
      <div className="app-hero__row">
        <div>
          {badge ? <p className="app-badge">{badge}</p> : null}
          <h1 className="app-title">{title}</h1>
          {lede ? <p className="app-lede">{lede}</p> : null}
        </div>
        {action ? <div className="app-hero__action">{action}</div> : null}
      </div>
      {children}
    </header>
  );
}

/** Kennzahlen-Leiste: vier echte Werte aus den Daten. */
export function StatRow({ items }: { items: { value: string; label: string }[] }) {
  if (items.length === 0) return null;
  return (
    <dl className="stat-row">
      {items.map((item) => (
        <div className="stat" key={item.label}>
          <dt className="stat__value">{item.value}</dt>
          <dd className="stat__label">{item.label}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Abgesetzte Sektion auf dem zweiten Grauton. */
export function Band({ title, note, children }: { title?: string; note?: string; children: ReactNode }) {
  return (
    <section className="app-band app-section">
      <div className="app-container">
        {title ? (
          <div className="app-section__head">
            <h2 className="app-section__title">{title}</h2>
            {note ? <p className="app-section__note">{note}</p> : null}
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="app-card app-empty">
      <p className="app-empty__title">{title}</p>
      <p className="app-empty__hint">{hint}</p>
      {action}
    </div>
  );
}
