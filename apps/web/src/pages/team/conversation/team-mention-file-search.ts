/**
 * team 会话 `@` 文件提及检索装配。
 *
 * 检索根取 session metadata 的 `workingDirectory`（SSH 会话下即远端绝对路径）；
 * 已建立的 team 会话同时把 `sessionId` 透传给网关，由网关沿父会话链解析 SSH
 * 绑定，避免 Windows 网关把远端 POSIX 路径当本地路径校验。
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

/**
 * 从已解析的 session metadata 中读取 SSH 连接 id（网关写入的键名是
 * `sshConnectionId`）。缺失 / 类型不符 / 空串返回 null（本地会话）。
 */
export function readTeamMentionSshConnectionId(
  sessionMetadata: Record<string, unknown> | null,
): string | null {
  const sshConnectionId = sessionMetadata?.['sshConnectionId'];
  return typeof sshConnectionId === 'string' && sshConnectionId.trim().length > 0
    ? sshConnectionId.trim()
    : null;
}

export interface TeamMentionFileSearchInput {
  /** 检索根目录；为 null 时返回恒空结果。 */
  workspaceDirectory: string | null;
  gatewayUrl: string;
  token: string;
  /** 当前 team 会话 id：SSH 绑定会话必须携带，网关据此解析远端连接。 */
  sessionId: string | null;
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
  const { workspaceDirectory, gatewayUrl, token, sessionId } = input;
  if (!workspaceDirectory) {
    return () => Promise.resolve(EMPTY_MENTION_SEARCH_RESULT);
  }

  const workspaceClient = createWorkspaceClient(gatewayUrl);
  return async (query, signal) => {
    const result = await workspaceClient.searchFileIndexResult(token, workspaceDirectory, {
      query,
      limit: MENTION_SEARCH_LIMIT,
      signal,
      ...(sessionId ? { sessionId } : {}),
    });
    if (!result.ok) {
      throw new Error(result.errorMessage ?? '检索工作区文件索引失败。');
    }
    return { files: result.files, directories: result.directories };
  };
}
