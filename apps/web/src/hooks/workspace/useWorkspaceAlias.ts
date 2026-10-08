import { useCallback, useEffect, useState } from 'react';
import {
  resolveWorkspaceDisplayName,
  subscribeWorkspaceAlias,
  writeWorkspaceAlias,
} from '../../utils/workspace-alias.js';

/**
 * 工作区展示名解析器。
 *
 * 会话列表的分组头用它把路径末段换成用户自定义名称。别名写入后会广播变更事件，
 * 这里订阅并重建解析函数，保证所有消费方（侧栏 / 会话管理页 / 标题栏）
 * 在任意入口改名后立即同步，无需刷新页面。
 */
export function useWorkspaceDisplayName(): (workspacePath: string | null) => string {
  const [aliasRevision, setAliasRevision] = useState(0);

  useEffect(() => subscribeWorkspaceAlias(() => setAliasRevision((revision) => revision + 1)), []);

  // aliasRevision 参与依赖：变更后重建函数引用，强制消费方读取最新别名。
  return useCallback(
    (workspacePath: string | null) => resolveWorkspaceDisplayName(workspacePath),
    [aliasRevision],
  );
}

/** 重命名工作区（写入别名）；传空串表示恢复默认名。 */
export function renameWorkspaceDisplay(workspacePath: string | null, alias: string): void {
  writeWorkspaceAlias(workspacePath, alias);
}
