/**
 * 管理类工具（`mcp_manage_servers` / `memory_manage` / `skill_manage` / `plugin_manage` /
 * `schedule_manage` / `agent_manage` / `team_workspace_manage`）的结果识别。
 *
 * 这七个工具的输出信封形状统一为 `{ ok, action, count?, <列表 | 实体> }`，但有三处差异
 * 必须处理，否则会渲染出「空列表」这种误导性画面：
 *
 * 1. `mcp_manage_servers` **没有 `count`**（唯一的例外），计数只能自己算；
 * 2. `memory_manage` 的 `add` / `update` / `delete` 返回的不是列表，而是**待确认提议**
 *    （`status: 'pending_confirmation'`、`outcome`、`proposalId`），且 `ok` 由
 *    `outcome === 'created'` 计算，**可能是 false**；
 * 3. 同一个工具换 action 就换列表字段名（`skills` → `results`、`jobs` → `history`），
 *    所以不能枚举字段名，必须按「信封里第一个数组字段」来认。
 */

import {
  formatShortDate,
  formatShortDateTime,
  pickBoolean,
  pickNumber,
  pickText,
  resultAvatarText,
  type ResultBadge,
  type ResultCell,
  type ResultRow,
  type ResultTable,
  type ResultView,
} from './result-view.js';

export interface AdminProposal {
  status: string;
  /** `created` / `not_created`；网关的 `ok` 就是按它算的，标题也跟着它走。 */
  outcome?: string;
  proposalId?: string;
  message?: string;
}

export interface AdminEnvelope {
  action: string;
  ok: boolean;
  /** 列表字段名（`servers` / `skills` / …）；没有列表时为空。 */
  listKey?: string;
  items: Array<Record<string, unknown>>;
  /** 信封声明的总数。`mcp_manage_servers` 不提供。 */
  declaredCount?: number;
  /** 单实体结果字段名（`job` / `skill` / `workspace`…）。 */
  singleKey?: string;
  single?: Record<string, unknown>;
  proposal?: AdminProposal;
  hint?: string;
}

/** 这些键虽然可能是对象，但不是「结果实体」，展示成行只会让人困惑。 */
const NON_ENTITY_OBJECT_KEYS = new Set(['connect', 'args', 'input', 'output']);

/**
 * 识别管理类信封。判定用「`ok` 是布尔 + `action` 是非空字符串」这对强特征——
 * 比按工具名列举更稳，也能覆盖以后新增的同族管理工具。
 */
export function extractAdminEnvelope(output: unknown): AdminEnvelope | null {
  const record = asRecord(output);
  if (!record) return null;

  const ok = record['ok'];
  const action = record['action'];
  if (typeof ok !== 'boolean') return null;
  if (typeof action !== 'string' || action.trim().length === 0) return null;

  const envelope: AdminEnvelope = { action: action.trim(), ok, items: [] };

  const count = pickNumber(record, ['count']);
  if (count !== undefined) envelope.declaredCount = count;

  const hint = pickText(record, ['hint']);
  if (hint) envelope.hint = hint;

  // 列表：取第一个「元素全是对象」的数组字段。
  for (const [key, value] of Object.entries(record)) {
    if (!Array.isArray(value)) continue;
    const objects = value.filter(isRecord);
    // 空数组也认（合法的「没有条目」），但混了非对象的数组不像结果集。
    if (objects.length !== value.length) continue;
    envelope.listKey = key;
    envelope.items = objects;
    break;
  }

  if (envelope.listKey === undefined) {
    const proposal = readProposal(record);
    if (proposal) {
      envelope.proposal = proposal;
    } else {
      for (const [key, value] of Object.entries(record)) {
        if (NON_ENTITY_OBJECT_KEYS.has(key)) continue;
        const entity = asRecord(value);
        if (!entity) continue;
        envelope.singleKey = key;
        envelope.single = entity;
        break;
      }
    }
  }

  // 既没有列表、也没有实体、也不是提议——大概率不是管理类结果，交回通用兜底。
  if (envelope.listKey === undefined && envelope.single === undefined && !envelope.proposal) {
    return null;
  }
  return envelope;
}

