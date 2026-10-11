import fs from 'fs/promises';
import path from 'path';
import { findPrometheusPlans } from '../session/boulder-state.js';

/**
 * 工作计划（workflow plan）发现与匹配（提取自 commands.ts，拆分轮次 2/4）。
 *
 * 扫描 `.agentdocs/workflow` 与 legacy `.boulder`（Prometheus）计划文件，
 * 解析 markdown checklist 进度，并按用户请求做精确/模糊匹配。
 * 供 `/start-work`、`/handoff` 与 Ralph/ULW loop 运行时共用。
 */

export interface WorkflowPlanSummary {
  completed: number;
  filePath: string;
  modifiedAt: number;
  pendingItems: string[];
  relativePath: string;
  title: string;
  total: number;
}

function getWorkflowPlanSearchFields(plan: WorkflowPlanSummary): readonly string[] {
  const relativePathWithoutExtension = plan.relativePath.endsWith('.md')
    ? plan.relativePath.slice(0, -'.md'.length)
    : plan.relativePath;

  return [
    plan.title,
    relativePathWithoutExtension,
    path.basename(plan.relativePath, '.md'),
    plan.relativePath,
  ].map((field) => field.toLowerCase());
}

export function findMatchingWorkflowPlan(
  summaries: readonly WorkflowPlanSummary[],
  requestedPlan: string | undefined,
): WorkflowPlanSummary | null {
  const requested = requestedPlan?.trim().toLowerCase();
  if (!requested) {
    return summaries[0] ?? null;
  }

  const exactMatch = summaries.find((item) =>
    getWorkflowPlanSearchFields(item).some((field) => field === requested),
  );
  if (exactMatch) return exactMatch;

  return (
    summaries.find((item) =>
      getWorkflowPlanSearchFields(item).some((field) => field.includes(requested)),
    ) ?? null
  );
}

export async function findLatestWorkflowPlan(
  workspaceRoot: string,
  requestedPlan?: string,
): Promise<WorkflowPlanSummary | null> {
  const files = await collectWorkflowPlanFiles(workspaceRoot);
  const summaries = (
    await Promise.all(files.map((filePath) => readWorkflowPlanSummary(filePath, workspaceRoot)))
  )
    .filter((item): item is WorkflowPlanSummary => item !== null)
    .filter((item) => item.total > 0 && item.completed < item.total)
    .sort((a, b) => b.modifiedAt - a.modifiedAt);

  return findMatchingWorkflowPlan(summaries, requestedPlan);
}

async function collectWorkflowPlanFiles(workspaceRoot: string): Promise<string[]> {
  const nativeFiles = await collectWorkflowMarkdownFiles(
    path.join(workspaceRoot, '.agentdocs', 'workflow'),
  );
  const compatibilityFiles = await findPrometheusPlans(workspaceRoot);
  return [...new Set([...nativeFiles, ...compatibilityFiles])];
}

async function collectWorkflowMarkdownFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const nested = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name !== 'done')
        .map((entry) => collectWorkflowMarkdownFiles(path.join(dirPath, entry.name))),
    );

    return [
      ...entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => path.join(dirPath, entry.name)),
      ...nested.flat(),
    ];
  } catch {
    return [];
  }
}

async function readWorkflowPlanSummary(
  filePath: string,
  workspaceRoot: string,
): Promise<WorkflowPlanSummary | null> {
  try {
    const [content, stats] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);
    const { completed, pendingItems, total } = parseMarkdownChecklist(content);

    return {
      completed,
      filePath,
      modifiedAt: stats.mtimeMs,
      pendingItems,
      relativePath: toWorkspaceRelativePath(filePath, workspaceRoot),
      title: extractMarkdownTitle(content, path.basename(filePath, '.md')),
      total,
    };
  } catch {
    return null;
  }
}

function parseMarkdownChecklist(content: string): {
  completed: number;
  pendingItems: string[];
  total: number;
} {
  const matches = [...content.matchAll(/^- \[( |x|X)\]\s+(.+)$/gm)];
  const pendingItems = matches
    .filter((match) => match[1] === ' ')
    .map((match) => match[2]?.trim() ?? '')
    .filter((item) => item.length > 0)
    .slice(0, 5);

  return {
    completed: matches.filter((match) => match[1]?.toLowerCase() === 'x').length,
    pendingItems,
    total: matches.length,
  };
}

function extractMarkdownTitle(content: string, fallback: string): string {
  const titleLine = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('# '));
  return titleLine ? titleLine.slice(2).trim() : fallback;
}

export function toWorkspaceRelativePath(filePath: string, workspaceRoot: string): string {
  const relativePath = path.relative(workspaceRoot, filePath);
  return relativePath && !relativePath.startsWith('..')
    ? relativePath.replaceAll('\\', '/')
    : filePath;
}
