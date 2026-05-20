import Link from "next/link";
import { notFound } from "next/navigation";
import { FollowButton } from "@/components/FollowButton";
import {
  ensureUserProfile,
  getCommunityFeed,
  getProfileByUsername,
} from "@/lib/community";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { toAuthenticatedRequestUser } from "@/lib/supabase";
import type { CommunityActivity } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const { data: sessionData } = userData.user
    ? await supabase.auth.getSession()
    : { data: { session: null } };
  const viewer = userData.user
    ? await ensureUserProfile(toAuthenticatedRequestUser(userData.user))
    : null;
  const profile = await getProfileByUsername(
    decodeURIComponent(username),
    viewer?.id,
  );

  if (!profile) {
    notFound();
  }

  const activities = await getCommunityFeed({
    profileId: profile.id,
    viewerId: viewer?.id,
    limit: 30,
  });
  const isOwnProfile = viewer?.id === profile.id;

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <Link href="/" className="font-mono text-xs text-muted hover:text-foreground">
          Carbon / community
        </Link>

        <section className="rounded-2xl border border-border bg-surface p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-5">
              <Avatar
                avatarUrl={profile.avatar_url}
                label={profile.display_name ?? profile.username}
              />
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-display text-5xl leading-none tracking-[-0.05em]">
                    {profile.display_name ?? profile.username}
                  </h1>
                  {profile.is_verified ? (
                    <span className="rounded-full bg-accent-soft px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-accent-soft-foreground">
                      Verified
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 font-mono text-xs text-muted">
                  @{profile.username}
                </p>
                <p className="mt-5 max-w-xl text-sm leading-7 text-muted">
                  {profile.bio || "No bio yet."}
                </p>
              </div>
            </div>

            {!isOwnProfile ? (
              <FollowButton
                username={profile.username}
                initialFollowing={Boolean(profile.is_following)}
                initialFollowers={profile.followers_count}
                accessToken={sessionData.session?.access_token ?? null}
              />
            ) : null}
          </div>

          <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Followers" value={profile.followers_count} />
            <Stat label="Following" value={profile.following_count} />
            <Stat label="Papers" value={profile.papers_count} />
            <Stat label="Stars" value={profile.stars_count} />
            <Stat label="Claims" value={profile.claims_count} />
          </dl>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="font-display text-3xl leading-none tracking-[-0.04em]">
            Activity
          </h2>
          <ActivityList activities={activities} />
        </section>
      </div>
    </main>
  );
}

function Avatar({ avatarUrl, label }: { avatarUrl: string | null; label: string }) {
  const initials = label
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface-2 font-display text-3xl text-foreground"
      style={
        avatarUrl
          ? {
              backgroundImage: `url(${avatarUrl})`,
              backgroundPosition: "center",
              backgroundSize: "cover",
            }
          : undefined
      }
      aria-label={label}
    >
      {avatarUrl ? null : initials}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
      <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
        {label}
      </dt>
      <dd className="mt-1 font-display text-3xl leading-none tracking-[-0.04em]">
        {value}
      </dd>
    </div>
  );
}

function ActivityList({ activities }: { activities: CommunityActivity[] }) {
  if (activities.length === 0) {
    return (
      <p className="mt-5 rounded-xl border border-border bg-surface-2 px-5 py-6 text-sm text-muted">
        No public activity yet.
      </p>
    );
  }

  return (
    <ul className="mt-5 space-y-3">
      {activities.map((activity) => (
        <li
          key={activity.id}
          className="rounded-xl border border-border bg-surface-2 px-5 py-4"
        >
          <p className="text-sm text-muted">
            {activityCopy(activity)}{" "}
            <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
              {new Date(activity.created_at).toLocaleDateString()}
            </span>
          </p>
          <p className="mt-2 line-clamp-2 text-sm font-medium text-foreground">
            {activity.paper.title}
          </p>
        </li>
      ))}
    </ul>
  );
}

function activityCopy(activity: CommunityActivity) {
  switch (activity.type) {
    case "paper_added":
      return "Added paper";
    case "paper_read":
      return "Read paper";
    case "paper_starred":
      return "Starred paper";
    case "paper_claimed":
      return "Claimed authorship";
  }
}
