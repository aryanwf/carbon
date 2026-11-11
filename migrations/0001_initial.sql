-- Carbon initial D1 schema.
-- Conventions:
--   * ids are TEXT; UUIDs are generated in app code with crypto.randomUUID().
--   * timestamps are ISO-8601 TEXT (UTC, millisecond precision).
--   * booleans are INTEGER 0/1.
--   * JSON values (authors, categories, bs_score) are TEXT containing JSON.
--   * paper embeddings live in the Vectorize index, not in D1.

-- Auth --------------------------------------------------------------------

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX users_email_idx ON users (LOWER(email));

CREATE TABLE oauth_accounts (
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (provider, provider_user_id)
);

CREATE INDEX oauth_accounts_user_idx ON oauth_accounts (user_id);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY, -- sha-256 hex of the random session token
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- Papers ------------------------------------------------------------------

CREATE TABLE papers (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  authors TEXT NOT NULL DEFAULT '[]',
  abstract TEXT,
  published TEXT,
  source_url TEXT,
  pdf_url TEXT,
  categories TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  bs_score TEXT,
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE user_papers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  read_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, paper_id)
);

CREATE INDEX user_papers_user_added_idx ON user_papers (user_id, added_at DESC);
CREATE INDEX user_papers_paper_idx ON user_papers (paper_id);
-- Global community feed (ordered by recency across all users).
CREATE INDEX user_papers_added_idx ON user_papers (added_at DESC);
CREATE INDEX user_papers_read_idx ON user_papers (read_at DESC);

CREATE TABLE paper_connections (
  id TEXT PRIMARY KEY,
  paper_a TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  paper_b TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  strength REAL NOT NULL DEFAULT 0.5,
  relation_type TEXT NOT NULL DEFAULT 'similar',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (paper_a, paper_b),
  CHECK (paper_a <> paper_b)
);

CREATE INDEX paper_connections_paper_a_idx ON paper_connections (paper_a);
CREATE INDEX paper_connections_paper_b_idx ON paper_connections (paper_b);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX chat_messages_user_paper_idx
  ON chat_messages (user_id, paper_id, created_at);

-- Moderation --------------------------------------------------------------

CREATE TABLE banned_users (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  username_pattern TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    user_id IS NOT NULL
    OR email IS NOT NULL
    OR username_pattern IS NOT NULL
  )
);

CREATE INDEX banned_users_user_idx ON banned_users (user_id);
CREATE INDEX banned_users_email_idx ON banned_users (LOWER(email));

-- Community ---------------------------------------------------------------

CREATE TABLE profiles (
  id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT,
  bio TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  is_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX profiles_username_idx ON profiles (LOWER(username));

CREATE TABLE follows (
  follower_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

CREATE INDEX follows_following_idx ON follows (following_id, created_at DESC);
CREATE INDEX follows_follower_idx ON follows (follower_id, created_at DESC);

CREATE TABLE paper_stars (
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, paper_id)
);

CREATE INDEX paper_stars_paper_idx ON paper_stars (paper_id, created_at DESC);
CREATE INDEX paper_stars_user_idx ON paper_stars (user_id, created_at DESC);

CREATE TABLE paper_claims (
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, paper_id)
);

CREATE INDEX paper_claims_paper_idx ON paper_claims (paper_id, created_at DESC);
CREATE INDEX paper_claims_user_idx ON paper_claims (user_id, created_at DESC);
