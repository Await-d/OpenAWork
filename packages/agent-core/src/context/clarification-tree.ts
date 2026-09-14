import type { ClarificationDimension, ClarificationQuestion } from './routing.js';

export type ClarificationNodeStatus = 'open' | 'settled' | 'blocked';

export interface ClarificationNodeOption {
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface ClarificationNode {
  id: string;
  dimension?: ClarificationDimension;
  question: string;
  options: ClarificationNodeOption[];
  dependsOn: string[];
  answer?: string;
}

export interface GrillHistoryEntry {
  nodeId: string;
  answer: string;
  at: number;
}

export interface GrillState {
  nodes: ClarificationNode[];
  round: number;
  history: GrillHistoryEntry[];
  confirmedAt?: number;
}

export interface GrillSeedOptions {
  withConfirmation?: boolean;
}

export const CONFIRM_NODE_ID = '__grill_confirm__';
export const CONFIRM_ANSWER = 'confirmed';
export const REJECT_ANSWER = 'rejected';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cloneNode(node: ClarificationNode): ClarificationNode {
  return {
    ...node,
    options: node.options.map((option) => ({ ...option })),
    dependsOn: [...node.dependsOn],
  };
}

function indexNodes(nodes: readonly ClarificationNode[]): Map<string, ClarificationNode> {
  const index = new Map<string, ClarificationNode>();
  for (const node of nodes) {
    index.set(node.id, node);
  }
  return index;
}

function resolveNodeStatus(
  node: ClarificationNode,
  index: Map<string, ClarificationNode>,
): ClarificationNodeStatus {
  if (node.answer !== undefined) return 'settled';
  const ready = node.dependsOn.every((id) => index.get(id)?.answer !== undefined);
  return ready ? 'open' : 'blocked';
}

export function createGrillState(nodes: readonly ClarificationNode[]): GrillState {
  return { nodes: nodes.map(cloneNode), round: 0, history: [] };
}

export function computeNodeStatus(
  state: GrillState,
  nodeId: string,
): ClarificationNodeStatus | null {
  const index = indexNodes(state.nodes);
  const node = index.get(nodeId);
  return node ? resolveNodeStatus(node, index) : null;
}

export function computeFrontier(state: GrillState): ClarificationNode[] {
  const index = indexNodes(state.nodes);
  return state.nodes.filter((node) => resolveNodeStatus(node, index) === 'open');
}

export function isFrontierEmpty(state: GrillState): boolean {
  return computeFrontier(state).length === 0;
}

export function needsConfirmation(state: GrillState): boolean {
  if (state.confirmedAt !== undefined) return false;
  const frontier = computeFrontier(state);
  return frontier.length === 1 && frontier[0]?.id === CONFIRM_NODE_ID;
}

/**
 * 记录一个节点的答案。对未知节点、前置未决（blocked）节点、已结算（settled）节点一律
 * 返回原 state 不变——这是为 inbound 通道的重复投递与陈旧消息而设计的容忍语义，不是静默失败。
 * 仅当节点位于 frontier 时才推进；确认节点只有收到 `confirmed` 才结算并写入 confirmedAt。
 */
export function applyAnswer(
  state: GrillState,
  nodeId: string,
  answer: string,
  at: number = Date.now(),
): GrillState {
  const index = indexNodes(state.nodes);
  const node = index.get(nodeId);
  if (!node) return state;
  if (resolveNodeStatus(node, index) !== 'open') return state;

  const history = [...state.history, { nodeId, answer, at }];
  if (nodeId === CONFIRM_NODE_ID) {
    const affirmative =
      answer === CONFIRM_ANSWER ||
      node.options.some((option) => option.recommended === true && option.label === answer);
    if (!affirmative) {
      return { ...state, round: state.round + 1, history };
    }
    return {
      ...state,
      nodes: state.nodes.map((item) => (item.id === nodeId ? { ...item, answer } : item)),
      round: state.round + 1,
      history,
      confirmedAt: at,
    };
  }

  return {
    ...state,
    nodes: state.nodes.map((item) => (item.id === nodeId ? { ...item, answer } : item)),
    round: state.round + 1,
    history,
  };
}

export function confirmGrill(state: GrillState, at: number = Date.now()): GrillState {
  return applyAnswer(state, CONFIRM_NODE_ID, CONFIRM_ANSWER, at);
}

export function buildConfirmNode(dependsOn: readonly string[]): ClarificationNode {
  return {
    id: CONFIRM_NODE_ID,
    dimension: 'acceptance',
    question: '以上共识是否确认？确认后才进入执行。',
    options: [
      { label: '确认', description: '共识达成，进入执行', recommended: true },
      { label: '需修改', description: '仍有未决项需要调整' },
    ],
    dependsOn: [...dependsOn],
  };
}

export function seedGrillState(
  questions: readonly ClarificationQuestion[],
  options: GrillSeedOptions = {},
): GrillState {
  const nodes: ClarificationNode[] = questions.map((question) => ({
    id: question.dimension,
    dimension: question.dimension,
    question: question.question,
    options: (question.options ?? []).map((option) => ({ ...option })),
    dependsOn: [],
  }));

  if (options.withConfirmation !== false) {
    nodes.push(buildConfirmNode(nodes.map((node) => node.id)));
  }

  return createGrillState(nodes);
}

function isClarificationNodeOption(value: unknown): value is ClarificationNodeOption {
  if (!isRecord(value)) return false;
  if (typeof value['label'] !== 'string') return false;
  if (value['description'] !== undefined && typeof value['description'] !== 'string') return false;
  if (value['recommended'] !== undefined && typeof value['recommended'] !== 'boolean') return false;
  return true;
}

function isClarificationNode(value: unknown): value is ClarificationNode {
  if (!isRecord(value)) return false;
  if (typeof value['id'] !== 'string') return false;
  if (value['dimension'] !== undefined && typeof value['dimension'] !== 'string') return false;
  if (typeof value['question'] !== 'string') return false;
  if (!Array.isArray(value['options']) || !value['options'].every(isClarificationNodeOption)) {
    return false;
  }
  if (!Array.isArray(value['dependsOn'])) return false;
  if (!value['dependsOn'].every((id) => typeof id === 'string')) return false;
  if (value['answer'] !== undefined && typeof value['answer'] !== 'string') return false;
  return true;
}

function isGrillHistoryEntry(value: unknown): value is GrillHistoryEntry {
  if (!isRecord(value)) return false;
  if (typeof value['nodeId'] !== 'string') return false;
  if (typeof value['answer'] !== 'string') return false;
  return typeof value['at'] === 'number';
}

function isGrillState(value: unknown): value is GrillState {
  if (!isRecord(value)) return false;
  const { nodes, round, history, confirmedAt } = value;
  if (!Array.isArray(nodes) || !nodes.every(isClarificationNode)) return false;
  if (typeof round !== 'number' || !Number.isFinite(round)) return false;
  if (!Array.isArray(history) || !history.every(isGrillHistoryEntry)) return false;
  if (confirmedAt !== undefined && typeof confirmedAt !== 'number') return false;
  return true;
}

export function serializeGrillState(state: GrillState): string {
  return JSON.stringify(state);
}

export function parseGrillState(json: string): GrillState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isGrillState(raw)) return null;

  return {
    nodes: raw.nodes.map(cloneNode),
    round: raw.round,
    history: raw.history.map((entry) => ({ ...entry })),
    ...(raw.confirmedAt !== undefined ? { confirmedAt: raw.confirmedAt } : {}),
  };
}
