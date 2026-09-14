/**
 * 角色窗口墙的「展开态」持久化。
 *
 * 为什么需要它：卡片墙的展开 / 收起是用户手工组织出来的阅读态。刷新一次就把
 * 刚摆好的视角全部折回折叠态，等于让用户重做一遍。展开态是纯 UI 偏好、不是
 * 业务数据，所以落 localStorage，而不是塞进会话快照或后端。
 *
 * 为什么按 scopeKey（= 当前会话 id）分键：同一条卡片墙在不同 team 会话下的
 * 实例集合完全不同。共用一个键会让 A 会话展开过的卡片 id 泄进 B 会话 ——
 * 不致命，但会出现「刚打开就莫名展开几张卡」的错位感。分键之后两边互不干扰。
 *
 * 为什么容错做得这么厚：localStorage 在隐私模式 / 配额耗尽 / 被策略禁用时
 * 会**抛异常**，而这里读写在 React 渲染路径上 —— 抛出去就是整面板白屏。
 * 所以任何异常一律降级成「没有持久化」，让卡片墙照常可用。
 */

const STORAGE_KEY_PREFIX = 'teamV2.cardWall.expanded.';

/** 该 scopeKey 对应的 localStorage 键。导出仅为便于测试断言，业务侧不要直接用。 */
export function cardWallExpandedStorageKey(scopeKey: string): string {
  return `${STORAGE_KEY_PREFIX}${scopeKey}`;
}

function isUsableStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

/**
 * 读取某个会话下已展开的卡片键集合。
 *
 * 只有「非空字符串数组」会被采纳：存进去的东西可能被人手改、被旧版本写成
 * 别的形状，甚至被同域下另一个应用的同名键污染 —— 一律当作没有持久化。
 */
export function readCardWallExpandedKeys(scopeKey: string | null | undefined): ReadonlySet<string> {
  if (!scopeKey || !isUsableStorage()) {
    return new Set<string>();
  }
  try {
    const raw = window.localStorage.getItem(cardWallExpandedStorageKey(scopeKey));
    if (!raw) {
      return new Set<string>();
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set<string>();
    }
    return new Set(
      parsed.filter((item): item is string => typeof item === 'string' && item.length > 0),
    );
  } catch {
    return new Set<string>();
  }
}

/**
 * 写入某个会话下已展开的卡片键集合。
 *
 * 写失败只影响「下次刷新能否还原展开态」，不影响本次交互，因此静默降级。
 */
export function writeCardWallExpandedKeys(
  scopeKey: string | null | undefined,
  keys: Iterable<string>,
): void {
  if (!scopeKey || !isUsableStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(cardWallExpandedStorageKey(scopeKey), JSON.stringify([...keys]));
  } catch {
    // 隐私模式 / 配额耗尽：放弃持久化，保留本次内存中的展开态。
  }
}
