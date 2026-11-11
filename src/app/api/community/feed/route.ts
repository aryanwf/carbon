import { requireRequestUser } from "@/lib/auth";
import { envErrorResponse, internalErrorResponse } from "@/lib/http";
import { getCommunityFeed } from "@/lib/community";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireRequestUser(request);
  if (auth.response) return auth.response;

  try {
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

    return internalErrorResponse(error, "Failed to load activity");
  }
}
