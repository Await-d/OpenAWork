import type { WorkerEntry } from '@openAwork/shared-ui';
import type {
  DevtoolsSourceKey,
  DevtoolsSourceState,
  SettingsDiagnosticRecord,
  SettingsDevLogRecord,
} from '../state/settings-types.js';
import { redactSecrets, redactUrl } from './devtools-redact.js';
import { stringifyDetails } from './devtools-workbench-primitives.js';

export interface TroubleshootBundleInput {
  generatedAt: string;
  appVersion: string;
  buildVersion: string;
  buildTime: string;
  gitHash: string;
  gitBranch: string;
  platform: string;
  userAgent: string;
  gatewayUrl: string;
  sourceStates: Record<DevtoolsSourceKey, DevtoolsSourceState>;
  diagnostics: SettingsDiagnosticRecord[];
  errorLogs: SettingsDevLogRecord[];
  workers: WorkerEntry[];
}

const SOURCE_STATUS_LABELS: Record<DevtoolsSourceState['status'], string> = {
  healthy: '正常',
  loading: '加载中',
  empty: '暂无数据',
  unavailable: '未接入',
  error: '失败',
};

function formatLogTimestamp(log: SettingsDevLogRecord): string {
  return log.createdAt ?? new Date(log.timestamp).toISOString();
}

/** 表格单元格：转义竖线与换行，避免破坏 Markdown 表格结构。 */
function tableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function codeBlock(value: unknown): string {
  return ['```json', stringifyDetails(value), '```'].join('\n');
}

/**
 * 构建「排障上下文」Markdown：一次性汇总环境信息、数据源状态、全部诊断记录、
 * 全部错误日志与 Worker 异常，便于直接粘贴给 AI 或同事排查。
 *
 * 诊断与日志的 `input` / `output` 会先经 `redactSecrets` 脱敏（密钥名、headers
 * 子树、带凭据的 URL），网关地址经 `redactUrl` 处理——排障包会被外发，不得携带凭据。
 *
 * 纯函数（无 React / 无 IO），单测覆盖格式稳定性。
 */
export interface IssueCountSummary {
  /** 去重后的待排查问题合计（诊断记录 + 错误日志 + Worker 异常）。 */
  total: number;
  /** 错误日志中与诊断记录指向同一事件的条数。 */
  duplicatedLogs: number;
}

/**
 * 跨数据源识别「同一条问题」的键。
 *
 * 优先用 `requestId`：网关的「诊断记录」与「错误日志」都取自 `audit_logs`，
 * 同一行的 `requestId`（工具调用 id / 请求 id）逐字相同，是唯一可靠的跨源身份；
 * 缺 `requestId` 时退回行 id（错误日志带审计行 id，workflow 行有 `workflow-`
 * 前缀，不会与审计行撞车）。两者都没有则返回 null —— 此时按「独立一条」计数，
 * 宁可高估也不把两条不同的问题合并成一条。
 */
function issueIdentity(record: { requestId?: string | null; id?: string | null }): string | null {
  const requestId = record.requestId?.trim();
  if (requestId && requestId.length > 0) return `request:${requestId}`;
  const id = record.id?.trim();
  return id && id.length > 0 ? `id:${id}` : null;
}

/**
 * 统计待排查问题。
 *
 * 「直接相加」会系统性虚高：诊断记录筛 `is_error = 1`，而错误日志是同一张表
 * 不过滤 `is_error`、再按 `is_error` 标成 `level: 'error'`，因此后者是前者的
 * 超集。2026-10-15 的一份排障包里 19 条诊断 + 8 条错误日志报成「27 项」，
 * 其中 7 条 requestId 与诊断记录逐字相同。
 */
export function summarizeIssues(input: {
  diagnostics: readonly SettingsDiagnosticRecord[];
  errorLogs: readonly SettingsDevLogRecord[];
  workers: readonly WorkerEntry[];
}): IssueCountSummary {
  const seen = new Set<string>();
  let anonymous = 0;

  for (const diagnostic of input.diagnostics) {
    const identity = issueIdentity(diagnostic);
    if (identity === null) anonymous += 1;
    else seen.add(identity);
  }

  let duplicatedLogs = 0;
  for (const log of input.errorLogs) {
    const identity = issueIdentity(log);
    if (identity === null) {
      anonymous += 1;
      continue;
    }
    if (seen.has(identity)) duplicatedLogs += 1;
    else seen.add(identity);
  }

  const errorWorkers = input.workers.filter((worker) => worker.status === 'error').length;
  return { total: seen.size + anonymous + errorWorkers, duplicatedLogs };
}

