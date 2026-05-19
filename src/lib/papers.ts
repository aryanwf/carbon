import {
  getSupabaseAdmin,
  mapPaperConnectionRow,
  mergePaperRows,
  type PaperRow,
  type UserPaperRow,
} from "@/lib/supabase";
import type { Paper, PaperConnection } from "@/lib/types";

export type PapersResponse = {
  papers: Paper[];
  connections: PaperConnection[];
};

export async function getUserLibrary(userId: string): Promise<PapersResponse> {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: userPapers, error: userPapersError } = await supabaseAdmin
    .from("user_papers")
    .select("*")
    .eq("user_id", userId)
    .order("added_at", { ascending: false });

  if (userPapersError) {
    throw new Error(userPapersError.message);
  }

  const userPaperRows = (userPapers ?? []) as UserPaperRow[];
  const paperIds = userPaperRows.map((row) => row.paper_id);

  if (paperIds.length === 0) {
    return { papers: [], connections: [] };
  }

  const { data: papers, error: papersError } = await supabaseAdmin
    .from("papers")
    .select(
      "id,title,authors,abstract,published,source_url,pdf_url,categories",
    )
    .in("id", paperIds);

  if (papersError) {
    throw new Error(papersError.message);
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
    throw new Error(connectionsError.message);
  }

  return {
    papers: mergedPapers,
    connections: (connections ?? []).map(mapPaperConnectionRow),
  };
}
