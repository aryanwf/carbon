import { AuthProvider } from "@/components/AuthProvider";
import { Workspace } from "@/components/Workspace";
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
  const [{ data: sessionData }, { data: userData }] = await Promise.all([
    supabase.auth.getSession(),
    supabase.auth.getUser(),
  ]);
  const session =
    userData.user && sessionData.session
      ? { ...sessionData.session, user: userData.user }
      : null;

  let initialPapers = EMPTY_PAPERS;
  let initialConnections = EMPTY_CONNECTIONS;
  let initialLibraryError: string | null = null;

  if (userData.user) {
    const user = toAuthenticatedRequestUser(userData.user);

    try {
      const bannedReason = await getBannedReason(user);

      if (bannedReason !== null) {
        initialLibraryError = bannedReason
          ? `Account banned: ${bannedReason}`
          : "Account banned";
      } else {
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
      />
    </AuthProvider>
  );
}
