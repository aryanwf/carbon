import { AuthProvider } from "@/components/AuthProvider";
import { Workspace } from "@/components/Workspace";
import { getCurrentUser } from "@/lib/auth";
import { authErrorMessage } from "@/lib/auth/errors";
import { getBannedReason } from "@/lib/bans";
import { getDb } from "@/lib/cloudflare";
import { getUserLibrary } from "@/lib/papers";
import type { Paper, PaperConnection } from "@/lib/types";

const EMPTY_PAPERS: Paper[] = [];
const EMPTY_CONNECTIONS: PaperConnection[] = [];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  const authError = authErrorMessage(params.auth_error);

  let initialPapers = EMPTY_PAPERS;
  let initialConnections = EMPTY_CONNECTIONS;
  let initialLibraryError: string | null = null;
  let initialProfileUsername: string | null = null;
  let initialProfileAvatarUrl: string | null = null;

  if (user) {
    try {
      const bannedReason = await getBannedReason(getDb(), user);

      if (bannedReason !== null) {
        initialLibraryError = bannedReason
          ? `Account banned: ${bannedReason}`
          : "Account banned";
      } else {
        initialProfileUsername = user.username;
        initialProfileAvatarUrl = user.avatar_url;
        const library = await getUserLibrary(user.id);
        initialPapers = library.papers;
        initialConnections = library.connections;
      }
    } catch (error) {
      console.error("Failed to load papers:", error);
      initialLibraryError = "Failed to load papers";
    }
  }

  return (
    <AuthProvider initialUser={user} initialError={authError}>
      <Workspace
        initialPapers={initialPapers}
        initialConnections={initialConnections}
        initialLibraryError={initialLibraryError}
        initialLibraryUserId={user?.id ?? null}
        initialProfileUsername={initialProfileUsername}
        initialProfileAvatarUrl={initialProfileAvatarUrl}
      />
    </AuthProvider>
  );
}
