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

/**
 * 一次「确认被驳回」的记录。驳回不等于澄清失败：它只表示某几个共识项仍需调整，
 * 引擎保留全部已答节点、只把确认节点继续留在 frontier 等下一轮。
 *
 * `outstanding` 是驳回时仍待用户拍板的共识项（确认节点除外），用于在重提确认时
 * 告诉用户「还需你决定的是哪几项」，而不是只重复一遍确认问句。
 */
export interface GrillRejection {
  at: number;
  answer: string;
  outstanding: string[];
}

export interface GrillState {
  nodes: ClarificationNode[];
  round: number;
  history: GrillHistoryEntry[];
  confirmedAt?: number;
  /** 确认被驳回的追加式记录。可选：旧持久化状态没有该字段。 */
  rejections?: GrillRejection[];
  /** 确认驳回达到上限后的时间戳。可选：旧持久化状态没有该字段。 */
  exhaustedAt?: number;
}

/**
 * 确认驳回的上限（与 pm1 既有的 6 轮保持一致，两层共用同一政策）。
 *
 * 必须键在 `rejections.length` 上、而不是 `round` 上：一轮多答（见 parseMultiGrillReply）
 * 会让 `round` 一次跳多格，`round` 不再是「确认轮次」的可靠计数。
 */
export const GRILL_MAX_ROUNDS = 6;

export interface GrillSeedOptions {
  withConfirmation?: boolean;
}

export const CONFIRM_NODE_ID = '__grill_confirm__';
export const CONFIRM_ANSWER = 'confirmed';
export const REJECT_ANSWER = 'rejected';

/**
 * 「肯定确认」文案模式。确认节点的语义是「用户确认共识、可以进入执行」，但调用方的
 * 输入形态不同：A 层（chat）传的是选项标签，C 层（team）传的是用户回复文本。
 * 两侧都必须按同一套判定归一化到 `CONFIRM_ANSWER`，否则会出现"点了确认却被判成驳回"
 * 或"模型把推荐项标在否定项上导致驳回被当成确认"这类漂移。
 */
export const CONFIRM_AFFIRMATIVE_PATTERN =
  /^(确认|同意|可以|行|好|没问题|是|对的|ok|okay|yes|yep|go)/i;

/** 该文案是否可视为"肯定确认"（用于确认节点的选项标签 / 用户回复文本归一化）。 */
export function isConfirmAffirmative(label: string): boolean {
  return label.trim() === CONFIRM_ANSWER || CONFIRM_AFFIRMATIVE_PATTERN.test(label.trim());
}

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

/** 确认驳回后仍待用户拍板的共识项（确认节点除外），保持节点声明顺序。 */
export function listConsensusItemIds(state: GrillState): string[] {
  return state.nodes.filter((node) => node.id !== CONFIRM_NODE_ID).map((node) => node.id);
}

export function grillRejectionCount(state: GrillState): number {
  return state.rejections?.length ?? 0;
}

/** 确认驳回是否已达到上限（含旧状态：无 rejections 时按 0 计，不会追溯判定为耗尽）。 */
export function isGrillExhausted(state: GrillState): boolean {
  return state.exhaustedAt !== undefined || grillRejectionCount(state) >= GRILL_MAX_ROUNDS;
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
      const rejections = [
        ...(state.rejections ?? []),
        { at, answer, outstanding: listConsensusItemIds(state) },
      ];
      const exhaustedAt =
        state.exhaustedAt ?? (rejections.length >= GRILL_MAX_ROUNDS ? at : undefined);
      return {
        ...state,
        round: state.round + 1,
        history,
        rejections,
        ...(exhaustedAt !== undefined ? { exhaustedAt } : {}),
      };
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

const GRILL_INDEX_PREFIX = /^\s*(\d+)\s*[.、)）．:：]\s*/;

const GRILL_DIMENSION_ALIASES: Record<string, readonly string[]> = {
  goal: ['goal', '目标'],
  constraint: ['constraint', '约束'],
  deliverable: ['deliverable', '交付', '交付物', '产出'],
  acceptance: ['acceptance', '验收', '验收标准', '验收条件'],
};

