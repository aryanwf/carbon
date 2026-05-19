"use client";

import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function requirePublicEnv(name: string, value: string | undefined) {
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

export const supabaseBrowser = createBrowserClient(
  requirePublicEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl),
  requirePublicEnv(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    supabasePublishableKey,
  ),
);
