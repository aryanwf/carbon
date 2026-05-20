import { AuthProvider } from "@/components/AuthProvider";
import { Workspace } from "@/components/Workspace";
import { ensureUserProfile } from "@/lib/community";
import { getUserLibrary } from "@/lib/papers";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  getBannedReason,
  toAuthenticatedRequestUser,
} from "@/lib/supabase";
import type { Paper, PaperConnection } from "@/lib/types";

const EMPTY_PAPERS: Paper[] = [];
const EMPTY_CONNECTIONS: PaperConnection[] = [];

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  let session = null;

  if (userData.user) {
    const { data: sessionData } = await supabase.auth.getSession();
    session = sessionData.session
      ? { ...sessionData.session, user: userData.user }
      : null;
  }

  let initialPapers = EMPTY_PAPERS;
  let initialConnections = EMPTY_CONNECTIONS;
  let initialLibraryError: string | null = null;
  let initialProfileUsername: string | null = null;
  let initialProfileAvatarUrl: string | null = null;

  if (userData.user) {
    const user = toAuthenticatedRequestUser(userData.user);

    try {
      const bannedReason = await getBannedReason(user);

      if (bannedReason !== null) {
        initialLibraryError = bannedReason
          ? `Account banned: ${bannedReason}`
          : "Account banned";
      } else {
        const profile = await ensureUserProfile(user);
        initialProfileUsername = profile.username;
        initialProfileAvatarUrl = profile.avatar_url;
        const library = await getUserLibrary(user.id);
        initialPapers = library.papers;
        initialConnections = library.connections;
      }
    } catch (error) {
      initialLibraryError =
        error instanceof Error ? error.message : "Failed to load papers";
    }
  }

  return (
    <AuthProvider initialSession={session}>
      <Workspace
        initialPapers={initialPapers}
        initialConnections={initialConnections}
        initialLibraryError={initialLibraryError}
        initialLibraryUserId={userData.user?.id ?? null}
        initialProfileUsername={initialProfileUsername}
        initialProfileAvatarUrl={initialProfileAvatarUrl}
      />
    </AuthProvider>
  );
}
