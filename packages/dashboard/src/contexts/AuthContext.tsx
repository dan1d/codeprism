import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { api } from "@/lib/api";

interface AuthUser {
  userId: string;
  email: string;
  tenantSlug: string;
  role: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (sessionToken: string, tenantSlug: string) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: () => {},
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("codeprism_session");
    if (!token) {
      setLoading(false);
      return;
    }

    api.me()
      .then((data) => setUser(data))
      .catch(() => {
        localStorage.removeItem("codeprism_session");
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback((sessionToken: string, tenantSlug: string) => {
    localStorage.setItem("codeprism_session", sessionToken);
    api.me()
      .then((data) => setUser(data))
      .catch(() => {});
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    localStorage.removeItem("codeprism_session");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
