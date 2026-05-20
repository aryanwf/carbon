import type { SupabaseClient } from "@supabase/supabase-js";

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

const CHAT_SELECT = "id,paper_id,role,content,created_at";

let chatUserScoped: boolean | null = null;

function isMissingUserIdColumn(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    error.message?.includes("user_id") === true
  );
}

export async function chatMessagesAreUserScoped(
  supabase: SupabaseClient,
): Promise<boolean> {
  if (chatUserScoped !== null) return chatUserScoped;

  const { error } = await supabase
    .from("chat_messages")
    .select("user_id")
    .limit(0);

  chatUserScoped = !isMissingUserIdColumn(error);
  return chatUserScoped;
}

export async function listChatMessages(
  supabase: SupabaseClient,
  userId: string,
  paperId: string,
) {
  const userScoped = await chatMessagesAreUserScoped(supabase);
  let query = supabase
    .from("chat_messages")
    .select(CHAT_SELECT)
    .eq("paper_id", paperId)
    .order("created_at", { ascending: true });

  if (userScoped) {
    query = query.eq("user_id", userId);
  }

  return query;
}

export async function listChatHistory(
  supabase: SupabaseClient,
  userId: string,
  paperId: string,
  limit: number,
) {
  const userScoped = await chatMessagesAreUserScoped(supabase);
  let query = supabase
    .from("chat_messages")
    .select("role,content")
    .eq("paper_id", paperId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (userScoped) {
    query = query.eq("user_id", userId);
  }

  return query;
}

export async function insertChatMessage(
  supabase: SupabaseClient,
  message: ChatInsert,
) {
  const userScoped = await chatMessagesAreUserScoped(supabase);
  const row = userScoped
    ? message
    : {
        paper_id: message.paper_id,
        role: message.role,
        content: message.content,
      };

  return supabase.from("chat_messages").insert(row).select(CHAT_SELECT).single();
}
