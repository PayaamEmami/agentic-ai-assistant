'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  api,
  clearStoredAuthToken,
  getStoredAuthToken,
  isSessionExpiredError,
  resetSessionExpired,
  setSessionExpiredHandler,
  setStoredAuthToken,
} from './api-client';

interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isReady: boolean;
  isAuthenticated: boolean;
  sessionExpired: boolean;
  login: (email: string, password: string) => Promise<void>;
  // Account creation is intentionally disabled.
  // register: (email: string, password: string, displayName: string) => Promise<void>;
  devLogin: (email?: string, displayName?: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const authMutationRef = useRef(0);

  const applyAuth = useCallback((nextToken: string, nextUser: AuthUser) => {
    authMutationRef.current += 1;
    resetSessionExpired();
    setStoredAuthToken(nextToken);
    setToken(nextToken);
    setUser(nextUser);
    setSessionExpired(false);
    setIsReady(true);
  }, []);

  const logout = useCallback((reason: 'manual' | 'expired' = 'manual') => {
    authMutationRef.current += 1;
    if (reason === 'manual') {
      resetSessionExpired();
    }
    clearStoredAuthToken();
    setToken(null);
    setUser(null);
    setSessionExpired(reason === 'expired');
    setIsReady(true);
  }, []);

  const refresh = useCallback(async () => {
    const refreshMutation = authMutationRef.current;
    const existingToken = getStoredAuthToken();
    if (!existingToken) {
      setToken(null);
      setUser(null);
      setIsReady(true);
      return;
    }

    setToken(existingToken);
    try {
      const response = await api.auth.me();
      if (authMutationRef.current !== refreshMutation || getStoredAuthToken() !== existingToken) {
        return;
      }
      setUser(response.user);
    } catch (error) {
      if (authMutationRef.current === refreshMutation && getStoredAuthToken() === existingToken) {
        logout(isSessionExpiredError(error) ? 'expired' : 'manual');
      }
    } finally {
      if (authMutationRef.current === refreshMutation && getStoredAuthToken() === existingToken) {
        setIsReady(true);
      }
    }
  }, [logout]);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await api.auth.login(email, password);
      applyAuth(response.token, response.user);
    },
    [applyAuth],
  );

  const devLogin = useCallback(
    async (email = 'dev@localhost', displayName = 'Dev User') => {
      const response = await api.auth.devLogin(email, displayName);
      applyAuth(response.token, response.user);
    },
    [applyAuth],
  );

  useEffect(() => {
    setSessionExpiredHandler(() => {
      logout('expired');
    });
    return () => setSessionExpiredHandler(null);
  }, [logout]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isReady,
      isAuthenticated: user !== null && token !== null,
      sessionExpired,
      login,
      devLogin,
      logout: () => logout('manual'),
      refresh,
    }),
    [devLogin, isReady, login, logout, refresh, sessionExpired, token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within AuthProvider');
  }
  return context;
}
