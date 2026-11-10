ALTER TABLE tracks ADD COLUMN content_hash TEXT;
CREATE UNIQUE INDEX tracks_user_content_hash ON tracks(user_id, content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX tracks_unhashed_size ON tracks(user_id, size) WHERE content_hash IS NULL;
