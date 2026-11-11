import { requireRequestUser } from "@/lib/auth";
import {
  envErrorResponse,
  internalErrorResponse,
  isForeignKeyError,
} from "@/lib/http";
import {
  getPaperCommunityState,
  setPaperClaim,
} from "@/lib/community";

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

    return internalErrorResponse(error, "Failed to load paper claims");
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

    if (error instanceof Error && error.message.includes("Verified")) {
      return Response.json({ error: error.message }, { status: 403 });
    }

    if (isForeignKeyError(error)) {
      return Response.json({ error: "Paper not found" }, { status: 404 });
    }

    return internalErrorResponse(error, "Failed to update paper claim");
  }
}
