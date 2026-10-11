/**
 * 提示词评估类型定义（借鉴 prompt-optimizer 的评估体系，按 OpenAWork 场景裁剪）。
 *
 * 四种评估类型：
 * - result        单结果评估：评估某提示词在一次测试中的输出效果
 * - compare       对比评估：原始版 vs 优化版（A/B）的测试效果
 * - prompt-only   仅提示词评估：直接评估提示词本身质量，无需测试结果
 * - prompt-iterate 带迭代需求的提示词评估：评估是否满足用户迭代要求
 */

// ==================== 评估类型 ====================

export type PromptEvaluationType =
  | 'result'
  | 'compare'
  | 'prompt-only'
  | 'prompt-iterate';

// ==================== 补丁操作（借鉴 PatchOperation 设计） ====================

export type PatchOperationType = 'insert' | 'replace' | 'delete';

/**
 * 补丁操作——评估产出「精准修复指令」而非整篇重写。
 *
 * 操作约定：
 * - insert：oldText 是锚点上下文，newText = oldText + 插入内容
 * - delete：newText = ''
 * - replace：直接 oldText → newText
 *
 * 本地 apply 就是简单字符串替换，支持 diff 可视化渲染（红删绿增）。
 */
export interface PatchOperation {
  op: PatchOperationType;
  /** 修改前的原文本片段（用于定位和 diff 展示）。 */
  oldText: string;
  /** 修改后的文本（删除时为空字符串）。 */
  newText: string;
  /** 操作说明（问题描述 + 修复说明）。 */
  instruction: string;
  /** 出现次数（从 1 开始，处理多次出现的情况，默认 1）。 */
  occurrence?: number;
}

// ==================== 测试用例与执行快照 ====================

/** 测试用例输入内容块。 */
export interface EvaluationContentBlock {
  kind: 'text' | 'variables' | 'conversation' | 'json';
  label: string;
  content: string;
  summary?: string;
}

/** 测试用例——表达「这次到底在测什么」，可被多个快照共享。 */
export interface EvaluationTestCase {
  id: string;
  label?: string;
  input: EvaluationContentBlock;
}

/** 提示词来源引用。 */
export interface EvaluationPromptRef {
  kind: 'workspace' | 'original' | 'version' | 'custom';
  version?: number;
  label?: string;
}

/** 单次执行快照——某提示词在某个测试用例上的真实输出。 */
export interface EvaluationSnapshot {
  id: string;
  /** 快照标签，如 A / B / C。 */
  label: string;
  testCaseId: string;
  promptRef: EvaluationPromptRef;
  promptText: string;
  output: string;
  modelKey?: string;
  versionLabel?: string;
}

// ==================== 请求 ====================

export interface PromptEvaluationRequestBase {
  /** 被评估的可编辑目标提示词。 */
  workspacePrompt: string;
  /** 可选参考提示词（如 v0 / 优化前的原始版本）。 */
  referencePrompt?: string;
}

export interface ResultEvaluationRequest extends PromptEvaluationRequestBase {
  type: 'result';
  testCase: EvaluationTestCase;
  snapshot: EvaluationSnapshot;
}

export interface CompareEvaluationRequest extends PromptEvaluationRequestBase {
  type: 'compare';
  testCases: EvaluationTestCase[];
  /** 执行快照（至少 2 个）。 */
  snapshots: EvaluationSnapshot[];
}

export interface PromptOnlyEvaluationRequest extends PromptEvaluationRequestBase {
  type: 'prompt-only';
}

export interface PromptIterateEvaluationRequest extends PromptEvaluationRequestBase {
  type: 'prompt-iterate';
  /** 迭代需求（用户期望本次优化解决什么）。 */
  iterateRequirement: string;
}

export type PromptEvaluationRequest =
  | ResultEvaluationRequest
  | CompareEvaluationRequest
  | PromptOnlyEvaluationRequest
  | PromptIterateEvaluationRequest;

// ==================== 响应 ====================

export interface EvaluationDimension {
  key: string;
  label: string;
  /** 维度分数（0-100）。 */
  score: number;
}

export interface EvaluationScore {
  /** 总分（0-100）。 */
  overall: number;
  dimensions: EvaluationDimension[];
}

/** 机器可读的迭代止损信号（借鉴 CompareStopSignals）。 */
export interface EvaluationStopSignals {
  /** 相对参考版的改进方向。 */
  targetVsBaseline?: 'improved' | 'flat' | 'regressed';
  /** 距离理想目标的剩余空间。 */
  improvementHeadroom?: 'none' | 'low' | 'medium' | 'high';
  /** 过拟合风险：提示词过度针对样例而丧失通用性。 */
  overfitRisk?: 'low' | 'medium' | 'high';
  stopRecommendation?: 'continue' | 'stop' | 'review';
  stopReasons?: string[];
}

