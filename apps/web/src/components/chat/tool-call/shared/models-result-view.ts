/**
 * `models` 工具的结果视图。
 *
 * 输出是 `{ providers: [{ id, name, models }], total, next }`，按 provider 分组、
 * 当前会话自身 provider 排最前。两个坑：
 *
 * 1. `cost` 是**数组**（`Array<{ input, output, cache }>`），目前恒只有一个元素——
 *    按对象读会拿到 undefined，定价整个丢掉；
 * 2. `released: 0` 表示「未知」，直接格式化会渲染成 1970 年。
 *
 * 用户选了行卡 + 表格两种形态，而这两者是互斥的排版，所以这里同时产出两份视图，
 * 由 `ResultViewPreview` 提供切换：行卡适合「确认某个模型在不在」，
 * 表格适合「比价」。
 */

import {
  formatShortDate,
  formatUsdPrice,
  pickNumber,
  pickText,
  resultAvatarText,
  type ResultBadge,
  type ResultCell,
  type ResultRow,
  type ResultTable,
  type ResultView,
} from './result-view.js';

export interface ModelsResultViews {
  primary: ResultView;
  alternate: ResultView;
}

interface ModelEntry {
  id?: string;
  name: string;
  status?: string;
  released?: number;
  inputPrice?: number;
  outputPrice?: number;
  cacheReadPrice?: number;
}

interface ProviderGroup {
  id: string;
  name: string;
  models: ModelEntry[];
}

export function buildModelsResultViews(output: unknown): ModelsResultViews | null {
  const groups = extractProviderGroups(output);
  if (!groups) return null;

  const total = readTotal(output);
  const hasNext = readHasNext(output);
  const note = buildTotalNote(groups, total);

  return {
    primary: {
      ...(note ? { note } : {}),
      groups: groups.map((group) => ({
        label: group.name,
        count: group.models.length,
        rows: group.models.map(toModelRow),
      })),
      ...(hasNext ? { footnote: '还有更多结果，可用 offset 翻页' } : {}),
    },
    alternate: { table: buildModelTable(groups) },
  };
}

function extractProviderGroups(output: unknown): ProviderGroup[] | null {
  const record = asRecord(output);
  if (!record) return null;
  const rawProviders = record['providers'];
  if (!Array.isArray(rawProviders)) return null;
  // 强特征：必须有 total（数字）或 next（数字 / null），否则 `{ providers: [] }`
  // 这种普通结构也会被当成模型目录。
  const hasTotal = typeof record['total'] === 'number';
  const hasNext = 'next' in record;
  if (!hasTotal && !hasNext) return null;

  const groups: ProviderGroup[] = [];
  for (const rawProvider of rawProviders) {
    const provider = asRecord(rawProvider);
    if (!provider) return null;
    const rawModels = provider['models'];
    if (!Array.isArray(rawModels)) return null;
    // `id` 这里刻意保持 `undefined` 而不是 `?? ''`：`''` 不是 nullish，若先兜成空串，
    // 下面 name 回退链里的 `'未命名 Provider'` 就永远走不到，分组标题会渲染成空白。
    // 只有落到分组字段（要求 string）时才补空串。
    const providerId = pickText(provider, ['id']);
    groups.push({
      id: providerId ?? '',
      name: pickText(provider, ['name']) ?? providerId ?? '未命名 Provider',
      models: rawModels.map((rawModel) => toModelEntry(rawModel, providerId ?? '')),
    });
  }
  return groups;
}

