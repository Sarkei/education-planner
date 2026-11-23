import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import { LoginPage } from './pages/LoginPage';
import { lazy, Suspense } from 'react';

// Selten genutzte Seiten erst laden, wenn sie geoeffnet werden.
// Das haelt das Start-Bundle klein - Editor und Admin braucht niemand beim ersten Aufruf.
const FilesPage = lazy(() => import('./pages/FilesPage').then(m => ({ default: m.FilesPage })));
const EditorPage = lazy(() => import('./pages/EditorPage').then(m => ({ default: m.EditorPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
const TrashPage = lazy(() => import('./pages/TrashPage').then(m => ({ default: m.TrashPage })));
const SearchPage = lazy(() => import('./pages/SearchPage').then(m => ({ default: m.SearchPage })));
const SharedPage = lazy(() => import('./pages/SharedPage').then(m => ({ default: m.SharedPage })));

function useHashRoute(): string {
  const [route, setRoute] = useState(() => location.hash || '#/');
  useEffect(() => {
    const onChange = () => setRoute(location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

function Router() {
  const route = useHashRoute();
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted">Lädt …</div>;
  }
  if (!user) return <LoginPage />;

  const seite = (() => {
  if (route.startsWith('#/edit/')) return <EditorPage nodeId={route.replace('#/edit/', '')} />;
  if (route.startsWith('#/files')) {
    const folder = route.startsWith('#/files/') ? route.slice('#/files/'.length) : null;
    return <FilesPage key={folder ?? 'root'} initialFolder={folder} />;
  }
  if (route.startsWith('#/shared')) return <SharedPage />;
  if (route.startsWith('#/search')) return <SearchPage />;
  if (route.startsWith('#/trash')) return <TrashPage />;
  if (route.startsWith('#/users')) return <AdminPage />;
  // Startseite sind die Dateien: eine Übersichtsseite davor zeigte nur, was dort schon steht.
  return <FilesPage key="root-start" initialFolder={null} />;
  })();

  return (
    <Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center text-sm text-muted">Lädt …</div>}>
      {seite}
    </Suspense>
  );
}

export function App() {
  useEffect(() => {
    const stored = localStorage.getItem('eduplanner.theme');
    document.documentElement.setAttribute('data-theme', stored === 'light' ? 'light' : 'dark');
  }, []);

  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}

export function navigate(hash: string): void {
  if (location.hash === hash) return;
  location.hash = hash;
}
