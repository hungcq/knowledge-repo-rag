ALTER TABLE sessions
    DROP COLUMN openai_conversation_id,
    ADD COLUMN summary TEXT NULL,
    ADD COLUMN summary_updated_at TIMESTAMPTZ NULL;
