import type { MemoryScope, MemorySourceProvenance } from '@openAwork/agent-core';
import {
  channelChatMemoryScope,
  memoryScopeKey,
  resolveProposalScope,
  teamMemoryScope,
  userMemoryScope,
  workspaceMemoryScope,
} from '@openAwork/agent-core';

/**
 * 会话 → 记忆作用域解析（261101-记忆确认写入与周期整理）。
 *
 * 本模块是**注入边界**：`resolveAllowedInjectionScopes` 决定一次会话能看到哪些作用域
 * 的记忆。渠道会话由外部群成员驱动，必须与 owner 的私人记忆严格隔离——这是本次要修
 * 的核心越权面，故渠道分支**绝不包含 owner 的 user scope**。
 */

/** 渠道会话在 `sessions.metadata_json` 里的来源标记。 */
const CHANNEL_SOURCE = 'channel';

function parseSessionMetadata(metadataJson: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(metadataJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function readNonEmptyString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** 会话 metadata 是否标记为消息渠道来源（`source === 'channel'`）。 */
export function isChannelSessionMetadata(metadataJson: string): boolean {
  const metadata = parseSessionMetadata(metadataJson);
  return metadata !== null && metadata['source'] === CHANNEL_SOURCE;
}

/**
 * 解析候选记忆应落入的作用域。
 *
 * 顺序：渠道来源 > 团队 > 工作区 > 用户。渠道优先是刻意的——即使渠道会话绑定了工作区，
 * 群成员的话也默认留在该对话作用域，不直接落进项目 / 个人记忆。
 *
 * metadata 解析失败视为「无 team / workspace 信息」，fail-closed 落到 user 作用域，
 * 而不是抛出——调用方拿到的是可继续处理的保守结果。
 */
export function resolveProposalScopeForSession(input: {
  userId: string;
  metadataJson: string;
  provenance?: MemorySourceProvenance | null;
}): MemoryScope {
  const metadata = parseSessionMetadata(input.metadataJson);
  const teamWorkspaceId = metadata ? readNonEmptyString(metadata, 'teamWorkspaceId') : null;
  const workspaceRoot = metadata ? readNonEmptyString(metadata, 'workingDirectory') : null;
  return resolveProposalScope({
    userId: input.userId,
    provenance: input.provenance ?? null,
    teamWorkspaceId,
    workspaceRoot,
  });
}

/**
 * 解析一次会话**允许注入**的作用域列表——**唯一实现**。
 *
 * 渠道会话（`source === 'channel'`）：
 *   - 只允许 `channel_chat`（有 provenance 时）；
 *   - metadata 带 teamWorkspaceId 时额外允许 team scope；
 *   - **绝不包含 owner 的 user scope**——这正是要修的越权。
 *   - metadata 解析失败（无法确认是不是渠道会话）→ 返回空数组，宁可不注入。
 *
 * 非渠道会话：`user:<userId>` + 有 workingDirectory 时 `workspace:<规范化路径>`
 *   + 有 teamWorkspaceId 时 team scope；metadata 解析失败只保留 `user:<userId>`。
 *
 * 下面两个导出**必须**由本函数派生，不得各写一份：两者分别是「按作用域查库」与
 * 「注入块白名单过滤」的输入，一旦分叉就会出现「查回来的行被白名单全过滤掉」（少注入）
 * 或「白名单放行但查询没取」（表现为记忆凭空消失）这类难查的不一致。
 */
function resolveAllowedInjectionScopeList(input: {
  userId: string;
  metadataJson: string;
  provenance?: MemorySourceProvenance | null;
}): MemoryScope[] {
  const metadata = parseSessionMetadata(input.metadataJson);
  const isChannel = metadata !== null && metadata['source'] === CHANNEL_SOURCE;

  if (isChannel) {
    if (metadata === null) {
      return [];
    }
    const scopes: MemoryScope[] = [];
    if (input.provenance) {
      scopes.push(channelChatMemoryScope(input.provenance));
    }
    const teamWorkspaceId = readNonEmptyString(metadata, 'teamWorkspaceId');
    if (teamWorkspaceId) {
      scopes.push(teamMemoryScope(teamWorkspaceId));
    }
    return scopes;
  }

  const scopes: MemoryScope[] = [userMemoryScope(input.userId)];
  if (metadata === null) {
    return scopes;
  }
  const workspaceRoot = readNonEmptyString(metadata, 'workingDirectory');
  if (workspaceRoot) {
    scopes.push(workspaceMemoryScope(workspaceRoot));
  }
  const teamWorkspaceId = readNonEmptyString(metadata, 'teamWorkspaceId');
  if (teamWorkspaceId) {
    scopes.push(teamMemoryScope(teamWorkspaceId));
  }
  return scopes;
}

/** 白名单键数组（`memoryScopeKey()` 产物），供注入块的 `allowedScopes` 使用。 */
export function resolveAllowedInjectionScopes(input: {
  userId: string;
  metadataJson: string;
  provenance?: MemorySourceProvenance | null;
}): readonly string[] {
  return resolveAllowedInjectionScopeList(input).map(memoryScopeKey);
}

/** 作用域对象数组，供 `listEnabledMemoriesForScopeInjection` 查库使用。 */
export function resolveAllowedInjectionScopeObjects(input: {
  userId: string;
  metadataJson: string;
  provenance?: MemorySourceProvenance | null;
}): MemoryScope[] {
  return resolveAllowedInjectionScopeList(input);
}