/** 待确认提议：`status` + （`pendingConfirmation` 或 `outcome`）是它的联合特征。 */
function readProposal(record: Record<string, unknown>): AdminProposal | null {
  const status = pickText(record, ['status']);
  if (!status) return null;
  const outcome = pickText(record, ['outcome']);
  const pending = pickBoolean(record, ['pendingConfirmation']);
  if (pending !== true && outcome === undefined) return null;

  const proposalId = pickText(record, ['proposalId']);
  const message = pickText(record, ['message']);
  return {
    status,
    ...(outcome ? { outcome } : {}),
    ...(proposalId ? { proposalId } : {}),
    ...(message ? { message } : {}),
  };
}

/**
 * 提议行上的动作标签。
 *
 * 取的是 `envelope.action`——网关回填的**用户可见动作**。注意 `memory_manage` 的
 * `delete` 会回填 `archive`（「归档即删除」是它的用户可见语义），所以不能拿模型的
 * 入参去猜，必须用返回值里这个字段。
 *
 * 这里是短标签（名词向），和折叠标题的 `adminActionSummary`（动词向，如
 * 「已删除了记忆」）是两套词汇，刻意不合并——硬并会逼出 `已列举了` / `已读取了历史`
 * 这类拼不出来的形状。
 */
const PROPOSAL_ACTION_LABELS: Record<string, string> = {
  add: '新增',
  archive: '归档',
  create: '创建',
  delete: '删除',
  disable: '停用',
  enable: '启用',
  install: '安装',
  reload: '重新加载',
  remove: '移除',
  run: '运行',
  source_add: '添加来源',
  source_remove: '移除来源',
  uninstall: '卸载',
  update: '更新',
};

/** 未知动作给中性中文标签——绝不把英文动作名摊到界面上。 */
function proposalActionLabel(action: string): string {
  return PROPOSAL_ACTION_LABELS[action] ?? '变更';
}

/** 管理类信封 → 结果视图。返回 null 表示没有可渲染的内容。 */
export function buildAdminResultView(envelope: AdminEnvelope): ResultView | null {
  if (envelope.proposal) {
    // 提议没有列表可渲染，只给一行确认——渲染成空列表会让人以为「什么都没返回」。
    // `outcome` 优先：网关的 `ok` 就是按 `outcome === 'created'` 算的，标题跟着它才不会自相矛盾。
    const created =
      envelope.proposal.outcome === undefined
        ? envelope.proposal.status === 'pending_confirmation'
        : envelope.proposal.outcome === 'created';
    return {
      groups: [
        {
          rows: [
            {
              avatar: '⏳',
              title: created ? '已提交待确认' : '未创建',
              badges: [
                { label: proposalActionLabel(envelope.action), tone: created ? 'soft' : 'error' },
              ],
              ...(envelope.proposal.message ? { description: envelope.proposal.message } : {}),
              ...(envelope.proposal.proposalId ? { meta: [envelope.proposal.proposalId] } : {}),
            },
          ],
        },
      ],
    };
  }

  if (envelope.items.length > 0) {
    // 定时任务天然列对齐，走表格更有用（其余管理工具的信息层级更适合行卡）。
    if (envelope.listKey === 'jobs') {
      return { table: buildScheduleTable(envelope.items) };
    }
    const rows = envelope.items.map(toAdminRow);
    const note = buildStatusNote(envelope.items);
    return {
      groups: [{ rows }],
      ...(note ? { note } : {}),
      ...(envelope.hint ? { footnote: envelope.hint } : {}),
    };
  }

  if (envelope.listKey !== undefined) {
    // 空列表是合法结果，明确说出来比渲染一片空白好。
    return {
      groups: [{ rows: [] }],
      note: '没有条目',
      ...(envelope.hint ? { footnote: envelope.hint } : {}),
    };
  }

  if (envelope.single) {
    return { groups: [{ rows: [toAdminRow(envelope.single)] }] };
  }
  return null;
}

/** 标题字段按语义取：七个工具的标题名各不相同（`name` / `displayName` / `label` / `key`…）。 */
const TITLE_KEYS = ['displayName', 'label', 'name', 'title', 'key', 'skillId', 'id'] as const;
const DESCRIPTION_KEYS = [
  'description',
  'value',
  'systemPromptPreview',
  'prompt',
  'bio',
  'error',
] as const;
const ID_KEYS = ['id', 'skillId', 'sourceId'] as const;
/** 「类型」类字段：显示成灰色小标签，帮助识别条目种类。 */
const KIND_KEYS = ['transport', 'visibility', 'source', 'type'] as const;
const MODEL_KEYS = ['model'] as const;
/** 时间字段：优先「下次触发」，其次「更新时间」。 */
const NEXT_TIME_KEYS = ['nextFireAt', 'lastFiredAt', 'updatedAt'] as const;
const COUNT_KEYS = [
  { key: 'memberCount', label: '成员' },
  { key: 'fireCount', label: '已触发' },
  { key: 'priority', label: '优先级' },
] as const;

