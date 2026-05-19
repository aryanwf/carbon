import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
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
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabaseAdminClient: SupabaseClient | null = null;

function requireEnv(name: string, value: string | undefined) {
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

export function getSupabaseAdmin() {
  if (!supabaseAdminClient) {
    supabaseAdminClient = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY", supabaseServiceRoleKey),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }

  return supabaseAdminClient;
}

export function envErrorResponse(error: unknown) {
  if (error instanceof Error && error.message.includes("is required")) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  throw error;
}

const supabaseAuth = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl),
  requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", supabasePublishableKey),
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

export type AuthenticatedRequestUser = {
  id: string;
  email: string | null;
  username: string | null;
};

type AuthenticatedRequest =
  | { user: AuthenticatedRequestUser; response?: never }
  | { user?: never; response: Response };

export async function getRequestUserId(request: Request) {
  const user = await getRequestUser(request);

  return user?.id ?? null;
}

export async function requireRequestUser(
  request: Request,
): Promise<AuthenticatedRequest> {
  const user = await getRequestUser(request);

  if (!user) {
    return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  let bannedReason: string | null;

  try {
    bannedReason = await getBannedReason(user);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Authorization check failed";

    return {
      response: Response.json({ error: message }, { status: 500 }),
    };
  }

  if (bannedReason !== null) {
    return {
      response: Response.json(
        { error: "Account banned", reason: bannedReason },
        { status: 403 },
      ),
    };
  }

  return { user };
}

async function getRequestUser(
  request: Request,
): Promise<AuthenticatedRequestUser | null> {
  const header = request.headers.get("authorization");
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!token) {
    return null;
  }

  const { data, error } = await supabaseAuth.auth.getUser(token);

  if (error || !data.user) {
    return null;
  }

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    username: getUserName(data.user),
  };
}

type BannedUserRow = {
  user_id: string | null;
  email: string | null;
  username_pattern: string | null;
  reason: string | null;
};

async function getBannedReason(user: AuthenticatedRequestUser) {
  const { data, error } = await getSupabaseAdmin()
    .from("banned_users")
    .select("user_id,email,username_pattern,reason");

  if (error) {
    throw new Error(error.message);
  }

  const userEmail = user.email?.toLowerCase() ?? null;
  const username = user.username?.toLowerCase() ?? null;

  for (const row of (data ?? []) as BannedUserRow[]) {
    if (row.user_id === user.id) {
      return row.reason ?? "";
    }

    if (userEmail && row.email?.toLowerCase() === userEmail) {
      return row.reason ?? "";
    }

    if (
      username &&
      row.username_pattern &&
      wildcardMatches(row.username_pattern, username)
    ) {
      return row.reason ?? "";
    }
  }

  return null;
}

function getUserName(user: User) {
  const metadata = user.user_metadata;
  const username =
    typeof metadata.user_name === "string"
      ? metadata.user_name
      : typeof metadata.username === "string"
        ? metadata.username
        : typeof metadata.name === "string"
          ? metadata.name
          : null;

  return username;
}

function wildcardMatches(pattern: string, value: string) {
  const escaped = pattern
    .trim()
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll("?", ".");

  return new RegExp(`^${escaped}$`).test(value);
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