export type GrillAmbiguityReason = 'no-target' | 'duplicate-target' | 'shared-label';

export interface GrillMultiAnswerParse {
  assigned: Array<{ nodeId: string; answer: string }>;
  ambiguous: Array<{ segment: string; reason: GrillAmbiguityReason }>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nodeAliases(node: ClarificationNode): string[] {
  const aliases = new Set<string>([node.id]);
  if (node.dimension) {
    aliases.add(node.dimension);
    for (const alias of GRILL_DIMENSION_ALIASES[node.dimension] ?? []) aliases.add(alias);
  }
  return [...aliases];
}

function matchNodeAlias(
  frontier: readonly ClarificationNode[],
  segment: string,
): { nodeId: string; rest: string } | null {
  for (const node of frontier) {
    for (const alias of nodeAliases(node)) {
      const pattern = new RegExp(`^\\s*${escapeRegExp(alias)}\\s*[:：=]\\s*`, 'i');
      const match = pattern.exec(segment);
      if (match) return { nodeId: node.id, rest: segment.slice(match[0].length) };
    }
  }
  return null;
}

function parseTargetedSegment(
  frontier: readonly ClarificationNode[],
  segment: string,
): { nodeId: string; answer: string } | null {
  const indexMatch = GRILL_INDEX_PREFIX.exec(segment);
  if (indexMatch) {
    const index = Number.parseInt(indexMatch[1] ?? '', 10);
    const node = Number.isFinite(index) ? frontier[index - 1] : undefined;
    const answer = segment.slice(indexMatch[0].length).trim();
    return node && answer.length > 0 ? { nodeId: node.id, answer } : null;
  }
  const aliasMatch = matchNodeAlias(frontier, segment);
  if (!aliasMatch || aliasMatch.rest.trim().length === 0) return null;
  return { nodeId: aliasMatch.nodeId, answer: aliasMatch.rest.trim() };
}

function hasTargetMarker(frontier: readonly ClarificationNode[], segment: string): boolean {
  if (GRILL_INDEX_PREFIX.test(segment)) return true;
  return matchNodeAlias(frontier, segment) !== null;
}

function splitIfAllTargeted(
  frontier: readonly ClarificationNode[],
  text: string,
  separator: RegExp,
): string[] {
  const parts = text
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length >= 2 && parts.every((part) => hasTargetMarker(frontier, part))) return parts;
  return text.trim().length > 0 ? [text.trim()] : [];
}

