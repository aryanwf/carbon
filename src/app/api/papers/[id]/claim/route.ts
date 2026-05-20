import {
  envErrorResponse,
  requireRequestUser,
} from "@/lib/supabase";
import {
  getPaperCommunityState,
  setPaperClaim,
} from "@/lib/community";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRequestUser(request);
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const state = await getPaperCommunityState(
      auth.user,
      decodeURIComponent(id),
    );

    return Response.json({ state });
  } catch (error) {
    if (error instanceof Error && error.message.includes("is required")) {
      return envErrorResponse(error);
    }

    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load paper claims",
      },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return updateClaim(request, params, true);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return updateClaim(request, params, false);
}

async function updateClaim(
  request: Request,
  params: Promise<{ id: string }>,
  claimed: boolean,
) {
  const auth = await requireRequestUser(request);
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const state = await setPaperClaim(auth.user, decodeURIComponent(id), claimed);

    return Response.json({ state });
  } catch (error) {
    if (error instanceof Error && error.message.includes("is required")) {
      return envErrorResponse(error);
    }

    const message =
      error instanceof Error ? error.message : "Failed to update paper claim";

    return Response.json(
      { error: message },
      { status: message.includes("Verified") ? 403 : 500 },
    );
  }
}
