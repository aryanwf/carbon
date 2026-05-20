import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin, type AuthenticatedRequestUser } from "@/lib/supabase";
import type {
  CommunityActivity,
  CommunityActivityType,
  CommunityPaper,
  PaperCommunityState,
  Profile,
  ProfileWithStats,
} from "@/lib/types";

type ProfileRow = Profile;

type UserPaperActivityRow = {
  id: string;
  user_id: string;
  paper_id: string;
  is_read: boolean;
  read_at: string | null;
  added_at: string;
};

type PaperActionRow = {
  user_id: string;
  paper_id: string;
  created_at: string;
};

type ActivitySeed = {
  id: string;
  type: CommunityActivityType;
  user_id: string;
  paper_id: string;
  created_at: string;
};

const DEFAULT_BIO = "";

export async function ensureUserProfile(user: AuthenticatedRequestUser) {
  const supabase = getSupabaseAdmin();
  const existing = await getProfileById(user.id, supabase);

  if (existing) {
    await syncProfileMetadata(supabase, existing, user);
    return existing;
  }

  const username = await availableUsername(supabase, user);
  const { data, error } = await supabase
    .from("profiles")
    .insert({
      id: user.id,
      username,
      display_name: user.display_name,
      bio: DEFAULT_BIO,
      avatar_url: user.avatar_url,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Profile;
}

export async function getProfileByUsername(
  username: string,
  viewerId?: string | null,
) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username.toLowerCase())
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }

  return addProfileStats(supabase, data as Profile, viewerId);
}

export async function getCommunityFeed(options: {
  viewerId?: string | null;
  profileId?: string | null;
  followingOnly?: boolean;
  limit?: number;
}) {
  const supabase = getSupabaseAdmin();
  let actorIds: string[] | null = options.profileId ? [options.profileId] : null;

  if (options.followingOnly && options.viewerId) {
    const { data, error } = await supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", options.viewerId);

    if (error) {
      throw new Error(error.message);
    }

    actorIds = [
      options.viewerId,
      ...((data ?? []) as { following_id: string }[]).map(
        (row) => row.following_id,
      ),
    ];
  }

  const [userPapers, stars, claims] = await Promise.all([
    selectActivityRows<UserPaperActivityRow>(
      supabase,
      "user_papers",
      "added_at",
      actorIds,
    ),
    selectActivityRows<PaperActionRow>(
      supabase,
      "paper_stars",
      "created_at",
      actorIds,
    ),
    selectActivityRows<PaperActionRow>(
      supabase,
      "paper_claims",
      "created_at",
      actorIds,
    ),
  ]);

  const seeds: ActivitySeed[] = [];

  for (const row of userPapers) {
    seeds.push({
      id: `add:${row.id}`,
      type: "paper_added",
      user_id: row.user_id,
      paper_id: row.paper_id,
      created_at: row.added_at,
    });
    if (row.is_read && row.read_at) {
      seeds.push({
        id: `read:${row.id}`,
        type: "paper_read",
        user_id: row.user_id,
        paper_id: row.paper_id,
        created_at: row.read_at,
      });
    }
  }

  for (const row of stars) {
    seeds.push({
      id: `star:${row.user_id}:${row.paper_id}`,
      type: "paper_starred",
      user_id: row.user_id,
      paper_id: row.paper_id,
      created_at: row.created_at,
    });
  }

  for (const row of claims) {
    seeds.push({
      id: `claim:${row.user_id}:${row.paper_id}`,
      type: "paper_claimed",
      user_id: row.user_id,
      paper_id: row.paper_id,
      created_at: row.created_at,
    });
  }

  seeds.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  return hydrateActivity(supabase, seeds.slice(0, options.limit ?? 50));
}

export async function getPaperCommunityState(
  user: AuthenticatedRequestUser,
  paperId: string,
): Promise<PaperCommunityState> {
  const supabase = getSupabaseAdmin();
  const profile = await ensureUserProfile(user);
  const [stars, claims, starred, claimed] = await Promise.all([
    countRows(supabase, "paper_stars", "paper_id", paperId),
    countRows(supabase, "paper_claims", "paper_id", paperId),
    hasPaperAction(supabase, "paper_stars", profile.id, paperId),
    hasPaperAction(supabase, "paper_claims", profile.id, paperId),
  ]);

  return {
    paper_id: paperId,
    star_count: stars,
    claim_count: claims,
    starred,
    claimed,
    can_claim: profile.is_verified ?? false,
  };
}

export async function setPaperStar(
  user: AuthenticatedRequestUser,
  paperId: string,
  starred: boolean,
) {
  const supabase = getSupabaseAdmin();
  const profile = await ensureUserProfile(user);

  if (starred) {
    const { error } = await supabase
      .from("paper_stars")
      .upsert({ user_id: profile.id, paper_id: paperId });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("paper_stars")
      .delete()
      .eq("user_id", profile.id)
      .eq("paper_id", paperId);
    if (error) throw new Error(error.message);
  }

  return getPaperCommunityState(user, paperId);
}

export async function setPaperClaim(
  user: AuthenticatedRequestUser,
  paperId: string,
  claimed: boolean,
) {
  const supabase = getSupabaseAdmin();
  const profile = await ensureUserProfile(user);

  if (!(profile.is_verified ?? false)) {
    throw new Error("Verified profile required to claim papers");
  }

  if (claimed) {
    const { error } = await supabase
      .from("paper_claims")
      .upsert({ user_id: profile.id, paper_id: paperId });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("paper_claims")
      .delete()
      .eq("user_id", profile.id)
      .eq("paper_id", paperId);
    if (error) throw new Error(error.message);
  }

  return getPaperCommunityState(user, paperId);
}

