import { getDb, jsonParse, toBool } from "@/lib/cloudflare";
import type { BsScore, Paper, PaperConnection } from "@/lib/types";

export type PapersResponse = {
  papers: Paper[];
  connections: PaperConnection[];
};

/** A `papers` row as stored in D1 (JSON columns are TEXT, booleans 0/1). */
export type PaperRow = {
  id: string;
  title: string;
  authors: string | null;
  abstract: string | null;
  published: string | null;
  source_url: string | null;
  pdf_url: string | null;
  categories: string | null;
  summary?: string | null;
  bs_score?: string | null;
  is_public?: number | boolean | null;
};

export type UserPaperRow = {
  id: string;
  user_id: string;
  paper_id: string;
  is_read: number | boolean;
  read_at: string | null;
  notes: string;
  added_at: string;
};

export type PaperConnectionRow = {
  id: string;
  paper_a: string;
  paper_b: string;
  strength: number;
  relation_type: string;
};

export const PAPER_COLUMNS =
  "id,title,authors,abstract,published,source_url,pdf_url,categories";

/** Row shape produced by LIBRARY_ROW_SELECT (user_papers joined with papers). */
export type LibraryJoinRow = Omit<PaperRow, "id"> & {
  paper_id: string;
  up_id: string;
  user_id: string;
  is_read: number;
  read_at: string | null;
  notes: string;
  added_at: string;
};

export const LIBRARY_ROW_SELECT = `SELECT up.id AS up_id, up.user_id, up.paper_id, up.is_read, up.read_at,
       up.notes, up.added_at, p.title, p.authors, p.abstract, p.published,
       p.source_url, p.pdf_url, p.categories
FROM user_papers up
JOIN papers p ON p.id = up.paper_id`;

export function libraryJoinRowToPaper(row: LibraryJoinRow): Paper {
  return mergePaperRows(
    {
      id: row.paper_id,
      title: row.title,
      authors: row.authors,
      abstract: row.abstract,
      published: row.published,
      source_url: row.source_url,
      pdf_url: row.pdf_url,
      categories: row.categories,
      summary: row.summary,
      bs_score: row.bs_score,
      is_public: row.is_public,
    },
    {
      id: row.up_id,
      user_id: row.user_id,
      paper_id: row.paper_id,
      is_read: row.is_read,
      read_at: row.read_at,
      notes: row.notes,
      added_at: row.added_at,
    },
  );
}

export async function getUserLibrary(userId: string): Promise<PapersResponse> {
  const db = getDb();

  const [papersResult, connectionsResult] = await db.batch([
    db
      .prepare(`${LIBRARY_ROW_SELECT} WHERE up.user_id = ?1 ORDER BY up.added_at DESC`)
      .bind(userId),
    db
      .prepare(
        `SELECT id, paper_a, paper_b, strength, relation_type
         FROM paper_connections
         WHERE paper_a IN (SELECT paper_id FROM user_papers WHERE user_id = ?1)
           AND paper_b IN (SELECT paper_id FROM user_papers WHERE user_id = ?1)`,
      )
      .bind(userId),
  ]);

  return {
    papers: (papersResult.results as LibraryJoinRow[]).map(libraryJoinRowToPaper),
    connections: (connectionsResult.results as PaperConnectionRow[]).map(
      mapPaperConnectionRow,
    ),
  };
}

export function mergePaperRows(paper: PaperRow, userPaper: UserPaperRow): Paper {
  return {
    id: paper.id,
    title: paper.title,
    authors: stringArray(paper.authors),
    abstract: paper.abstract,
    published: paper.published,
    source_url: paper.source_url,
    pdf_url: paper.pdf_url,
    categories: stringArray(paper.categories),
    summary: paper.summary ?? null,
    added_at: userPaper.added_at,
    read_at: userPaper.read_at,
    is_read: toBool(userPaper.is_read),
    notes: userPaper.notes,
    bs_score: parseBsScoreColumn(paper.bs_score),
    is_public: toBool(paper.is_public),
  };
}

export function mapPaperConnectionRow(row: PaperConnectionRow): PaperConnection {
  return {
    id: row.id,
    paper_a: row.paper_a,
    paper_b: row.paper_b,
    strength: row.strength,
    relation_type: row.relation_type,
  };
}

/** Parses a JSON TEXT column holding a string array. */
export function stringArray(value: string | null | undefined): string[] {
  const parsed = jsonParse<unknown>(value, []);
  return Array.isArray(parsed)
    ? parsed.filter((v): v is string => typeof v === "string")
    : [];
}

export function parseBsScoreColumn(value: string | null | undefined): BsScore | null {
  const parsed = jsonParse<unknown>(value, null);

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const score = parsed as Partial<BsScore>;

  if (
    typeof score.overall !== "number" ||
    typeof score.overclaiming !== "number" ||
    typeof score.rigor !== "number" ||
    typeof score.novelty !== "number" ||
    typeof score.credibility !== "number" ||
    typeof score.reproducibility !== "number" ||
    typeof score.interesting !== "number" ||
    typeof score.verdict !== "string"
  ) {
    return null;
  }

  return {
    overall: score.overall,
    overclaiming: score.overclaiming,
    rigor: score.rigor,
    novelty: score.novelty,
    credibility: score.credibility,
    reproducibility: score.reproducibility,
    interesting: score.interesting,
    interesting_why:
      typeof score.interesting_why === "string" ? score.interesting_why : undefined,
    verdict: score.verdict,
  };
}

/** R2 key for an uploaded (non-arXiv) paper PDF. */
export function pdfObjectKey(paperId: string) {
  return `pdfs/${sanitizeObjectId(paperId)}.pdf`;
}

/** R2 key for the cached extracted full text of a paper. */
export function textObjectKey(paperId: string) {
  return `text/${sanitizeObjectId(paperId)}.md`;
}

function sanitizeObjectId(paperId: string) {
  return paperId.replace(/[^a-zA-Z0-9._-]/g, "_");
}
