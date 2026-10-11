/**
 * 待发队列的「消费端」标识——多端互斥靠它区分。
 *
 * 为什么必须是**每标签页**一个而不是每设备一个：同一台机器上开两个标签页看同一会话，
 * 它们会各自水合到同一条待发消息。若两端共用一个 id，claim 会认为「是我自己」而双双放行，
 * 互斥直接失效。
 *
 * 为什么放 sessionStorage 而不是 localStorage：
 * - sessionStorage 每标签页独立，天然满足上面的「每标签页一个」；
 * - 刷新页面保持不变，所以刷新后仍能认领自己尚未完成的 claim，不会把自己锁在门外；
 * - 关闭标签页即失效，下次新开是新端，正好符合「旧端不会再回来发」的预期。
 */

/** sessionStorage key。带前缀以免与其它业务的存储项撞名。 */
const CLIENT_ID_STORAGE_KEY = 'openawork-composer-queue-client-id';

/** 正常情况下不会出现，但 storage 被策略禁用时需要兜底，故不能假定写入成功。 */
function createFallbackClientId(): string {
  return `cq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function resolveComposerQueueClientId(): string {
  if (typeof window === 'undefined') {
    return createFallbackClientId();
  }

  try {
    const existing = window.sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing && existing.length > 0) {
      return existing;
    }
    const created = `cq-${crypto.randomUUID()}`;
    window.sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, created);
    return created;
  } catch {
    // 隐私模式 / 配额禁用等场景下 storage 不可用：退化为进程内临时 id。
    // 此时同标签页内的多次调用会拿到不同值，互斥退化为「本端不互斥」——
    // 仍优于直接崩溃，且浏览器禁用 storage 的场景极为罕见。
    return createFallbackClientId();
  }
}
