import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, saveToken } from '../api/client';
import type { CurrentUser } from '../api/types';

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(() => Boolean(getToken()));

  useEffect(() => {
    if (!getToken()) {
      return;
    }
    api<CurrentUser>('/auth/me/')
      .then(setUser)
      .catch(() => saveToken(null))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthState>(() => ({
    user,
    loading,
    async login(username, password) {
      const result = await api<{ token: string; user: CurrentUser }>('/auth/login/', { method: 'POST', body: JSON.stringify({ username, password }) });
      saveToken(result.token);
      setUser(result.user);
    },
    async logout() {
      try { await api('/auth/logout/', { method: 'POST' }); } finally { saveToken(null); setUser(null); }
    },
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is missing');
  return value;
}

