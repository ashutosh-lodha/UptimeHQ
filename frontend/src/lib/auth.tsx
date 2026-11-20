import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';
import { api, setTokenGetter } from '../api/client';
import type { User } from '../api/types';

interface AuthState {
  /** The UptimeHQ account for the signed-in Clerk user. */
  user: User | null;
  loading: boolean;
  /** Set when signed in to Clerk but the API rejected the account (e.g. unverified email). */
  error: Error | null;
  retry: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

/** Bridges Clerk's session to the API: attaches session JWTs and loads the local user. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken, signOut } = useClerkAuth();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loadingUser, setLoadingUser] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setTokenGetter(() => getToken());
    return () => setTokenGetter(null);
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setUser(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoadingUser(true);
    setError(null);
    api<{ user: User }>('/auth/me')
      .then((r) => !cancelled && setUser(r.user))
      .catch((err: Error) => !cancelled && setError(err))
      .finally(() => !cancelled && setLoadingUser(false));
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, attempt]);

  const logout = useCallback(() => {
    setUser(null);
    void signOut({ redirectUrl: '/' });
  }, [signOut]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const loading = !isLoaded || (Boolean(isSignedIn) && !user && !error) || loadingUser;
  return <AuthContext.Provider value={{ user, loading, error, retry, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
