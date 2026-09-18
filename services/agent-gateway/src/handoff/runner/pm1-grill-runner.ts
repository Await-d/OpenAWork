/**
 * 260914 · T-12：pm1（c 层）grill 运行体。
 *
 * 与 `reception-grill-runner` 同构——决策树 / 前沿 / 确认门控的算法只在
 * `@openAwork/agent-core`（context/clarification-tree）实现一次；本模块只负责
 * 「按 session 读写 GrillState」与「把 inbound 答案喂回引擎」，不实现任何澄清算法
 * （handoff §5.1 SSOT 铁律）。
 */

import {
  applyAnswer,
  buildClarificationQuestions,
  buildConfirmNode,
  computeFrontier,
  confirmGrill,
  CONFIRM_NODE_ID,
  createGrillState,
  parseGrillState,
  serializeGrillState,
  type ClarificationNode,
  type ClarificationNodeOption,
  type GrillState,
} from '@openAwork/agent-core';
import { sqliteGet, sqliteRun } from '../../infra/db.js';
import { parseSessionMetadataJson } from '../../session/session-workspace-metadata.js';
import type { GrillConfirmationPayload } from '../capability/grill-confirmation.js';

/** escalation_request / artifact.needs-clarification 载荷里的一条问题。 */
export interface Pm1FrontierQuestion {
  /** 传输 id：普通节点即引擎节点 id；确认节点带轮次后缀（见 confirmTransportQuestionId）。 */
  id: string;
  question: string;
  context: string;
  options: ClarificationNodeOption[];
}

export interface Pm1GrillAnswer {
  nodeId: string;
  answer: string;
}

export interface Pm1GrillTask {
  state: GrillState;
  intent: string;
}

/**
 * 确认节点的传输 id 形如 `__grill_confirm__@r3`。
 *
 * 为什么需要轮次后缀：前端 `useClarificationStore.push` / `replaceFromRuntime` 按 `id`
 * 去重（历史实现每轮 id 是随机 uuid，故不会冲突）。确认节点被驳回后必须**重提**，若沿用
 * 同一 id 会被前端静默去重 → 用户看不到确认题 → 超时无法收口。普通节点每轮只提一次
 * （未答项在前端保持 pending、不会消失），故无需后缀。
 */
const CONFIRM_TRANSPORT_ID_PATTERN = /^__grill_confirm__@r\d+$/;

export function confirmTransportQuestionId(state: GrillState): string {
  return `${CONFIRM_NODE_ID}@r${state.round}`;
}

/** 传输 id → 引擎节点 id（剥掉确认节点的轮次后缀）。 */
export function toEngineNodeId(transportId: string): string {
  return CONFIRM_TRANSPORT_ID_PATTERN.test(transportId) ? CONFIRM_NODE_ID : transportId;
}

/**
 * 每题恰好一个推荐答案（G2）。模板未标推荐时把首项标为推荐；
 * 已显式标记则原样保留（不覆盖模板意图）。
 */
function withRecommendedDefault(
  options: readonly ClarificationNodeOption[],
): ClarificationNodeOption[] {
  const cloned = options.map((option) => ({ ...option }));
  const first = cloned[0];
  if (!first) return cloned;
  if (cloned.some((option) => option.recommended === true)) return cloned;
  cloned[0] = { ...first, recommended: true };
  return cloned;
}

/**
 * 构造 pm1 决策树：4 个澄清维度同处初始前沿（一轮问整个 frontier），末尾追加确认节点
 * （依赖全部问题节点，故唯有 frontier 只剩它时才进入待确认态）。
 */
export function buildPm1GrillSeed(intent: string): GrillState {
  const nodes: ClarificationNode[] = buildClarificationQuestions(intent).map((question) => ({
    id: question.dimension,
    dimension: question.dimension,
    question: question.question,
    options: withRecommendedDefault(question.options ?? []),
    dependsOn: [],
  }));
  nodes.push(buildConfirmNode(nodes.map((node) => node.id)));
  return createGrillState(nodes);
}

