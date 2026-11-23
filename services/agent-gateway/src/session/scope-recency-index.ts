/**
 * 进程内「每会话 scope 新旧次序」索引 —— 让按 scope 的保留裁剪从
 * O(会话总行数) 降到 O(被删行数)。
 *
 * 背景（实测，2026-11-02 生产）：`session_run_events` / `session_entry` 都按
 * `(session_id, client_request_id)` 分段（scope），每会话保留最近 N 段。旧写法每次
 * prune 都要对**整个会话**做
 *
 *   DELETE ... WHERE client_request_id NOT IN (
 *     SELECT client_request_id FROM (SELECT client_request_id, MAX(id) ... GROUP BY ...))
 *
 * 这是一次覆盖索引的全量遍历 + 外层再扫一遍 + bloom filter：单会话 25 万行时，
 * 即使只淘汰 1 个旧 scope（约 1 千行），也要走 25 万条索引项。热页时约 95ms，
 * 冷页时实测 **2269ms**，期间事件循环完全停摆（`[event-loop-lag]` 最长告警
 * 2059ms 的来源），SSE 心跳 / `/status` / 首 token 一起排队。
 *
 * 本索引把「scope 的新旧次序」搬到内存：写入方每落一行调用 `noteScopeWrite`，
 * prune 时直接由内存次序算出该淘汰的 scope，再按 scope 精确删除
 * （走 `(session_id, client_request_id, ...)` 索引前缀，成本只与**被删行数**相关）。
 *
 * 正确性：
 *  - 进程重启后内存为空 → 首次 prune 用调用方的 DB 分组查询播种（返回「新的在前」），
 *    之后才走增量；播种结果就是 DB 真相，因此不会比旧实现多留或少留。
 *  - 淘汰始终**整段**进行（整段 DELETE），不会截断 scope 头部 —— 截断会破坏回放。
 *  - 任何「写入未 note」的路径最多让该 scope 永不被淘汰（保留偏多），绝不会误删
 *    在跑的或有数据的 scope：淘汰判据是「内存里最旧的若干个」，越新越安全。
 *  - 内存只作为**次序**依据，不作为存在性依据：调用方命中不存在的 scope 时删除是
 *    空操作（如失败运行清理已删除该段行）。
 */

/**
 * 同时跟踪的会话数上限（LRU）。超限时淘汰最久未写入的会话 —— 该会话下次 prune
 * 重新播种即可，只多一次分组查询，不影响正确性。
 */
const MAX_TRACKED_SESSIONS = 512;

/**
 * 单次 prune 最多淘汰的 scope 段数。用于给「历史遗留大户」的追平删除封顶：
 * 老会话首次播种可能一次性算出上千个待淘汰段，若不封顶，单条同步删除会重新
 * 变成秒级阻塞。未淘汰完的部分留给后续 prune 继续收敛（最终仍然有界）。
 */
const MAX_EVICTIONS_PER_PRUNE = 200;

interface TrackedSessionScopes {
  /** scopeId → 最近一次写入的单调序号（越大越新）。 */
  touchedAt: Map<string, number>;
  /**
   * 是否已用 DB 分组查询播种过。
   *
   * 未播种的条目**不可**用于淘汰判定：进程启动后、首次 prune 之前写入的会话只有
   * 新 scope 在内存里，DB 里已有的老 scope 不可见，按它判定会「以为只有 1 个
   * scope」而永不淘汰，老会话因此无限增长。故首次判定前必须回表播种一次。
   */
  seeded: boolean;
}

const trackedScopes = new Map<string, TrackedSessionScopes>();
let touchCounter = 0;

