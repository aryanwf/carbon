"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CommunityActivity } from "@/lib/types";

type Props = {
  signedIn: boolean;
};

export function CommunityFeed({ signedIn }: Props) {
  const [activities, setActivities] = useState<CommunityActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) {
      setActivities([]);
      setError("Sign in required");
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const response = await fetch("/api/community/feed?scope=following", {
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          activities?: CommunityActivity[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load activity");
        }

        setActivities(payload.activities ?? []);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load activity",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [signedIn]);

  return (
    <section className="flex h-full flex-col">
      <header className="border-b border-border bg-surface-2 px-6 py-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
          Community
        </p>
        <h2 className="mt-2 font-display text-4xl leading-none tracking-[-0.04em] text-foreground">
          Activity feed
        </h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {loading ? (
          <p className="text-xs uppercase tracking-[0.2em] text-muted">
            Loading activity…
          </p>
        ) : error ? (
          <p className="rounded-md border border-[#5a3434] bg-[#2a1818] px-4 py-3 font-mono text-xs text-[#e3bb74]">
            {error}
          </p>
        ) : activities.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface-2 px-6 py-10 text-center">
            <p className="font-display text-3xl leading-none tracking-[-0.04em] text-foreground">
              Feed quiet
            </p>
            <p className="mt-3 text-sm leading-6 text-muted">
              Follow researchers to see adds, reads, stars, and claims here.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {activities.map((activity) => (
              <li
                key={activity.id}
                className="rounded-xl border border-border bg-surface-2 px-5 py-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm leading-6 text-muted">
                      <Link
                        href={`/u/${activity.profile.username}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {activity.profile.display_name ??
                          `@${activity.profile.username}`}
                      </Link>{" "}
                      {activityVerb(activity.type)}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm font-medium text-foreground">
                      {activity.paper.title}
                    </p>
                    <p className="mt-2 line-clamp-1 font-mono text-[10px] text-muted">
                      {activity.paper.authors.join(", ") || "Unknown authors"}
                    </p>
                  </div>
                  <time className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                    {new Date(activity.created_at).toLocaleDateString()}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function activityVerb(type: CommunityActivity["type"]) {
  switch (type) {
    case "paper_added":
      return "added a paper";
    case "paper_read":
      return "read a paper";
    case "paper_starred":
      return "starred a paper";
    case "paper_claimed":
      return "claimed authorship";
  }
}
