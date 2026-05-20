import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import {
  ensureUserProfile,
  getProfileByUsername,
} from "@/lib/community";
import {
  getSupabaseAdmin,
  toAuthenticatedRequestUser,
} from "@/lib/supabase";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function EditProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    notFound();
  }

  const viewer = await ensureUserProfile(
    toAuthenticatedRequestUser(userData.user),
  );
  const profile = await getProfileByUsername(
    decodeURIComponent(username),
    viewer.id,
  );

  if (!profile || profile.id !== viewer.id) {
    notFound();
  }

  async function updateProfile(formData: FormData) {
    "use server";

    const supabase = await createSupabaseServerClient();
    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      notFound();
    }

    const viewer = await ensureUserProfile(
      toAuthenticatedRequestUser(userData.user),
    );
    const displayName = cleanText(formData.get("displayName"), 80);
    const bio = cleanText(formData.get("bio"), 280) ?? "";
    const avatarUrl = cleanUrl(formData.get("avatarUrl"));

    const { error } = await getSupabaseAdmin()
      .from("profiles")
      .update({
        display_name: displayName,
        bio,
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", viewer.id);

    if (error) {
      throw new Error(error.message);
    }

    const profilePath = `/u/${viewer.username}`;
    revalidatePath(profilePath);
    redirect(profilePath);
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-3xl">
        <Link
          href={`/u/${profile.username}`}
          className="font-mono text-xs text-muted hover:text-foreground"
        >
          Carbon / @{profile.username}
        </Link>

        <section className="mt-6 rounded-2xl border border-border bg-surface p-8">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
            Profile
          </p>
          <h1 className="mt-2 font-display text-5xl leading-none tracking-[-0.05em]">
            Edit public details
          </h1>

          <form action={updateProfile} className="mt-8 space-y-5">
            <label className="block">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                Display name
              </span>
              <input
                name="displayName"
                defaultValue={profile.display_name ?? ""}
                maxLength={80}
                className="mt-2 w-full rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-muted"
              />
            </label>

            <label className="block">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                Bio
              </span>
              <textarea
                name="bio"
                defaultValue={profile.bio}
                maxLength={280}
                rows={5}
                className="mt-2 w-full resize-none rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm leading-6 text-foreground outline-none transition-colors focus:border-muted"
              />
            </label>

            <label className="block">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                Avatar URL
              </span>
              <input
                name="avatarUrl"
                type="url"
                defaultValue={profile.avatar_url ?? ""}
                maxLength={500}
                className="mt-2 w-full rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-muted"
              />
            </label>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="submit"
                className="rounded-md bg-accent px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-background transition-all duration-300 ease-spring hover:bg-[#ddd7cb] active:scale-[0.98]"
              >
                Save profile
              </button>
              <Link
                href={`/u/${profile.username}`}
                className="rounded-md border border-border px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-muted transition-colors hover:text-foreground"
              >
                Cancel
              </Link>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}

function cleanText(value: FormDataEntryValue | null, maxLength: number) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().slice(0, maxLength);
  return trimmed === "" ? null : trimmed;
}

function cleanUrl(value: FormDataEntryValue | null) {
  const cleaned = cleanText(value, 500);

  if (!cleaned) {
    return null;
  }

  try {
    const url = new URL(cleaned);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
