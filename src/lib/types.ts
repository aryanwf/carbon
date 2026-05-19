export type Paper = {
  id: string;
  title: string;
  authors: string[];
  abstract: string | null;
  published: string | null;
  source_url: string | null;
  pdf_url: string | null;
  categories: string[];
  summary: string | null;
  added_at: string;
  read_at: string | null;
  is_read: boolean;
  notes: string;
  bs_score: BsScore | null;
  is_public?: boolean;
};

export type BsScore = {
  overall: number;
  overclaiming: number;
  rigor: number;
  novelty: number;
  credibility: number;
  reproducibility: number;
  interesting: number;
  interesting_why?: string;
  verdict: string;
};

export type PaperConnection = {
  id: string;
  paper_a: string;
  paper_b: string;
  strength: number;
  relation_type: string;
};

export type ChatMessage = {
  id: string;
  paper_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  bio: string;
  avatar_url: string | null;
  is_verified?: boolean;
  created_at: string;
  updated_at: string;
};

export type WorkspaceView = "graph" | "reader";
export type LibraryFilter = "all" | "read" | "unread";
export type SortKey = "added" | "published" | "legit" | "interesting";
