/**
 * 渠道读取类工具的结果视图（`PluginGetGroupMessages` / `FeishuListChatMembers` /
 * `FeishuBitableGetRecords` 等）。
 *
 * 这些工具的输出差异很大，但都能归到四种形态之一：
 * - **消息**（`senderName` + `content`）：行卡，发送者是主体
 * - **记录**（`fields` 是开放键值映射）：表格——列名由用户自建，写死列名一定会错
 * - **群组**（`name` + `memberCount`）：行卡，右侧给人数
 * - **成员**（`name` + `member_id` / `tenant_key`）：行卡，副信息给 id
 *
 * 识别要求**数组内每一项都符合同一形态**才认，否则返回 null —— 宁可交给通用兜底，
 * 也不要把一段恰好有 `name` 字段的 JSON 当成群列表。
 */

import {
  formatShortDateTime,
  pickNumber,
  pickText,
  resultAvatarText,
  type ResultRow,
  type ResultTable,
  type ResultView,
} from './result-view.js';

type ChannelShape = 'message' | 'record' | 'group' | 'member';

/** 表格最多展示的列数：用户自建字段可能几十个，全铺开就没法看了。 */
const MAX_TABLE_COLUMNS = 8;

export function buildChannelResultView(output: unknown): ResultView | null {
  const items = readChannelItems(output);
  if (!items) return null;

  const shape = detectShape(items);
  if (!shape) return null;

  if (shape === 'record') {
    const table = buildRecordTable(items);
    if (!table) return null;
    return {
      table,
      ...(items.length > 0 ? { note: `${items.length} 条记录` } : {}),
    };
  }

  return {
    groups: [{ rows: items.map((item) => toChannelRow(item, shape)) }],
    note: buildCountNote(shape, items.length),
  };
}

/** 展开体顶部的条数说明：行卡没有表头，不给一句总数就只能靠用户自己数。 */
function buildCountNote(shape: ChannelShape, count: number): string {
  if (shape === 'message') return `${count} 条消息`;
  if (shape === 'group') return `${count} 个群组`;
  if (shape === 'member') return `${count} 位成员`;
  return `${count} 条记录`;
}

function readChannelItems(output: unknown): Array<Record<string, unknown>> | null {
  const value = coerceJson(output);
  const list = Array.isArray(value) ? value : readEnvelopeList(value);
  if (!list || list.length === 0) return null;

  const items: Array<Record<string, unknown>> = [];
  for (const item of list) {
    const record = asRecord(item);
    // 混了非对象元素说明这不是渠道列表，整组放弃。
    if (!record) return null;
    items.push(record);
  }
  return items;
}

/** 飞书成员与 Bitable 都包了一层 `{ items, page_token, has_more }`。 */
function readEnvelopeList(value: unknown): unknown[] | null {
  const record = asRecord(value);
  if (!record) return null;
  for (const key of ['items', 'data', 'list']) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return null;
}

function detectShape(items: Array<Record<string, unknown>>): ChannelShape | null {
  if (items.every(isMessage)) return 'message';
  if (items.every(isRecordRow)) return 'record';
  // 成员的特征比群组更具体（`member_id` / `tenant_key` 是群组不会有的字段），先判成员，
  // 免得某个渠道的成员对象恰好带 `id` 时被误认成群组。
  if (items.every(isMember)) return 'member';
  if (items.every(isGroup)) return 'group';
  return null;
}

function isMessage(item: Record<string, unknown>): boolean {
  const hasSender =
    pickText(item, ['senderName']) !== undefined || pickText(item, ['senderId']) !== undefined;
  return hasSender && 'content' in item;
}

function isRecordRow(item: Record<string, unknown>): boolean {
  return asRecord(item['fields']) !== null;
}

/**
 * 群组判据是 `name` + `id`（`ChannelGroup` 的两个**必填**字段）。
 *
 * 不能用 `memberCount`：它在 `ChannelGroup` 里是可选的，而 QQ / 微信的
 * `listRecentChannelGroups` 只返回 `{ id, name }`（见
 * `services/agent-gateway/src/channels/channel-message-cache.ts`）。拿它当判据会让
 * 这两个渠道的 `PluginListGroups` 永远识别不出来，整条落到通用兜底。
 * 人数只在拿得到时才显示（`trailing` 已按可选处理）。
 */
