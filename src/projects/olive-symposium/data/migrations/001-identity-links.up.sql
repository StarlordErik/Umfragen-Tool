-- Opt-in extension. Existing participant IDs, answers and PINs are untouched.
-- Global identity lives in a separate store: intentionally no cross-database FK.
CREATE TABLE legacy_user_mappings (
    legacy_participant_id INTEGER PRIMARY KEY REFERENCES respondents(id) ON DELETE RESTRICT,
    global_user_id TEXT NOT NULL CHECK (length(global_user_id) BETWEEN 1 AND 200),
    linked_at TEXT NOT NULL,
    linked_by TEXT NOT NULL
);
CREATE INDEX legacy_user_mappings_global_user ON legacy_user_mappings(global_user_id);
