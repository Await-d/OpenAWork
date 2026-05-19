/**
 * Start Work
 *
 * Ported from oh-my-opencode's start-work hook.
 * Detects "ultrawork/ulw" keywords in user messages and:
 * 1. Finds Prometheus plan files
 * 2. Creates boulder state for the active plan
 * 3. Injects plan context into the conversation
 *
 * In oh-my-opencode this was a chat.message hook.
 * In OpenAWork it's integrated into the user message processing pipeline.
 */

import {
  readBoulderState,
  writeBoulderState,
  appendSessionId,
  findPrometheusPlans,
  getPlanProgress,
  createBoulderState,
  getPlanName,
  clearBoulderState,
} from '../session/boulder-state.js';
import { startRalphLoop } from '../session/ralph-loop.js';

export const KEYWORD_PATTERN = /\b(ultrawork|ulw)\b/gi;

/**
 * Check if the user message contains the start-work keyword.
 */
export function detectStartWorkKeyword(text: string): boolean {
  return KEYWORD_PATTERN.test(text);
}

/**
 * Extract an explicit plan name from the user message.
 * Looks for <user-request>...</user-request> tags and strips the keyword.
 */
function extractUserRequestPlanName(promptText: string): string | null {
  const userRequestMatch = promptText.match(/<user-request>\s*([\s\S]*?)\s*<\/user-request>/i);
  if (!userRequestMatch) return null;

  const rawArg = userRequestMatch[1]?.trim();
  if (!rawArg) return null;

  const cleanedArg = rawArg.replace(KEYWORD_PATTERN, '').trim();
  return cleanedArg || null;
}

/**
 * Find a plan by name (exact or partial match).
 */
function findPlanByName(plans: string[], requestedName: string): string | null {
  const lowerName = requestedName.toLowerCase();

  const exactMatch = plans.find((p) => getPlanName(p).toLowerCase() === lowerName);
  if (exactMatch) return exactMatch;

  const partialMatch = plans.find((p) => getPlanName(p).toLowerCase().includes(lowerName));
  return partialMatch || null;
}

/**
 * Process a start-work request. Returns context info to inject into the conversation.
 */