export async function setFollow(
  user: AuthenticatedRequestUser,
  username: string,
  following: boolean,
) {
  const supabase = getSupabaseAdmin();
  const profile = await ensureUserProfile(user);
  const target = await getProfileByUsername(username, profile.id);

  if (!target) {
    throw new Error("Profile not found");
  }
  if (target.id === profile.id) {
    throw new Error("Cannot follow yourself");
  }

  if (following) {
    const { error } = await supabase
      .from("follows")
      .upsert({ follower_id: profile.id, following_id: target.id });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("follows")
      .delete()
      .eq("follower_id", profile.id)
      .eq("following_id", target.id);
    if (error) throw new Error(error.message);
  }

  return getProfileByUsername(username, profile.id);
}

async function getProfileById(userId: string, supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as Profile | null) ?? null;
}

async function syncProfileMetadata(
  supabase: SupabaseClient,
  profile: Profile,
  user: AuthenticatedRequestUser,
) {
  if (
    profile.display_name === user.display_name &&
    profile.avatar_url === user.avatar_url
  ) {
    return;
  }

  await supabase
    .from("profiles")
    .update({
      display_name: profile.display_name ?? user.display_name,
      avatar_url: profile.avatar_url ?? user.avatar_url,
      updated_at: new Date().toISOString(),
    })
    .eq("id", profile.id);
}

async function availableUsername(
  supabase: SupabaseClient,
  user: AuthenticatedRequestUser,
) {
  const base = sanitizeUsername(
    user.username ?? user.email?.split("@")[0] ?? `user_${user.id.slice(0, 8)}`,
  );
  const candidates = [base, `${base}_${user.id.slice(0, 6)}`];

  for (const candidate of candidates) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", candidate)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }
    if (!data) {
      return candidate;
    }
  }

  return `user_${user.id.replaceAll("-", "").slice(0, 12)}`;
}

function sanitizeUsername(value: string) {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);

  return cleaned.length >= 3 ? cleaned : `user_${cleaned}`;
}

async function addProfileStats(
  supabase: SupabaseClient,
  profile: Profile,
  viewerId?: string | null,
): Promise<ProfileWithStats> {
  const [
    followers_count,
    following_count,
    papers_count,
    stars_count,
    claims_count,
    is_following,
  ] = await Promise.all([
    countRows(supabase, "follows", "following_id", profile.id),
    countRows(supabase, "follows", "follower_id", profile.id),
    countRows(supabase, "user_papers", "user_id", profile.id),
    countRows(supabase, "paper_stars", "user_id", profile.id),
    countRows(supabase, "paper_claims", "user_id", profile.id),
    viewerId ? hasFollow(supabase, viewerId, profile.id) : Promise.resolve(false),
  ]);

  return {
    ...profile,
    followers_count,
    following_count,
    papers_count,
    stars_count,
    claims_count,
    is_following,
  };
}

async function countRows(
  supabase: SupabaseClient,
  table: string,
  column: string,
  value: string,
) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, value);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

async function hasFollow(
  supabase: SupabaseClient,
  followerId: string,
  followingId: string,
) {
  const { data, error } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("follower_id", followerId)
    .eq("following_id", followingId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}

async function hasPaperAction(
  supabase: SupabaseClient,
  table: "paper_stars" | "paper_claims",
  userId: string,
  paperId: string,
) {
  const { data, error } = await supabase
    .from(table)
    .select("user_id")
    .eq("user_id", userId)
    .eq("paper_id", paperId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}

async function selectActivityRows<T>(
  supabase: SupabaseClient,
  table: string,
  orderColumn: string,
  actorIds: string[] | null,
) {
  let query = supabase.from(table).select("*").order(orderColumn, {
    ascending: false,
  });

  if (actorIds) {
    query = query.in("user_id", actorIds);
  }

  const { data, error } = await query.limit(80);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as T[];
}

async function hydrateActivity(
  supabase: SupabaseClient,
  seeds: ActivitySeed[],
): Promise<CommunityActivity[]> {
  const userIds = Array.from(new Set(seeds.map((seed) => seed.user_id)));
  const paperIds = Array.from(new Set(seeds.map((seed) => seed.paper_id)));

  if (userIds.length === 0 || paperIds.length === 0) {
    return [];
  }

  const [profilesResult, papersResult] = await Promise.all([
    supabase.from("profiles").select("*").in("id", userIds),
    supabase
      .from("papers")
      .select("id,title,authors,source_url,pdf_url")
      .in("id", paperIds),
  ]);

  if (profilesResult.error) {
    throw new Error(profilesResult.error.message);
  }
  if (papersResult.error) {
    throw new Error(papersResult.error.message);
  }

  const profiles = new Map(
    ((profilesResult.data ?? []) as Profile[]).map((profile) => [
      profile.id,
      profile,
    ]),
  );
  const papers = new Map(
    ((papersResult.data ?? []) as (CommunityPaper & { authors: unknown })[]).map(
      (paper) => [
        paper.id,
        {
          ...paper,
          authors: Array.isArray(paper.authors)
            ? paper.authors.filter((author): author is string => typeof author === "string")
            : [],
        },
      ],
    ),
  );

  return seeds.flatMap((seed) => {
    const profile = profiles.get(seed.user_id);
    const paper = papers.get(seed.paper_id);

    return profile && paper
      ? [{ id: seed.id, type: seed.type, created_at: seed.created_at, profile, paper }]
      : [];
  });
}
