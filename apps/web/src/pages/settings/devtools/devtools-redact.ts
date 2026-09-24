/**
 * 排障上下文（troubleshoot bundle）脱敏：按「密钥名 + URL 凭据」剔除导出内容里的敏感值。
 *
 * 只作用于**导出**（粘贴给 AI / 同事的排障包），不改动真实配置，因此可以放心地在
 * 展示层做加法。规则与上游 opencode `debug config` 的脱敏保持一致：
 * - 命中文档中「密钥名」的字符串值替换为 `***`（大小写不敏感）；
 * - `headers` 键下的**所有**字符串值一律替换（头的名字无法穷举）；
 * - URL 携带 userinfo 或密钥名查询参数时整体替换；
 * - 无法解析的 URL 按敏感处理（宁可多打码）。
 */

/** 密钥名判定（与上游 opencode `debug config` 保持同一张表）。 */
const SECRET_KEY =
  /(?:api.?key|secret|password|token$|authorization$|cookie$|credential|private.?key)/i;

/** URL 是否携带凭据（userinfo）或密钥名查询参数；非 http(s) 字符串一律为 false。 */
export function urlCarriesSecret(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  if (!URL.canParse(value)) return true;
  const url = new URL(value);
  return (
    url.username.length > 0 ||
    url.password.length > 0 ||
    [...url.searchParams.keys()].some((name) => SECRET_KEY.test(name))
  );
}

/** URL 需要打码时返回 `***`，否则原样返回（供 gatewayUrl 这类单值字段使用）。 */
export function redactUrl(value: string): string {
  return urlCarriesSecret(value) ? '***' : value;
}

/**
 * 递归脱敏任意 JSON 形状的载荷。`headers` 为 true 时，当前层所有字符串值都按敏感处理
 * （用于 `headers` / `request.headers` 这类键名无法穷举的子树）。
 */
export function redactSecrets(value: unknown, headers = false): unknown {
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, headers));
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (typeof item === 'string' && (headers || SECRET_KEY.test(key) || urlCarriesSecret(item))) {
        return [key, '***'];
      }
      return [key, redactSecrets(item, headers || key.toLowerCase() === 'headers')];
    }),
  );
}
