/**
 * 系统级密钥脱敏模块 — 默认开启。
 *
 * 参考：hermes-agent v0.13.0 Security Wave — "redaction ON by default"
 *
 * 覆盖范围：
 *   - API Key / Bearer Token / JWT
 *   - 数据库连接字符串中的密码
 *   - Redis URL 中的密码
 *   - 通用 key=value / key:value 对中的敏感 value
 *   - AWS / GCP / Azure 密钥
 *   - 私钥（PEM 格式）
 *   - 信用卡号
 *
 * 可配置白名单（allowList）：允许特定值原样通过。
 */

/** 单条脱敏规则 */
export interface RedactionPattern {
  /** 规则名称，用于 debug */
  name: string;
  /** 正则表达式（全局） */
  pattern: RegExp;
  /** 替换文本 */
  replacement: string;
}

/** 脱敏配置 */
export interface RedactionConfig {
  /** 是否启用（默认 true） */
  enabled: boolean;
  /** 白名单值：出现在此列表中的原始值不会被脱敏 */
  allowList: Set<string>;
  /** 自定义额外规则（追加到默认规则后） */
  customPatterns: RedactionPattern[];
}

/** 默认脱敏规则库 */
export const DEFAULT_REDACTION_PATTERNS: RedactionPattern[] = [
  // Bearer Token
  {
    name: 'bearer-token',
    pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
    replacement: 'Bearer [REDACTED]',
  },
  // API Key 格式（sk-xxx, key-xxx, ai-xxx 等）
  {
    name: 'api-key-prefix',
    pattern: /\b(?:sk|key|ai|pk|pk_live|pk_test|rk|rk_live)-[A-Za-z0-9]{20,}\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  // JWT Token（三段式 base64.base64.base64）
  {
    name: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: '[REDACTED_JWT]',
  },
  // 数据库连接字符串密码 postgresql://user:pass@host
  {
    name: 'db-connection-password',
    pattern:
      /((?:postgres|postgresql|mysql|mongodb|redis|amqp):\/\/[^:]+:)[^@]+(@[^\s/]+)/g,
    replacement: '$1[REDACTED]$2',
  },
  // key=value 或 key: value 形式中的敏感 key
  {
    name: 'sensitive-key-value',
    pattern:
      /((?:api[_-]?key|secret|password|passwd|pwd|token|auth|access[_-]?key|private[_-]?key|client[_-]?secret)\s*[:=]\s*)[^\s,}"'\]]+/gi,
    replacement: '$1[REDACTED]',
  },
  // AWS Access Key ID（AKIA 开头 20 字符）
  {
    name: 'aws-access-key-id',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED_AWS_KEY_ID]',
  },
  // AWS Secret Access Key（40 字符 base64）
  {
    name: 'aws-secret-key',
    pattern: /(aws_secret_access_key\s*[:=]\s*)[A-Za-z0-9/+=]{40}/gi,
    replacement: '$1[REDACTED]',
  },
  // Google API Key（AIza 开头）
  {
    name: 'google-api-key',
    pattern: /\bAIza[0-9A-Za-z_\-]{35}\b/g,
    replacement: '[REDACTED_GOOGLE_KEY]',
  },
  // PEM 私钥块
  {
    name: 'pem-private-key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  // 信用卡号（16 位，可能含空格或连字符，需以 4/5/3 开头）
  {
    name: 'credit-card',
    pattern: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2})[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    replacement: '[REDACTED_CC]',
  },
  // Slack Token（xoxb-/xoxp-/xoxa-）
  {
    name: 'slack-token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    replacement: '[REDACTED_SLACK_TOKEN]',
  },
  // GitHub Token（ghp_/gho_/ghu_/ghs_/ghr_）
  {
    name: 'github-token',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
    replacement: '[REDACTED_GITHUB_TOKEN]',
  },
];

const DEFAULT_CONFIG: RedactionConfig = {
  enabled: true,
  allowList: new Set(),
  customPatterns: [],
};

let currentConfig: RedactionConfig = { ...DEFAULT_CONFIG, allowList: new Set() };

/**
 * 更新脱敏配置。传入 partial 会与当前配置合并。
 */
export function configureRedaction(partial: Partial<RedactionConfig>): void {
  currentConfig = {
    ...currentConfig,
    ...partial,
    allowList: partial.allowList ?? currentConfig.allowList,
    customPatterns: partial.customPatterns ?? currentConfig.customPatterns,
  };
}

/**
 * 获取当前配置（只读视图）。
 */
export function getRedactionConfig(): Readonly<RedactionConfig> {
  return currentConfig;
}

/**
 * 对文本执行脱敏。
 *
 * 如果配置禁用则原样返回。
 * 白名单中的值不会被脱敏（先暂存，替换后恢复）。
 */
export function redactText(input: string): string {
  if (!currentConfig.enabled || typeof input !== 'string' || input.length === 0) {
    return input;
  }

  const patterns = [...DEFAULT_REDACTION_PATTERNS, ...currentConfig.customPatterns];

  // 如果有白名单，先暂存白名单值
  const placeholders: string[] = [];
  let text = input;
  if (currentConfig.allowList.size > 0) {
    let placeholderIdx = 0;
    for (const allowed of currentConfig.allowList) {
      if (allowed.length === 0 || !text.includes(allowed)) continue;
      const placeholder = `\x00ALLOW_${placeholderIdx}\x00`;
      text = text.split(allowed).join(placeholder);
      placeholders[placeholderIdx] = allowed;
      placeholderIdx++;
    }
  }

  // 应用所有脱敏规则
  for (const { pattern, replacement } of patterns) {
    // 每次都需要创建新的 RegExp（因为全局正则有 lastIndex 状态）
    const regex = new RegExp(pattern.source, pattern.flags);
    text = text.replace(regex, replacement);
  }

  // 恢复白名单值
  if (placeholders.length > 0) {
    for (let i = 0; i < placeholders.length; i++) {
      const placeholder = `\x00ALLOW_${i}\x00`;
      text = text.split(placeholder).join(placeholders[i]!);
    }
  }

  return text;
}

/**
 * 对任意值执行深度脱敏（递归遍历对象/数组）。
 */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return redactText(value) as unknown as T;
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      // 对敏感 key 对应的 value 直接脱敏为 [REDACTED]
      if (isSensitiveKey(key) && typeof val === 'string') {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactDeep(val);
      }
    }
    return result as unknown as T;
  }
  return value;
}

const SENSITIVE_KEY_RE =
  /^(?:api[_-]?key|secret|password|passwd|pwd|token|auth[_-]?token|access[_-]?key|private[_-]?key|client[_-]?secret|bearer|authorization|cookie)$/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key);
}

/**
 * 创建一个脱敏中间件函数，用于 stream / log 管道。
 */
export function createRedactionFilter(): (text: string) => string {
  return (text: string) => redactText(text);
}
