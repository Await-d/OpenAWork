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

/**
 * bash 超限输出落盘目录（各 workspace 根下的 `.openAwork/tool-output`）。
 *
 * 命中该目录的拦截必须**特判**：这些文件是工具刚生成的产物，正常应已被
 * agentignore 豁免（见 agent-core `filesystem/ignore.ts`）；一旦仍被拦
 * （如项目自带更严的规则），直接告诉模型「这是 bash 落盘文件 + 唯一正确
 * 取回路径」，否则模型会在同一目录上反复撞墙（2026-10-18 排障）。
 */
const TOOL_OUTPUT_DIR_MARKER = '/.openAwork/tool-output/';

/** 判断路径是否为 bash 超限输出的落盘文件。 */
export function isBashToolOutputPath(path: string): boolean {
  return path.replace(/\\/g, '/').includes(TOOL_OUTPUT_DIR_MARKER);
}

/** 生成统一的 agentignore 拦截消息(保持原有前缀 + 追加可执行指引)。 */
export function formatAgentIgnoreDenial(target: AgentIgnoreDenialTarget, path: string): string {
  if (target === 'file' && isBashToolOutputPath(path)) {
    return (
      `Access denied: ${target} "${path}" is protected by agentignore rules. ` +
      `该文件是 bash 工具截断超限输出时落盘的完整原文。请**不要**用 read / grep 等文件工具读取它：` +
      `回到触发截断的那次 bash 调用，改用 read_tool_output 并传该次调用的 toolCallId（配合 lineStart / lineCount）。` +
      `工具结果在会话内持久化，read_tool_output 不受 agentignore 限制。`
    );
  }
  return `Access denied: ${target} "${path}" is protected by agentignore rules. ${AGENTIGNORE_DENIAL_HINT}`;
}