function toAdminRow(item: Record<string, unknown>): ResultRow {
  const title = pickText(item, TITLE_KEYS) ?? '（未命名）';
  const badges: ResultBadge[] = [];

  const enabled = pickBoolean(item, ['enabled']);
  if (enabled === true) badges.push({ label: '已启用', tone: 'ok' });
  else if (enabled === false) badges.push({ label: '已停用', tone: 'off' });

  // `state` 是插件信封的状态词（取值 `active` / `disabled` / `failed`，见
  // `plugin/plugin-admin-tools.ts`），**不能直接当徽章**——那是三个英文单词。
  // 认不出的状态就什么都不显示：`enabled` 已经表达了启停，宁缺勿滥。
  const state = pickText(item, ['state']);
  if (state === 'failed') {
    badges.push({ label: '加载失败', tone: 'error' });
  } else if (enabled === undefined) {
    if (state === 'active') badges.push({ label: '已加载', tone: 'ok' });
    else if (state === 'disabled') badges.push({ label: '已停用', tone: 'off' });
  }

  const version = pickText(item, ['version']);
  if (version) badges.push({ label: `v${version}`, tone: 'soft' });

  const meta: string[] = [];
  const id = pickText(item, ID_KEYS);
  if (id && id !== title) meta.push(id);

  const kind = pickText(item, KIND_KEYS);
  if (kind) meta.push(kind);

  const model = pickText(item, MODEL_KEYS);
  if (model) meta.push(model);

  for (const { key, label } of COUNT_KEYS) {
    const value = pickNumber(item, [key]);
    if (value !== undefined) meta.push(`${label} ${value}`);
  }

  const time = formatShortDateTime(item['nextFireAt']) ?? formatShortDate(item['updatedAt']);
  if (time) meta.push(time);

  const description = pickText(item, DESCRIPTION_KEYS);
  return {
    avatar: resultAvatarText(title),
    title,
    ...(badges.length > 0 ? { badges } : {}),
    ...(description ? { description } : {}),
    ...(meta.length > 0 ? { meta } : {}),
  };
}

/** 变体 C 的头部结论：有停用 / 失败项时先说结论，省得用户逐行找。 */
function buildStatusNote(items: Array<Record<string, unknown>>): string | undefined {
  let disabled = 0;
  let failed = 0;
  for (const item of items) {
    if (pickBoolean(item, ['enabled']) === false) disabled += 1;
    if (pickText(item, ['state']) === 'failed') failed += 1;
  }
  const parts: string[] = [];
  if (disabled > 0) parts.push(`${disabled} 个已停用`);
  if (failed > 0) parts.push(`${failed} 个加载失败`);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** 定时任务表格：调度表达式、下次触发、已触发次数列对齐后才能横向比较。 */
function buildScheduleTable(items: Array<Record<string, unknown>>): ResultTable {
  const rows: ResultCell[][] = items.map((item) => {
    const enabled = pickBoolean(item, ['enabled']);
    return [
      { text: pickText(item, ['name']) ?? pickText(item, ['id']) ?? '（未命名）', strong: true },
      {
        badge: {
          label: enabled === false ? '停用' : '启用',
          tone: enabled === false ? 'off' : 'ok',
        },
        text: '',
      },
      { text: describeSchedule(item), mono: true },
      { text: formatShortDateTime(item['nextFireAt']) ?? '—', mono: true },
      { text: String(pickNumber(item, ['fireCount']) ?? 0), mono: true },
    ];
  });

  return {
    columns: ['任务', '状态', '调度', '下次触发', '已触发'],
    rows,
  };
}

function describeSchedule(item: Record<string, unknown>): string {
  const kind = pickText(item, ['scheduleKind']);
  if (kind === 'cron') return pickText(item, ['scheduleExpr']) ?? 'cron';
  if (kind === 'every') {
    const every = pickNumber(item, ['scheduleEvery']);
    return every === undefined ? 'every' : `every ${every}ms`;
  }
  if (kind === 'at') return pickText(item, ['scheduleAt']) ?? 'at';
  return pickText(item, ['scheduleExpr']) ?? kind ?? '—';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return asRecord(value) !== null;
}
