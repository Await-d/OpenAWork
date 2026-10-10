/**
 * agentignore 拦截文案的**唯一来源**。
 *
 * 除了告知「该路径受保护」,还给出可执行的下一步 —— 模型常反复尝试读取同一批
 * 敏感文件(如 `.env.production` / `.env.development`),在诊断面板里刷出大量
 * 无效错误。把常见受保护模式与替代做法直接写进工具输出,让模型当轮就能换路子。
 *
 * 文案保留 `Access denied: ... is protected by agentignore rules` 前缀不变,便于
 * 既有日志/检索口径稳定。
 */

export type AgentIgnoreDenialTarget = 'file' | 'directory';

const AGENTIGNORE_DENIAL_HINT =
  '该类路径受 agentignore 保护(常见受保护模式:`.env` / `.env.*`、`*.pem` / `*.key` / `id_rsa*`、`.aws/credentials`、`*.sqlite` / `*.db`、`node_modules/**`、`.git/**` 等)。' +
  '请勿重复尝试读取或写入;如需其中的值,请让用户显式提供,或改读不含敏感值的等价文件(如 `.env.example`)。';

/** 生成统一的 agentignore 拦截消息(保持原有前缀 + 追加可执行指引)。 */
export function formatAgentIgnoreDenial(target: AgentIgnoreDenialTarget, path: string): string {
  return `Access denied: ${target} "${path}" is protected by agentignore rules. ${AGENTIGNORE_DENIAL_HINT}`;
}
