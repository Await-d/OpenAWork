/**
 * 审计写入前的敏感信息脱敏。
 *
 * `writeAuditLog` 会把工具输入/输出原样落库,并随后出现在诊断导出里。bash
 * 输入中常见 `echo '<密码>' | sudo -S` 这类把密码写进命令行的用法,不处理就会
 * 连同明文密码一起入库。这里只做保守的三类匹配,避免误伤正常内容:
 *
 *   1. `echo <引号包裹内容> | sudo -S` —— 实际观察到的泄漏形态;
 *   2. 字符串里 `password|passwd|pwd|secret|token|api[_-]?key` 后跟 `:`/`=` 的键值对;
 *   3. 对象里键名本身是凭据名(`api_key: 'sk-...'`)→ 整个值替换为 `[REDACTED]`。
 *
 * 值一律替换为 `[REDACTED]`,只保留键名,便于仍能看出是哪类凭据。
 */

const SECRET_ECHO_SUDO_PATTERN = /(echo\s+)(['"])[^'"\n]*\2(\s*\|\s*sudo\s+-S)/g;

const SECRET_KEY_VALUE_PATTERN =
  /\b(password|passwd|pwd|secret|token|api[_-]?key)\b\s*['"]?\s*[=:]\s*['"]?[^\s'",;|&]+/gi;

const SECRET_KEY_NAME_PATTERN = /\b(password|passwd|pwd|secret|token|api[_-]?key)\b/i;

export function redactSecretsInString(value: string): string {
  return value
    .replace(SECRET_ECHO_SUDO_PATTERN, "$1'******'$3")
    .replace(SECRET_KEY_VALUE_PATTERN, '$1=[REDACTED]');
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function redactAuditValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSecretsInString(value);
  if (Array.isArray(value)) return value.map((item) => redactAuditValue(item));
  if (value !== null && typeof value === 'object' && isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SECRET_KEY_NAME_PATTERN.test(key) ? '[REDACTED]' : redactAuditValue(item),
      ]),
    );
  }
  return value;
}
