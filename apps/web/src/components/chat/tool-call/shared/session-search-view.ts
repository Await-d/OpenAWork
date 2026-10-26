/**
 * `session_search` 文本输出的解析（纯函数）。
 *
 * 网关格式（`runSessionSearchTool`）：
 *
 *   Found 2 matches:
 *
 *   [ses_a] Message msg_1 (user)
 *   匹配到的消息片段（单行，最多 220 字符）
 *
 *   [ses_b] Message msg_2 (assistant)
 *   另一条片段
 *
 * 无结果时是 `No matches found.`。
 */

export interface SessionSearchHit {
  sessionId: string;
  messageId: string;
  role: string;
  snippet: string;
}

const HIT_PATTERN = /^\[([^\]]+)\]\s+Message\s+(\S+)\s+\(([^)]+)\)\s*$/;
const NO_MATCHES = /^No matches found\.?$/i;

export function parseSessionSearchHits(output: unknown): SessionSearchHit[] | null {
  if (typeof output !== 'string') return null;
  const trimmed = output.trim();
  if (trimmed.length === 0) return null;
  if (NO_MATCHES.test(trimmed)) return [];

  const hits: SessionSearchHit[] = [];
  let current: SessionSearchHit | null = null;

  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (/^Found \d+ matches?:$/i.test(line)) continue;

    const match = HIT_PATTERN.exec(line);
    if (match) {
      if (current) hits.push(current);
      current = {
        sessionId: match[1]?.trim() ?? '',
        messageId: match[2]?.trim() ?? '',
        role: match[3]?.trim() ?? '',
        snippet: '',
      };
      continue;
    }

    if (current) {
      current.snippet = current.snippet.length > 0 ? `${current.snippet} ${line}` : line;
    }
  }

  if (current) hits.push(current);
  return hits.length > 0 ? hits : null;
}
