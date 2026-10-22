/**
 * 流式失败的「给人看」文案收敛。
 *
 * 背景：`handleStreamRequest` 在 `stopReason === 'error'` 时曾把 `errorSummary` 硬编码为
 * 「模型服务内部错误，请稍后重试」，把 `upstreamError` 里已经分好类的信息（上游分类、
 * HTTP 状态、上游原话、建议）整段丢掉。渠道侧（`channels/router.ts`）只能拿到这句
 * `errorSummary`，于是 IM 回复、`sessions.last_error`、`CHANNEL_RUN_FAILED` 审计行三处
 * 全部退化成同一句无信息量的话 —— 排障页再怎么渲染也看不到真因。
 *
 * 这里把同一份上游错误拆成两个出口，调用方各取所需：
 *   - `summary`：单行、可直接展示（IM 回复 / 会话失败标记 / 审计 `message`）；
 *   - `detail`：多行技术证据（审计 `channelDetail` / 诊断面板输出），只用于排障。
 *
 * 纯函数、不抛错：上游错误描述字段可能缺失或形态漂移，任何异常都必须降级成
 * 「通用文案 + HTTP 状态」，不能让文案组装反过来打断失败上报。
 */

/** 上游错误描述中本模块关心的字段（`UpstreamErrorDescriptor` 的结构子集）。 */
export interface StreamUpstreamErrorLike {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly technicalDetail?: string | undefined;
  /** `describeUpstreamErrorForUser` 渲染的中文说明（含原因 / 上游原话 / 建议）。 */
  readonly userMessage?: string | undefined;
  readonly retryAfterMs?: number | undefined;
}

export interface StreamFailureMessages {
  /** 单行摘要；保证非空，可直接落 `message` / `last_error` / IM 回复。 */
  readonly summary: string;
  /**
   * 多行技术详情；恒有值 —— 至少包含 HTTP 状态，或在没有上游证据时明确写出
   * 「未收到上游错误详情」，避免排障时把「没记录」误读成「已展示全量」。
   */
  readonly detail: string;
  /** 上游错误码（如 `V2_TRANSIENT_5XX`），供审计检索。 */
  readonly code: string | undefined;
}

/** 没有任何上游信息时的兜底文案；保留「稍后重试」以免丢失可重试语义。 */
export const STREAM_FAILURE_FALLBACK_SUMMARY = '模型服务内部错误，请稍后重试';

/** 摘要上限：IM 消息与会话列表都不适合承载长文本。 */
const SUMMARY_MAX_LENGTH = 600;

/** 详情上限与渠道审计的摘要上限一致，避免单行审计被技术详情撑爆。 */
const DETAIL_MAX_LENGTH = 2_000;

function clampText(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…（已截断）` : trimmed;
}

/**
 * 把「原因 / 上游返回 / 建议」这类多行 markdown 说明压成一行：
 * IM 平台按纯文本渲染，保留换行会变成一串空行；`**` 也会原样露出来。
 */
function toSingleLine(value: string): string {
  return value
    .replace(/[*`]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s*\n+\s*/g, '；')
    .replace(/。；/g, '；')
    .replace(/；{2,}/g, '；')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** 取多行文本首行，用于 `technicalDetail` 兜底（首行通常就是真正的错误）。 */
function firstLine(value: string): string {
  const [line] = value.replace(/\r\n?/g, '\n').split('\n');
  return line?.trim() ?? '';
}

/**
 * 生成失败摘要与技术详情。
 *
 * 优先级：中文说明 → 分类短消息 → 技术详情首行 → 通用兜底。前三者都可能缺失，
 * 因此 `summary` 恒有值；`detail` 只承载「与摘要不同的额外证据」，避免重复。
 */
export function resolveStreamFailureMessages(input: {
  readonly upstreamError?: StreamUpstreamErrorLike | undefined;
  readonly statusCode: number;
}): StreamFailureMessages {
  const upstream = input.upstreamError;
  const code = upstream?.code?.trim() || undefined;
  const technicalDetail = upstream?.technicalDetail?.trim() || undefined;
  const rawMessage = upstream?.message?.trim() || undefined;
  const rawUserMessage = upstream?.userMessage?.trim() || undefined;

  const summaryCandidate =
    rawUserMessage ?? rawMessage ?? (technicalDetail ? firstLine(technicalDetail) : undefined);

  const summary = clampText(
    summaryCandidate
      ? toSingleLine(summaryCandidate)
      : `${STREAM_FAILURE_FALLBACK_SUMMARY}（HTTP ${input.statusCode}）`,
    SUMMARY_MAX_LENGTH,
  );

  const detailLines: string[] = [];
  const hasUpstreamEvidence =
    code !== undefined ||
    technicalDetail !== undefined ||
    rawMessage !== undefined ||
    rawUserMessage !== undefined ||
    upstream?.retryAfterMs !== undefined;
  if (!hasUpstreamEvidence) {
    // 连技术详情都没有：明确写出「没有收到上游证据」，避免排障时误以为已展示全量。
    detailLines.push(
      `HTTP 状态：${input.statusCode}；未收到上游错误详情（可能为会话恢复失败或流被中断）`,
    );
  } else {
    if (code) {
      detailLines.push(`上游错误码：${code}`);
    }
    if (input.statusCode >= 400) {
      detailLines.push(`HTTP 状态：${input.statusCode}`);
    }
    // 与**单行化且截断后的摘要**比较，而不是与原始候选值比较：摘要被截断时
    // （流内 error 事件只带 technicalDetail 是最典型的场景）必须把全文留在
    // 技术详情里，否则超过 600 字的部分在审计中彻底消失。
    if (technicalDetail && toSingleLine(technicalDetail) !== summary) {
      detailLines.push(`技术详情：${technicalDetail}`);
    }
    if (upstream?.retryAfterMs !== undefined) {
      detailLines.push(`上游建议等待：${upstream.retryAfterMs}ms`);
    }
  }

  return {
    summary:
      summary.length > 0
        ? summary
        : `${STREAM_FAILURE_FALLBACK_SUMMARY}（HTTP ${input.statusCode}）`,
    detail: clampText(detailLines.join('\n'), DETAIL_MAX_LENGTH),
    code,
  };
}
