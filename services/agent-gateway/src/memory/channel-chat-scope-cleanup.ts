/**
 * `channel_chat` 作用域记忆/规则的**孤儿清理**（261104-渠道作用域记忆泄漏）。
 *
 * 背景：渠道会话的记忆与规则落在 `memories` / `memory_rule_entries`，其作用域为
 * `channel_chat`，scope id 由入站来源派生（`memoryChannelScopeKey`）：
 *
 *   `channel:<platform>:<channelInstanceId>:chat:<chatId>`
 *
 * 来源冻结在 `memory_message_provenance`（`session_id` + 上面四个字段）。这两张权威表
 * **没有**指向 `sessions` 的外键，会话删除（正常路径 FK 级联删掉了 provenance 行，
 * 畸形恢复路径需要显式删）不会带走它们；而注入侧按 scope id 字符串匹配、**不校验**
 * 对应的渠道会话是否仍存在，于是删掉会话后这些记忆/规则仍可能被命中。
 *
 * 清理语义（刻意保守）：
 *   - 只清**该会话来源派生出的** scope id（`IN (... WHERE p.session_id = ?)`）；
 *   - 且该 scope id 已**不再被其它会话引用**（`NOT IN (... WHERE p.session_id <> ?)`）；
 *   - 只碰 `scope_type = 'channel_chat'`，user / workspace / team 一律不动。
 *
 * 「不再被任何会话引用」即「作用域已失效」：同一 `(渠道实例, chatId)` 下若仍有别的
 * 会话，说明该对话作用域仍可达，此处**不删**（避免误删仍有效的群记忆）。用户手动创建、
 * 却没有对应入站来源的 `channel_chat` 记忆不会命中 `IN` 子查询，因此也不会被误删。
 *
 * 幂等：本会话来源行删除后，`IN` 子查询为空集 → 再次执行 0 行受影响。
 */

/** 从 `memory_message_provenance` 行派生 scope id 的 SQL 片段（与 `memoryChannelScopeKey` 同构）。 */
export const DERIVED_CHANNEL_SCOPE_EXPRESSION =
  "('channel:' || platform || ':' || channel_instance_id || ':chat:' || chat_id)";

/**
 * 删除「由本会话来源派生、且已无其它会话引用」的 `channel_chat` 记忆。
 *
 * 参数顺序：`[userId, sessionId, sessionId]`。
 */
export function buildDeleteOrphanedChannelChatMemoriesSql(): string {
  return `DELETE FROM memories
          WHERE user_id = ?
            AND scope_type = 'channel_chat'
            AND scope_id IN (
              SELECT ${DERIVED_CHANNEL_SCOPE_EXPRESSION}
                FROM memory_message_provenance
               WHERE session_id = ?
            )
            AND scope_id NOT IN (
              SELECT ${DERIVED_CHANNEL_SCOPE_EXPRESSION}
                FROM memory_message_provenance
               WHERE session_id <> ?
            )`;
}

/**
 * 删除「由本会话来源派生、且已无其它会话引用」的 `channel_chat` 规则。
 *
 * 参数顺序：`[userId, sessionId, sessionId]`。
 */
export function buildDeleteOrphanedChannelChatRulesSql(): string {
  return `DELETE FROM memory_rule_entries
          WHERE user_id = ?
            AND scope_type = 'channel_chat'
            AND scope_id IN (
              SELECT ${DERIVED_CHANNEL_SCOPE_EXPRESSION}
                FROM memory_message_provenance
               WHERE session_id = ?
            )
            AND scope_id NOT IN (
              SELECT ${DERIVED_CHANNEL_SCOPE_EXPRESSION}
                FROM memory_message_provenance
               WHERE session_id <> ?
            )`;
}
