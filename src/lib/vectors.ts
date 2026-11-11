import { getVectors } from "@/lib/cloudflare";

// Paper embeddings live in Vectorize (1536-dim, cosine). Vector ids are the
// paper id when it fits Vectorize's 64-byte limit, otherwise "sha256:<hex>";
// the paper id is also stored as metadata so hashed ids can be mapped back.
// Vectorize has no local simulation, so callers treat failures as "skip".

const MAX_VECTOR_ID_BYTES = 64;

export type PaperNeighbor = { paperId: string; score: number };

export async function vectorIdForPaper(paperId: string) {
  if (new TextEncoder().encode(paperId).byteLength <= MAX_VECTOR_ID_BYTES) {
    return paperId;
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(paperId),
  );
  const hex = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

  return `sha256:${hex.slice(0, 56)}`;
}

/** Returns false (and logs) when Vectorize is unavailable. */
export async function upsertPaperVector(paperId: string, values: number[]) {
  try {
    await getVectors().upsert([
      {
        id: await vectorIdForPaper(paperId),
        values,
        metadata: { paper_id: paperId },
      },
    ]);
    return true;
  } catch (error) {
    console.warn("Vectorize upsert failed; skipping:", error);
    return false;
  }
}

/** Nearest papers by cosine similarity (higher = more similar), excluding the paper itself. */
export async function queryPaperNeighbors(
  paperId: string,
  values: number[],
  topK: number,
): Promise<PaperNeighbor[]> {
  try {
    const selfId = await vectorIdForPaper(paperId);
    const { matches } = await getVectors().query(values, {
      topK: topK + 1,
      returnValues: false,
      returnMetadata: "all",
    });

    return matches
      .filter((match) => match.id !== selfId)
      .map((match) => ({
        paperId:
          typeof match.metadata?.paper_id === "string"
            ? match.metadata.paper_id
            : match.id,
        score: match.score,
      }))
      .filter((match) => match.paperId !== paperId)
      .slice(0, topK);
  } catch (error) {
    console.warn("Vectorize query failed; skipping connections:", error);
    return [];
  }
}

export async function deletePaperVector(paperId: string) {
  try {
    await getVectors().deleteByIds([await vectorIdForPaper(paperId)]);
  } catch (error) {
    console.warn("Vectorize delete failed:", error);
  }
}
