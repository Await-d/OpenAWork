import { getPathBasename } from './workspace-path.js';

/**
 * 工作区展示名（别名）持久化。
 *
 * 别名存放在 localStorage，key 形如 `ws-alias:/path/to/project`；
 * 侧栏面板头部与标题栏共用这里的读写实现，避免两处各自的 key 拼写漂移。
 * 写入时会广播自定义事件，使标题栏等只读消费方能实时刷新。
 */
const WORKSPACE_ALIAS_PREFIX = 'ws-alias:';
const WORKSPACE_ALIAS_CHANGE_EVENT = 'openawork:workspace-alias-changed';

function aliasKey(workspacePath: string): string {
  return `${WORKSPACE_ALIAS_PREFIX}${workspacePath}`;
}

/** 读取工作区别名；未设置或 localStorage 不可用时返回空串。 */
export function readWorkspaceAlias(workspacePath: string | null): string {
  if (!workspacePath) {
    return '';
  }

  try {
    return localStorage.getItem(aliasKey(workspacePath)) ?? '';
  } catch {
    return '';
  }
}

/** 写入工作区别名；传空串表示清除别名（展示名回落到路径末段）。 */
export function writeWorkspaceAlias(workspacePath: string | null, alias: string): void {
  if (!workspacePath) {
    return;
  }

  try {
    if (alias) {
      localStorage.setItem(aliasKey(workspacePath), alias);
    } else {
      localStorage.removeItem(aliasKey(workspacePath));
    }
  } catch {
    // localStorage 不可用时静默失败：别名只是展示层偏好，不影响主流程。
  }

  broadcastWorkspaceAliasChange();
}

/**
 * 订阅工作区别名变更。
 * 同文档内的写入靠自定义事件广播，其它标签页的写入由 `storage` 事件兜底。
 */
export function subscribeWorkspaceAlias(listener: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  window.addEventListener(WORKSPACE_ALIAS_CHANGE_EVENT, listener);
  window.addEventListener('storage', listener);

  return () => {
    window.removeEventListener(WORKSPACE_ALIAS_CHANGE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

/** 工作区展示名：别名优先，否则回落到路径末段。 */
export function resolveWorkspaceDisplayName(workspacePath: string | null): string {
  return readWorkspaceAlias(workspacePath) || getPathBasename(workspacePath, 'OpenAWork');
}

function broadcastWorkspaceAliasChange(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(WORKSPACE_ALIAS_CHANGE_EVENT));
}
