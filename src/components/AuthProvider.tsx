"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase-client";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function verifiedSession(
  storedSession: Session | null,
): Promise<Session | null> {
  if (!storedSession) {
    return null;
  }

  const { data, error } = await supabaseBrowser.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  return { ...storedSession, user: data.user };
}

export function AuthProvider({
  children,
  initialSession,
}: {
  children: ReactNode;
  initialSession: Session | null;
}) {
  const [session, setSession] = useState<Session | null>(initialSession);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const syncAuth = async (storedSession: Session | null) => {
      const nextSession = await verifiedSession(storedSession);

      if (!active) return;

      setSession(nextSession);
      setError(null);
      setLoading(false);
    };

    void (async () => {
      const { data, error: userError } = await supabaseBrowser.auth.getUser();

      if (!active) return;

      if (userError || !data.user) {
        setSession(null);
        setError(userError?.message ?? null);
        setLoading(false);
        return;
      }

      const { data: sessionData, error: sessionError } =
        await supabaseBrowser.auth.getSession();

      if (!active) return;

      setSession(
        sessionData.session
          ? { ...sessionData.session, user: data.user }
          : null,
      );
      setError(sessionError?.message ?? null);
      setLoading(false);
    })();

    const {
      data: { subscription },
    } = supabaseBrowser.auth.onAuthStateChange((_event, nextSession) => {
      void syncAuth(nextSession);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      error,
      signInWithGoogle: async () => {
        setError(null);

        const { error: signInError } =
          await supabaseBrowser.auth.signInWithOAuth({
            provider: "google",
            options: {
              redirectTo: `${window.location.origin}/auth/callback`,
            },
          });

        if (signInError) {
          setError(signInError.message);
        }
      },
      signOut: async () => {
        setError(null);
        const { error: signOutError } = await supabaseBrowser.auth.signOut();

        if (signOutError) {
          setError(signOutError.message);
        }
      },
    }),
    [error, loading, session],
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