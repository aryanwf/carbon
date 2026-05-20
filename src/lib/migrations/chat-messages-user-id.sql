-- Run in Supabase SQL Editor if chat fails with "column chat_messages.user_id does not exist".
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
DELETE FROM chat_messages WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS chat_messages_user_paper_idx
  ON chat_messages (user_id, paper_id, created_at);

NOTIFY pgrst, 'reload schema';
