import Link from "next/link";
import { notFound } from "next/navigation";
import { FollowButton } from "@/components/FollowButton";
import { ProfileActions } from "@/components/ProfileActions";
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
  const profilePath = `/u/${encodeURIComponent(profile.username)}`;

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <Link href="/" className="font-mono text-xs text-muted hover:text-foreground">
          Carbon / community
        </Link>

        <section className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="border-b border-border bg-surface-2 px-8 py-7">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex flex-col gap-5 sm:flex-row">
                <Avatar
                  avatarUrl={profile.avatar_url}
                  label={profile.display_name ?? profile.username}
                />
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="font-display text-5xl leading-none tracking-[-0.05em] sm:text-6xl">
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
                  <p className="mt-5 max-w-2xl text-sm leading-7 text-muted">
                    {profile.bio || "No bio yet."}
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-start gap-3 sm:flex-row lg:items-end">
                <ProfileActions profilePath={profilePath} canEdit={isOwnProfile} />
                {!isOwnProfile ? (
                  <FollowButton
                    username={profile.username}
                    initialFollowing={Boolean(profile.is_following)}
                    initialFollowers={profile.followers_count}
                    accessToken={sessionData.session?.access_token ?? null}
                  />
                ) : null}
              </div>
            </div>
          </div>

          <dl className="grid gap-px bg-border sm:grid-cols-3">
            <HeaderDetail label="Followers" value={profile.followers_count} />
            <HeaderDetail label="Following" value={profile.following_count} />
            <HeaderDetail
              label="Joined"
              value={formatJoinedDate(profile.created_at)}
            />
          </dl>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
                Statistics
              </p>
              <h2 className="mt-2 font-display text-4xl leading-none tracking-[-0.04em]">
                Overview
              </h2>
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Stat label="Papers in library" value={profile.papers_count} />
            <Stat label="Papers read" value={profile.papers_read_count} />
            <Stat label="Public items" value={profile.public_items_count} />
            <Stat label="Stars given" value={profile.stars_count} />
            <Stat label="Stars received" value={profile.stars_received_count} />
            <Stat label="Published works" value={profile.published_works_count} />
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

function HeaderDetail({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="bg-surface px-8 py-5">
      <dt className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-foreground">{value}</dd>
    </div>
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

function formatJoinedDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    year: "numeric",
  }).format(new Date(value));
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