/** 按换行 / `；` 切段，再对每段尝试「全段可定位」的标点再切，避免把一整句普通答案切碎。 */
function splitGrillSegments(frontier: readonly ClarificationNode[], reply: string): string[] {
  const base = reply
    .split(/[\n；;]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const segments: string[] = [];
  for (const piece of base) {
    for (const byPeriod of splitIfAllTargeted(frontier, piece, /。/)) {
      segments.push(...splitIfAllTargeted(frontier, byPeriod, /[，,]/));
    }
  }
  return segments;
}

function isSharedOptionLabel(frontier: readonly ClarificationNode[], segment: string): boolean {
  const label = segment.trim();
  let hits = 0;
  for (const node of frontier) {
    if (node.options.some((option) => option.label.trim() === label)) hits += 1;
  }
  return hits >= 2;
}

/**
 * 把一条自由文本回复解析成「多个节点各自的答案」（一轮多答，P3）。
 *
 * 面向 chat composer 的约定式语法（非结构化传输通道）：
 *   - 序号式：`1. 改单文件；2. 无额外约束`（`1.` / `1、` / `1)` / `1）` / `1：` 均可）
 *   - 维度式：`目标：改单文件。约束：无额外约束`
 *
 * 关键安全语义：绝不猜。只有能被序号/维度别名明确指认，或「单段回复」「段数与前沿数一致」
 * 这类可判定情形才落位；其余返回 `ambiguous`，由调用方重述格式，而不是把整段塞给 frontier[0]。
 */
export function parseMultiGrillReply(
  frontier: readonly ClarificationNode[],
  reply: string,
): GrillMultiAnswerParse {
  const assigned: GrillMultiAnswerParse['assigned'] = [];
  const ambiguous: GrillMultiAnswerParse['ambiguous'] = [];
  const first = frontier[0];
  const segments = splitGrillSegments(frontier, reply);
  if (segments.length === 0 || !first) return { assigned, ambiguous };

  const firstSegment = segments[0] ?? '';
  if (segments.length === 1 && !hasTargetMarker(frontier, firstSegment)) {
    return { assigned: [{ nodeId: first.id, answer: firstSegment }], ambiguous };
  }

  const targeted: Array<{ segment: string; nodeId: string; answer: string }> = [];
  const untargeted: string[] = [];
  for (const segment of segments) {
    const parsed = parseTargetedSegment(frontier, segment);
    if (parsed) {
      targeted.push({ segment, ...parsed });
      continue;
    }
    untargeted.push(segment);
  }

  const used = new Set<string>();
  for (const item of targeted) {
    if (used.has(item.nodeId)) {
      ambiguous.push({ segment: item.segment, reason: 'duplicate-target' });
      continue;
    }
    used.add(item.nodeId);
    assigned.push({ nodeId: item.nodeId, answer: item.answer });
  }

  if (untargeted.length === 0) return { assigned, ambiguous };

  if (targeted.length === 0 && segments.length === frontier.length) {
    if (untargeted.some((segment) => isSharedOptionLabel(frontier, segment))) {
      for (const segment of untargeted) ambiguous.push({ segment, reason: 'shared-label' });
      return { assigned, ambiguous };
    }
    return {
      assigned: frontier.map((node, index) => ({
        nodeId: node.id,
        answer: untargeted[index] ?? '',
      })),
      ambiguous,
    };
  }

  const untargetedNodes = frontier.filter((node) => !used.has(node.id));
  const loneUntargeted = untargeted[0];
  const loneNode = untargetedNodes[0];
  if (untargeted.length === 1 && untargetedNodes.length === 1 && loneNode && loneUntargeted) {
    assigned.push({ nodeId: loneNode.id, answer: loneUntargeted });
    return { assigned, ambiguous };
  }

  for (const segment of untargeted) ambiguous.push({ segment, reason: 'no-target' });
  return { assigned, ambiguous };
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

function isGrillRejection(value: unknown): value is GrillRejection {
  if (!isRecord(value)) return false;
  if (typeof value['at'] !== 'number') return false;
  if (typeof value['answer'] !== 'string') return false;
  const outstanding = value['outstanding'];
  if (!Array.isArray(outstanding) || !outstanding.every((id) => typeof id === 'string')) {
    return false;
  }
  return true;
}

function isGrillState(value: unknown): value is GrillState {
  if (!isRecord(value)) return false;
  const { nodes, round, history, confirmedAt, rejections, exhaustedAt } = value;
  if (!Array.isArray(nodes) || !nodes.every(isClarificationNode)) return false;
  if (typeof round !== 'number' || !Number.isFinite(round)) return false;
  if (!Array.isArray(history) || !history.every(isGrillHistoryEntry)) return false;
  if (confirmedAt !== undefined && typeof confirmedAt !== 'number') return false;
  if (rejections !== undefined) {
    if (!Array.isArray(rejections) || !rejections.every(isGrillRejection)) return false;
  }
  if (exhaustedAt !== undefined && typeof exhaustedAt !== 'number') return false;
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
    ...(raw.rejections !== undefined
      ? {
          rejections: raw.rejections.map((entry) => ({
            ...entry,
            outstanding: [...entry.outstanding],
          })),
        }
      : {}),
    ...(raw.exhaustedAt !== undefined ? { exhaustedAt: raw.exhaustedAt } : {}),
  };
}