export async function processStartWork(
  workspaceRoot: string,
  sessionId: string,
  userMessage: string,
): Promise<string> {
  const timestamp = new Date().toISOString();
  const existingState = await readBoulderState(workspaceRoot);
  const explicitPlanName = extractUserRequestPlanName(userMessage);

  let contextInfo = '';

  if (explicitPlanName) {
    const allPlans = await findPrometheusPlans(workspaceRoot);
    const matchedPlan = findPlanByName(allPlans, explicitPlanName);

    if (matchedPlan) {
      const progress = await getPlanProgress(matchedPlan);

      if (progress.isComplete) {
        contextInfo = `## 计划已完成\n\n请求的计划 "${getPlanName(matchedPlan)}" 已完成。\n所有 ${progress.total} 个任务已完成。使用 /plan 创建新计划。`;
      } else {
        if (existingState) {
          await clearBoulderState(workspaceRoot);
        }
        const newState = createBoulderState(matchedPlan, sessionId);
        await writeBoulderState(workspaceRoot, newState);

        contextInfo = `## 自动选择计划\n\n**计划**: ${getPlanName(matchedPlan)}\n**路径**: ${matchedPlan}\n**进度**: ${progress.completed}/${progress.total} 任务\n**会话 ID**: ${sessionId}\n**开始时间**: ${timestamp}\n\nboulder.json 已创建。阅读计划并开始执行。`;

        // Start Ralph loop for ultrawork
        if (KEYWORD_PATTERN.test(userMessage)) {
          await startRalphLoop(workspaceRoot, sessionId, userMessage, {
            ultrawork: true,
            completionPromise: 'DONE',
          });
        }
      }
    } else {
      const planEntries = await Promise.all(
        (await findPrometheusPlans(workspaceRoot)).map(async (path) => ({
          path,
          progress: await getPlanProgress(path),
        })),
      );
      const incompletePlans = planEntries
        .filter((entry) => !entry.progress.isComplete)
        .map((entry) => entry.path);
      if (incompletePlans.length > 0) {
        const planList = (
          await Promise.all(
            incompletePlans.map(async (p, i) => {
              const prog = await getPlanProgress(p);
              return `${i + 1}. [${getPlanName(p)}] - 进度: ${prog.completed}/${prog.total}`;
            }),
          )
        ).join('\n');

        contextInfo = `## 未找到计划\n\n找不到匹配 "${explicitPlanName}" 的计划。\n\n可用的未完成计划：\n${planList}\n\n询问用户要处理哪个计划。`;
      } else {
        contextInfo = `## 未找到计划\n\n找不到匹配 "${explicitPlanName}" 的计划。\n没有可用的未完成计划。使用 /plan 创建新计划。`;
      }
    }
  } else if (existingState) {
    const progress = await getPlanProgress(existingState.active_plan);

    if (!progress.isComplete) {
      await appendSessionId(workspaceRoot, sessionId);
      contextInfo = `## 发现活跃工作会话\n\n**状态**: 恢复现有工作\n**计划**: ${existingState.plan_name}\n**路径**: ${existingState.active_plan}\n**进度**: ${progress.completed}/${progress.total} 任务完成\n**会话数**: ${existingState.session_ids.length + 1}\n**开始时间**: ${existingState.started_at}\n\n当前会话 (${sessionId}) 已添加到 session_ids。\n阅读计划文件并从第一个未勾选的任务继续。`;
    } else {
      contextInfo = `## 之前的工作已完成\n\n之前的计划 (${existingState.plan_name}) 已完成。\n正在寻找新计划...`;
    }
  }

  if (
    (!existingState && !explicitPlanName) ||
    (existingState &&
      !explicitPlanName &&
      (await getPlanProgress(existingState.active_plan)).isComplete)
  ) {
    const plans = await findPrometheusPlans(workspaceRoot);
    const incompletePlansWithProgress = await Promise.all(
      plans.map(async (p) => ({ path: p, progress: await getPlanProgress(p) })),
    );
    const incompletePlans = incompletePlansWithProgress.filter((p) => !p.progress.isComplete);

    if (plans.length === 0) {
      contextInfo += `\n\n## 未找到计划\n\n在 .sisyphus/plans/ 未找到 Prometheus 计划文件。\n使用 Prometheus 先创建工作计划。`;
    } else if (incompletePlans.length === 0) {
      contextInfo += `\n\n## 所有计划已完成\n\n所有 ${plans.length} 个计划已完成。使用 /plan 创建新计划。`;
    } else if (incompletePlans.length === 1) {
      const planPath = incompletePlans[0]!.path;
      const progress = incompletePlans[0]!.progress;
      const newState = createBoulderState(planPath, sessionId);
      await writeBoulderState(workspaceRoot, newState);

      contextInfo += `\n\n## 自动选择计划\n\n**计划**: ${getPlanName(planPath)}\n**路径**: ${planPath}\n**进度**: ${progress.completed}/${progress.total} 任务\n**会话 ID**: ${sessionId}\n**开始时间**: ${timestamp}\n\nboulder.json 已创建。阅读计划并开始执行。`;

      if (KEYWORD_PATTERN.test(userMessage)) {
        await startRalphLoop(workspaceRoot, sessionId, userMessage, {
          ultrawork: true,
          completionPromise: 'DONE',
        });
      }
    } else {
      const planList = (
        await Promise.all(
          incompletePlans.map(async (p, i) => {
            const stat = await import('node:fs').then((fs) => fs.promises.stat(p.path));
            const modified = new Date(stat.mtimeMs).toISOString();
            return `${i + 1}. [${getPlanName(p.path)}] - 修改: ${modified} - 进度: ${p.progress.completed}/${p.progress.total}`;
          }),
        )
      ).join('\n');

      contextInfo += `\n\n<system-reminder>\n## 找到多个计划\n\n当前时间: ${timestamp}\n会话 ID: ${sessionId}\n\n${planList}\n\n询问用户要处理哪个计划。展示上述选项并等待回复。\n</system-reminder>`;
    }
  }

  return contextInfo;
}
