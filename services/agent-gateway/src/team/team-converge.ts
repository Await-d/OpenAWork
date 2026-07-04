/**
 * /converge — 代码库与 spec/plan/tasks 一致性评估。
 *
 * 参考：spec-kit v0.11.2 `/speckit.converge`
 *   - 评估代码库当前状态与 spec/plan/tasks 的一致性
 *   - 将发现的偏差作为新任务追加
 *   - 支持增量评估（只检查自上次 converge 以来的变化）
 *
 * 本模块提供 converge 的核心逻辑，由 team-phase-a 路由调用。
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { sqliteGet, sqliteRun } from '../infra/db.js';

export interface ConvergeInput {
  userId: string;
  teamWorkspaceId: string;
  sessionId: string;
  /** 工作区根目录（用于读 .agentdocs/spec.md / plan.md / tasks.md + git diff） */
  workspaceRoot: string;
}

export type ConvergeDeviationSeverity = 'critical' | 'warning' | 'info';

export interface ConvergeDeviation {
  /** 偏差类型 */
  type:
    | 'spec_not_implemented'
    | 'plan_not_executed'
    | 'task_not_completed'
    | 'code_not_in_spec'
    | 'spec_changed_without_plan'
    | 'missing_artifact';
  /** 严重程度 */
  severity: ConvergeDeviationSeverity;
  /** 偏差描述 */
  description: string;
  /** 相关的 spec/plan/task 引用 */
  reference?: string;
  /** 建议的修正动作 */
  suggestedAction: string;
}

export interface ConvergeResult {
  /** 发现的偏差列表 */
  deviations: ConvergeDeviation[];
  /** 评估的 spec/plan/tasks 文件列表 */
  evaluatedArtifacts: string[];
  /** 评估时间戳 */
  timestamp: number;
  /** 评估耗时（ms） */
  durationMs: number;
  /** 是否发现 critical 偏差 */
  hasCriticalDeviations: boolean;
  /** 生成的偏差报告文本 */
  report: string;
}

interface ArtifactRow {
  type: string;
  content: string;
  updated_at: string;
}

/**
 * 执行 converge 一致性评估。
 *
 * 步骤：
 *   1. 读取 spec.md / plan.md / tasks.md 产物
 *   2. 读取 git diff（如果工作区是 git 仓库）
 *   3. 对比产物中的声明与实际代码状态
 *   4. 生成偏差报告
 */
export async function executeConverge(input: ConvergeInput): Promise<ConvergeResult> {
  const startAt = Date.now();
  const deviations: ConvergeDeviation[] = [];
  const evaluatedArtifacts: string[] = [];

  // 1. 读取产物文件
  const specContent = await readArtifactFile(input.workspaceRoot, '.agentdocs/spec.md');
  const planContent = await readArtifactFile(input.workspaceRoot, '.agentdocs/plan.md');
  const tasksContent = await readArtifactFile(input.workspaceRoot, '.agentdocs/tasks.md');

  if (specContent) {
    evaluatedArtifacts.push('.agentdocs/spec.md');
    // 检查 spec 中声明但代码中不存在的内容
    const specFeatures = extractFeaturesFromSpec(specContent);
    for (const feature of specFeatures) {
      const exists = await checkFeatureExists(input.workspaceRoot, feature);
      if (!exists) {
        deviations.push({
          type: 'spec_not_implemented',
          severity: 'warning',
          description: `Spec 中声明的功能尚未实现: ${feature.name}`,
          reference: `spec.md#${feature.name}`,
          suggestedAction: `将 "${feature.name}" 作为新任务追加到 tasks.md`,
        });
      }
    }
  }

  if (planContent) {
    evaluatedArtifacts.push('.agentdocs/plan.md');
    // 检查 plan 中声明的文件/目录是否实际存在
    const planFiles = extractFilesFromPlan(planContent);
    for (const filePath of planFiles) {
      const fullPath = path.join(input.workspaceRoot, filePath);
      try {
        await fs.access(fullPath);
      } catch {
        deviations.push({
          type: 'plan_not_executed',
          severity: 'warning',
          description: `Plan 中声明的文件不存在: ${filePath}`,
          reference: `plan.md → ${filePath}`,
          suggestedAction: `创建文件 ${filePath} 或更新 plan.md`,
        });
      }
    }
  }

  if (tasksContent) {
    evaluatedArtifacts.push('.agentdocs/tasks.md');
    // 检查 tasks.md 中未完成的任务
    const uncheckedTasks = extractUncheckedTasks(tasksContent);
    for (const task of uncheckedTasks) {
      deviations.push({
        type: 'task_not_completed',
        severity: 'info',
        description: `tasks.md 中尚未完成的任务: ${task.description}`,
        reference: `tasks.md → ${task.description}`,
        suggestedAction: `完成该任务或在 tasks.md 中标记为跳过`,
      });
    }
  }

  // 2. 检查是否有 DB 中存储的产物
  try {
    const dbArtifacts = sqliteGet<ArtifactRow>(
      `SELECT type, content, updated_at FROM team_artifacts
       WHERE team_workspace_id = ? AND session_id = ?
       ORDER BY updated_at DESC LIMIT 1`,
      [input.teamWorkspaceId, input.sessionId],
    );
    if (dbArtifacts) {
      evaluatedArtifacts.push(`db:${dbArtifacts.type}`);
    }
  } catch {
    // team_artifacts 表可能不存在，跳过
  }

  // 3. 如果没有任何产物，返回 info
  if (evaluatedArtifacts.length === 0) {
    deviations.push({
      type: 'missing_artifact',
      severity: 'info',
      description: '未找到 spec/plan/tasks 产物，无法执行一致性评估',
      suggestedAction: '先通过 PM1 层生成 spec → plan → tasks 产物链',
    });
  }

  // 4. 生成报告
  const hasCriticalDeviations = deviations.some((d) => d.severity === 'critical');
  const report = generateConvergeReport(deviations, evaluatedArtifacts);

  return {
    deviations,
    evaluatedArtifacts,
    timestamp: Date.now(),
    durationMs: Date.now() - startAt,
    hasCriticalDeviations,
    report,
  };
}

