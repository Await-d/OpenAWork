/**
 * `session_read` 的文本转录解析。
 *
 * 它返回的是一整块纯文本（网关侧 `lines.join('\n')`，见 `session-manager-tools.ts`）：
 * 头部几行元信息，正文按 `[Message i/N] role (时间)` 分节，节内的工具调用是
 * `[tool_call] name {json}` / `[tool_result] …` 两行。直接铺出来就是一大段等宽文本，
 * 40 条转录根本读不动——这里把它还原成结构，让 UI 能按角色排版、把工具调用折叠起来。
 */

import { extractTextFromOutput } from './extract-text.js';

export interface SessionReadLine {
  kind: 'text' | 'tool_call' | 'tool_result';
  text: string;
  /** `tool_call` 才有：被调用的工具名。 */
  toolName?: string;
}

export interface SessionReadEntry {
  /** `[Message 3/42]` 里的 3。 */
  index: number;
  /** `[Message 3/42]` 里的 42。 */
  total: number;
  role: string;
  timestamp?: string;
  /**
   * 合成通知的来源限定词原文（形如 `subagent · scout · failed`）。只有 `synthetic`
   * 消息才有；网关把它放在行头括号内、时间之后，理由见 `splitHeaderParen`。
   */
  notice?: string;
  lines: SessionReadLine[];
}

export interface SessionReadView {
  sessionId?: string;
  /** 会话级来源（`Source:` 行），通道会话才有：形如 `channel · wechat · wxid_abc`。 */
  source?: string;
  messageCount?: number;
  dateRange?: string;
  hint?: string;
  entries: SessionReadEntry[];
}

const ENTRY_HEAD = /^\[Message\s+(\d+)\/(\d+)\]\s*(\S*)\s*(?:\(([^)]*)\))?\s*$/;
const TOOL_CALL = /^\[tool_call\]\s*(\S+)\s*([\s\S]*)$/;
const TOOL_RESULT = /^\[tool_result\]\s*([\s\S]*)$/;
const META_LINE = /^(Session|Messages|Date Range|Source|提示)\s*[:：]\s*(.*)$/;
/** 行头括号内「时间」与「通知限定词」的分隔符，与网关 `buildNoticeSuffix` 一致。 */
const HEADER_QUALIFIER_SEPARATOR = ' · ';
/**
 * 入参开启后才追加的附加段落（`Todos:` / `Transcript:` / `Debug …`）。它们不是消息正文，
 * 若不在这里截断，会被当成最后一条消息的正文吞进去。
 */
const SECTION_HEAD = /^(Todos|Transcript|Run Events|Debug File Diffs|Debug Snapshots)\s*:/;

/**
 * 解析 `session_read` 的输出。识别不出任何消息条目时返回 null，交回通用兜底
 * （宁可显示原始文本，也不要把一段恰好长得像的东西误解析成转录）。
 */
export function parseSessionReadOutput(output: unknown): SessionReadView | null {
  const text = readTranscriptText(output);
  if (!text) return null;

  const view: SessionReadView = { entries: [] };
  let current: SessionReadEntry | null = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();

    if (SECTION_HEAD.test(line)) {
      if (current) view.entries.push(current);
      current = null;
      continue;
    }

    const head = ENTRY_HEAD.exec(line);
    if (head) {
      if (current) view.entries.push(current);
      const { timestamp, notice } = splitHeaderParen(head[4]);
      current = {
        index: Number.parseInt(head[1] ?? '0', 10),
        total: Number.parseInt(head[2] ?? '0', 10),
        role: (head[3] ?? '').trim() || 'unknown',
        ...(timestamp ? { timestamp } : {}),
        ...(notice ? { notice } : {}),
        lines: [],
      };
      continue;
    }

    if (!current) {
      applyMetaLine(view, line);
      continue;
    }

    if (line.trim().length === 0) continue;

    const toolCall = TOOL_CALL.exec(line);
    if (toolCall) {
      current.lines.push({
        kind: 'tool_call',
        toolName: (toolCall[1] ?? '').trim(),
        text: (toolCall[2] ?? '').trim(),
      });
      continue;
    }

    const toolResult = TOOL_RESULT.exec(line);
    if (toolResult) {
      current.lines.push({ kind: 'tool_result', text: (toolResult[1] ?? '').trim() });
      continue;
    }

    current.lines.push({ kind: 'text', text: line });
  }

  if (current) view.entries.push(current);
  return view.entries.length > 0 ? view : null;
}

/**
 * 拆开行头括号里的内容：`<时间>[ · <通知限定词>]`。
 *
 * 网关把合成通知的来源限定词放在**时间之后、同一个括号内**（`session-manager-tools.ts`
 * 的 `buildNoticeSuffix`），而不是角色之后——因为 `ENTRY_HEAD` 要求「角色 + 可选括号」
 * 收尾，加在角色之后会让整行失配，连消息带通知一起消失。代价是 ` · ` 这个分隔符
 * 成为契约的一部分，所以这里按**第一个** ` · ` 切分，余下全部算限定词
 * （限定词内部自己还有 ` · `，例如 `subagent · scout · failed`）。
 */
function splitHeaderParen(paren: string | undefined): { timestamp?: string; notice?: string } {
  const raw = (paren ?? '').trim();
  if (raw.length === 0) return {};

  const separator = raw.indexOf(HEADER_QUALIFIER_SEPARATOR);
  if (separator < 0) return { timestamp: raw };

  const timestamp = raw.slice(0, separator).trim();
  const notice = raw.slice(separator + HEADER_QUALIFIER_SEPARATOR.length).trim();
  return { ...(timestamp ? { timestamp } : {}), ...(notice ? { notice } : {}) };
}

/** 输出可能是裸字符串，也可能是 `{ output }` 信封。 */
function readTranscriptText(output: unknown): string | null {
  if (typeof output === 'string') return output.length > 0 ? output : null;
  const text = extractTextFromOutput(output)?.text;
  return text && text.length > 0 ? text : null;
}

function applyMetaLine(view: SessionReadView, line: string): void {
  const match = META_LINE.exec(line);
  if (!match) return;
  const key = match[1] ?? '';
  const value = (match[2] ?? '').trim();
  if (value.length === 0) return;

  if (key === 'Session') {
    view.sessionId = value;
    return;
  }
  if (key === 'Date Range') {
    view.dateRange = value;
    return;
  }
  if (key === 'Source') {
    view.source = value;
    return;
  }
  if (key === '提示') {
    view.hint = value;
    return;
  }
  // `Messages: 42（仅显示最近 40 条…）` —— 只取开头的数字。
  const count = /^(\d+)/.exec(value);
  if (count) view.messageCount = Number.parseInt(count[1] ?? '0', 10);
}
