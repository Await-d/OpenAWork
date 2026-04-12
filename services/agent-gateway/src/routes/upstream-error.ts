export interface UpstreamErrorDescriptor {
  code: string;
  message: string;
  technicalDetail: string;
}

export type Upstream429ErrorClassification = 'quota_exceeded' | 'rate_limit' | 'unknown';

const QUOTA_EXCEEDED_PATTERNS = [
  /daily_limit_exceeded/i,
  /daily usage limit exceeded/i,
  /insufficient_quota/i,
  /quota exceeded/i,
  /exceeded your current quota/i,
  /usage limit exceeded/i,
  /credit(?:s)? exhausted/i,
];

const RATE_LIMIT_PATTERNS = [/rate limit/i, /too many requests/i, /request limit/i];
const CONTEXT_OVERFLOW_PATTERNS = [
  /context length/i,
  /context window/i,
  /maximum context length/i,
  /maximum.*tokens/i,
  /too many input tokens/i,
  /input.*too long/i,
  /prompt.*too long/i,
  /context exceeds/i,
  /requested.*tokens/i,
];

export async function readUpstreamError(response: Response): Promise<UpstreamErrorDescriptor> {
  const technicalDetail = await readUpstreamErrorDetail(response);

  if (response.status === 429) {
    const classification = classifyUpstream429Error(technicalDetail);

    if (classification === 'quota_exceeded') {
      return {
        code: 'QUOTA_EXCEEDED',
        message: '当前模型提供方额度已用尽，请切换模型或提供方，或等待额度恢复后再试',
        technicalDetail,
      };
    }

    if (classification === 'rate_limit') {
      return {
        code: 'RATE_LIMIT',
        message: '模型服务触发速率限制，请稍后重试',
        technicalDetail,
      };
    }

    return {
      code: 'RATE_LIMIT',
      message: '模型服务暂时达到请求上限，请稍后重试',
      technicalDetail,
    };
  }

  return {
    code: 'MODEL_ERROR',
    message: technicalDetail,
    technicalDetail,
  };
}

export function classifyUpstream429Error(technicalDetail: string): Upstream429ErrorClassification {
  if (matchesAnyPattern(technicalDetail, QUOTA_EXCEEDED_PATTERNS)) {
    return 'quota_exceeded';
  }

  if (matchesAnyPattern(technicalDetail, RATE_LIMIT_PATTERNS)) {
    return 'rate_limit';
  }

  return 'unknown';
}

export function isUpstreamContextOverflowError(input: {
  response: Pick<Response, 'status'>;
  error: UpstreamErrorDescriptor;
}): boolean {
  if (input.response.status !== 400 && input.response.status !== 413) {
    return false;
  }

  const detail = `${input.error.code} ${input.error.message} ${input.error.technicalDetail}`;
  return matchesAnyPattern(detail, CONTEXT_OVERFLOW_PATTERNS);
}

export async function readUpstreamErrorDetail(response: Response): Promise<string> {
  const prefix = `Upstream request failed (${response.status})`;

  try {
    const raw = await response.text();
    if (!raw) return prefix;

    try {
      const parsed = JSON.parse(raw) as unknown;
      const extracted = extractErrorMessage(parsed);
      return extracted ? `${prefix}: ${extracted}` : `${prefix}: ${raw}`;
    } catch {
      return `${prefix}: ${raw}`;
    }
  } catch {
    return prefix;
  }
}

function matchesAnyPattern(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function extractErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  if (typeof record['message'] === 'string') {
    return record['message'];
  }

  const nestedError = record['error'];
  if (nestedError && typeof nestedError === 'object') {
    const nestedRecord = nestedError as Record<string, unknown>;
    if (typeof nestedRecord['message'] === 'string') {
      return nestedRecord['message'];
    }
  }

  return null;
}
