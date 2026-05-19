import {
  envErrorResponse,
  requireRequestUser,
} from "@/lib/supabase";
import { getUserLibrary } from "@/lib/papers";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireRequestUser(request);

  if (auth.response) {
    return auth.response;
  }

  const userId = auth.user.id;

  try {
    return Response.json(await getUserLibrary(userId));
  } catch (error) {
    if (error instanceof Error && error.message.includes("is required")) {
      return envErrorResponse(error);
    }

    const message =
      error instanceof Error ? error.message : "Failed to load papers";
    return Response.json({ error: message }, { status: 500 });
  }
}
