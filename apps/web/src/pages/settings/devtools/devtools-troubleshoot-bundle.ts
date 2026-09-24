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
export function buildTroubleshootBundleMarkdown(input: TroubleshootBundleInput): string {
  const errorWorkers = input.workers.filter((worker) => worker.status === 'error');
  const failedSources = (
    Object.entries(input.sourceStates) as Array<[DevtoolsSourceKey, DevtoolsSourceState]>
  ).filter(([, source]) => source.status === 'error' && source.error);
  const issueCount = input.diagnostics.length + input.errorLogs.length + errorWorkers.length;

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
    `- 错误日志：${input.errorLogs.length} 条`,
    `- Worker 异常：${errorWorkers.length} 个`,
    `- 异常数据源：${failedSources.length} 个`,
    `- **待排查问题合计：${issueCount} 项**`,
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
