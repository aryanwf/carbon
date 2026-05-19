import { createClient } from "@supabase/supabase-js";
import type { BsScore, Paper, PaperConnection } from "@/lib/types";

export type PaperRow = {
  id: string;
  title: string;
  authors: unknown;
  abstract: string | null;
  published: string | null;
  source_url: string | null;
  pdf_url: string | null;
  categories: unknown;
  summary: string | null;
  bs_score: unknown;
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

export type UserPaperRow = {
  id: string;
  user_id: string;
  paper_id: string;
  is_read: boolean;
  read_at: string | null;
  notes: string;
  added_at: string;
};

type PaperConnectionRow = {
  id: string;
  paper_a: string;
  paper_b: string;
  strength: number;
  relation_type: string;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function requireEnv(name: string, value: string | undefined) {
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

export const supabaseAdmin = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY", supabaseServiceRoleKey),
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

const supabaseAuth = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl),
  requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", supabaseAnonKey),
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

export async function getRequestUserId(request: Request) {
  const header = request.headers.get("authorization");
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!token) {
    return null;
  }

  const { data, error } = await supabaseAuth.auth.getUser(token);

  if (error || !data.user) {
    return null;
  }

  return data.user.id;
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
    summary: paper.summary,
    added_at: userPaper.added_at,
    read_at: userPaper.read_at,
    is_read: userPaper.is_read,
    notes: userPaper.notes,
    bs_score: bsScore(paper.bs_score),
    is_public: paper.is_public,
  };
}

export function mapPaperConnectionRow(
  row: PaperConnectionRow,
): PaperConnection {
  return {
    id: row.id,
    paper_a: row.paper_a,
    paper_b: row.paper_b,
    strength: row.strength,
    relation_type: row.relation_type,
  };
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

function bsScore(value: unknown): BsScore | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const score = value as Partial<BsScore>;

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
      typeof score.interesting_why === "string"
        ? score.interesting_why
        : undefined,
    verdict: score.verdict,
  };
}