export function buildTroubleshootBundleMarkdown(input: TroubleshootBundleInput): string {
  const errorWorkers = input.workers.filter((worker) => worker.status === 'error');
  const failedSources = (
    Object.entries(input.sourceStates) as Array<[DevtoolsSourceKey, DevtoolsSourceState]>
  ).filter(([, source]) => source.status === 'error' && source.error);
  const issueSummary = summarizeIssues({
    diagnostics: input.diagnostics,
    errorLogs: input.errorLogs,
    workers: input.workers,
  });

  const lines: string[] = [
    '# OpenAWork 排障上下文',
    '',
    `- 生成时间：${input.generatedAt}`,
    `- 应用版本：${input.appVersion}（构建版本 ${input.buildVersion}）`,
    `- 构建时间：${input.buildTime}`,
    `- Git：${input.gitBranch} @ ${input.gitHash}`,
    `- 平台：${input.platform}`,
    `- 网关地址：${redactUrl(input.gatewayUrl)}`,
    `- User-Agent：${input.userAgent}`,
    '',
    '## 概览',
    '',
    `- 诊断记录：${input.diagnostics.length} 条`,
    `- 错误日志：${input.errorLogs.length} 条${
      issueSummary.duplicatedLogs > 0
        ? `（其中 ${issueSummary.duplicatedLogs} 条与诊断记录指向同一事件）`
        : ''
    }`,
    `- Worker 异常：${errorWorkers.length} 个`,
    `- 异常数据源：${failedSources.length} 个`,
    `- **待排查问题合计：${issueSummary.total} 项**${
      issueSummary.duplicatedLogs > 0 ? '（已按 requestId 跨数据源去重）' : ''
    }`,
    '',
    '## 数据源状态',
    '',
    '| 数据源 | 状态 | 说明 | 错误 |',
    '| --- | --- | --- | --- |',
  ];

  const sourceEntries = Object.entries(input.sourceStates) as Array<
    [DevtoolsSourceKey, DevtoolsSourceState]
  >;
  for (const [, source] of sourceEntries) {
    lines.push(
      `| ${tableCell(source.label)} | ${SOURCE_STATUS_LABELS[source.status]} | ${tableCell(source.detail)} | ${tableCell(source.error ?? '-')} |`,
    );
  }

  lines.push('', `## 诊断记录（${input.diagnostics.length} 条）`, '');

  if (input.diagnostics.length === 0) {
    lines.push('（无）', '');
  } else {
    input.diagnostics.forEach((diagnostic, index) => {
      lines.push(
        `### ${index + 1}. ${diagnostic.message}`,
        '',
        `- 严重级别：${diagnostic.severity}`,
        `- 工具：${diagnostic.toolName ?? '-'}`,
        `- 文件：${diagnostic.filePath}`,
        `- 请求 ID：${diagnostic.requestId ?? '-'}`,
        `- 会话：${diagnostic.sessionId ?? '-'}`,
        `- 耗时：${typeof diagnostic.durationMs === 'number' ? `${diagnostic.durationMs}ms` : '-'}`,
        `- 时间：${diagnostic.createdAt ?? '-'}`,
        '',
        '输入：',
        '',
        codeBlock(redactSecrets(diagnostic.input)),
        '',
        '输出 / 错误：',
        '',
        codeBlock(redactSecrets(diagnostic.output)),
        '',
      );
    });
  }

  lines.push('', `## 错误日志（${input.errorLogs.length} 条）`, '');

  if (input.errorLogs.length === 0) {
    lines.push('（无）', '');
  } else {
    input.errorLogs.forEach((log, index) => {
      lines.push(
        `### ${index + 1}. ${log.message}`,
        '',
        `- 来源：${log.source ?? 'settings'}`,
        `- 请求 ID：${log.requestId ?? '-'}`,
        `- 会话：${log.sessionId ?? '-'}`,
        `- 耗时：${typeof log.durationMs === 'number' ? `${log.durationMs}ms` : '-'}`,
        `- 时间：${formatLogTimestamp(log)}`,
        '',
        '输入：',
        '',
        codeBlock(redactSecrets(log.input)),
        '',
        '输出：',
        '',
        codeBlock(redactSecrets(log.output)),
        '',
      );
    });
  }

  lines.push('', `## Worker 异常（${errorWorkers.length} 个）`, '');

  if (errorWorkers.length === 0) {
    lines.push('（无）', '');
  } else {
    errorWorkers.forEach((worker, index) => {
      lines.push(
        `### ${index + 1}. ${worker.name}`,
        '',
        `- ID：${worker.id}`,
        `- 状态：${worker.status}`,
        `- 模式：${worker.mode ?? 'unknown'}`,
        `- 端点：${worker.endpoint ?? '未配置端点'}`,
        '',
      );
    });
  }

  return lines.join('\n').trimEnd() + '\n';
}
