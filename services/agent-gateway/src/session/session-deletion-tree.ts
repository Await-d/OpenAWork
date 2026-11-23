import { sqliteAll, sqliteGet } from '../infra/db.js';
import { buildSqlitePlaceholders, chunkSqliteBindValues } from '../infra/sqlite-batch.js';

/** 直接绑定父 ID，避免递归 JOIN 只按 user_id 使用组合索引。 */
export function buildSessionDeletionChildQuery(
  columns: string,
  parentCount: number,
  relation: 'metadata' | 'team',
): string {
  const parent =
    relation === 'metadata'
      ? "(CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.parentSessionId') END)"
      : 'team_parent_session_id';
  return `SELECT ${columns} FROM sessions
          WHERE user_id = ? AND ${parent} IN (${buildSqlitePlaceholders(parentCount, ', ')})`;
}

export function loadSessionDeletionTree<Row extends { id: string }>(input: {
  columns: string;
  rootSessionId: string;
  userId: string;
  hasTeamParentColumn: boolean;
}): Row[] {
  const { columns, rootSessionId, userId } = input;
  const root = sqliteGet<Row>(`SELECT ${columns} FROM sessions WHERE id = ? AND user_id = ?`, [
    rootSessionId,
    userId,
  ]);
  if (!root) return [];

  const visited = new Set([root.id]);
  const levels: Row[][] = [[root]];
  const relations = input.hasTeamParentColumn
    ? (['metadata', 'team'] as const)
    : (['metadata'] as const);
  for (let frontier = [root]; frontier.length > 0;) {
    const next: Row[] = [];
    for (const parents of chunkSqliteBindValues(frontier.map(({ id }) => id))) {
      for (const relation of relations) {
        const children = sqliteAll<Row>(
          buildSessionDeletionChildQuery(columns, parents.length, relation),
          [userId, ...parents],
        );
        for (const child of children) {
          if (visited.has(child.id)) continue;
          visited.add(child.id);
          next.push(child);
        }
      }
    }
    if (next.length > 0) levels.push(next);
    frontier = next;
  }
  return levels.reverse().flat();
}
