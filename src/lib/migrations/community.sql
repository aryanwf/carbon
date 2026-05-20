CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT,
  bio TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (username ~ '^[a-z0-9_]{3,32}$')
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS follows (
  follower_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

ALTER TABLE follows ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS paper_stars (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, paper_id)
);

ALTER TABLE paper_stars ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS paper_claims (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, paper_id)
);

ALTER TABLE paper_claims ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS profiles_username_idx
  ON profiles (LOWER(username));

CREATE INDEX IF NOT EXISTS follows_following_idx
  ON follows (following_id, created_at DESC);

CREATE INDEX IF NOT EXISTS follows_follower_idx
  ON follows (follower_id, created_at DESC);

CREATE INDEX IF NOT EXISTS paper_stars_paper_idx
  ON paper_stars (paper_id, created_at DESC);

CREATE INDEX IF NOT EXISTS paper_stars_user_idx
  ON paper_stars (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS paper_claims_paper_idx
  ON paper_claims (paper_id, created_at DESC);

CREATE INDEX IF NOT EXISTS paper_claims_user_idx
  ON paper_claims (user_id, created_at DESC);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_stars ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles are public" ON profiles;
CREATE POLICY "profiles are public"
  ON profiles FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "users update own profile" ON profiles;
CREATE POLICY "users update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "follows are public" ON follows;
CREATE POLICY "follows are public"
  ON follows FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "users manage own follows" ON follows;
CREATE POLICY "users manage own follows"
  ON follows FOR ALL
  USING (auth.uid() = follower_id)
  WITH CHECK (auth.uid() = follower_id);

DROP POLICY IF EXISTS "paper stars are public" ON paper_stars;
CREATE POLICY "paper stars are public"
  ON paper_stars FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "users manage own stars" ON paper_stars;
CREATE POLICY "users manage own stars"
  ON paper_stars FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "paper claims are public" ON paper_claims;
CREATE POLICY "paper claims are public"
  ON paper_claims FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "verified users manage own claims" ON paper_claims;
CREATE POLICY "verified users manage own claims"
  ON paper_claims FOR ALL
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.is_verified = TRUE
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.is_verified = TRUE
    )
  );

NOTIFY pgrst, 'reload schema';
