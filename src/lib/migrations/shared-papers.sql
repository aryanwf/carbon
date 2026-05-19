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

-- Existing DBs: CREATE TABLE IF NOT EXISTS does not add new columns.
ALTER TABLE papers ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE papers ADD COLUMN IF NOT EXISTS embedding VECTOR(1536);
ALTER TABLE papers ADD COLUMN IF NOT EXISTS bs_score JSONB;
ALTER TABLE papers ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE papers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE papers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

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

CREATE TABLE IF NOT EXISTS banned_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  username_pattern TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    user_id IS NOT NULL
    OR email IS NOT NULL
    OR username_pattern IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS user_papers_user_added_idx
  ON user_papers (user_id, added_at DESC);

CREATE INDEX IF NOT EXISTS user_papers_paper_idx
  ON user_papers (paper_id);

CREATE INDEX IF NOT EXISTS paper_connections_paper_a_idx
  ON paper_connections (paper_a);

CREATE INDEX IF NOT EXISTS paper_connections_paper_b_idx
  ON paper_connections (paper_b);

CREATE INDEX IF NOT EXISTS banned_users_user_idx
  ON banned_users (user_id);

CREATE INDEX IF NOT EXISTS banned_users_email_idx
  ON banned_users (LOWER(email));

CREATE INDEX IF NOT EXISTS papers_embedding_idx
  ON papers USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE banned_users ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION match_papers(
  query_embedding VECTOR(1536),
  exclude_id TEXT,
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    papers.id,
    1 - (papers.embedding <=> query_embedding) AS similarity
  FROM papers
  WHERE papers.embedding IS NOT NULL
    AND papers.id <> exclude_id
    AND 1 - (papers.embedding <=> query_embedding) > match_threshold
  ORDER BY papers.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
