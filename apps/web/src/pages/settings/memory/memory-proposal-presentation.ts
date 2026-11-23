/**
 * 记忆提议的纯展示逻辑：中文标签映射、版本排序、倾向判定。
 *
 * 刻意与 React 组件分离，既便于面板复用，也让「到期风险」「冲突倾向」这类判定
 * 可以在没有渲染层的条件下单独推理与测试。
 */

import type {
  MemoryProposalAction,
  MemoryProposalOrigin,
  MemoryProposalRelationKind,
  MemoryRevisionOperation,
  MemoryRevisionOrigin,
  MemoryScopeType,
} from '@openAwork/web-client';

/** 提议动作中文标签。 */
export const PROPOSAL_ACTION_LABELS: Record<MemoryProposalAction, string> = {
  create: '新增',
  update: '修改',
  archive: '归档',
  restore: '恢复',
  merge: '合并',
  rule: '规则',
};

/** 作用域中文标签。 */
export const SCOPE_TYPE_LABELS: Record<MemoryScopeType, string> = {
  user: '个人',
  workspace: '项目',
  team: '团队',
  channel_chat: '渠道对话',
};

/** 提议来源中文标签。 */
export const PROPOSAL_ORIGIN_LABELS: Record<MemoryProposalOrigin, string> = {
  auto_extract: '自动抽取',
  manual_extract: '手动抽取',
  tool: '工具',
  team_init: '团队初始化',
  maintenance: '周期整理',
  channel: '渠道',
  api: 'API',
};

/** 关系类型中文标签。 */
export const RELATION_KIND_LABELS: Record<MemoryProposalRelationKind, string> = {
  duplicate: '重复',
  conflict: '冲突',
  supersedes: '将被取代',
};

/** 版本操作中文标签。 */
export const REVISION_OPERATION_LABELS: Record<MemoryRevisionOperation, string> = {
  create: '新增',
  update: '修改',
  archive: '归档',
  restore: '恢复',
  merge: '合并',
  rollback: '回滚',
  rule: '规则',
};

/** 版本来源中文标签。 */
export const REVISION_ORIGIN_LABELS: Record<MemoryRevisionOrigin, string> = {
  manual: '人工',
  periodic: '周期整理',
  proposal: '提议确认',
  channel: '渠道',
};

/** 提议的汇总计数（整理报告用）。 */
export interface ProposalSummary {
  total: number;
  pending: number;
  duplicates: number;
  conflicts: number;
}

export function summarizeProposals(
  proposals: ReadonlyArray<{
    status?: string;
    relations?: ReadonlyArray<{ kind: MemoryProposalRelationKind }> | undefined;
  }>,
): ProposalSummary {
  let pending = 0;
  let duplicates = 0;
  let conflicts = 0;
  for (const proposal of proposals) {
    if (proposal.status === 'pending' || proposal.status === undefined) {
      pending += 1;
    }
    for (const relation of proposal.relations ?? []) {
      if (relation.kind === 'duplicate') {
        duplicates += 1;
      }
      if (relation.kind === 'conflict') {
        conflicts += 1;
      }
    }
  }
  return { total: proposals.length, pending, duplicates, conflicts };
}

const RELATIVE_UNITS: ReadonlyArray<{ limitMs: number; divisorMs: number; unit: string }> = [
  { limitMs: 60_000, divisorMs: 1_000, unit: '秒' },
  { limitMs: 3_600_000, divisorMs: 60_000, unit: '分钟' },
  { limitMs: 86_400_000, divisorMs: 3_600_000, unit: '小时' },
  { limitMs: 2_592_000_000, divisorMs: 86_400_000, unit: '天' },
  { limitMs: 31_536_000_000, divisorMs: 2_592_000_000, unit: '个月' },
];

/** 把 ISO 时间转成「剩 3 小时 / 2 天前」的相对时间。非法输入原样返回。 */
export function formatRelativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) {
    return '未设置';
  }
  const target = Date.parse(iso);
  if (Number.isNaN(target)) {
    return iso;
  }
  const delta = target - now;
  const suffix = delta < 0 ? '前' : '后';
  const absolute = Math.abs(delta);
  if (absolute < 45_000) {
    return '刚刚';
  }
  for (const entry of RELATIVE_UNITS) {
    if (absolute < entry.limitMs) {
      const value = Math.max(1, Math.round(absolute / entry.divisorMs));
      return `${String(value)}${entry.unit}${suffix}`;
    }
  }
  const years = Math.max(1, Math.round(absolute / 31_536_000_000));
  return `${String(years)}年${suffix}`;
}

/** 到期风险档位：已过期 / 即将到期（24h 内）/ 安全 / 无期限。 */
export type ExpiryRisk = 'expired' | 'soon' | 'ok' | 'none';

export function getExpiryRisk(iso: string | null, now: number = Date.now()): ExpiryRisk {
  if (!iso) {
    return 'none';
  }
  const target = Date.parse(iso);
  if (Number.isNaN(target)) {
    return 'none';
  }
  const delta = target - now;
  if (delta <= 0) {
    return 'expired';
  }
  if (delta <= 86_400_000) {
    return 'soon';
  }
  return 'ok';
}

export function describeExpiry(risk: ExpiryRisk): string {
  switch (risk) {
    case 'expired':
      return '该提议已过期，确认时会失败，需重新发起。';
    case 'soon':
      return '该提议即将到期，请尽快确认。';
    case 'ok':
      return '在有效期内。';
    default:
      return '该提议无有效期限制。';
  }
}

/** 版本列表按变更序号降序（最新在前）。 */
export function sortRevisionsDescending<T extends { changeSeq: number; revision: number }>(
  revisions: readonly T[],
): T[] {
  return revisions.toSorted((a, b) => b.changeSeq - a.changeSeq || b.revision - a.revision);
}

/** 提议载荷摘要（key + value），用于列表与折叠展示。 */
export function describeProposalPayload(payload: {
  key?: string | undefined;
  value?: string | undefined;
  name?: string | undefined;
  body?: string | undefined;
}): { key: string; value: string } {
  return {
    key: payload.key ?? payload.name ?? '（未提供键）',
    value: payload.value ?? payload.body ?? '（未提供内容）',
  };
}
