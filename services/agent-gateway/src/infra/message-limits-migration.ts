/** 全局单例配置，与用户生命周期无关。 */
export function migrateMessageLimits(db: { exec(sql: string): unknown }): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_limits (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      max_chars INTEGER NOT NULL
    )
  `);
}
