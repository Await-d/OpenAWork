/**
 * Logger 内置轻量脱敏 —— 避免与 agent-core 形成循环依赖。
 *
 * 会在日志输出时自动对 message 和 fields 值执行脱敏。
 * 完整脱敏规则在 agent-core/src/security/redaction.ts 中维护，
 * 这里只覆盖最常见的日志泄露模式。
 */

const SENSITIVE_KEY_RE =
  /^(?:api[_-]?key|secret|password|passwd|pwd|token|auth[_-]?token|access[_-]?key|private[_-]?key|client[_-]?secret|bearer|authorization|cookie)$/i;

const LOG_REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
    replacement: 'Bearer [REDACTED]',
  },
  {
    pattern: /\b(?:sk|key|ai|pk)-[A-Za-z0-9]{20,}\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    pattern:
      /((?:api[_-]?key|secret|password|passwd|pwd|token|auth|access[_-]?key|private[_-]?key|client[_-]?secret)\s*[:=]\s*)[^\s,}"'\]]+/gi,
    replacement: '$1[REDACTED]',
  },
  {
    pattern: /((?:postgres|postgresql|mysql|mongodb|redis|amqp):\/\/[^:]+:)[^@]+(@[^\s/]+)/g,
    replacement: '$1[REDACTED]$2',
  },
];

export function redactLogText(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  let result = text;
  for (const { pattern, replacement } of LOG_REDACTION_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    result = result.replace(regex, replacement);
  }
  return result;
}

export function redactLogFields(
  fields?: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> | undefined {
  if (!fields) return fields;
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string' && SENSITIVE_KEY_RE.test(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      result[key] = redactLogText(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
