import { newId, nowIso } from "@/lib/cloudflare";
import type { AuthenticatedRequestUser } from "@/lib/auth";
import type { GoogleClaims } from "@/lib/auth/google";

const PROVIDER = "google";
const USERNAME_MAX = 32;
const DEFAULT_BIO = "";
const MAX_PROFILE_ATTEMPTS = 3;

type ExistingUserRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  profile_avatar_url: string | null;
};

/**
 * Lowercase, [a-z0-9_] only, collapsed/trimmed underscores, 3–32 chars.
 * Returns "" when nothing usable remains (caller falls back to another source).
 */
export function sanitizeUsername(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, USERNAME_MAX)
    .replace(/_+$/g, "");

  if (cleaned === "") {
    return "";
  }

  return cleaned.length >= 3 ? cleaned : `user_${cleaned}`;
}

export function baseUsername(input: {
  id: string;
  name: string | null;
  email: string | null;
}): string {
  const sources = [input.name, input.email?.split("@")[0] ?? null];

  for (const source of sources) {
    const sanitized = source ? sanitizeUsername(source) : "";

    if (sanitized) {
      return sanitized;
    }
  }

  return `user_${input.id.replaceAll("-", "").slice(0, 8)}`;
}

function withSuffix(base: string, suffix: string) {
  const head = base
    .slice(0, USERNAME_MAX - suffix.length - 1)
    .replace(/_+$/g, "");
  return `${head}_${suffix}`;
}

function randomDigits(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => String(byte % 10)).join("");
}

export function usernameCandidates(base: string, userId: string): string[] {
  const compactId = userId.replaceAll("-", "");

  return [
    base,
    withSuffix(base, compactId.slice(0, 6)),
    withSuffix(base, randomDigits(6)),
    `user_${compactId.slice(0, 12)}`,
  ];
}

async function pickAvailableUsername(
  db: D1Database,
  candidates: string[],
): Promise<string> {
  const { results } = await db
    .prepare(
      "SELECT username FROM profiles WHERE username IN (SELECT value FROM json_each(?))",
    )
    .bind(JSON.stringify(candidates))
    .all<{ username: string }>();
  const taken = new Set(results.map((row) => row.username));

  return (
    candidates.find((candidate) => !taken.has(candidate)) ??
    withSuffix(candidates[0], randomDigits(8))
  );
}

function isUniqueViolation(error: unknown, table?: string) {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed/i.test(error.message) &&
    (table === undefined || error.message.includes(`${table}.`))
  );
}

/**
 * Finds or creates the user for a Google identity, refreshes users.* from the
 * claims and guarantees a profiles row exists. Returns the resolved user.
 */
export async function upsertGoogleUser(
  db: D1Database,
  claims: GoogleClaims,
  lostAccountRace = false,
): Promise<AuthenticatedRequestUser> {
  const email = claims.email;
  const displayDefault = claims.name ?? email.split("@")[0] ?? null;

  const existing = await db
    .prepare(
      `SELECT u.id, p.username, p.display_name, p.avatar_url AS profile_avatar_url
       FROM oauth_accounts o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN profiles p ON p.id = u.id
       WHERE o.provider = ? AND o.provider_user_id = ?`,
    )
    .bind(PROVIDER, claims.sub)
    .first<ExistingUserRow>();

  const userId = existing?.id ?? newId();
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];

  if (existing) {
    statements.push(
      db
        .prepare(
          `UPDATE users
           SET email = ?, email_verified = 1, name = ?, avatar_url = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(email, claims.name, claims.picture, now, userId),
    );
  } else {
    statements.push(
      db
        .prepare(
          `INSERT INTO users (id, email, email_verified, name, avatar_url, created_at, updated_at)
           VALUES (?, ?, 1, ?, ?, ?, ?)`,
        )
        .bind(userId, email, claims.name, claims.picture, now, now),
    );
  }

  if (!existing) {
    // Plain INSERT: if a concurrent first sign-in already linked this Google
    // account, the whole batch (users + profiles rows) rolls back.
    statements.push(
      db
        .prepare(
          `INSERT INTO oauth_accounts (provider, provider_user_id, user_id, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(PROVIDER, claims.sub, userId, now),
    );
  }

  if (existing?.username) {
    // Fill in profile metadata only where the user has not set it.
    if (existing.display_name === null || existing.profile_avatar_url === null) {
      statements.push(
        db
          .prepare(
            `UPDATE profiles
             SET display_name = COALESCE(display_name, ?),
                 avatar_url = COALESCE(avatar_url, ?),
                 updated_at = ?
             WHERE id = ?`,
          )
          .bind(displayDefault, claims.picture, now, userId),
      );
    }

    await db.batch(statements);

    return {
      id: userId,
      email,
      username: existing.username,
      display_name: existing.display_name ?? displayDefault ?? existing.username,
      avatar_url: existing.profile_avatar_url ?? claims.picture,
    };
  }

  const base = baseUsername({ id: userId, name: claims.name, email });
  let candidates = usernameCandidates(base, userId);

  for (let attempt = 0; ; attempt++) {
    const username = await pickAvailableUsername(db, candidates);

    try {
      // D1 batches are transactional: a username race rolls back everything.
      await db.batch([
        ...statements,
        db
          .prepare(
            `INSERT INTO profiles (id, username, display_name, bio, avatar_url, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(userId, username, displayDefault, DEFAULT_BIO, claims.picture, now, now),
      ]);

      return {
        id: userId,
        email,
        username,
        display_name: displayDefault ?? username,
        avatar_url: claims.picture,
      };
    } catch (error) {
      if (!lostAccountRace && isUniqueViolation(error, "oauth_accounts")) {
        // Lost a concurrent first sign-in: use the account the winner created.
        return upsertGoogleUser(db, claims, true);
      }

      if (!isUniqueViolation(error) || attempt + 1 >= MAX_PROFILE_ATTEMPTS) {
        throw error;
      }

      candidates = [withSuffix(base, randomDigits(6)), withSuffix(base, randomDigits(8))];
    }
  }
}