/** 读取持久化的 grill 任务态（含意图，用于判断是否为同一任务的续跑）。 */
export function readPm1GrillTask(sessionId: string): Pm1GrillTask | null {
  const row = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (!row) return null;
  const metadata = parseSessionMetadataJson(row.metadata_json);
  const rawState = metadata['clarificationState'];
  if (typeof rawState !== 'string') return null;
  const state = parseGrillState(rawState);
  if (!state) return null;
  const rawIntent = metadata['clarificationIntent'];
  return { state, intent: typeof rawIntent === 'string' ? rawIntent : '' };
}

/** 会话行缺失时静默跳过——运行态以内存 state 为准，持久化只是抗压缩/恢复的兜底。 */
export function persistPm1Grill(sessionId: string, state: GrillState, intent: string): void {
  const row = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (!row) return;
  const metadata = parseSessionMetadataJson(row.metadata_json);
  sqliteRun("UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?", [
    JSON.stringify({
      ...metadata,
      clarificationState: serializeGrillState(state),
      clarificationIntent: intent,
    }),
    sessionId,
  ]);
}

export function clearPm1Grill(sessionId: string): void {
  const row = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (!row) return;
  const metadata = parseSessionMetadataJson(row.metadata_json);
  delete metadata['clarificationState'];
  delete metadata['clarificationIntent'];
  sqliteRun("UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?", [
    JSON.stringify(metadata),
    sessionId,
  ]);
}

/** 当前前沿 → 载荷问题（携带结构化选项，前端可直接渲染为选项按钮）。 */
export function frontierToQuestions(state: GrillState): Pm1FrontierQuestion[] {
  return computeFrontier(state).map((node) => ({
    id: node.id === CONFIRM_NODE_ID ? confirmTransportQuestionId(state) : node.id,
    question: node.question,
    context: '',
    options: node.options.map((option) => ({ ...option })),
  }));
}

/**
 * 把本轮答案逐个喂回引擎。inbound 未携带 nodeId（兼容纯文本 `user_input`）时落到当前
 * 前沿首个未决节点，与 reception「对 frontier[0] 作答」的语义一致。
 */
export function applyPm1GrillAnswers(
  state: GrillState,
  answers: readonly Pm1GrillAnswer[],
): GrillState {
  let next = state;
  for (const item of answers) {
    const nodeId =
      item.nodeId.length > 0 ? toEngineNodeId(item.nodeId) : (computeFrontier(next)[0]?.id ?? '');
    if (nodeId.length === 0) break;
    next = applyAnswer(next, nodeId, item.answer);
  }
  return next;
}

/** 已结算的决策节点（不含确认节点）→ plan 提示中的问答行。 */
export function formatSettledAnswers(state: GrillState): string[] {
  return state.nodes
    .filter((node) => node.id !== CONFIRM_NODE_ID && typeof node.answer === 'string')
    .map((node) => `问：${node.question}\n   答：${node.answer}`);
}

/**
 * 用 reception 传播来的已确认共识构造 pm1 决策树：直接置为已确认态，pm1 不再重复拷问，
 * 同时保留答案供 plan 注入（`formatSettledAnswers`）。
 */
export function buildConfirmedPm1GrillSeed(
  intent: string,
  confirmation: GrillConfirmationPayload,
): GrillState {
  const settled = applyPm1GrillAnswers(buildPm1GrillSeed(intent), confirmation.answers);
  return confirmGrill(settled, confirmation.confirmedAt);
}

/** 确认驳回达到上限时给 PlanningFailure 的中文原因（`planning-generation-failed:` 前缀由 PlanningFailure 统一补齐）。 */
export function formatGrillExhaustedReason(state: GrillState): string {
  const outstanding = state.nodes
    .filter((node) => node.id !== CONFIRM_NODE_ID)
    .map((node) => node.id)
    .join('、');
  return `grill-rounds-exhausted：连续 ${state.rejections?.length ?? 0} 轮未获确认，未决项：${outstanding}`;
}
