CREATE TABLE play_counts (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, track_id TEXT NOT NULL, device_id TEXT NOT NULL, count INTEGER NOT NULL CHECK (count > 0), PRIMARY KEY (user_id, track_id, device_id));
CREATE TABLE deleted_play_count_tracks (track_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE);
