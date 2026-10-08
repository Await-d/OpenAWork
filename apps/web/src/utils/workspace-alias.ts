import { getPathBasename } from './workspace-path.js';

/**
 * 工作区展示名（别名）持久化。
 *
 * 别名存放在 localStorage，key 形如 `ws-alias:/path/to/project`；
 * 侧栏面板头部、标题栏与会话列表分组头共用这里的读写实现，避免各处各自的
 * key 拼写与展示口径漂移。写入时会广播自定义事件，使其它消费方实时刷新。
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

/** 工作区别名长度上限：超出会撑破侧栏分组头并挤掉会话数徽标。 */
export const WORKSPACE_ALIAS_MAX_LENGTH = 60;

export type WorkspaceAliasValidation = { ok: true; alias: string } | { ok: false; reason: string };

/**
 * 校验重命名输入。
 *
 * 纯函数，便于重命名对话框与单测共用同一套规则：
 * 空串视为「清除别名、恢复默认名」，其余按 trim + 长度上限判定。
 */
export function validateWorkspaceAlias(input: string): WorkspaceAliasValidation {
  const alias = input.trim();

  if (alias.length === 0) {
    return { ok: true, alias: '' };
  }

  if (alias.length > WORKSPACE_ALIAS_MAX_LENGTH) {
    return { ok: false, reason: `名称最长 ${WORKSPACE_ALIAS_MAX_LENGTH} 个字符` };
  }

  // 换行会让单行输入框与分组头的 ellipsis 截断行为不一致，直接拒绝。
  if (/[\r\n\t]/u.test(alias)) {
    return { ok: false, reason: '名称不能包含换行或制表符' };
  }

  return { ok: true, alias };
}

function broadcastWorkspaceAliasChange(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(WORKSPACE_ALIAS_CHANGE_EVENT));
}
