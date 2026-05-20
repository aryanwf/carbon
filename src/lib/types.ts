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
  star_count?: number;
  claimed_by_count?: number;
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

export type ProfileWithStats = Profile & {
  followers_count: number;
  following_count: number;
  papers_count: number;
  stars_count: number;
  claims_count: number;
  is_following?: boolean;
};

export type CommunityActivityType =
  | "paper_added"
  | "paper_read"
  | "paper_starred"
  | "paper_claimed";

export type CommunityPaper = {
  id: string;
  title: string;
  authors: string[];
  source_url: string | null;
  pdf_url: string | null;
};

export type CommunityActivity = {
  id: string;
  type: CommunityActivityType;
  created_at: string;
  profile: Profile;
  paper: CommunityPaper;
};

export type PaperCommunityState = {
  paper_id: string;
  star_count: number;
  claim_count: number;
  starred: boolean;
  claimed: boolean;
  can_claim: boolean;
};

export type WorkspaceView = "community" | "graph" | "reader";
export type SortKey = "added" | "published" | "legit" | "interesting";