function toModelEntry(raw: unknown, providerId: string): ModelEntry {
  const record = asRecord(raw) ?? {};
  // `cost` 是数组，取首元素；缺失时价格留空而不是显示 $0。
  const cost = Array.isArray(record['cost']) ? asRecord(record['cost'][0]) : null;
  const cache = cost ? asRecord(cost['cache']) : null;
  const modelId = pickText(record, ['id']);
  const status = pickText(record, ['status']);
  const released = pickNumber(record, ['released']);
  // 一律「先取值、再判空」。写成 `pickNumber(x) === undefined ? {} : { v: pickNumber(x) }`
  // 会让同一次提取算两遍，两遍一旦不同就是静默错值；上面的 `released` 也是这个写法。
  const inputPrice = cost ? pickNumber(cost, ['input']) : undefined;
  const outputPrice = cost ? pickNumber(cost, ['output']) : undefined;
  const cacheReadPrice = cache ? pickNumber(cache, ['read']) : undefined;

  return {
    ...(modelId ? { id: modelId } : {}),
    name: pickText(record, ['name']) ?? modelId ?? providerId,
    ...(status ? { status } : {}),
    ...(released === undefined ? {} : { released }),
    ...(inputPrice === undefined ? {} : { inputPrice }),
    ...(outputPrice === undefined ? {} : { outputPrice }),
    ...(cacheReadPrice === undefined ? {} : { cacheReadPrice }),
  };
}

function toModelRow(model: ModelEntry): ResultRow {
  const badges: ResultBadge[] = [];
  if (model.status === 'deprecated') {
    // 上游语义是「该账号下这个模型被停用」（`model.enabled === false`），不是官方下线。
    badges.push({ label: '已停用', tone: 'off' });
  } else if (model.status) {
    badges.push({ label: '可用', tone: 'ok' });
  }

  const meta: string[] = [];
  if (model.id) meta.push(model.id);
  if (model.released !== undefined) {
    const released = formatShortDate(model.released);
    if (released) meta.push(`${released} 发布`);
  }

  return {
    avatar: resultAvatarText(model.name),
    title: model.name,
    ...(badges.length > 0 ? { badges } : {}),
    ...(meta.length > 0 ? { meta } : {}),
    ...(model.inputPrice === undefined && model.outputPrice === undefined
      ? {}
      : {
          trailing: formatPricePair(model.inputPrice, model.outputPrice),
          trailingTitle: '输入 / 输出，每百万 token',
        }),
  };
}

function formatPricePair(input?: number, output?: number): string {
  const left = input === undefined ? '—' : formatUsdPrice(input);
  const right = output === undefined ? '—' : formatUsdPrice(output);
  return `${left} / ${right}`;
}

function buildModelTable(groups: ProviderGroup[]): ResultTable {
  const rows: ResultCell[][] = [];
  for (const group of groups) {
    for (const model of group.models) {
      rows.push([
        { text: model.name, strong: true },
        {
          badge:
            model.status === 'deprecated'
              ? { label: '已停用', tone: 'off' }
              : { label: '可用', tone: 'ok' },
          text: '',
        },
        {
          text: model.inputPrice === undefined ? '—' : formatUsdPrice(model.inputPrice),
          mono: true,
        },
        {
          text: model.outputPrice === undefined ? '—' : formatUsdPrice(model.outputPrice),
          mono: true,
        },
        {
          text: model.cacheReadPrice === undefined ? '—' : formatUsdPrice(model.cacheReadPrice),
          mono: true,
        },
        { text: formatShortDate(model.released) ?? '—', mono: true },
        { text: group.name, mono: true },
      ]);
    }
  }
  return {
    columns: ['模型', '状态', '输入 / M', '输出 / M', '缓存读', '发布', 'Provider'],
    rows,
  };
}

function buildTotalNote(groups: ProviderGroup[], total: number | undefined): string | undefined {
  const shown = groups.reduce((sum, group) => sum + group.models.length, 0);
  if (total === undefined) return shown > 0 ? `显示 ${shown} 个模型` : undefined;
  if (total === shown) return `共 ${total} 个模型`;
  return `共 ${total} 个模型，显示前 ${shown} 个`;
}

function readTotal(output: unknown): number | undefined {
  return pickNumber(asRecord(output) ?? {}, ['total']);
}

function readHasNext(output: unknown): boolean {
  return pickNumber(asRecord(output) ?? {}, ['next']) !== undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
