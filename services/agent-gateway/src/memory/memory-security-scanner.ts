/**
 * 260515-team-phase-a · T-07
 *
 * Memory 写入安全扫描（D39 13 条威胁模式 + Unicode 异常检测）。
 *
 * 使用场景：
 *   - 用户手动 POST /memories（routes/memories.ts）
 *   - 自动抽取 upsertExtractedMemories（memory-store.ts）
 *   - 团队宪法 / SOUL / user_memory 写入（Phase A 新增的 PUT 端点）
 *
 * 设计原则：
 *   1. **拒绝优先**：发现可疑模式直接拒绝写入，让用户主动修改后重试，
 *      而不是默默清洗（清洗会让攻击者知道哪些字符串触发了过滤）。
 *   2. **可观察**：返回的 reason / matchedPattern / sample 可以记录到
 *      审计日志，方便排查是误判还是真攻击。
 *   3. **零外部依赖**：纯正则 + Unicode codepoint 判断，避免在网关启动
 *      路径上引入 NLP / ML 依赖。
 */

export type MemoryWriteThreatKind =
  | 'prompt-injection-instruction'
  | 'prompt-injection-system-role'
  | 'prompt-injection-tool-call'
  | 'data-exfiltration-url'
  | 'data-exfiltration-credential'
  | 'jailbreak-keyword'
  | 'unicode-bidi-override'
  | 'unicode-zero-width'
  | 'unicode-tag-block'
  | 'unicode-private-use'
  | 'oversize-content'
  | 'binary-payload'
  | 'control-character';

export interface MemoryWriteScanResult {
  ok: boolean;
  /** 命中的威胁种类（按命中顺序记录第一个） */
  threat?: MemoryWriteThreatKind;
  /** 命中的具体规则人类可读描述 */
  reason?: string;
  /** 用于审计的命中样本（最多 80 字符） */
  sample?: string;
}

interface ThreatPattern {
  kind: MemoryWriteThreatKind;
  reason: string;
  test(text: string): { matched: boolean; sample?: string };
}

const MAX_MEMORY_BYTES = 64 * 1024;

/**
 * D39 的 13 条威胁模式 = 5 条 prompt-injection / 2 条数据外泄
 * / 1 条 jailbreak / 4 条 Unicode 异常 / 1 条结构异常。
 */
