import type { AuthenticatedRequestUser } from "@/lib/auth";
import { getDb, jsonList, nowIso, toBool } from "@/lib/cloudflare";
import { stringArray } from "@/lib/papers";
import type {
  CommunityActivity,
  CommunityActivityType,
  PaperCommunityState,
  Profile,
  ProfileWithStats,
} from "@/lib/types";

// Profiles are created by the auth layer at sign-in, so profiles.id === user.id
// for every authenticated user.

type ProfileRow = Omit<Profile, "is_verified"> & { is_verified: number };

type ProfileStatsRow = ProfileRow & {
  followers_count: number;
  following_count: number;
  papers_count: number;
  papers_read_count: number;
  public_items_count: number;
  stars_count: number;
  stars_received_count: number;
  claims_count: number;
  is_following: number;
};

type ActivityRow = {
  id: string;
  type: CommunityActivityType;
  created_at: string;
  profile_id: string;
  username: string;
  display_name: string | null;
  bio: string;
  avatar_url: string | null;
  is_verified: number;
  profile_created_at: string;
  profile_updated_at: string;
  paper_id: string;
  title: string;
  authors: string | null;
  source_url: string | null;
  pdf_url: string | null;
};

type CommunityStateRow = {
  star_count: number;
  claim_count: number;
  starred: number;
  claimed: number;
  is_verified: number | null;
};

const ACTIVITY_SOURCE_LIMIT = 80;

const PROFILE_STATS_SELECT = `SELECT p.id, p.username, p.display_name, p.bio, p.avatar_url,
       p.is_verified, p.created_at, p.updated_at,
       (SELECT COUNT(*) FROM follows WHERE following_id = p.id) AS followers_count,
       (SELECT COUNT(*) FROM follows WHERE follower_id = p.id) AS following_count,
       (SELECT COUNT(*) FROM user_papers WHERE user_id = p.id) AS papers_count,
       (SELECT COUNT(*) FROM user_papers WHERE user_id = p.id AND is_read = 1) AS papers_read_count,
       (SELECT COUNT(*) FROM user_papers up JOIN papers pa ON pa.id = up.paper_id
         WHERE up.user_id = p.id AND pa.is_public = 1) AS public_items_count,
       (SELECT COUNT(*) FROM paper_stars WHERE user_id = p.id) AS stars_count,
       (SELECT COUNT(*) FROM paper_claims c JOIN paper_stars s ON s.paper_id = c.paper_id
         WHERE c.user_id = p.id) AS stars_received_count,
       (SELECT COUNT(*) FROM paper_claims WHERE user_id = p.id) AS claims_count,
       EXISTS (SELECT 1 FROM follows WHERE follower_id = ?2 AND following_id = p.id) AS is_following
FROM profiles p
WHERE LOWER(p.username) = LOWER(?1)`;

const COMMUNITY_STATE_SELECT = `SELECT
  (SELECT COUNT(*) FROM paper_stars WHERE paper_id = ?1) AS star_count,
  (SELECT COUNT(*) FROM paper_claims WHERE paper_id = ?1) AS claim_count,
  EXISTS (SELECT 1 FROM paper_stars WHERE paper_id = ?1 AND user_id = ?2) AS starred,
  EXISTS (SELECT 1 FROM paper_claims WHERE paper_id = ?1 AND user_id = ?2) AS claimed,
  (SELECT is_verified FROM profiles WHERE id = ?2) AS is_verified`;

