import { requireRequestUser } from "@/lib/auth";
import { envErrorResponse, internalErrorResponse } from "@/lib/http";
import { setFollow } from "@/lib/community";

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

    const message = error instanceof Error ? error.message : "";

    if (message === "Profile not found") {
      return Response.json({ error: message }, { status: 404 });
    }

    if (message === "Cannot follow yourself") {
      return Response.json({ error: message }, { status: 400 });
    }

    return internalErrorResponse(error, "Failed to update follow");
  }
}
