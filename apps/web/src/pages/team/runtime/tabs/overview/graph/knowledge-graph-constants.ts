import type { GraphRoleLayer } from '../../../data/build-knowledge-graph.js';

export const MAX_KNOWLEDGE_VALUE_LENGTH = 4000;
export const MAX_KNOWLEDGE_SEARCH_LENGTH = 200;

export const ROLE_LAYER_ORDER: GraphRoleLayer[] = [
  'reception',
  'pm1',
  'pm2',
  'executor',
  'reviewer',
];

export const ROLE_LAYER_LABELS: Record<GraphRoleLayer, string> = {
  reception: '接待',
  pm1: 'PM1',
  pm2: 'PM2',
  executor: '执行',
  reviewer: '评审',
};

export const PHASE_ORDER = [
  'spec',
  'plan',
  'tasks',
  'implementation',
  'patch',
  'review',
  'review_report',
] as const;

export const PHASE_LABELS: Record<(typeof PHASE_ORDER)[number], string> = {
  spec: '规格',
  plan: '计划',
  tasks: '任务',
  implementation: '实现',
  patch: '补丁',
  review: '评审',
  review_report: '评审报告',
};

export function phaseRank(phase: string | null): number {
  if (!phase) {
    return -1;
  }
  return PHASE_ORDER.indexOf(phase as (typeof PHASE_ORDER)[number]);
}
