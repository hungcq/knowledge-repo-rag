-- sessions shown in sidebar/history
CREATE TABLE sessions (
                          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                          user_id TEXT NOT NULL,
                          title TEXT NOT NULL,
                          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                          archived_at TIMESTAMPTZ,
                          meta JSONB NOT NULL DEFAULT '{}'
);

-- ordered messages for viewing
CREATE TABLE messages (
                          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                          session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                          role TEXT NOT NULL CHECK (role IN ('system','user','assistant','tool')),
                          content TEXT NOT NULL,              -- plain text or compact markdown
                          tokens INT,                         -- optional, for cost stats
                          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                          idx BIGINT GENERATED ALWAYS AS IDENTITY, -- monotonic for pagination
                          meta JSONB NOT NULL DEFAULT '{}'    -- tool call ids, function args, etc.
);

-- for quick list rendering/search
CREATE TABLE session_summaries (
                                   session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
                                   short_title TEXT NOT NULL,          -- e.g., "Fire exit rules Q&A"
                                   short_summary TEXT,                 -- 1–2 lines
                                   updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON messages(session_id, idx);
CREATE INDEX ON sessions(user_id, created_at DESC);
CREATE INDEX ON session_summaries(session_id);