function isGroup(item: Record<string, unknown>): boolean {
  return pickText(item, ['name']) !== undefined && pickText(item, ['id']) !== undefined;
}

function isMember(item: Record<string, unknown>): boolean {
  if (pickText(item, ['name']) === undefined) return false;
  return pickText(item, ['member_id']) !== undefined || 'tenant_key' in item;
}

function toChannelRow(item: Record<string, unknown>, shape: ChannelShape): ResultRow {
  if (shape === 'message') {
    const sender = pickText(item, ['senderName']) ?? pickText(item, ['senderId']) ?? '未知发送者';
    const content = pickText(item, ['content']);
    const time = formatShortDateTime(item['timestamp']);
    const repliedTo = pickText(item, ['replyMessageId']);
    const meta: string[] = [];
    if (time) meta.push(time);
    if (repliedTo) meta.push('回复');
    return {
      avatar: resultAvatarText(sender),
      title: sender,
      ...(content ? { description: content } : {}),
      ...(meta.length > 0 ? { meta } : {}),
    };
  }

  if (shape === 'group') {
    const name = pickText(item, ['name']) ?? '未命名群组';
    const memberCount = pickNumber(item, ['memberCount']);
    const id = pickText(item, ['id']);
    return {
      avatar: resultAvatarText(name),
      title: name,
      ...(id ? { meta: [id] } : {}),
      ...(memberCount === undefined ? {} : { trailing: `${memberCount} 人` }),
    };
  }

  // member
  const name = pickText(item, ['name']) ?? '未知成员';
  const memberId = pickText(item, ['member_id']) ?? pickText(item, ['open_id']);
  return {
    avatar: resultAvatarText(name),
    title: name,
    ...(memberId ? { meta: [memberId] } : {}),
  };
}

/**
 * Bitable 记录 → 表格。列名取所有记录 `fields` 键的并集并保持出现顺序——
 * 不同记录的字段可能不完全一致，取并集才不会丢列。
 */
function buildRecordTable(items: Array<Record<string, unknown>>): ResultTable | null {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const fields = asRecord(item['fields']) ?? {};
    for (const key of Object.keys(fields)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }
  if (columns.length === 0) return null;

  const shown = columns.slice(0, MAX_TABLE_COLUMNS);
  const rows = items.map((item) => {
    const fields = asRecord(item['fields']) ?? {};
    return shown.map((column) => ({ text: formatFieldValue(fields[column]) }));
  });

  const table: ResultTable = { columns: shown, rows };
  if (columns.length > shown.length) {
    // 溢出信息由调用方放进 footnote 更合适，但表格自身也要能说清自己不全。
    table.columns = [...shown, '…'];
    for (const row of table.rows) {
      row.push({ text: `另有 ${columns.length - shown.length} 列` });
    }
  }
  return table;
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((item) => (typeof item === 'string' ? item : '')).filter(Boolean);
    return parts.length > 0 ? parts.join('、') : `[${value.length} 项]`;
  }
  return JSON.stringify(value) ?? '';
}

/**
 * 渠道**发送类**的确认结果。
 *
 * 接口约定就是 `Promise<{ messageId: string }>`（`channels/types.ts` 的
 * `MessagingChannelService.sendMessage` / `replyMessage` / `sendImage` / `sendFile`
 * 全部如此），网关再套一层 `JSON.stringify`。
 *
 * 它没有可展示的内容，只有「发出去了」这个信号外加一个技术 id。落到通用字段表会渲染成
 * `messageId | om_xxx`，而这里想说的是「已发送了消息」——所以识别出来交给确认行渲染。
 * 判定刻意收得很窄（必须有一个非空 `messageId` 字符串），避免把别的对象误认成发送回执。
 */
export function extractChannelAck(output: unknown): Record<string, unknown> | null {
  const value = coerceJson(output);
  const record = asRecord(value);
  if (!record) return null;
  const messageId = record['messageId'];
  if (typeof messageId !== 'string' || messageId.trim().length === 0) return null;
  return record;
}

/** 输出是 `JSON.stringify(...)` 字符串；已解析的则原样返回。 */
function coerceJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
