/**
 * GitHub Issue 同步器 — 将 error_boundary 遥测事件自动同步到 GitHub Issues。
 *
 * 策略：
 * 1. 对错误堆栈前 5 帧取 SHA-256 作为签名
 * 2. 24 小时窗口内相同签名不重复创建 Issue
 * 3. 已有 Issue 时追加 comment（更新 occurrence_count）
 * 4. 未配置 GITHUB_TELEMETRY_TOKEN / GITHUB_REPO 时静默跳过
 * 5. 内部限流 10 req/min，遵守 GitHub API 5000 req/h
 * 6. 所有失败静默吞掉，不影响遥测主流程
 *
 * 隐私：
 * - installId 仅保留前 8 位用于关联同一安装
 * - 不包含任何用户内容、文件路径、prompt
 */

import { createHash } from 'node:crypto';
import { getDedupEntry, upsertDedupEntry } from './telemetry-db.js';

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const GITHUB_API_BASE = 'https://api.github.com';
const MAX_REQUESTS_PER_MINUTE = 10;

let requestsThisMinute = 0;
let minuteWindowStart = 0;

interface GitHubConfig {
  token: string;
  repo: string; // owner/repo 格式
}

function loadGitHubConfig(): GitHubConfig | null {
  const token = process.env['GITHUB_TELEMETRY_TOKEN'];
  const repo = process.env['GITHUB_REPO'];
  if (!token || !repo) return null;
  return { token, repo };
}

function isRateLimited(): boolean {
  const now = Date.now();
  if (now - minuteWindowStart >= 60_000) {
    requestsThisMinute = 0;
    minuteWindowStart = now;
  }
  if (requestsThisMinute >= MAX_REQUESTS_PER_MINUTE) return true;
  requestsThisMinute += 1;
  return false;
}

/**
 * 从 error_boundary 事件属性中提取堆栈签名。
 * 使用堆栈前 5 帧（或所有可用的帧）的 SHA-256。
 */
function computeStackSignature(properties: Record<string, string | number | boolean>): string {
  const stack = String(properties['stack'] ?? properties['stackTrace'] ?? '');
  if (!stack) {
    // 无堆栈时用 errorName + message 作为 fallback 签名
    const fallback = `${properties['errorName'] ?? 'unknown'}:${properties['message'] ?? ''}`;
    return createHash('sha256').update(fallback).digest('hex');
  }

  const frames = stack.split('\n').slice(0, 5).join('\n');
  return createHash('sha256').update(frames).digest('hex');
}

/**
 * 构建脱敏的 Issue 正文。
 * installId 仅保留前 8 位用于关联同一安装的多次错误，不可逆向。
 */
function buildIssueBody(
  properties: Record<string, string | number | boolean>,
  installIdShort: string,
  occurrenceCount: number,
): string {
  const lines: string[] = [
    '## 自动错误报告',
    '',
    `**来源：** OpenAWork 遥测系统`,
    `**安装标识：** \`${installIdShort}\``,
    `**累计出现次数：** ${occurrenceCount}`,
    `**上报时间：** ${new Date().toISOString()}`,
    '',
    '### 错误信息',
    '',
    '| 字段 | 值 |',
    '|------|-----|',
  ];

  const fields: Array<[string, string]> = [
    ['错误名称', String(properties['errorName'] ?? 'unknown')],
    ['错误消息', String(properties['message'] ?? '(无)')],
    ['平台', String(properties['platform'] ?? 'unknown')],
    ['应用版本', String(properties['appVersion'] ?? 'unknown')],
    ['浏览器', String(properties['userAgent'] ?? 'unknown')],
  ];

  for (const [label, value] of fields) {
    lines.push(`| ${label} | ${value.length > 200 ? value.slice(0, 200) + '…' : value} |`);
  }

  lines.push('', '### 堆栈跟踪', '', '```');

  const stack = String(properties['stack'] ?? properties['stackTrace'] ?? '(无堆栈)');
  const truncatedStack = stack.length > 4000 ? stack.slice(0, 4000) + '\n…(truncated)' : stack;
  lines.push(truncatedStack);

  lines.push(
    '```',
    '',
    '---',
    '_此 Issue 由遥测系统自动创建，如需关闭请设置 `GITHUB_TELEMETRY_TOKEN=` 为空_',
  );

  return lines.join('\n');
}

function buildIssueTitle(properties: Record<string, string | number | boolean>): string {
  const errorName = String(properties['errorName'] ?? 'UnknownError');
  const platform = String(properties['platform'] ?? 'unknown');
  return `[Telemetry] ${errorName} on ${platform}`;
}

/**
 * 将 error_boundary 事件同步到 GitHub Issues。
 *
 * @param properties  事件属性
 * @param installId   完整 installId（仅取前 8 位用于 Issue 正文）
 */
export async function syncErrorToGitHub(
  properties: Record<string, string | number | boolean>,
  installId: string,
): Promise<void> {
  const config = loadGitHubConfig();
  if (!config) return;

  if (isRateLimited()) return;

  const signature = computeStackSignature(properties);
  const installIdShort = installId.slice(0, 8);

  // 检查去重
  const existing = getDedupEntry(signature);
  const now = Date.now();

  if (existing) {
    const lastSeen = new Date(existing.last_seen).getTime();
    if (now - lastSeen < DEDUP_WINDOW_MS) {
      // 窗口内重复，仅更新计数，不创建新 Issue
      upsertDedupEntry(signature);
      return;
    }

    // 窗口外重复，追加 comment 到已有 Issue
    if (existing.issue_number) {
      await addCommentToIssue(config, existing.issue_number, properties, installIdShort);
      upsertDedupEntry(signature);
      return;
    }
  }

  // 创建新 Issue
  const occurrenceCount = existing ? existing.occurrence_count + 1 : 1;
  const title = buildIssueTitle(properties);
  const body = buildIssueBody(properties, installIdShort, occurrenceCount);

  const issueNumber = await createIssue(config, title, body);
  upsertDedupEntry(signature, issueNumber ?? undefined);
}

async function createIssue(
  config: GitHubConfig,
  title: string,
  body: string,
): Promise<number | null> {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${config.repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        title,
        body,
        labels: ['auto-reported', 'telemetry'],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { number?: number };
    return data.number ?? null;
  } catch {
    return null;
  }
}

async function addCommentToIssue(
  config: GitHubConfig,
  issueNumber: number,
  properties: Record<string, string | number | boolean>,
  installIdShort: string,
): Promise<void> {
  try {
    const body = [
      `**复发报告** — ${new Date().toISOString()}`,
      `安装标识: \`${installIdShort}\``,
      `错误: ${String(properties['errorName'] ?? 'unknown')}: ${String(properties['message'] ?? '')}`,
    ].join('\n');

    await fetch(`${GITHUB_API_BASE}/repos/${config.repo}/issues/${String(issueNumber)}/comments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ body }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // 静默忽略
  }
}

// ── Test helpers ──────────────────────────────────────────────────

export function __resetGitHubSyncRateLimitForTesting(): void {
  requestsThisMinute = 0;
  minuteWindowStart = 0;
}

export function __computeStackSignatureForTesting(
  properties: Record<string, string | number | boolean>,
): string {
  return computeStackSignature(properties);
}

export function __loadGitHubConfigForTesting(): GitHubConfig | null {
  return loadGitHubConfig();
}
