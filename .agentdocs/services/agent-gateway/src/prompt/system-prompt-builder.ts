/**
 * 系统提示词构建器
 *
 * 参考: Claude Code prompts.ts
 */

export interface SystemPromptOptions {
  enabledTools: Set<string>;
  model: string;
  language?: string;
  workspaceRoot?: string;
}

/**
 * 系统提示词动态边界标记
 */
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__';

/**
 * 构建完整的系统提示词
 */
export async function buildSystemPrompt(
  options: SystemPromptOptions,
): Promise<string[]> {
  const { enabledTools } = options;

  return [
    // === 静态内容（可缓存）===
    getIntroSection(),
    getDoingTasksSection(),
    getToolsUsageSection(enabledTools),
    getToneAndStyleSection(),

    // === 动态边界 ===
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY,

    // === 动态内容 ===
    getEnvironmentSection(options),
    getLanguageSection(options.language),
  ].filter((s): s is string => s !== null);
}

function getIntroSection(): string {
  return '你是 OpenAWork AI Agent 工作台的智能助手。';
}

function getDoingTasksSection(): string {
  return `# 执行任务

- 仔细理解用户需求
- 选择合适的工具完成任务
- 提供清晰的反馈`;
}

function getToolsUsageSection(enabledTools: Set<string>): string {
  // 动态导入工具章节
  try {
    const { buildToolUsageSections } = require('./tool-sections.js');
    return buildToolUsageSections(enabledTools);
  } catch {
    return '# 工具使用指南\n\n（工具章节加载中...）';
  }
}

function getToneAndStyleSection(): string {
  return `# 语气和风格

- 使用专业、友好的语气
- 提供清晰、准确的回答`;
}

function getEnvironmentSection(options: SystemPromptOptions): string {
  const { workspaceRoot, model } = options;
  return `# 环境信息

- 工作目录: ${workspaceRoot || process.cwd()}
- 模型: ${model}`;
}

function getLanguageSection(language?: string): string | null {
  if (!language) return null;
  return `# 语言偏好\n\n所有回复使用${language}。`;
}
