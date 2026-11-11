import { newId, nowIso } from "@/lib/cloudflare";

export type ChatMessageRow = {
  id: string;
  paper_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type ChatInsert = {
  user_id: string;
  paper_id: string;
  role: "user" | "assistant";
  content: string;
};

const CHAT_SELECT = "id, paper_id, role, content, created_at";

export function listChatMessagesStatement(
  db: D1Database,
  userId: string,
  paperId: string,
) {
  return db
    .prepare(
      `SELECT ${CHAT_SELECT} FROM chat_messages
       WHERE user_id = ?1 AND paper_id = ?2
       ORDER BY created_at ASC`,
    )
    .bind(userId, paperId);
}

export async function listChatMessages(
  db: D1Database,
  userId: string,
  paperId: string,
) {
  const { results } = await listChatMessagesStatement(db, userId, paperId).all<ChatMessageRow>();
  return results;
}

/** Most recent `limit` turns, newest first. */
export function listChatHistoryStatement(
  db: D1Database,
  userId: string,
  paperId: string,
  limit: number,
) {
  return db
    .prepare(
      `SELECT role, content FROM chat_messages
       WHERE user_id = ?1 AND paper_id = ?2
       ORDER BY created_at DESC
       LIMIT ?3`,
    )
    .bind(userId, paperId, limit);
}

export async function insertChatMessage(db: D1Database, message: ChatInsert) {
  const row = await db
    .prepare(
      `INSERT INTO chat_messages (id, user_id, paper_id, role, content, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       RETURNING ${CHAT_SELECT}`,
    )
    .bind(
      newId(),
      message.user_id,
      message.paper_id,
      message.role,
      message.content,
      nowIso(),
    )
    .first<ChatMessageRow>();

  if (!row) {
    throw new Error("Failed to save message");
  }

  return row;
}
