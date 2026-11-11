import { requireRequestUser } from "@/lib/auth";
import {
  envErrorResponse,
  internalErrorResponse,
  isForeignKeyError,
} from "@/lib/http";
import {
  getPaperCommunityState,
  setPaperStar,
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

    return internalErrorResponse(error, "Failed to load paper stars");
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return updateStar(request, params, true);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return updateStar(request, params, false);
}

async function updateStar(
  request: Request,
  params: Promise<{ id: string }>,
  starred: boolean,
) {
  const auth = await requireRequestUser(request);
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const state = await setPaperStar(auth.user, decodeURIComponent(id), starred);

    return Response.json({ state });
  } catch (error) {
    if (error instanceof Error && error.message.includes("is required")) {
      return envErrorResponse(error);
    }

    if (isForeignKeyError(error)) {
      return Response.json({ error: "Paper not found" }, { status: 404 });
    }

    return internalErrorResponse(error, "Failed to update paper star");
  }
}
