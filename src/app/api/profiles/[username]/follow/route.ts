import {
  envErrorResponse,
  requireRequestUser,
} from "@/lib/supabase";
import { ensureUserProfile, setFollow } from "@/lib/community";

export const runtime = "nodejs";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  return updateFollow(request, params, true);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  return updateFollow(request, params, false);
}

async function updateFollow(
  request: Request,
  params: Promise<{ username: string }>,
  following: boolean,
) {
  const auth = await requireRequestUser(request);
  if (auth.response) return auth.response;

  try {
    await ensureUserProfile(auth.user);
    const { username } = await params;
    const profile = await setFollow(
      auth.user,
      decodeURIComponent(username),
      following,
    );

    return Response.json({ profile });
  } catch (error) {
    if (error instanceof Error && error.message.includes("is required")) {
      return envErrorResponse(error);
    }

    const message =
      error instanceof Error ? error.message : "Failed to update follow";
    const status =
      message === "Profile not found"
        ? 404
        : message === "Cannot follow yourself"
          ? 400
          : 500;

    return Response.json({ error: message }, { status });
  }
}
