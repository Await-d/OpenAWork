import {
  activeSelectionSchema,
  imageGenerationDefaultsSchema,
  parseStoredImageGenerationDefaults,
} from '../provider/provider-config.js';

/**
 * settings 路由共享支撑（提取自 settings.ts，拆分轮次）。
 *
 * 文件级常量、类型与纯工具函数，供 settings 各分区路由文件共用：
 * - 审计日志行/审批历史/用户设置的 DB 行类型
 * - 审计 payload 的脱敏与摘要提取
 * - active-selection / image-generation-defaults 的「保留存储值」合并
 * - provider 目录侧的数量汇总
 */

interface AuditLogRow {
  id: number;
  session_id: string | null;
  tool_name: string;
  request_id: string;
  input_json: string | null;
  output_json: string | null;
  is_error: number;
  /** 1 = 该行是「已挂起、等用户交互」（提问 / 审批），不是故障。 */
  pending_interaction: number | null;
  duration_ms: number | null;
  created_at: string;
}

interface PermissionRequestHistoryRow {
  id: string;
  session_id: string;
  tool_name: string;
  scope: string;
  reason: string;
  risk_level: 'low' | 'medium' | 'high';
  decision: string | null;
  status: string;
  created_at: string;
}

interface UserSettingRow {
  key: string;
  value: string;
}

const AUDIT_PAYLOAD_MAX_STRING_LENGTH = 1000;
const AUDIT_PAYLOAD_MAX_DEPTH = 4;
const AUDIT_PAYLOAD_MAX_ARRAY_ITEMS = 20;
const REDACTED_VALUE = '[REDACTED]';
const TRUNCATED_SUFFIX = '…[truncated]';
const REDACTED_KEY_PATTERN =
  /(authorization|api[-_]?key|token|secret|password|cookie|set-cookie|session)/i;

const parseStoredJson = (value: string | undefined): unknown => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

function mergeActiveSelectionPreservingStored(input: {
  incoming: unknown;
  stored: unknown;
}): unknown {
  const incomingParsed = activeSelectionSchema.safeParse(input.incoming);
  if (!incomingParsed.success) {
    return input.stored;
  }

  const storedParsed = activeSelectionSchema.safeParse(input.stored);
  if (!storedParsed.success) {
    return incomingParsed.data;
  }

  return {
    ...storedParsed.data,
    ...incomingParsed.data,
    chat: incomingParsed.data.chat,
    fast: incomingParsed.data.fast,
    compaction: incomingParsed.data.compaction ?? storedParsed.data.compaction,
    image: incomingParsed.data.image ?? storedParsed.data.image,
  };
}

function mergeImageGenerationDefaultsPreservingStored(input: {
  incoming: unknown;
  stored: unknown;
}) {
  const incomingParsed = imageGenerationDefaultsSchema.safeParse(input.incoming);
  if (!incomingParsed.success) {
    return parseStoredImageGenerationDefaults(input.stored);
  }

  return {
    ...parseStoredImageGenerationDefaults(input.stored),
    ...incomingParsed.data,
  };
}

