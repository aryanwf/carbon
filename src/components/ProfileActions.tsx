"use client";

import Link from "next/link";

type Props = {
  profilePath: string;
  canEdit: boolean;
};

export function ProfileActions({ profilePath, canEdit }: Props) {
  const shareProfile = async () => {
    if (typeof navigator === "undefined") return;
    const profileUrl = new URL(profilePath, window.location.origin).toString();

    try {
      if (navigator.share) {
        await navigator.share({ title: "Carbon profile", url: profileUrl });
        return;
      }

      await navigator.clipboard?.writeText(profileUrl);
    } catch {
      await navigator.clipboard?.writeText(profileUrl);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {canEdit ? (
        <Link
          href={`${profilePath}/edit`}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted transition-colors hover:text-foreground"
          aria-label="Edit profile"
          title="Edit profile"
        >
          <EditIcon />
        </Link>
      ) : null}
      <button
        type="button"
        onClick={() => void shareProfile()}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted transition-colors hover:text-foreground"
        aria-label="Share profile"
        title="Share profile"
      >
        <ShareIcon />
      </button>
    </div>
  );
}

function EditIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
      <path d="m16 6-4-4-4 4" />
      <path d="M12 2v13" />
    </svg>
  );
}
