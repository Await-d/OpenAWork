/**
 * Composer Input History Store — 输入框上下键历史的服务端持久化。
 *
 * 背景：输入历史原先只存在浏览器侧 Zustand（无 persist 中间件），刷新、重启桌面端
 * 或换设备后即不可见。落库后网关成为唯一真相源，客户端只保留运行期缓存并在进入
 * 会话时水合。
 *
 * 与待发队列（`session_composer_queue`）的关键差异：
 * 1. **不是消息**：历史只用于上下键回填，既不对模型可见，也不参与发送状态机；
 * 2. **容量固定**：每个会话只保留最新 {@link COMPOSER_INPUT_HISTORY_MAX_ENTRIES}
 *    条，写入后立刻裁剪，避免一条输入历史表无限增长；
 * 3. **相邻去重**：与客户端 `appendComposerInputHistoryEntry` 同一语义——连续发送
 *    同一句话只在历史里留一条，不把重复内容挤掉真正有用的记录。
 *
 * 归属过滤一律带 `user_id`：路由层已校验会话归属，这里再带一次可以防止调用方
 * 误传他人 sessionId 时发生越权读取。
 */

import { sqliteAll, sqliteGet, sqliteRun, sqliteTransaction } from '../infra/db.js';

/** 每个会话保留的输入历史条数上限。 */
export const COMPOSER_INPUT_HISTORY_MAX_ENTRIES = 50;

/** 单条历史文本长度上限——与输入框 / 待发队列同量级，防止单行塞爆库。 */
export const COMPOSER_INPUT_HISTORY_TEXT_MAX_LENGTH = 200_000;

/** 一次批量追加允许携带的条数上限（用于新会话建立后迁移 pending 历史）。 */
export const COMPOSER_INPUT_HISTORY_APPEND_MAX_ENTRIES = COMPOSER_INPUT_HISTORY_MAX_ENTRIES;

interface ComposerInputHistoryRow {
  text: string;
}

/**
 * 按写入顺序（旧 → 新）列出某会话的输入历史。
 *
 * 顺序即客户端上下键的遍历顺序：数组末尾是最近一次提交。按自增 `id` 排序而非
 * `created_at`——同一毫秒内的连续提交在时间戳上无法区分。
 */
export function listComposerInputHistory(input: { sessionId: string; userId: string }): string[] {
  return sqliteAll<ComposerInputHistoryRow>(
    `SELECT text
       FROM session_composer_input_history
      WHERE session_id = ? AND user_id = ?
      ORDER BY id ASC`,
    [input.sessionId, input.userId],
  ).map((row) => row.text);
}

/**
 * 追加若干条历史并裁剪到最新 50 条，返回落库后的全量列表。
 *
 * 批量语义是为了「新会话创建后迁移 pending 历史」——逐条发请求既慢又可能在迁移
 * 中途失败，留下半截历史。整批写入放在一个事务里，失败则一条都不落。
 *
 * 空文本跳过；与「当前最新一条」相同的条目跳过（相邻去重）。非相邻的历史重复
 * 是刻意保留的——用户确实在不同轮次里发过同一句话。
 */
export function appendComposerInputHistory(input: {
  entries: readonly string[];
  sessionId: string;
  userId: string;
}): string[] {
  // 先过滤空文本再取最后 N 条：反过来的话，末尾的空条目会挤掉一条有效历史。
  const pendingEntries = input.entries
    .map((text) => text.slice(0, COMPOSER_INPUT_HISTORY_TEXT_MAX_LENGTH))
    .filter((text) => text.trim().length > 0)
    .slice(-COMPOSER_INPUT_HISTORY_APPEND_MAX_ENTRIES);

  if (pendingEntries.length === 0) {
    return listComposerInputHistory(input);
  }

  return sqliteTransaction(() => {
    const latestRow = sqliteGet<ComposerInputHistoryRow>(
      `SELECT text
         FROM session_composer_input_history
        WHERE session_id = ? AND user_id = ?
        ORDER BY id DESC
        LIMIT 1`,
      [input.sessionId, input.userId],
    );
    let latestText = latestRow?.text;
    let inserted = false;

    for (const text of pendingEntries) {
      if (latestText === text) {
        continue;
      }
      sqliteRun(
        `INSERT INTO session_composer_input_history (session_id, user_id, text, created_at)
         VALUES (?, ?, ?, ?)`,
        [input.sessionId, input.userId, text, Date.now()],
      );
      latestText = text;
      inserted = true;
    }

    // 只在确有新行时裁剪：重复提交的路径不需要重写索引页。
    if (inserted) {
      sqliteRun(
        `DELETE FROM session_composer_input_history
          WHERE session_id = ? AND user_id = ?
            AND id < (
              SELECT id
                FROM session_composer_input_history
               WHERE session_id = ? AND user_id = ?
               ORDER BY id DESC
               LIMIT 1 OFFSET ?
            )`,
        [
          input.sessionId,
          input.userId,
          input.sessionId,
          input.userId,
          COMPOSER_INPUT_HISTORY_MAX_ENTRIES - 1,
        ],
      );
    }

    return listComposerInputHistory(input);
  });
}
