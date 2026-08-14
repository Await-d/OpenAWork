/**
 * 技能状态恢复
 *
 * 从持久化存储中恢复会话的技能上下文，确保会话恢复时技能可用。
 *
 * 参考实现：
 * Claude Code - conversationRecovery.ts (行 382-403)
 *
 * 核心逻辑：
 * 1. 从数据库加载会话的已调用技能
 * 2. 将技能重新注入到运行时技能注册表
 * 3. 保持技能的原始调用顺序
 *
 * 集成点：
 * - 会话恢复时自动调用（POST /sessions/:sessionId/resume）
 * - 技能调用时记录状态（Skill 工具）
 */

import { loadInvokedSkills, type InvokedSkill } from './session-skill-state-store.js';

/**
 * 技能注入回调函数类型
 *
 * 用于将恢复的技能注入到运行时技能注册表。
 * 这个回调应该由调用方提供，因为技能注册表的实现可能在不同的模块中。
 */
export type SkillInjectorCallback = (
  skillName: string,
  skillPath: string,
  skillContent: string,
) => void;

/**
 * 技能恢复结果
 */
export interface SkillRecoveryResult {
  /** 是否成功恢复 */
  success: boolean;
  /** 恢复的技能数量 */
  restoredCount: number;
  /** 恢复的技能列表 */
  restoredSkills: Array<{
    name: string;
    path: string;
  }>;
  /** 失败的技能列表（如果有） */
  failedSkills: Array<{
    name: string;
    error: string;
  }>;
}

/**
 * 从会话恢复技能状态
 *
 * 这个函数从数据库加载会话的已调用技能，并通过注入回调将它们重新加载到运行时。
 *
 * 使用示例：
 * ```typescript
 * // 在会话恢复流程中
 * const result = restoreSkillStateFromSession(sessionId, (name, path, content) => {
 *   // 将技能注入到运行时注册表
 *   skillRegistry.addInvokedSkill(name, path, content);
 * });
 *
 * if (result.success) {
 *   console.log(`恢复了 ${result.restoredCount} 个技能`);
 * }
 * ```
 *
 * @param sessionId 会话 ID
 * @param injector 技能注入回调函数
 * @returns 恢复结果
 */
export function restoreSkillStateFromSession(
  sessionId: string,
  injector: SkillInjectorCallback,
): SkillRecoveryResult {
  const result: SkillRecoveryResult = {
    success: true,
    restoredCount: 0,
    restoredSkills: [],
    failedSkills: [],
  };

  try {
    // 从数据库加载已调用的技能
    const invokedSkills = loadInvokedSkills(sessionId);

    if (invokedSkills.length === 0) {
      return result;
    }

    // 按调用顺序恢复技能
    for (const skill of invokedSkills) {
      try {
        // 验证技能数据完整性
        if (!skill.skillName || !skill.skillPath || !skill.skillContent) {
          result.failedSkills.push({
            name: skill.skillName || '(unknown)',
            error: 'Incomplete skill data',
          });
          continue;
        }

        // 注入技能到运行时
        injector(skill.skillName, skill.skillPath, skill.skillContent);

        result.restoredSkills.push({
          name: skill.skillName,
          path: skill.skillPath,
        });
        result.restoredCount++;
      } catch (error) {
        // 单个技能恢复失败不应阻止其他技能恢复
        result.failedSkills.push({
          name: skill.skillName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 如果有任何技能恢复失败，标记为部分成功
    if (result.failedSkills.length > 0) {
      result.success = result.restoredCount > 0;
    }

    return result;
  } catch (error) {
    // 整体加载失败
    result.success = false;
    result.failedSkills.push({
      name: '(all)',
      error: error instanceof Error ? error.message : String(error),
    });
    return result;
  }
}

/**
 * 从消息历史中提取技能状态（兼容性辅助函数）
 *
 * 这个函数用于从消息历史中提取已调用的技能信息，
 * 可以用作数据库持久化之前的备用恢复机制。
 *
 * 参考 Claude Code 的实现：
 * - 扫描 attachment 类型为 'invoked_skills' 的消息
 * - 提取 skills 数组中的 name、path、content
 *
 * @param messages 消息历史
 * @returns 已调用的技能列表
 */
export function extractInvokedSkillsFromMessages(
  messages: Array<{
    type?: string;
    attachment?: {
      type?: string;
      skills?: Array<{
        name?: string;
        path?: string;
        content?: string;
      }>;
    };
  }>,
): InvokedSkill[] {
  const skills: InvokedSkill[] = [];
  let idCounter = 0;

  for (const message of messages) {
    if (message.type !== 'attachment') {
      continue;
    }

    if (message.attachment?.type === 'invoked_skills' && message.attachment.skills) {
      for (const skill of message.attachment.skills) {
        if (skill.name && skill.path && skill.content) {
          skills.push({
            id: idCounter++,
            sessionId: '', // 由调用方填充
            skillName: skill.name,
            skillPath: skill.path,
            skillContent: skill.content,
            invokedAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  return skills;
}

/**
 * 构建技能恢复摘要（用于日志和调试）
 *
 * @param result 恢复结果
 * @returns 摘要文本
 */
export function buildSkillRecoverySummary(result: SkillRecoveryResult): string {
  if (!result.success && result.restoredCount === 0) {
    return `技能恢复失败: ${result.failedSkills.map((f) => f.error).join(', ')}`;
  }

  if (result.restoredCount === 0 && result.failedSkills.length === 0) {
    return '无技能需要恢复';
  }

  const parts: string[] = [];

  if (result.restoredCount > 0) {
    parts.push(`成功恢复 ${result.restoredCount} 个技能`);
    if (result.restoredSkills.length > 0 && result.restoredSkills.length <= 5) {
      parts.push(`(${result.restoredSkills.map((s) => s.name).join(', ')})`);
    }
  }

  if (result.failedSkills.length > 0) {
    parts.push(`${result.failedSkills.length} 个失败`);
  }

  return parts.join('; ');
}