function extractAuditSummary(payload: unknown): string | null {
  if (typeof payload === 'string') {
    return payload.trim().length > 0 ? payload.trim() : null;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const summary = extractAuditSummary(item);
      if (summary) {
        return summary;
      }
    }
    return null;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const candidateKeys = ['message', 'error', 'summary', 'detail', 'reason', 'stderr', 'text'];
  for (const key of candidateKeys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  if (record['data']) {
    const dataSummary = extractAuditSummary(record['data']);
    if (dataSummary) {
      return dataSummary;
    }
  }

  return summarizeBatchResults(record);
}

/**
 * `batch` 的 output 只有 `{ results, total }`，失败细节藏在 `results[].output`，
 * 需单独派生摘要；无失败/待审批子调用时返回 null，保持其他工具的既有提取行为。
 *
 * 待审批（pending permission）不是失败：子调用返回的 `isError: true` 只是"等待
 * 用户批准"的占位结果，不能计入失败数。这里按 `tool-sandbox.ts` 的两条待审批
 * 文案单独归类，避免把"1/2 待审批"误报成"1/2 失败"。
 */
const BATCH_PENDING_PERMISSION_PATTERN =
  /requires approval before it can run|is waiting for approval/;

function isPendingPermissionOutput(output: unknown): boolean {
  return typeof output === 'string' && BATCH_PENDING_PERMISSION_PATTERN.test(output);
}

function summarizeBatchResults(record: Record<string, unknown>): string | null {
  const results = record['results'];
  if (!Array.isArray(results)) {
    return null;
  }

  const errorOutputs: unknown[] = [];
  const pendingOutputs: unknown[] = [];
  for (const entry of results) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const entryRecord = entry as Record<string, unknown>;
    if (entryRecord['isError'] !== true) {
      continue;
    }
    const output = entryRecord['output'];
    if (isPendingPermissionOutput(output)) {
      pendingOutputs.push(output);
    } else {
      errorOutputs.push(output);
    }
  }

  if (errorOutputs.length === 0 && pendingOutputs.length === 0) {
    return null;
  }

  const totalValue = record['total'];
  const total =
    typeof totalValue === 'number' && Number.isFinite(totalValue)
      ? Math.max(totalValue, results.length)
      : results.length;

  const segments: string[] = [];
  if (errorOutputs.length > 0) {
    segments.push(`${errorOutputs.length}/${total} 个子调用失败`);
  }
  if (pendingOutputs.length > 0) {
    segments.push(`${pendingOutputs.length}/${total} 个子调用待审批`);
  }
  const headline = `batch: ${segments.join('，')}`;

  let firstDetail: string | null = null;
  for (const output of errorOutputs) {
    const detail = extractAuditSummary(output);
    if (detail) {
      firstDetail = detail;
      break;
    }
  }

  const summary = firstDetail
    ? `${headline}：${firstDetail.replace(/\s+/g, ' ').trim()}`
    : headline;

  return truncateAuditString(summary);
}

/** 仅测试使用：暴露审计摘要提取逻辑，供 settings 路由测试断言。 */
export { extractAuditSummary };
export { extractAuditSummary as __extractAuditSummaryForTesting };

function truncateAuditString(value: string): string {
  if (value.length <= AUDIT_PAYLOAD_MAX_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, AUDIT_PAYLOAD_MAX_STRING_LENGTH)}${TRUNCATED_SUFFIX}`;
}

function sanitizeAuditPayload(payload: unknown, depth = 0): unknown {
  if (payload === null || payload === undefined) {
    return payload;
  }

  if (typeof payload === 'string') {
    return truncateAuditString(payload);
  }

  if (typeof payload === 'number' || typeof payload === 'boolean') {
    return payload;
  }

  if (typeof payload === 'bigint' || typeof payload === 'symbol') {
    return payload.toString();
  }

  if (typeof payload === 'function') {
    return '[Function]';
  }

  if (depth >= AUDIT_PAYLOAD_MAX_DEPTH) {
    return '[Max depth reached]';
  }

  if (Array.isArray(payload)) {
    return payload
      .slice(0, AUDIT_PAYLOAD_MAX_ARRAY_ITEMS)
      .map((item) => sanitizeAuditPayload(item, depth + 1));
  }

  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const sanitizedEntries = Object.entries(record).map(([key, value]) => {
      if (REDACTED_KEY_PATTERN.test(key)) {
        return [key, REDACTED_VALUE] as const;
      }

      return [key, sanitizeAuditPayload(value, depth + 1)] as const;
    });

    return Object.fromEntries(sanitizedEntries);
  }

  return '[Unsupported payload]';
}

const providerIdsKey = (providers: unknown[]): string =>
  providers
    .map((provider) => {
      const id = (provider as { id?: unknown } | null)?.id;
      return typeof id === 'string' ? id : '';
    })
    .join('\u0000');

const countProviderModels = (providers: unknown[]): number =>
  providers.reduce<number>((sum, provider) => {
    const models = (provider as { defaultModels?: unknown } | null)?.defaultModels;
    return sum + (Array.isArray(models) ? models.length : 0);
  }, 0);

export type { AuditLogRow, PermissionRequestHistoryRow, UserSettingRow };
export {
  parseStoredJson,
  mergeActiveSelectionPreservingStored,
  mergeImageGenerationDefaultsPreservingStored as mergeImageGenerationDefaultsPreservingStored,
  sanitizeAuditPayload,
  providerIdsKey,
  countProviderModels,
};
