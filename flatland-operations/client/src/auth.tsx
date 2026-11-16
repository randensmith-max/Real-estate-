import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { setTimeZone } from "./format";

export type Role = "owner" | "manager" | "employee" | "subcontractor";
export interface Me {
  user: { id: number; email: string; role: Role; first_name: string; last_name: string; must_change_password: number; can_record_time: number };
  permissions: string[];
  company: { name: string | null; timezone: string };
  integrations: { esign: boolean; quickbooks: boolean };
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  needsSetup: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  /** UI convenience only — the server enforces every permission independently. */
  can: (perm: string) => boolean;
}

const Ctx = createContext<AuthState>(null as unknown as AuthState);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const m = await api.get<Me>("/auth/me");
      setTimeZone(m.company.timezone);
      setMe(m);
      setNeedsSetup(false);
    } catch {
      setMe(null);
      try {
        const s = await api.get<{ needsSetup: boolean }>("/auth/status");
        setNeedsSetup(s.needsSetup);
      } catch {
        /* offline */
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onUnauth = () => setMe(null);
    const onPw = () => refresh();
    window.addEventListener("flatland:unauthorized", onUnauth);
    window.addEventListener("flatland:password-change", onPw);
    return () => {
      window.removeEventListener("flatland:unauthorized", onUnauth);
      window.removeEventListener("flatland:password-change", onPw);
    };
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
    setMe(null);
  }, []);

  const can = useCallback((perm: string) => Boolean(me?.permissions.includes(perm)), [me]);

  return <Ctx.Provider value={{ me, loading, needsSetup, refresh, logout, can }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
