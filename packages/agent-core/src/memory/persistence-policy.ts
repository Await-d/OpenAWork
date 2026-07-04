import type {
  ExtractedMemoryCandidate,
  MemoryCandidateDecision,
  MemoryCandidateDecisionReason,
  MemoryCandidatePersistencePolicy,
} from './types.js';

const TRANSIENT_CONTEXT_PATTERNS: readonly RegExp[] = [
  /(?:今天|明天|昨天|这次|本次|当前|临时|刚刚|马上|稍后|这轮|这一轮|这个会话|本轮|这次对话)/i,
  /\b(?:today|tomorrow|yesterday|this time|current|temporary|temp|right now|for now|this session|this chat)\b/i,
  /(?:报错|错误日志|stack trace|traceback|debug|调试|临时分支|当前分支)/i,
];

const SENSITIVE_INFORMATION_PATTERNS: readonly RegExp[] = [
  /\b(?:sk|rk|pk|ghp|gho|ghu|ghs|github_pat|xoxb|xoxp|xoxa)-[A-Za-z0-9_-]{16,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:password|passwd|pwd|secret|token|api[_ -]?key|access[_ -]?key)\s*(?:is|=|:|为|是)\s*\S+/i,
  /(?:密码|密钥|令牌|访问凭证|身份证|护照号|银行卡|信用卡|社保号|病历|诊断|宗教信仰|政治倾向)\s*(?:是|为|:|：)?\s*\S+/i,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b(?:\d[ -]*?){13,19}\b/,
];

const SUPPORTED_TYPES = new Set([
  'preference',
  'fact',
  'instruction',
  'project_context',
  'learned_pattern',
]);

function decision(
  candidate: ExtractedMemoryCandidate,
  status: MemoryCandidateDecision['status'],
  reason: MemoryCandidateDecisionReason,
  detail: string,
): MemoryCandidateDecision {
  return { candidate, status, reason, detail };
}

function hasPattern(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function candidateText(candidate: ExtractedMemoryCandidate): string {
  return `${candidate.key}\n${candidate.value}`;
}

export function evaluateMemoryCandidateForPersistence(
  candidate: ExtractedMemoryCandidate,
  policy: MemoryCandidatePersistencePolicy,
): MemoryCandidateDecision {
  if (!SUPPORTED_TYPES.has(candidate.type)) {
    return decision(candidate, 'reject', 'unsupported_type', '不支持的记忆类型。');
  }

  if (candidate.value.trim().length === 0 || candidate.key.trim().length === 0) {
    return decision(candidate, 'reject', 'empty_value', '候选记忆缺少 key 或 value。');
  }

  const text = candidateText(candidate);
  if (hasPattern(text, SENSITIVE_INFORMATION_PATTERNS)) {
    return decision(candidate, 'reject', 'sensitive_information', '疑似包含凭证或敏感个人信息。');
  }

  if (hasPattern(text, TRANSIENT_CONTEXT_PATTERNS)) {
    return decision(candidate, 'review', 'transient_context', '更像一次性会话上下文，需人工确认。');
  }

  if (candidate.confidence < policy.autoWriteMinConfidence) {
    return decision(
      candidate,
      policy.reviewLowConfidence ? 'review' : 'reject',
      'low_confidence',
      '候选置信度低于自动写入阈值。',
    );
  }

  return decision(candidate, 'persist', 'eligible', '满足长期记忆自动写入条件。');
}
