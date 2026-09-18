/**
 * team 会话 `@` 文件提及检索装配。
 *
 * 网关的 `/workspace/files/search` 只接受绝对工作区根路径（不认 sessionId），
 * 所以 team 端必须自己从 session metadata 的 `workingDirectory` 取出检索根。
 * chat 端由 `useWorkspace().searchFileIndex` 提供同等能力，但 team 组件树里没有
 * `useWorkspace`，因此这里走 `@openAwork/web-client` 的工作区客户端（唯一合法通道）。
 */

import { createWorkspaceClient } from '@openAwork/web-client';
import type { MentionFileSearchFn } from '../../../components/chat/composer/use-mention-file-search.js';
import {
  MENTION_SEARCH_LIMIT,
  type MentionSearchResult,
} from '../../../components/conversation-runtime/messages/composer.js';

/** 无工作区根时的空结果：让 @ 菜单走「空状态」而不是报错。 */
const EMPTY_MENTION_SEARCH_RESULT: MentionSearchResult = { files: [], directories: [] };

/**
 * 从已解析的 session metadata 中读取工作区目录。
 * 缺失 / 类型不符 / 空串一律返回 null，由调用方回退为空结果。
 */
export function readTeamMentionWorkspaceDirectory(
  sessionMetadata: Record<string, unknown> | null,
): string | null {
  const workingDirectory = sessionMetadata?.['workingDirectory'];
  return typeof workingDirectory === 'string' && workingDirectory.length > 0
    ? workingDirectory
    : null;
}

export interface TeamMentionFileSearchInput {
  /** 检索根目录；为 null 时返回恒空结果。 */
  workspaceDirectory: string | null;
  gatewayUrl: string;
  token: string;
}

/**
 * 构造 team 端 `@` 文件提及检索函数。
 *
 * 有工作区根时经 `@openAwork/web-client` 调用 `/workspace/files/search`
 * （与 chat 端 `useWorkspace().searchFileIndex` 同一端点）；`!result.ok` 时抛错，
 * 由 `useMentionFileSearch` 统一收敛为菜单里的错误文案。
 */
export function createTeamMentionFileSearch(
  input: TeamMentionFileSearchInput,
): MentionFileSearchFn {
  const { workspaceDirectory, gatewayUrl, token } = input;
  if (!workspaceDirectory) {
    return () => Promise.resolve(EMPTY_MENTION_SEARCH_RESULT);
  }

  const workspaceClient = createWorkspaceClient(gatewayUrl);
  return async (query, signal) => {
    const result = await workspaceClient.searchFileIndexResult(token, workspaceDirectory, {
      query,
      limit: MENTION_SEARCH_LIMIT,
      signal,
    });
    if (!result.ok) {
      throw new Error(result.errorMessage ?? '检索工作区文件索引失败。');
    }
    return { files: result.files, directories: result.directories };
  };
}
