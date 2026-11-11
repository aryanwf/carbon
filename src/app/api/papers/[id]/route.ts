import { requireRequestUser } from "@/lib/auth";
import { getBucket, getDb } from "@/lib/cloudflare";
import { envErrorResponse, internalErrorResponse } from "@/lib/http";
import { pdfObjectKey, textObjectKey } from "@/lib/papers";
import { deletePaperVector } from "@/lib/vectors";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRequestUser(request);

  if (auth.response) {
    return auth.response;
  }

  const userId = auth.user.id;
  const { id } = await params;
  const paperId = decodeURIComponent(id);

  let db: D1Database;
  try {
    db = getDb();
  } catch (error) {
    return envErrorResponse(error);
  }

  let purged: boolean;

  try {
    const deleted = await db
      .prepare(
        "DELETE FROM user_papers WHERE user_id = ?1 AND paper_id = ?2 RETURNING id",
      )
      .bind(userId, paperId)
      .first<{ id: string }>();

    if (!deleted) {
      return Response.json({ error: "Paper not found" }, { status: 404 });
    }

    // Only a caller who actually removed a library row may purge the shared
    // paper, and only once no library references it anymore.
    const purgedRow = await db
      .prepare(
        `DELETE FROM papers
         WHERE id = ?1
           AND NOT EXISTS (SELECT 1 FROM user_papers WHERE paper_id = ?1)
         RETURNING id`,
      )
      .bind(paperId)
      .first<{ id: string }>();

    purged = purgedRow !== null;
  } catch (error) {
    return internalErrorResponse(error, "Failed to delete paper");
  }

  if (!purged) {
    return Response.json({ deleted: true, purged: false });
  }

  await Promise.all([
    getBucket()
      .delete([pdfObjectKey(paperId), textObjectKey(paperId)])
      .catch((error: unknown) => console.warn("R2 cleanup failed:", error)),
    deletePaperVector(paperId),
  ]);

  return Response.json({ deleted: true, purged: true });
}
