/**
 * 被截断 JSON 对象的确定性修复。
 *
 * 背景：`write` / `edit` / `patch` 等文件类工具的输出在存储与传输链路上是 **JSON
 * 文本**，卡片靠解析它还原 before/after 才能渲染 diff。文本一旦被截断（大文件写入、
 * 传输中断、上游转发上限），严格 `JSON.parse` 必然失败，卡片就退化成「原始 JSON
 * 文本 + 参数抽屉」——用户看到的是一大段带 `\n` 转义的字符串，而不是文件变更。
 *
 * 这里只做「补闭合」，不猜内容：
 *   1. 结尾停在值字符串里 → 补 `"`（保留已收到的部分正文）；
 *   2. 结尾停在 `\` 或半个 `\uXXXX` 转义里 → 丢弃该转义序列；
 *   3. 结尾停在键 / 冒号 / 半截数字上 → 回退到最后一个完整值的边界；
 *   4. 未闭合的容器（`{` / `[`）按栈补对应闭合符。
 *
 * 只有修复结果能解析成对象时才返回；否则返回 null，由调用方走原有兜底渲染。
 */

export interface TolerantJsonObject {
  /** 截断点之前已完整收到的字段。 */
  readonly value: Record<string, unknown>;
  /**
   * 是否经过修复：true = 严格解析失败、结果由补闭合得到，因此尾部可能不完整
   * （也可能是源文本本身格式异常，如尾逗号——两种情况下调用方都应提示用户）。
   */
  readonly truncated: boolean;
}

/**
 * 解析（必要时修复）一个 JSON 对象文本。
 *
 * 非 `{` 开头、或修复后仍解析不出对象时返回 null——保持既有调用方的兜底语义
 * （bash / grep 的裸文本绝不进入 JSON 解析）。
 */
export function parseJsonObjectTolerant(raw: string): TolerantJsonObject | null {
  const text = raw.trim();
  if (!text.startsWith('{')) {
    return null;
  }

  const parsed = tryParseObject(text);
  if (parsed) {
    return { value: parsed, truncated: false };
  }

  const repaired = repairTruncatedJsonObject(text);
  return repaired ? { value: repaired, truncated: true } : null;
}

/** 只做修复（不先尝试严格解析）：无法恢复时返回 null。 */
export function repairTruncatedJsonObject(text: string): Record<string, unknown> | null {
  for (const candidate of buildRepairCandidates(text)) {
    const parsed = tryParseObject(candidate);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function tryParseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 扫描出的「值已完整」边界：可从该处截断并补上 `closers`。 */
interface RepairAnchor {
  /** 截断位置（该下标之前的文本原样保留）。 */
  readonly cut: number;
  /** 截断位置需要补上的闭合符（内层在前）。 */
  readonly closers: string;
}

interface JsonScan {
  /** 未闭合容器的闭合符栈（内层在后）。 */
  readonly closers: string[];
  /** 扫描结束时是否停在字符串里。 */
  inString: boolean;
  /** 停在字符串里时，该字符串是对象的键。 */
  stringIsKey: boolean;
  /** 停在字符串里时，是否有未配对的反斜杠。 */
  escaped: boolean;
  /** 依次记录的值边界（越靠后越接近截断点）。 */
  readonly anchors: RepairAnchor[];
}

/** 最多尝试的修复候选数：先试最靠后的边界（保留内容最多）。 */
const MAX_REPAIR_ATTEMPTS = 6;

function buildRepairCandidates(text: string): string[] {
  const scan = scanJson(text);
  const closers = closersFor(scan.closers);
  const candidates: string[] = [];

  // 1. 结尾停在值字符串里：补 `"` 比丢掉整个值更诚实（保留已收到的正文）。
  if (scan.inString && !scan.stringIsKey) {
    const keep = stripIncompleteTrailingEscape(text, scan.escaped);
    candidates.push(`${text.slice(0, keep)}"${closers}`);
  }

  // 2. 结尾停在键 / 冒号 / 半截 token 上：回退到最后一个完整值边界。
  for (let index = scan.anchors.length - 1; index >= 0; index -= 1) {
    const anchor = scan.anchors[index];
    if (!anchor) continue;
    candidates.push(`${text.slice(0, anchor.cut)}${anchor.closers}`);
    if (candidates.length >= MAX_REPAIR_ATTEMPTS) break;
  }

  return candidates;
}

/**
 * 结尾若停在 `\`（转义中）或半个 `\uXXXX` 里，返回应保留的长度。
 *
 * `\u4e2` 这类半截转义必须整段丢弃：补上 `"` 仍是非法 JSON，会让修复白跑一轮。
 */
function stripIncompleteTrailingEscape(text: string, escaped: boolean): number {
  const unicodeTail = /\\(?:u[0-9a-fA-F]{0,3})?$/.exec(text);
  if (unicodeTail && unicodeTail[0].includes('u')) {
    return unicodeTail.index;
  }
  if (escaped) {
    return text.length - 1;
  }
  return text.length;
}

function closersFor(closers: readonly string[]): string {
  return [...closers].reverse().join('');
}

function scanJson(text: string): JsonScan {
  const closers: string[] = [];
  const anchors: RepairAnchor[] = [];
  let inString = false;
  let escaped = false;
  let stringIsKey = false;
  let expectingKey = true;
  let index = 0;

  const noteAnchor = (cut: number): void => {
    anchors.push({ closers: closersFor(closers), cut });
  };

  while (index < text.length) {
    const char = text[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
        if (!stringIsKey) {
          noteAnchor(index + 1);
        }
      }
      index += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      escaped = false;
      stringIsKey = expectingKey && closers[closers.length - 1] === '}';
      index += 1;
      continue;
    }

    if (char === '{') {
      closers.push('}');
      expectingKey = true;
      index += 1;
      continue;
    }

    if (char === '[') {
      closers.push(']');
      expectingKey = false;
      index += 1;
      continue;
    }

    if (char === '}' || char === ']') {
      closers.pop();
      noteAnchor(index + 1);
      index += 1;
      continue;
    }

    if (char === ',') {
      expectingKey = closers[closers.length - 1] === '}';
      index += 1;
      continue;
    }

    if (char === ':') {
      expectingKey = false;
      index += 1;
      continue;
    }

    const literal = readValueToken(text, index);
    if (literal !== null) {
      index = literal.end;
      // 数字 / 字面量只有在后面跟着结构性字符或已到结尾时才算完整：
      // `{"bytes":93` 这种半截数字会被判为完整，但结果带 truncated 标记，
      // 调用方必须如实告知用户，因此可接受。
      const next = text[literal.end];
      if (next === undefined || isStructural(next)) {
        noteAnchor(literal.end);
      }
      continue;
    }

    // 认不出的字符：停止扫描，由候选解析阶段兜底判失败。
    break;
  }

  return { anchors, closers, escaped, inString, stringIsKey };
}

interface ValueToken {
  end: number;
}

function readValueToken(text: string, start: number): ValueToken | null {
  const rest = text.slice(start);
  const number = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
  if (number) {
    return { end: start + number[0].length };
  }
  for (const literal of ['true', 'false', 'null'] as const) {
    if (rest.startsWith(literal)) {
      return { end: start + literal.length };
    }
  }
  return null;
}

function isStructural(char: string): boolean {
  return (
    char === ',' ||
    char === '}' ||
    char === ']' ||
    char === ' ' ||
    char === '\t' ||
    char === '\n' ||
    char === '\r'
  );
}
