import type { GraphRoleLayer } from '../../data/build-knowledge-graph.js';

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
