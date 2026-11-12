import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';
import type { User } from './types';

type AuthValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh(): Promise<void> {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await api<{ user: User }>('/auth/me');
      setUser(data.user);
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const value: AuthValue = {
    user,
    loading,
    refresh,
    async login(email, password) {
      const data = await api<{ token: string; user: User }>('/auth/login', { body: { email, password } });
      setToken(data.token);
      setUser(data.user);
    },
    async register(email, password, name) {
      const data = await api<{ token: string; user: User }>('/auth/register', { body: { email, password, name } });
      setToken(data.token);
      setUser(data.user);
    },
    logout() {
      setToken(null);
      setUser(null);
      location.hash = '#/login';
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth ohne AuthProvider');
  return ctx;
}
