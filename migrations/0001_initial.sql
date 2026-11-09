PRAGMA foreign_keys = ON;
CREATE TABLE users (id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE tracks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, artist TEXT NOT NULL DEFAULT '', album TEXT NOT NULL DEFAULT '', duration REAL NOT NULL, size INTEGER NOT NULL, mime TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE, cover_key TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX tracks_user ON tracks(user_id, created_at);
CREATE TABLE playlists (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, mutation_token TEXT);
CREATE TABLE playlist_tracks (playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE, track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, position INTEGER NOT NULL, PRIMARY KEY (playlist_id, track_id));
CREATE TABLE favorites (user_id TEXT NOT NULL REFERENCES users(id), track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, PRIMARY KEY (user_id, track_id));
CREATE TABLE upload_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), r2_upload_id TEXT NOT NULL, object_key TEXT NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE upload_parts (session_id TEXT NOT NULL REFERENCES upload_sessions(id) ON DELETE CASCADE, part_number INTEGER NOT NULL, etag TEXT NOT NULL, size INTEGER NOT NULL, PRIMARY KEY(session_id, part_number));
