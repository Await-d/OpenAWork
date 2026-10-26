/**
 * `desktop_automation` 读取类动作的输出解析（纯函数）。
 *
 * 各动作的真实返回形态来自网关 `runDesktopAutomationTool`：
 *   - status        → `{ enabled, started }`
 *   - console       → `{ messages: [{ level, text, timestamp }], errors: [{ message, timestamp }], truncated }`
 *   - network_list  → `{ requests: [...], truncated }`
 *   - network_get   → `{ request: {...} }`
 *   - find          → `{ matches: [...] }`
 *   - frames        → `{ frames: [...] }`
 *   - snapshot      → `{ snapshot: { url, title, openPages, ... } }`
 *   - evaluate      → `{ result }`
 *   - content       → `{ content: html }`（或落盘后的预览形态）
 *
 * 解析失败或动作不需要专用视图时返回 `{ kind: 'none' }`，卡片据此回退到通用渲染。
 */

export interface DesktopConsoleMessageView {
  level: string;
  text: string;
  timestamp?: number;
}

export interface DesktopConsoleErrorView {
  message: string;
  timestamp?: number;
}

export interface DesktopNetworkRequestView {
  id: string;
  method: string;
  url: string;
  resourceType: string;
  status?: number;
  ok?: boolean;
  durationMs?: number;
  failureText?: string;
}

export interface DesktopElementMatchView {
  tag: string;
  id?: string;
  text: string;
  visible: boolean;
}

export interface DesktopFrameView {
  index: number;
  name: string;
  url: string;
  isMain: boolean;
}

export type DesktopOutputNode =
  | { kind: 'status'; enabled?: boolean; started?: boolean }
  | {
      kind: 'console';
      messages: DesktopConsoleMessageView[];
      errors: DesktopConsoleErrorView[];
      truncated: boolean;
    }
  | { kind: 'network-list'; requests: DesktopNetworkRequestView[]; truncated: boolean }
  | { kind: 'network-request'; request: DesktopNetworkRequestView }
  | { kind: 'elements'; matches: DesktopElementMatchView[] }
  | { kind: 'frames'; frames: DesktopFrameView[] }
  | { kind: 'snapshot'; url: string; title: string; openPages: string[] }
  | { kind: 'json'; value: unknown }
  | { kind: 'text'; text: string }
  | { kind: 'none' };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeOutput(output: unknown): Record<string, unknown> | null {
  const direct = asRecord(output);
  if (direct) return direct;
  if (typeof output !== 'string') return null;
  const trimmed = output.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return asRecord(JSON.parse(trimmed) as unknown);
  } catch {
    // 截断 / 非 JSON：交给调用方按文本兜底。
    return null;
  }
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseConsoleMessage(value: unknown): DesktopConsoleMessageView | null {
  const record = asRecord(value);
  if (!record) return null;
  const text = readString(record, 'text');
  if (text.length === 0) return null;
  return {
    level: readString(record, 'level') || 'log',
    text,
    ...(readNumber(record, 'timestamp') !== undefined
      ? { timestamp: readNumber(record, 'timestamp') }
      : {}),
  };
}

function parseConsoleError(value: unknown): DesktopConsoleErrorView | null {
  const record = asRecord(value);
  if (!record) return null;
  const message = readString(record, 'message');
  if (message.length === 0) return null;
  return {
    message,
    ...(readNumber(record, 'timestamp') !== undefined
      ? { timestamp: readNumber(record, 'timestamp') }
      : {}),
  };
}