export interface PromptEvaluationResponse {
  type: PromptEvaluationType;
  score: EvaluationScore;
  /** 方向性改进建议（最多 3 条，用于迭代改写）。 */
  improvements: string[];
  summary: string;
  /** 精准修复操作（最多 3 条，可直接应用到提示词文本）。 */
  patchPlan: PatchOperation[];
  stopSignals?: EvaluationStopSignals;
  metadata?: {
    model?: string;
    timestamp?: number;
    duration?: number;
  };
}

// ==================== 错误 ====================

export type PromptEvaluationErrorKind = 'invalid_response' | 'upstream_unavailable';

export class PromptEvaluationError extends Error {
  readonly kind: PromptEvaluationErrorKind;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(input: {
    cause?: unknown;
    kind: PromptEvaluationErrorKind;
    message: string;
    retryable: boolean;
  }) {
    super(input.message);
    this.name = 'PromptEvaluationError';
    this.kind = input.kind;
    this.retryable = input.retryable;
    this.cause = input.cause;
  }
}

export class PromptEvaluationParseError extends PromptEvaluationError {
  constructor(cause?: unknown) {
    super({
      cause,
      kind: 'invalid_response',
      message: '评估模型返回结果格式无效，请重试。',
      retryable: false,
    });
    this.name = 'PromptEvaluationParseError';
  }
}

export class PromptEvaluationUpstreamError extends PromptEvaluationError {
  constructor(cause?: unknown) {
    super({
      cause,
      kind: 'upstream_unavailable',
      message: '评估模型暂时不可用，请稍后重试。',
      retryable: true,
    });
    this.name = 'PromptEvaluationUpstreamError';
  }
}

// ==================== 补丁应用（纯函数，供 UI diff 渲染与自动改写共用） ====================

export interface PatchApplyFailure {
  operation: PatchOperation;
  reason: 'anchor_not_found' | 'anchor_ambiguous';
}

export interface PatchApplyResult {
  /** 全部操作应用后的文本；失败操作被跳过。 */
  text: string;
  appliedCount: number;
  skipped: PatchApplyFailure[];
}

/**
 * 在目标文本中定位 oldText 的第 occurrence 次出现位置。
 * 未找到或出现次数不足 occurrence 时返回 null。
 */
export function findPatchAnchor(text: string, oldText: string, occurrence = 1): number | null {
  if (oldText.length === 0) {
    return 0;
  }
  let index = text.indexOf(oldText);
  if (index === -1) {
    return null;
  }
  if (occurrence === 1) {
    return index;
  }
  for (let seen = 1; seen < occurrence; seen += 1) {
    index = text.indexOf(oldText, index + oldText.length);
    if (index === -1) {
      return null;
    }
  }
  return index;
}

/** 应用单个补丁操作；失败返回 null 与原因。 */
export function applyPatch(
  text: string,
  operation: PatchOperation,
): { result: string | null; failure: PatchApplyFailure | null } {
  const occurrence = operation.occurrence ?? 1;
  const anchor = findPatchAnchor(text, operation.oldText, occurrence);
  if (anchor === null) {
    const total =
      operation.oldText.length === 0 ? 0 : countOccurrences(text, operation.oldText);
    const reason: PatchApplyFailure['reason'] =
      total === 0 ? 'anchor_not_found' : 'anchor_ambiguous';
    return { result: null, failure: { operation, reason } };
  }
  const end = anchor + operation.oldText.length;
  const next = `${text.slice(0, anchor)}${operation.newText}${text.slice(end)}`;
  return { result: next, failure: null };
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * 顺序应用一组补丁（每条基于前一条的结果）。
 * 单条失败不中断：跳过并记录原因，保证能应用的修复尽量落地。
 */
export function applyPatchPlan(
  text: string,
  patchPlan: readonly PatchOperation[],
): PatchApplyResult {
  let current = text;
  let appliedCount = 0;
  const skipped: PatchApplyFailure[] = [];
  for (const operation of patchPlan) {
    const { result, failure } = applyPatch(current, operation);
    if (result === null && failure) {
      skipped.push(failure);
      continue;
    }
    current = result ?? current;
    appliedCount += 1;
  }
  return { text: current, appliedCount, skipped };
}
