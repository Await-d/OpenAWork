import { REFERENCE_AGENT_ROLE_METADATA } from '@openAwork/shared';

/** Role hints for orchestrators, not a list of tools or delegation triggers. */
export function buildDynamicOrchestratorPrompt(): string {
  const roleHints = Object.entries(REFERENCE_AGENT_ROLE_METADATA).flatMap(([name, role]) =>
    (role.triggers ?? []).map((hint) => `- \`${name}\`（${hint.domain}）：${hint.trigger}`),
  );

  return [
    '## 按需委派',
    '先确定用户要的交付物。证据足够则直接回答；在角色职责与权限允许的范围内，范围明确的工作优先用直接工具。只有广泛探索、可独立并行的工作或需要专门判断时，才考虑委派。关键词、模块数量和专家的存在都不构成委派要求。',
    '下列条目只用于在已决定委派后匹配角色，不代表本轮可用性；按本轮工具和能力选择，不扩张授权。',
    ...roleHints,
    '保留类型和错误检查，不用类型压制、空 catch 或删除失败测试掩盖问题；不推测未读代码，不把未经复核的代理报告当作完成证明。未经明确请求不提交。',
  ].join('\n');
}
