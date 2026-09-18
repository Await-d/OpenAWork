/**
 * team 澄清项的规范身份与轮次收敛（纯函数，不依赖 store / React）。
 *
 * 背景：PM1 的确认节点传输 id 带轮次后缀（`__grill_confirm__@r3`，见
 * services/agent-gateway/src/handoff/runner/pm1-grill-runner.ts 的
 * `confirmTransportQuestionId`）。驳回后确认题必须重提，若沿用同一 id 会被
 * `useClarificationStore.push` 按 id 去重，用户再也看不到确认题。
 *
 * 因此 store 同时保存两份身份：
 *   - `id`：传输 id，原样用于 inbound submit（questionId）、忽略与去重；
 *   - `nodeId`：引擎节点 id（剥掉尾部 `@rN` 后缀），用于识别「同一逻辑问题」。
 *
 * 有了 nodeId，UI 就能把同一问题的旧轮次标成「已被新一轮取代」，而不是把
 * 每轮都并列成一个待回答卡片 —— 这正是「同一个确认被反复渲染」的根因之一。
 */

/** 轮次后缀：确认节点传输 id 形如 `__grill_confirm__@r3`。 */
const ROUND_SUFFIX_PATTERN = /(?:@r\d+)+$/;

/**
 * 传输 id → 规范节点 id（剥离尾部轮次后缀，可叠加多段）。
 * 剥离后为空（例如 id 本身就是 `@r1`）时保留原 id，避免产生空身份。
 */
export function canonicalClarificationNodeId(transportId: string): string {
  const canonical = transportId.replace(ROUND_SUFFIX_PATTERN, '');
  return canonical.length > 0 ? canonical : transportId;
}

/** 澄清项的最小身份结构（结构类型，避免与 team-events.ts 形成运行时依赖）。 */
export interface ClarificationIdentity {
  id: string;
  /** store 落库后必有；直接构造的旧数据可缺失，由 resolve 兜底。 */
  nodeId?: string;
}

/** 解析规范节点 id：优先显式 nodeId，缺省时从传输 id 剥离轮次后缀。 */
export function resolveClarificationNodeId(item: ClarificationIdentity): string {
  return item.nodeId !== undefined && item.nodeId.length > 0
    ? item.nodeId
    : canonicalClarificationNodeId(item.id);
}

/** 参与轮次收敛的最小澄清项结构。 */
export interface ClarificationRoundItem extends ClarificationIdentity {
  status: 'pending' | 'answered' | 'dismissed';
  /** 澄清轮次（0 基；runtime snapshot 恢复路径可能缺失）。 */
  round?: number;
  createdAt?: number;
}

/**
 * 比较同一 nodeId 下两条 pending 的「新」程度：
 * 先比 round（双方都有时），再比 createdAt，最后按数组顺序（后者更新）。
 */
function isFresherRound(
  candidate: ClarificationRoundItem,
  candidateIndex: number,
  current: ClarificationRoundItem,
  currentIndex: number,
): boolean {
  const candidateRound = typeof candidate.round === 'number' ? candidate.round : null;
  const currentRound = typeof current.round === 'number' ? current.round : null;
  if (candidateRound !== null && currentRound !== null && candidateRound !== currentRound) {
    return candidateRound > currentRound;
  }
  const candidateCreatedAt = typeof candidate.createdAt === 'number' ? candidate.createdAt : null;
  const currentCreatedAt = typeof current.createdAt === 'number' ? current.createdAt : null;
  if (
    candidateCreatedAt !== null &&
    currentCreatedAt !== null &&
    candidateCreatedAt !== currentCreatedAt
  ) {
    return candidateCreatedAt > currentCreatedAt;
  }
  return candidateIndex > currentIndex;
}

/**
 * 被新一轮取代的 pending 项 `id` 集合：同一 nodeId 下只保留最新的一条 pending，
 * 其余 pending 视为「已被新一轮取代」。
 *
 * 只有 pending 之间会互相取代 —— 已回答 / 已忽略的历史轮次保持原状，
 * 不会被误标，也不会因此复活。
 */
export function resolveSupersededClarificationIds(
  items: readonly ClarificationRoundItem[],
): ReadonlySet<string> {
  const freshestByNodeId = new Map<string, { index: number; item: ClarificationRoundItem }>();
  items.forEach((item, index) => {
    if (item.status !== 'pending') return;
    const nodeId = resolveClarificationNodeId(item);
    const current = freshestByNodeId.get(nodeId);
    if (current === undefined || isFresherRound(item, index, current.item, current.index)) {
      freshestByNodeId.set(nodeId, { index, item });
    }
  });

  const superseded = new Set<string>();
  items.forEach((item, index) => {
    if (item.status !== 'pending') return;
    const freshest = freshestByNodeId.get(resolveClarificationNodeId(item));
    if (freshest !== undefined && freshest.index !== index) {
      superseded.add(item.id);
    }
  });
  return superseded;
}

/**
 * 真正需要用户回答的 pending 数：排除被新一轮取代的轮次。
 * 面板头、对话内聚合卡、待处理 chip、attention bar 全部走这一个口径。
 */
export function countActionablePendingClarifications(
  items: readonly ClarificationRoundItem[],
): number {
  const superseded = resolveSupersededClarificationIds(items);
  let count = 0;
  for (const item of items) {
    if (item.status === 'pending' && !superseded.has(item.id)) {
      count += 1;
    }
  }
  return count;
}