function parseNetworkRequest(value: unknown): DesktopNetworkRequestView | null {
  const record = asRecord(value);
  if (!record) return null;
  const url = readString(record, 'url');
  if (url.length === 0) return null;
  const status = readNumber(record, 'status');
  const durationMs = readNumber(record, 'durationMs');
  const failureText = readString(record, 'failureText');
  const ok = readBoolean(record, 'ok');
  return {
    id: readString(record, 'id'),
    method: readString(record, 'method') || 'GET',
    url,
    resourceType: readString(record, 'resourceType'),
    ...(status !== undefined ? { status } : {}),
    ...(ok !== undefined ? { ok } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(failureText.length > 0 ? { failureText } : {}),
  };
}

function parseElementMatch(value: unknown): DesktopElementMatchView | null {
  const record = asRecord(value);
  if (!record) return null;
  const tag = readString(record, 'tag');
  if (tag.length === 0) return null;
  const id = readString(record, 'id');
  return {
    tag,
    ...(id.length > 0 ? { id } : {}),
    text: readString(record, 'text'),
    visible: readBoolean(record, 'visible') ?? true,
  };
}

function parseFrame(value: unknown): DesktopFrameView | null {
  const record = asRecord(value);
  if (!record) return null;
  const index = readNumber(record, 'index');
  if (index === undefined) return null;
  return {
    index,
    name: readString(record, 'name'),
    url: readString(record, 'url'),
    isMain: record['isMain'] === true,
  };
}

function collectArray<T>(
  record: Record<string, unknown>,
  key: string,
  parseItem: (value: unknown) => T | null,
): T[] {
  const raw = record[key];
  if (!Array.isArray(raw)) return [];
  const parsed: T[] = [];
  for (const item of raw) {
    const view = parseItem(item);
    if (view) parsed.push(view);
  }
  return parsed;
}

/** 按动作解析输出；无法识别时返回 `none`。 */
export function parseDesktopOutput(action: string, output: unknown): DesktopOutputNode {
  const record = normalizeOutput(output);
  if (!record) return { kind: 'none' };
  const normalizedAction = action.trim().toLowerCase();

  switch (normalizedAction) {
    case 'status': {
      const enabled = readBoolean(record, 'enabled');
      const started = readBoolean(record, 'started');
      return enabled === undefined && started === undefined
        ? { kind: 'none' }
        : {
            kind: 'status',
            ...(enabled !== undefined ? { enabled } : {}),
            ...(started !== undefined ? { started } : {}),
          };
    }
    case 'console': {
      if (!Array.isArray(record['messages']) && !Array.isArray(record['errors'])) {
        return { kind: 'none' };
      }
      return {
        kind: 'console',
        messages: collectArray(record, 'messages', parseConsoleMessage),
        errors: collectArray(record, 'errors', parseConsoleError),
        truncated: record['truncated'] === true,
      };
    }
    case 'network_list': {
      if (!Array.isArray(record['requests'])) return { kind: 'none' };
      return {
        kind: 'network-list',
        requests: collectArray(record, 'requests', parseNetworkRequest),
        truncated: record['truncated'] === true,
      };
    }
    case 'network_get': {
      const request = parseNetworkRequest(record['request']);
      return request ? { kind: 'network-request', request } : { kind: 'none' };
    }
    case 'find': {
      if (!Array.isArray(record['matches'])) return { kind: 'none' };
      return { kind: 'elements', matches: collectArray(record, 'matches', parseElementMatch) };
    }
    case 'frames': {
      if (!Array.isArray(record['frames'])) return { kind: 'none' };
      return { kind: 'frames', frames: collectArray(record, 'frames', parseFrame) };
    }
    case 'snapshot': {
      const snapshot = asRecord(record['snapshot']);
      if (!snapshot) return { kind: 'none' };
      const openPages = Array.isArray(snapshot['openPages'])
        ? snapshot['openPages'].filter((page): page is string => typeof page === 'string')
        : [];
      return {
        kind: 'snapshot',
        url: readString(snapshot, 'url'),
        title: readString(snapshot, 'title'),
        openPages,
      };
    }
    case 'select': {
      const selected = record['selected'];
      return Array.isArray(selected) ? { kind: 'json', value: selected } : { kind: 'none' };
    }
    case 'evaluate':
      return 'result' in record ? { kind: 'json', value: record['result'] } : { kind: 'none' };
    case 'content': {
      const content =
        typeof record['content'] === 'string'
          ? record['content']
          : typeof record['html'] === 'string'
            ? record['html']
            : '';
      return content.length > 0 ? { kind: 'text', text: content } : { kind: 'none' };
    }
    default:
      return { kind: 'none' };
  }
}
