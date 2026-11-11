"use client";

import { useState } from "react";
import type { ProfileWithStats } from "@/lib/types";

type Props = {
  username: string;
  initialFollowing: boolean;
  initialFollowers: number;
  signedIn: boolean;
};

export function FollowButton({
  username,
  initialFollowing,
  initialFollowers,
  signedIn,
}: Props) {
  const [following, setFollowing] = useState(initialFollowing);
  const [followers, setFollowers] = useState(initialFollowers);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateFollow = async () => {
    if (!signedIn || saving) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/profiles/${encodeURIComponent(username)}/follow`,
        {
          method: following ? "DELETE" : "PUT",
        },
      );
      const payload = (await response.json()) as {
        profile?: ProfileWithStats | null;
        error?: string;
      };

      if (!response.ok || !payload.profile) {
        throw new Error(payload.error ?? "Failed to update follow");
      }

      setFollowing(Boolean(payload.profile.is_following));
      setFollowers(payload.profile.followers_count);
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Failed to update follow",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => void updateFollow()}
        disabled={!signedIn || saving}
        className="rounded-md bg-accent px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-background transition-all duration-300 ease-spring hover:bg-[#ddd7cb] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving" : following ? "Following" : "Follow"}
      </button>
      <p className="font-mono text-[10px] text-muted">
        {followers} follower{followers === 1 ? "" : "s"}
      </p>
      {error ? <p className="text-xs text-[#e3bb74]">{error}</p> : null}
    </div>
  );
}