function touchSession(sessionId: string): TrackedSessionScopes {
  const existing = trackedScopes.get(sessionId);
  if (existing) {
    // 重新插入以把该会话推到 LRU 队尾（Map 保持插入序）。
    trackedScopes.delete(sessionId);
    trackedScopes.set(sessionId, existing);
    return existing;
  }
  const created: TrackedSessionScopes = { touchedAt: new Map(), seeded: false };
  trackedScopes.set(sessionId, created);
  if (trackedScopes.size > MAX_TRACKED_SESSIONS) {
    const oldest = trackedScopes.keys().next();
    if (!oldest.done) trackedScopes.delete(oldest.value);
  }
  return created;
}

/**
 * 记录「某会话的某 scope 刚被写入」。写入方可逐行调用（O(1)，无 IO）。
 * `scopeId` 为空（无 `client_request_id` 的 legacy 行）时直接忽略 —— 这类行
 * 从不参与裁剪。
 */
export function noteScopeWrite(sessionId: string, scopeId: string | null | undefined): void {
  if (!scopeId) return;
  const entry = touchSession(sessionId);
  entry.touchedAt.set(scopeId, ++touchCounter);
}

/**
 * 算出该淘汰的 scope（由旧到新），**不修改**内存状态。调用方删除成功后必须调用
 * `commitScopeEviction` 提交，否则同一批会在下次 prune 重算（幂等重试）。
 *
 * `loadScopesFromDb` 只在会话尚未播种时调用一次，须返回**由新到旧**排列的 scope
 * 列表（调用方用自己的表 / 列做分组查询）。
 */
export function planScopeEviction(
  sessionId: string,
  maxScopes: number,
  loadScopesFromDb: () => string[],
): string[] {
  if (!Number.isFinite(maxScopes) || maxScopes <= 0) return [];
  const limit = Math.floor(maxScopes);

  let entry = trackedScopes.get(sessionId);
  if (!entry || !entry.seeded) {
    // 播种以 DB 为唯一真相：DB 返回的快照包含此刻已落库的全部 scope（含本次
    // 判定前刚写入的那些），因此可以整表替换内存次序，不需要合并。
    const newestFirst = loadScopesFromDb();
    const seeded: Map<string, number> = new Map();
    // 倒序遍历：最新的拿到最大的计数，与 DB 的 MAX(id)/MAX(seq) 次序一致。
    for (let i = newestFirst.length - 1; i >= 0; i -= 1) {
      const scopeId = newestFirst[i];
      if (scopeId) seeded.set(scopeId, ++touchCounter);
    }
    entry = { touchedAt: seeded, seeded: true };
    trackedScopes.set(sessionId, entry);
    if (trackedScopes.size > MAX_TRACKED_SESSIONS) {
      const oldest = trackedScopes.keys().next();
      if (!oldest.done && oldest.value !== sessionId) trackedScopes.delete(oldest.value);
    }
  }

  const overflow = entry.touchedAt.size - limit;
  if (overflow <= 0) return [];

  const oldestFirst = [...entry.touchedAt.entries()].sort((a, b) => a[1] - b[1]);
  return oldestFirst
    .slice(0, Math.min(overflow, MAX_EVICTIONS_PER_PRUNE))
    .map(([scopeId]) => scopeId);
}

/** 删除成功后提交：把已淘汰的 scope 从内存次序中摘掉，避免重复删除。 */
export function commitScopeEviction(sessionId: string, scopeIds: readonly string[]): void {
  const entry = trackedScopes.get(sessionId);
  if (!entry) return;
  for (const scopeId of scopeIds) {
    entry.touchedAt.delete(scopeId);
  }
}

/** 会话被删除后释放其内存条目（可选调用；LRU 也会兜底回收）。 */
export function forgetScopeRecency(sessionId: string): void {
  trackedScopes.delete(sessionId);
}

/** Test-only: 清空索引，模拟进程重启（迫使下次 prune 走播种路径）。 */
export function __resetScopeRecencyIndexForTesting(): void {
  trackedScopes.clear();
  touchCounter = 0;
}

/** Test-only: 当前跟踪的会话数。 */
export function __trackedSessionCountForTesting(): number {
  return trackedScopes.size;
}
