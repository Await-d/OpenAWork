export interface SessionRuntimePolicy {
  readonly includeCapabilityContext: boolean;
  readonly includeLspGuidance: boolean;
  readonly includePinnedSkillsPrompt: boolean;
  readonly includeDynamicWorkspaceTools: boolean;
  readonly includeFlatMcpToolDefinitions: boolean;
}

const DEFAULT_SESSION_RUNTIME_POLICY: SessionRuntimePolicy = {
  includeCapabilityContext: true,
  includeLspGuidance: true,
  includePinnedSkillsPrompt: true,
  includeDynamicWorkspaceTools: true,
  includeFlatMcpToolDefinitions: true,
};

export function isChannelManagedSessionMetadata(metadata: Record<string, unknown>): boolean {
  return metadata['source'] === 'channel';
}

/**
 * 来源托管会话：渠道（`channel`）与定时任务执行会话（`cron`）。
 *
 * 两者的共同点是**都没有「澄清 / 编程 / 程序员」对话模式**——它们的工具面分别由
 * 渠道 allowlist / permissions 与定时任务自身配置决定，且持久化 metadata 里从来不写
 * `dialogueMode`（见 `channels/channel-session-store.ts` 与 `cron/agent-handler.ts`）。
 *
 * 因此凡是以 `dialogueMode` 为条件的收敛（典型：澄清模式的只读工具白名单）都**不
 * 适用于**这些会话：一旦 metadata 被上游误写入 `dialogueMode: 'clarify'`，渠道会话
 * 的全部回复工具会被 `clarify-mode-tool-policy` 过滤掉，表现为「渠道里再也回不了消息」。
 */
export function isSourceManagedSessionMetadata(metadata: Record<string, unknown>): boolean {
  const source = metadata['source'];
  return source === 'channel' || source === 'cron';
}

/**
 * 子代理会话应从父会话继承的 `dialogueMode`：来源托管父会话一律继承「无」。
 *
 * 为什么必须显式拦住：子会话 metadata **不带** `source`（只有 `parentSessionId` +
 * `createdByTool: 'task'`，见 `tools/sandbox/handlers/delegation.ts`），而
 * `isGatewayToolEnabledForSessionMetadata` 的澄清豁免按**自身** `source` 判定——脏值一旦被
 * 复制进子会话，子会话就会重新落进澄清只读白名单，工具面被收敛成只读。也就是说
 * 「渠道会话派生子代理」会绕过父会话侧的豁免（与本仓既有的祖先链类盲区同源）。
 *
 * 返回 undefined 表示不继承（保持该键缺席），而不是写一个兜底模式。
 */
export function resolveInheritedDialogueMode(
  parentMetadata: Record<string, unknown>,
): string | undefined {
  if (isSourceManagedSessionMetadata(parentMetadata)) {
    return undefined;
  }
  const dialogueMode = parentMetadata['dialogueMode'];
  return typeof dialogueMode === 'string' ? dialogueMode : undefined;
}

export function resolveSessionRuntimePolicy(
  _metadata: Record<string, unknown>,
): SessionRuntimePolicy {
  return DEFAULT_SESSION_RUNTIME_POLICY;
}
