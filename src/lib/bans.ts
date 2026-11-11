export type BanCheckUser = {
  id: string;
  email: string | null;
  username: string | null;
};

export type BannedUserRow = {
  user_id: string | null;
  email: string | null;
  username_pattern: string | null;
  reason: string | null;
};

const BAN_SELECT = "SELECT user_id, email, username_pattern, reason FROM banned_users";

/** Returns the ban reason ("" if none given) when the user is banned, otherwise null. */
export async function getBannedReason(
  db: D1Database,
  user: BanCheckUser,
): Promise<string | null> {
  const email = user.email?.toLowerCase() ?? null;

  const { results } = await db
    .prepare(
      `${BAN_SELECT}
       WHERE user_id = ?1
          OR (?2 IS NOT NULL AND LOWER(email) = ?2)
          OR username_pattern IS NOT NULL`,
    )
    .bind(user.id, email)
    .all<BannedUserRow>();

  return matchBannedReason(results, user);
}

/**
 * Candidate ban rows for the user behind a session token hash, so the ban
 * check can share a D1 batch (one round trip) with the session lookup.
 * Filter the rows with matchBannedReason.
 */
export function sessionBansStatement(db: D1Database, sessionIdHash: string) {
  return db
    .prepare(
      `${BAN_SELECT}
       WHERE user_id = (SELECT user_id FROM sessions WHERE id_hash = ?1)
          OR LOWER(email) = (
            SELECT LOWER(u.email)
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.id_hash = ?1
          )
          OR username_pattern IS NOT NULL`,
    )
    .bind(sessionIdHash);
}

export function matchBannedReason(
  rows: BannedUserRow[],
  user: BanCheckUser,
): string | null {
  const email = user.email?.toLowerCase() ?? null;
  const username = user.username?.toLowerCase() ?? null;

  for (const row of rows) {
    if (row.user_id === user.id) {
      return row.reason ?? "";
    }

    if (email && row.email?.toLowerCase() === email) {
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

/** Case-insensitive glob match: `*` = any run of chars, `?` = one char. */
export function wildcardMatches(pattern: string, value: string) {
  const escaped = pattern
    .trim()
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll("?", ".");

  return new RegExp(`^${escaped}$`).test(value.toLowerCase());
}
