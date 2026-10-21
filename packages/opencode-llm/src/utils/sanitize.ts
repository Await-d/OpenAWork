import { isRecord } from './record.js';

// `String.prototype.toWellFormed` 属 ES2024，本包 `lib` 只到 ES2022（`tsconfig.base.json`），
// 故手写等价实现：孤立的高位代理（后面不是低位）与孤立的低位代理（前面不是高位）
// 都替换成 U+FFFD。用零宽断言而不是消费相邻字符——否则连续两个孤立低位代理
// （`\uDC00\uDC00`）会漏掉第二个。
const LONE_SURROGATES = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const toWellFormed = (value: string): string => value.replace(LONE_SURROGATES, '\uFFFD');

/**
 * Recursively replace unpaired UTF-16 surrogates in a request payload.
 *
 * 为什么需要：模型生成的工具入参、用户粘贴的文本都可能带未配对代理（例如被截断的
 * emoji）。`JSON.stringify` 会把它们序列化成裸的 `\uD800` 转义，严格的供应商会以 400
 * 拒绝整个请求——而这类字符本来就不承载信息，清洗不会丢内容。
 *
 * `Uint8Array` 与 `Error` 原样返回：前者是二进制载荷（逐码元当字符串处理会破坏字节），
 * 后者的字段不参与 JSON 序列化。对象键同样清洗——键里的孤立代理会让整个请求体无法解析。
 */
export const sanitizeSurrogates = <T>(value: T): T => {
  if (typeof value === 'string') return toWellFormed(value) as T;
  if (Array.isArray(value)) return value.map(sanitizeSurrogates) as T;
  if (value instanceof Uint8Array || value instanceof Error) return value;
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [toWellFormed(key), sanitizeSurrogates(entry)]),
    ) as T;
  return value;
};
