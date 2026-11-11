import {
  matchBannedReason,
  sessionBansStatement,
  type BannedUserRow,
} from "@/lib/bans";
import { getCtx } from "@/lib/cloudflare";
import type { AuthenticatedRequestUser } from "@/lib/auth";
import { randomToken, sha256Hex } from "@/lib/auth/crypto";
import { SESSION_TTL_SECONDS } from "@/lib/auth/cookies";

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
/** Renew when less than this remains, i.e. at most about once per day. */
const RENEW_THRESHOLD_MS = SESSION_TTL_MS - DAY_MS;

type SessionRow = {
  user_id: string;
  expires_at: string;
  email: string | null;
  name: string | null;
  user_avatar_url: string | null;
  username: string | null;
  display_name: string | null;
  profile_avatar_url: string | null;
};

export type ValidatedSession = {
  user: AuthenticatedRequestUser;
  /** True when the session expiry was just extended (the cookie must be re-set). */
  renewed: boolean;
  /** Ban reason when `checkBan` was requested and the user is banned, else null. */
  bannedReason: string | null;
};

/** Plausible session token shape: 32 random bytes as base64url. */
function isTokenShape(token: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export async function createSession(
  db: D1Database,
  userId: string,
): Promise<string> {
  const token = randomToken(32);
  const idHash = await sha256Hex(token);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  await db.batch([
    // Opportunistic cleanup (indexed on expires_at); only runs on sign-in.
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(nowIso),
    db
      .prepare(
        `INSERT INTO sessions (id_hash, user_id, expires_at, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(idHash, userId, expiresAt, nowIso, nowIso),
  ]);

  return token;
}

export type ValidateSessionOptions = {
  /**
   * Extend the session expiry when it is due. Only pass true where the caller
   * can also re-set the cookie (route handlers, server actions); otherwise the
   * D1 expiry and the cookie Max-Age drift apart.
   */
  renew?: boolean;
  /** Also run the ban check, in the same D1 round trip as the lookup. */
  checkBan?: boolean;
};

export async function validateSession(
  db: D1Database,
  token: string | null | undefined,
  options: ValidateSessionOptions = {},
): Promise<ValidatedSession | null> {
  if (!token || !isTokenShape(token)) {
    return null;
  }

  const idHash = await sha256Hex(token);
  const now = new Date();
  const sessionStatement = db
    .prepare(
      `SELECT s.user_id, s.expires_at,
              u.email, u.name, u.avatar_url AS user_avatar_url,
              p.username, p.display_name, p.avatar_url AS profile_avatar_url
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN profiles p ON p.id = s.user_id
       WHERE s.id_hash = ? AND s.expires_at > ?`,
    )
    .bind(idHash, now.toISOString());

  let row: SessionRow | null;
  let banRows: BannedUserRow[] = [];

  if (options.checkBan) {
    const [sessionResult, banResult] = await db.batch([
      sessionStatement,
      sessionBansStatement(db, idHash),
    ]);
    row = (sessionResult.results[0] as SessionRow | undefined) ?? null;
    banRows = banResult.results as BannedUserRow[];
  } else {
    row = await sessionStatement.first<SessionRow>();
  }

  // The sign-in flow always creates the profile; a missing one means the
  // account is in a broken state, so force a fresh sign-in (which repairs it).
  if (!row || !row.username) {
    return null;
  }

  let renewed = false;

  if (
    options.renew &&
    Date.parse(row.expires_at) - now.getTime() < RENEW_THRESHOLD_MS
  ) {
    renewed = true;
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

    runInBackground(
      db
        .prepare(
          "UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id_hash = ?",
        )
        .bind(expiresAt, nowIso, idHash)
        .run(),
    );
  }

  const user: AuthenticatedRequestUser = {
    id: row.user_id,
    email: row.email,
    username: row.username,
    display_name:
      row.display_name ||
      row.name ||
      row.email?.split("@")[0] ||
      row.username,
    avatar_url: row.profile_avatar_url ?? row.user_avatar_url,
  };

  return {
    user,
    renewed,
    bannedReason: options.checkBan ? matchBannedReason(banRows, user) : null,
  };
}

export async function deleteSession(
  db: D1Database,
  token: string | null | undefined,
): Promise<void> {
  if (!token || !isTokenShape(token)) {
    return;
  }

  await db
    .prepare("DELETE FROM sessions WHERE id_hash = ?")
    .bind(await sha256Hex(token))
    .run();
}

function runInBackground(promise: Promise<unknown>) {
  const guarded = promise.catch((error) => {
    console.error("Session renewal failed", error);
  });

  try {
    getCtx().waitUntil(guarded);
  } catch {
    // No execution context (e.g. plain `next dev`): let it run unawaited.
  }
}
