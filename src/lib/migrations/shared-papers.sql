CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS papers (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  authors JSONB NOT NULL DEFAULT '[]'::jsonb,
  abstract TEXT,
  published TIMESTAMPTZ,
  source_url TEXT,
  pdf_url TEXT,
  categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  embedding VECTOR(1536),
  bs_score JSONB,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_papers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, paper_id)
);

CREATE TABLE IF NOT EXISTS paper_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_a TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  paper_b TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  strength REAL NOT NULL DEFAULT 0.5,
  relation_type TEXT NOT NULL DEFAULT 'similar',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(paper_a, paper_b),
  CHECK (paper_a <> paper_b)
);

CREATE INDEX IF NOT EXISTS user_papers_user_added_idx
  ON user_papers (user_id, added_at DESC);

CREATE INDEX IF NOT EXISTS user_papers_paper_idx
  ON user_papers (paper_id);

CREATE INDEX IF NOT EXISTS paper_connections_paper_a_idx
  ON paper_connections (paper_a);

CREATE INDEX IF NOT EXISTS paper_connections_paper_b_idx
  ON paper_connections (paper_b);