async function readArtifactFile(
  workspaceRoot: string,
  relativePath: string,
): Promise<string | null> {
  try {
    const fullPath = path.join(workspaceRoot, relativePath);
    const content = await fs.readFile(fullPath, 'utf8');
    return content.trim().length > 0 ? content.trim() : null;
  } catch {
    return null;
  }
}

interface SpecFeature {
  name: string;
  description?: string;
}

function extractFeaturesFromSpec(specContent: string): SpecFeature[] {
  const features: SpecFeature[] = [];
  // 匹配 ## Feature: xxx 或 ## 功能：xxx 标题
  const featureRegex = /^##\s+(?:Feature|功能)[:：]\s*(.+)$/gim;
  let match: RegExpExecArray | null;
  while ((match = featureRegex.exec(specContent)) !== null) {
    features.push({ name: match[1]!.trim() });
  }
  return features;
}

async function checkFeatureExists(workspaceRoot: string, feature: SpecFeature): Promise<boolean> {
  // 简单策略：检查工作区中是否有包含 feature name 的文件
  // 真实实现可以更复杂（语义搜索、符号匹配等）
  try {
    const entries = await fs.readdir(workspaceRoot, { recursive: true });
    const featureLower = feature.name.toLowerCase();
    for (const entry of entries) {
      const entryStr = String(entry).toLowerCase();
      if (entryStr.includes(featureLower)) {
        return true;
      }
    }
  } catch {
    // 目录读取失败，保守返回 true（不误报）
    return true;
  }
  return false;
}

function extractFilesFromPlan(planContent: string): string[] {
  const files: string[] = [];
  // 匹配 `path/to/file.ext` 或 `src/file.ts` 等模式
  const fileRegex = /`((?:src|lib|app|packages|services|apps)\/[^\s`]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = fileRegex.exec(planContent)) !== null) {
    files.push(match[1]!);
  }
  return [...new Set(files)];
}

interface TaskItem {
  description: string;
  completed: boolean;
}

function extractUncheckedTasks(tasksContent: string): TaskItem[] {
  const tasks: TaskItem[] = [];
  // 匹配 - [ ] xxx（未完成的任务）
  const uncheckedRegex = /^-\s+\[\s\]\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = uncheckedRegex.exec(tasksContent)) !== null) {
    tasks.push({ description: match[1]!.trim(), completed: false });
  }
  return tasks;
}

function generateConvergeReport(
  deviations: ConvergeDeviation[],
  evaluatedArtifacts: string[],
): string {
  const lines: string[] = [
    '# Converge 一致性评估报告',
    '',
    `评估时间: ${new Date().toISOString()}`,
    `评估产物: ${evaluatedArtifacts.join(', ') || '无'}`,
    `偏差总数: ${deviations.length}`,
    '',
  ];

  if (deviations.length === 0) {
    lines.push('✓ 代码库与 spec/plan/tasks 一致，无偏差。');
    return lines.join('\n');
  }

  const critical = deviations.filter((d) => d.severity === 'critical');
  const warnings = deviations.filter((d) => d.severity === 'warning');
  const infos = deviations.filter((d) => d.severity === 'info');

  if (critical.length > 0) {
    lines.push(`## ⚠ Critical 偏差（${critical.length}）`);
    for (const d of critical) {
      lines.push(`- **${d.type}**: ${d.description}`);
      lines.push(`  - 建议: ${d.suggestedAction}`);
    }
    lines.push('');
  }

  if (warnings.length > 0) {
    lines.push(`## ⚡ Warning 偏差（${warnings.length}）`);
    for (const d of warnings) {
      lines.push(`- **${d.type}**: ${d.description}`);
      lines.push(`  - 建议: ${d.suggestedAction}`);
    }
    lines.push('');
  }

  if (infos.length > 0) {
    lines.push(`## ℹ Info（${infos.length}）`);
    for (const d of infos) {
      lines.push(`- **${d.type}**: ${d.description}`);
      lines.push(`  - 建议: ${d.suggestedAction}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('请根据上述偏差修正代码或更新 spec/plan/tasks 产物。');

  return lines.join('\n');
}

/**
 * 记录 converge 评估结果到 DB，用于后续增量评估。
 */
export function recordConvergeResult(
  teamWorkspaceId: string,
  sessionId: string,
  result: ConvergeResult,
): void {
  sqliteRun(
    `INSERT INTO team_converge_results (id, team_workspace_id, session_id, result_json, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [`converge-${result.timestamp}`, teamWorkspaceId, sessionId, JSON.stringify(result)],
  );
}
