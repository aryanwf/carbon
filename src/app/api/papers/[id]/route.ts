import {
  envErrorResponse,
  getSupabaseAdmin,
  requireRequestUser,
} from "@/lib/supabase";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRequestUser(request);

  if (auth.response) {
    return auth.response;
  }

  const userId = auth.user.id;
  let supabaseAdmin;

  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (error) {
    return envErrorResponse(error);
  }

  const { id } = await params;
  const paperId = decodeURIComponent(id);

  const { data: deletedUserPaper, error: deleteUserPaperError } =
    await supabaseAdmin
      .from("user_papers")
      .delete()
      .eq("user_id", userId)
      .eq("paper_id", paperId)
      .select("id")
      .maybeSingle();

  if (deleteUserPaperError) {
    return Response.json(
      { error: deleteUserPaperError.message },
      { status: 500 },
    );
  }

  if (!deletedUserPaper) {
    return Response.json({ error: "Paper not found" }, { status: 404 });
  }

  const { count, error: countError } = await supabaseAdmin
    .from("user_papers")
    .select("id", { count: "exact", head: true })
    .eq("paper_id", paperId);

  if (countError) {
    return Response.json({ error: countError.message }, { status: 500 });
  }

  if ((count ?? 0) > 0) {
    return Response.json({ deleted: true, purged: false });
  }

  const { error: deletePaperError } = await supabaseAdmin
    .from("papers")
    .delete()
    .eq("id", paperId);

  if (deletePaperError) {
    return Response.json({ error: deletePaperError.message }, { status: 500 });
  }

  return Response.json({ deleted: true, purged: true });
}
