export interface SessionRow {
  id: string;
  title?: string;
  state_status: string;
  updated_at: string;
  metadata_json?: string;
  /** Team layering parent link — 非空表示是 team 子会话（pm1/pm2/executor/reviewer）。 */
  team_parent_session_id?: string | null;
  /** Team 语义层级标识（reception/pm1/pm2/executor/reviewer）。 */
  role_layer?: string | null;
}
