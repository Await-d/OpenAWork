export function migrateDispatches(db: {
  exec(sql: string): unknown;
  prepare(sql: string): { all(): unknown[] };
}): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dispatches (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      request TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      draft_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      confirmed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dispatch_items (
      id TEXT PRIMARY KEY,
      dispatch_id TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      acceptance TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('summarize', 'extract', 'review')),
      UNIQUE (dispatch_id, ordinal)
    );
    CREATE TABLE IF NOT EXISTS dispatch_attempts (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES dispatch_items(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL,
      number INTEGER NOT NULL,
      prior_attempt_id TEXT UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('initial', 'follow-up', 'retry')),
      status TEXT NOT NULL CHECK (status IN (
        'queued', 'running', 'succeeded', 'failed', 'interrupted', 'cancelled'
      )),
      question TEXT,
      result TEXT,
      error TEXT,
      stop_requested INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      finished_at INTEGER,
      UNIQUE (item_id, number)
    );
    CREATE INDEX IF NOT EXISTS idx_dispatch_attempts_active
      ON dispatch_attempts(status, created_at, id) WHERE status IN ('queued', 'running');
  `);

  const columns = db.prepare('PRAGMA table_info(dispatches)').all() as { name: string }[];
  if (!columns.some(({ name }) => name === 'created_at')) {
    db.exec('SAVEPOINT dispatch_creation_order');
    try {
      db.exec(`ALTER TABLE dispatches ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
        UPDATE dispatches SET created_at = updated_at;`);
      db.exec('RELEASE dispatch_creation_order');
    } catch (error) {
      db.exec('ROLLBACK TO dispatch_creation_order; RELEASE dispatch_creation_order;');
      throw error;
    }
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_dispatches_owner_created
    ON dispatches(owner_user_id, created_at DESC, id DESC);
    DROP INDEX IF EXISTS idx_dispatches_owner_recent;`);
}