const REGEX_PATTERNS: ThreatPattern[] = [
  {
    kind: 'prompt-injection-instruction',
    reason: '检测到指令覆盖企图（"忽略以上 / 之前的所有指令"）',
    test: (text) => {
      const re =
        /(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|earlier|the\s+system)\s+(instructions?|prompts?|rules?|directives?)|忽略(上面|之前|以上|前面|所有)的?(所有)?(指令|提示|规则|要求)|无视(上面|之前|以上)的?(指令|提示|规则)/i;
      const match = text.match(re);
      if (match) return { matched: true, sample: match[0] };
      return { matched: false };
    },
  },
  {
    kind: 'prompt-injection-system-role',
    reason: '检测到伪造 system / assistant 角色块',
    test: (text) => {
      const re =
        /<\|im_(start|end)\|>|<system>|<\/system>|\[INST\]|\[\/INST\]|^\s*system\s*:\s*you\s+(are|must)/im;
      const match = text.match(re);
      if (match) return { matched: true, sample: match[0] };
      return { matched: false };
    },
  },
  {
    kind: 'prompt-injection-tool-call',
    reason: '检测到伪造工具调用 / function call 结构',
    test: (text) => {
      const re =
        /<tool_call>|<function_call>|<invoke[\s>]|"tool_use"\s*:\s*\{|<tool_use[\s>]|"function":\s*\{\s*"name"/i;
      const match = text.match(re);
      if (match) return { matched: true, sample: match[0] };
      return { matched: false };
    },
  },
  {
    kind: 'data-exfiltration-url',
    reason: '检测到要求向外部 URL 发送数据的指令',
    test: (text) => {
      const re =
        /(send|post|forward|upload|exfiltrate|leak)\s+(this|the|all|user)?[\s\S]{0,40}(to|via)\s+https?:\/\/|发送(到|至|给)\s*https?:\/\//i;
      const match = text.match(re);
      if (match) return { matched: true, sample: match[0] };
      return { matched: false };
    },
  },
  {
    kind: 'data-exfiltration-credential',
    reason: '检测到要求泄露凭证 / API key / token',
    test: (text) => {
      const re =
        /(reveal|print|output|show|dump|leak)\s+(your\s+)?(system\s+prompt|api[\s_-]?key|secret|password|token|credentials?)|泄露(系统|密钥|密码|凭证|token)/i;
      const match = text.match(re);
      if (match) return { matched: true, sample: match[0] };
      return { matched: false };
    },
  },
  {
    kind: 'jailbreak-keyword',
    reason: '检测到越狱关键词（DAN / jailbreak / 开发者模式 等）',
    test: (text) => {
      const re =
        /\b(DAN|do\s+anything\s+now|jailbreak\s+mode|developer\s+mode\s+enabled|unrestricted\s+mode)\b|开发者模式已?启用|越狱模式/i;
      const match = text.match(re);
      if (match) return { matched: true, sample: match[0] };
      return { matched: false };
    },
  },
];

/**
 * Unicode 检测：
 *   - U+202A..202E、U+2066..2069 双向控制
 *   - U+200B..200D、U+FEFF 零宽
 *   - U+E0000..E007F Tag block（曾被用于 prompt injection 隐藏指令）
 *   - U+E000..F8FF / U+F0000..10FFFD 私有使用区
 *   - U+0000..001F（除 \t \n \r）+ U+007F 控制字符
 */
function scanUnicode(text: string): MemoryWriteScanResult | null {
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;

    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) {
      return {
        ok: false,
        threat: 'unicode-bidi-override',
        reason: '检测到 Unicode 双向控制字符（可能用于隐藏指令）',
        sample: `U+${code.toString(16).toUpperCase().padStart(4, '0')}`,
      };
    }

    if (
      code === 0x200b ||
      code === 0x200c ||
      code === 0x200d ||
      code === 0xfeff ||
      code === 0x180e
    ) {
      return {
        ok: false,
        threat: 'unicode-zero-width',
        reason: '检测到零宽字符（可能用于隐藏指令）',
        sample: `U+${code.toString(16).toUpperCase().padStart(4, '0')}`,
      };
    }

    if (code >= 0xe0000 && code <= 0xe007f) {
      return {
        ok: false,
        threat: 'unicode-tag-block',
        reason: '检测到 Unicode Tag block（被用于 invisible prompt injection）',
        sample: `U+${code.toString(16).toUpperCase().padStart(4, '0')}`,
      };
    }

    if (
      (code >= 0xe000 && code <= 0xf8ff) ||
      (code >= 0xf0000 && code <= 0xffffd) ||
      (code >= 0x100000 && code <= 0x10fffd)
    ) {
      return {
        ok: false,
        threat: 'unicode-private-use',
        reason: '检测到 Unicode 私有使用区字符',
        sample: `U+${code.toString(16).toUpperCase().padStart(4, '0')}`,
      };
    }

    if (
      (code >= 0x00 && code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      code === 0x7f
    ) {
      return {
        ok: false,
        threat: 'control-character',
        reason: '检测到 ASCII 控制字符',
        sample: `U+${code.toString(16).toUpperCase().padStart(4, '0')}`,
      };
    }
  }

  return null;
}

/**
 * 入口：对一段将要写入持久化记忆的文本做安全扫描。
 *
 * @returns ok: true 表示放行；ok: false 时 reason / sample 用于返给客户端展示
 */
export function scanMemoryWriteContent(text: string): MemoryWriteScanResult {
  if (typeof text !== 'string') {
    return {
      ok: false,
      threat: 'binary-payload',
      reason: '记忆内容必须是字符串',
    };
  }

  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength > MAX_MEMORY_BYTES) {
    return {
      ok: false,
      threat: 'oversize-content',
      reason: `记忆内容超过 ${MAX_MEMORY_BYTES} 字节上限（当前 ${byteLength} 字节）`,
    };
  }

  if (text.length === 0) {
    return { ok: true };
  }

  const unicodeResult = scanUnicode(text);
  if (unicodeResult) {
    return unicodeResult;
  }

  for (const pattern of REGEX_PATTERNS) {
    const result = pattern.test(text);
    if (result.matched) {
      return {
        ok: false,
        threat: pattern.kind,
        reason: pattern.reason,
        sample: result.sample?.slice(0, 80),
      };
    }
  }

  return { ok: true };
}

/**
 * 用于多字段一次性扫描的辅助。任意字段失败即整体失败。
 */
export function scanMemoryWriteFields(
  fields: Record<string, string | undefined | null>,
): MemoryWriteScanResult & { field?: string } {
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    const result = scanMemoryWriteContent(value);
    if (!result.ok) {
      return { ...result, field };
    }
  }
  return { ok: true };
}