// Each source is limited before merging (like the previous implementation) so
// the sort only touches a bounded number of rows. ?3 = 1 restricts actors to
// the ids in the JSON list ?1 plus everyone followed by ?2.
const COMMUNITY_FEED_SELECT = `WITH actors(user_id) AS (
  SELECT value FROM json_each(?1)
  UNION
  SELECT following_id FROM follows WHERE follower_id = ?2
),
events AS (
  SELECT * FROM (
    SELECT 'add:' || id AS id, 'paper_added' AS type, user_id, paper_id, added_at AS created_at
    FROM user_papers
    WHERE ?3 = 0 OR user_id IN (SELECT user_id FROM actors)
    ORDER BY added_at DESC LIMIT ${ACTIVITY_SOURCE_LIMIT}
  )
  UNION ALL
  SELECT * FROM (
    SELECT 'read:' || id, 'paper_read', user_id, paper_id, read_at
    FROM user_papers
    WHERE is_read = 1 AND read_at IS NOT NULL
      AND (?3 = 0 OR user_id IN (SELECT user_id FROM actors))
    ORDER BY read_at DESC LIMIT ${ACTIVITY_SOURCE_LIMIT}
  )
  UNION ALL
  SELECT * FROM (
    SELECT 'star:' || user_id || ':' || paper_id, 'paper_starred', user_id, paper_id, created_at
    FROM paper_stars
    WHERE ?3 = 0 OR user_id IN (SELECT user_id FROM actors)
    ORDER BY created_at DESC LIMIT ${ACTIVITY_SOURCE_LIMIT}
  )
  UNION ALL
  SELECT * FROM (
    SELECT 'claim:' || user_id || ':' || paper_id, 'paper_claimed', user_id, paper_id, created_at
    FROM paper_claims
    WHERE ?3 = 0 OR user_id IN (SELECT user_id FROM actors)
    ORDER BY created_at DESC LIMIT ${ACTIVITY_SOURCE_LIMIT}
  )
)
SELECT e.id, e.type, e.created_at,
       pr.id AS profile_id, pr.username, pr.display_name, pr.bio, pr.avatar_url,
       pr.is_verified, pr.created_at AS profile_created_at, pr.updated_at AS profile_updated_at,
       pa.id AS paper_id, pa.title, pa.authors, pa.source_url, pa.pdf_url
FROM events e
JOIN profiles pr ON pr.id = e.user_id
JOIN papers pa ON pa.id = e.paper_id
ORDER BY e.created_at DESC
LIMIT ?4`;

export async function updateProfileDetails(
  userId: string,
  details: {
    display_name: string | null;
    bio: string;
    avatar_url: string | null;
  },
) {
  await getDb()
    .prepare(
      `UPDATE profiles
       SET display_name = ?1, bio = ?2, avatar_url = ?3, updated_at = ?4
       WHERE id = ?5`,
    )
    .bind(details.display_name, details.bio, details.avatar_url, nowIso(), userId)
    .run();
}

export async function getProfileByUsername(
  username: string,
  viewerId?: string | null,
): Promise<ProfileWithStats | null> {
  const row = await profileStatsStatement(getDb(), username, viewerId).first<ProfileStatsRow>();
  return row ? mapProfileStats(row) : null;
}

export async function getCommunityFeed(options: {
  viewerId?: string | null;
  profileId?: string | null;
  followingOnly?: boolean;
  limit?: number;
}): Promise<CommunityActivity[]> {
  let actorIds: string[] = [];
  let followerId: string | null = null;
  let filtered = false;

  if (options.profileId) {
    actorIds = [options.profileId];
    filtered = true;
  }

  if (options.followingOnly && options.viewerId) {
    actorIds = [options.viewerId];
    followerId = options.viewerId;
    filtered = true;
  }

  const { results } = await getDb()
    .prepare(COMMUNITY_FEED_SELECT)
    .bind(jsonList(actorIds), followerId, filtered ? 1 : 0, options.limit ?? 50)
    .all<ActivityRow>();

  return results.map((row) => ({
    id: row.id,
    type: row.type,
    created_at: row.created_at,
    profile: mapProfile({
      id: row.profile_id,
      username: row.username,
      display_name: row.display_name,
      bio: row.bio,
      avatar_url: row.avatar_url,
      is_verified: row.is_verified,
      created_at: row.profile_created_at,
      updated_at: row.profile_updated_at,
    }),
    paper: {
      id: row.paper_id,
      title: row.title,
      authors: stringArray(row.authors),
      source_url: row.source_url,
      pdf_url: row.pdf_url,
    },
  }));
}

export async function getPaperCommunityState(
  user: AuthenticatedRequestUser,
  paperId: string,
): Promise<PaperCommunityState> {
  const row = await communityStateStatement(getDb(), user.id, paperId).first<CommunityStateRow>();
  return mapCommunityState(paperId, row);
}

