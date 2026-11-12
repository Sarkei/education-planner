import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import { LoginPage } from './pages/LoginPage';
import { FilesPage } from './pages/FilesPage';
import { EditorPage } from './pages/EditorPage';
import { AdminPage } from './pages/AdminPage';
import { TrashPage } from './pages/TrashPage';
import { SearchPage } from './pages/SearchPage';

function useHashRoute(): string {
  const [route, setRoute] = useState(() => location.hash || '#/files');
  useEffect(() => {
    const onChange = () => setRoute(location.hash || '#/files');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

function Router() {
  const route = useHashRoute();
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted">Lädt …</div>;
  }
  if (!user) return <LoginPage />;

  if (route.startsWith('#/edit/')) return <EditorPage nodeId={route.replace('#/edit/', '')} />;
  if (route.startsWith('#/search')) return <SearchPage />;
  if (route.startsWith('#/trash')) return <TrashPage />;
  if (route.startsWith('#/users')) return <AdminPage />;
  return <FilesPage />;
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
