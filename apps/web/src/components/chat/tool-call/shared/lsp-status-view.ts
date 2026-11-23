/**
 * `lsp_status`（含 `mcp__lsp__status`）的结果视图。
 *
 * 输出契约来自 `packages/lsp-client/src/types.ts`：
 * - `servers: LSPServerStatus[]` → `{ id, root, running, fileCount, diagnosticCount }`
 * - `missing: LSPMissingServer[]` → `{ id, extensions, binary, installCommand?, installed }`
 *
 * 两组信息性质不同：前者是「现在有哪些在跑、各背了多少诊断」，后者是「这台机器上
 * 还有哪些语言服务可用 / 需要安装」——后者尤其带着 `installCommand`，那正是用户
 * 看完之后真正要拿走的东西，所以放进 description 而不是埋进 meta。
 */

import {
  pickBoolean,
  pickNumber,
  pickText,
  resultAvatarText,
  type ResultGroup,
  type ResultRow,
  type ResultView,
} from './result-view.js';

export function buildLspStatusView(output: unknown): ResultView | null {
  const record = asRecord(output);
  if (!record) return null;

  const servers = readRecords(record['servers']);
  const missing = readRecords(record['missing']);
  // 两个字段都不存在 → 不是 lsp_status 的输出，交回通用兜底。
  if (servers === null && missing === null) return null;

  const groups: ResultGroup[] = [];
  if (servers !== null && servers.length > 0) {
    groups.push({ label: '运行中', count: servers.length, rows: servers.map(toServerRow) });
  }
  if (missing !== null && missing.length > 0) {
    groups.push({
      label: '可用的语言服务',
      count: missing.length,
      rows: missing.map(toMissingRow),
    });
  }

  if (groups.length === 0) {
    // 两个数组都空是合法结果：没有任何 LSP server 在跑，也没有探测到可安装项。
    return { groups: [{ rows: [] }], note: '当前没有 LSP 服务在运行' };
  }

  const notInstalled = missing?.filter((item) => item['installed'] === false).length ?? 0;
  return {
    groups,
    ...(notInstalled > 0 ? { note: `${notInstalled} 个尚未安装` } : {}),
  };
}

function toServerRow(item: Record<string, unknown>): ResultRow {
  const id = pickText(item, ['id', 'serverID', 'name']) ?? '（未知服务）';
  const meta: string[] = [];

  const root = pickText(item, ['root']);
  if (root) meta.push(root);

  const fileCount = pickNumber(item, ['fileCount']);
  if (fileCount !== undefined) meta.push(`${fileCount} 个文件`);

  const diagnosticCount = pickNumber(item, ['diagnosticCount']);
  // 0 条诊断不值得占一个位置——用户关心的是「有几个问题」。
  if (diagnosticCount !== undefined && diagnosticCount > 0) {
    meta.push(`${diagnosticCount} 条诊断`);
  }

  return {
    avatar: resultAvatarText(id),
    title: id,
    badges: [{ label: '运行中', tone: 'ok' }],
    ...(meta.length > 0 ? { meta } : {}),
  };
}

function toMissingRow(item: Record<string, unknown>): ResultRow {
  const id = pickText(item, ['id', 'name']) ?? '（未知服务）';
  const installed = pickBoolean(item, ['installed']);
  const meta: string[] = [];

  // `extensions` 是 `.ts` / `.tsx` 这类后缀，用它说明「这个服务管哪些文件」。
  const extensions = readTextArray(item['extensions']);
  if (extensions.length > 0) meta.push(extensions.join(' '));

  const binary = readBinary(item['binary']);
  if (binary) meta.push(binary);

  const installCommand = pickText(item, ['installCommand']);

  return {
    avatar: resultAvatarText(id),
    title: id,
    badges: [
      installed === true ? { label: '已安装', tone: 'ok' } : { label: '未安装', tone: 'warn' },
    ],
    // 装好了就不必再展示安装命令（那是一条已经完成的操作指引）。
    ...(installCommand && installed !== true ? { description: installCommand } : {}),
    ...(meta.length > 0 ? { meta } : {}),
  };
}

/** `binary` 可能是单个字符串或候选列表。 */
function readBinary(value: unknown): string | undefined {
  const list = readTextArray(value);
  return list.length > 0 ? list.join(' / ') : undefined;
}

function readTextArray(value: unknown): string[] {
  if (typeof value === 'string') return value.trim().length > 0 ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** 数组里全是对象才算有效列表；返回 null 表示「这个字段不存在」。 */
function readRecords(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null;
  const records: Array<Record<string, unknown>> = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) return null;
    records.push(record);
  }
  return records;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