export async function setPaperStar(
  user: AuthenticatedRequestUser,
  paperId: string,
  starred: boolean,
) {
  const db = getDb();
  const write = starred
    ? db
        .prepare(
          `INSERT INTO paper_stars (user_id, paper_id, created_at) VALUES (?1, ?2, ?3)
           ON CONFLICT (user_id, paper_id) DO NOTHING`,
        )
        .bind(user.id, paperId, nowIso())
    : db
        .prepare("DELETE FROM paper_stars WHERE user_id = ?1 AND paper_id = ?2")
        .bind(user.id, paperId);

  const [, stateResult] = await db.batch([
    write,
    communityStateStatement(db, user.id, paperId),
  ]);

  return mapCommunityState(paperId, stateResult.results[0] as CommunityStateRow | undefined);
}

export async function setPaperClaim(
  user: AuthenticatedRequestUser,
  paperId: string,
  claimed: boolean,
) {
  const db = getDb();
  // Writes are conditional on the profile being verified; the state read in the
  // same batch tells us whether that was the case.
  const write = claimed
    ? db
        .prepare(
          `INSERT INTO paper_claims (user_id, paper_id, created_at)
           SELECT ?1, ?2, ?3
           WHERE EXISTS (SELECT 1 FROM profiles WHERE id = ?1 AND is_verified = 1)
           ON CONFLICT (user_id, paper_id) DO NOTHING`,
        )
        .bind(user.id, paperId, nowIso())
    : db
        .prepare(
          `DELETE FROM paper_claims
           WHERE user_id = ?1 AND paper_id = ?2
             AND EXISTS (SELECT 1 FROM profiles WHERE id = ?1 AND is_verified = 1)`,
        )
        .bind(user.id, paperId);

  const [, stateResult] = await db.batch([
    write,
    communityStateStatement(db, user.id, paperId),
  ]);
  const state = mapCommunityState(
    paperId,
    stateResult.results[0] as CommunityStateRow | undefined,
  );

  if (!state.can_claim) {
    throw new Error("Verified profile required to claim papers");
  }

  return state;
}

export async function setFollow(
  user: AuthenticatedRequestUser,
  username: string,
  following: boolean,
) {
  const db = getDb();
  const target = await db
    .prepare("SELECT id FROM profiles WHERE LOWER(username) = LOWER(?1)")
    .bind(username)
    .first<{ id: string }>();

  if (!target) {
    throw new Error("Profile not found");
  }
  if (target.id === user.id) {
    throw new Error("Cannot follow yourself");
  }

  const write = following
    ? db
        .prepare(
          `INSERT INTO follows (follower_id, following_id, created_at) VALUES (?1, ?2, ?3)
           ON CONFLICT (follower_id, following_id) DO NOTHING`,
        )
        .bind(user.id, target.id, nowIso())
    : db
        .prepare("DELETE FROM follows WHERE follower_id = ?1 AND following_id = ?2")
        .bind(user.id, target.id);

  const [, profileResult] = await db.batch([
    write,
    profileStatsStatement(db, username, user.id),
  ]);
  const row = profileResult.results[0] as ProfileStatsRow | undefined;

  return row ? mapProfileStats(row) : null;
}

function profileStatsStatement(
  db: D1Database,
  username: string,
  viewerId?: string | null,
) {
  return db.prepare(PROFILE_STATS_SELECT).bind(username, viewerId ?? null);
}

function communityStateStatement(db: D1Database, userId: string, paperId: string) {
  return db.prepare(COMMUNITY_STATE_SELECT).bind(paperId, userId);
}

function mapCommunityState(
  paperId: string,
  row: CommunityStateRow | null | undefined,
): PaperCommunityState {
  return {
    paper_id: paperId,
    star_count: row?.star_count ?? 0,
    claim_count: row?.claim_count ?? 0,
    starred: toBool(row?.starred),
    claimed: toBool(row?.claimed),
    can_claim: toBool(row?.is_verified),
  };
}

function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    bio: row.bio,
    avatar_url: row.avatar_url,
    is_verified: toBool(row.is_verified),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapProfileStats(row: ProfileStatsRow): ProfileWithStats {
  return {
    ...mapProfile(row),
    followers_count: row.followers_count,
    following_count: row.following_count,
    papers_count: row.papers_count,
    papers_read_count: row.papers_read_count,
    public_items_count: row.public_items_count,
    stars_count: row.stars_count,
    stars_received_count: row.stars_received_count,
    claims_count: row.claims_count,
    published_works_count: row.claims_count,
    is_following: toBool(row.is_following),
  };
}
