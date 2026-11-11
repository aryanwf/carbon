"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SessionUser } from "@/lib/auth";

type AuthContextValue = {
  user: SessionUser | null;
  loading: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  initialUser,
  initialError = null,
}: {
  children: ReactNode;
  initialUser: SessionUser | null;
  initialError?: string | null;
}) {
  const [user, setUser] = useState<SessionUser | null>(initialUser);
  // The user is resolved on the server, so there is no client-side check.
  const loading = false;
  const [error, setError] = useState<string | null>(initialError);

  useEffect(() => {
    // Drop ?auth_error from the address bar once it has been shown.
    const url = new URL(window.location.href);

    if (url.searchParams.has("auth_error")) {
      url.searchParams.delete("auth_error");
      window.history.replaceState(window.history.state, "", url.toString());
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      error,
      signInWithGoogle: async () => {
        setError(null);
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/auth/login?next=${encodeURIComponent(next)}`);
      },
      signOut: async () => {
        setError(null);

        try {
          const response = await fetch("/auth/logout", { method: "POST" });

          if (!response.ok) {
            throw new Error(`Sign out failed (${response.status})`);
          }

          setUser(null);
          window.location.assign("/");
        } catch (signOutError) {
          setError(
            signOutError instanceof Error ? signOutError.message : "Sign out failed",
          );
        }
      },
    }),
    [error, loading, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
