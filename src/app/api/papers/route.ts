import {
  envErrorResponse,
  getSupabaseAdmin,
  mapPaperConnectionRow,
  mergePaperRows,
  requireRequestUser,
  type PaperRow,
  type UserPaperRow,
} from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(request: Request) {
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

  const { data: userPapers, error: userPapersError } = await supabaseAdmin
    .from("user_papers")
    .select("*")
    .eq("user_id", userId)
    .order("added_at", { ascending: false });

  if (userPapersError) {
    return Response.json({ error: userPapersError.message }, { status: 500 });
  }

  const userPaperRows = (userPapers ?? []) as UserPaperRow[];
  const paperIds = userPaperRows.map((row) => row.paper_id);

  if (paperIds.length === 0) {
    return Response.json({ papers: [], connections: [] });
  }

  const { data: papers, error: papersError } = await supabaseAdmin
    .from("papers")
    .select(
      "id,title,authors,abstract,published,source_url,pdf_url,categories,summary,bs_score,is_public,created_at,updated_at",
    )
    .in("id", paperIds);

  if (papersError) {
    return Response.json({ error: papersError.message }, { status: 500 });
  }

  const papersById = new Map(
    ((papers ?? []) as PaperRow[]).map((paper) => [paper.id, paper]),
  );
  const mergedPapers = userPaperRows.flatMap((userPaper) => {
    const paper = papersById.get(userPaper.paper_id);
    return paper ? [mergePaperRows(paper, userPaper)] : [];
  });

  const { data: connections, error: connectionsError } = await supabaseAdmin
    .from("paper_connections")
    .select("id,paper_a,paper_b,strength,relation_type")
    .in("paper_a", paperIds)
    .in("paper_b", paperIds);

  if (connectionsError) {
    return Response.json({ error: connectionsError.message }, { status: 500 });
  }

  return Response.json({
    papers: mergedPapers,
    connections: (connections ?? []).map(mapPaperConnectionRow),
  });
}
