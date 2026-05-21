-- ============================================================
-- Migration 009: AI assistant — historia rozmów
-- ============================================================
-- Cele:
--   1. ai_conversations — wątki rozmów z asystentem (per użytkownik)
--   2. ai_messages — wiadomości; content przechowuje bloki treści w formacie
--      Anthropic (text / tool_use / tool_result), żeby pętlę tool-calling
--      dało się odtworzyć przy kolejnych turach.
--   3. RLS — użytkownik widzi wyłącznie własne rozmowy.
--
-- Tabele te są CELOWO poza GRANT-em roli ai_readonly (migracja 008) —
-- AI nie może odczytać cudzych rozmów własnym zapytaniem SQL.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user
  ON ai_conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                 -- 'user' | 'assistant'
  content JSONB NOT NULL,             -- tablica bloków treści Anthropic
  artifacts JSONB,                    -- zdenormalizowane wyniki do UI (wykresy/tabele)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
  ON ai_messages (conversation_id, created_at);

-- updated_at trigger (funkcja touch_updated_at() z migracji 003)
DROP TRIGGER IF EXISTS trg_ai_conversations_updated_at ON ai_conversations;
CREATE TRIGGER trg_ai_conversations_updated_at
  BEFORE UPDATE ON ai_conversations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============ RLS ============

ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;

-- ai_conversations: użytkownik zarządza wyłącznie własnymi wątkami
CREATE POLICY "Users manage own conversations" ON ai_conversations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access conversations" ON ai_conversations
  FOR ALL USING (auth.role() = 'service_role');

-- ai_messages: dostęp przez wątek-rodzica
CREATE POLICY "Users read own messages" ON ai_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM ai_conversations c
      WHERE c.id = ai_messages.conversation_id AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "Users insert own messages" ON ai_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_conversations c
      WHERE c.id = ai_messages.conversation_id AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role full access messages" ON ai_messages
  FOR ALL USING (auth.role() = 'service_role');
