import {
  envErrorResponse,
  requireRequestUser,
} from "@/lib/supabase";
import { ensureUserProfile, getCommunityFeed } from "@/lib/community";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireRequestUser(request);
  if (auth.response) return auth.response;

  try {
    await ensureUserProfile(auth.user);
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope");
    const activities = await getCommunityFeed({
      viewerId: auth.user.id,
      followingOnly: scope === "following",
      limit: 50,
    });

    return Response.json({ activities });
  } catch (error) {
    if (error instanceof Error && error.message.includes("is required")) {
      return envErrorResponse(error);
    }

    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load activity",
      },
      { status: 500 },
    );
  }
}
