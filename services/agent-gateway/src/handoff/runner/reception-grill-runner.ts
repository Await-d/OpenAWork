import {
  applyAnswer,
  buildClarificationQuestions,
  buildConfirmNode,
  computeFrontier,
  CONFIRM_ANSWER,
  CONFIRM_NODE_ID,
  createGrillState,
  GRILL_MAX_ROUNDS,
  isConfirmAffirmative,
  isGrillExhausted,
  needsConfirmation,
  parseGrillState,
  parseMultiGrillReply,
  serializeGrillState,
  type ClarificationNode,
  type GrillAmbiguityReason,
  type GrillState,
} from '@openAwork/agent-core';

import { sqliteGet, sqliteRun } from '../../infra/db.js';
import { parseSessionMetadataJson } from '../../session/session-workspace-metadata.js';

export interface ReceptionGrill {
  state: GrillState;
  intent: string;
}

export function readReceptionGrill(sessionId: string): ReceptionGrill | null {
  const row = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (!row) return null;

  const metadata = parseSessionMetadataJson(row.metadata_json);
  const rawState = metadata['clarificationState'];
  const rawIntent = metadata['clarificationIntent'];
  if (typeof rawState !== 'string') return null;

  const state = parseGrillState(rawState);
  if (!state) return null;
  return { state, intent: typeof rawIntent === 'string' ? rawIntent : '' };
}

function writeReceptionMetadata(sessionId: string, patch: Record<string, unknown>): void {
  const row = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (!row) return;
  const metadata = parseSessionMetadataJson(row.metadata_json);
  sqliteRun("UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?", [
    JSON.stringify({ ...metadata, ...patch }),
    sessionId,
  ]);
}

export function persistReceptionGrill(sessionId: string, state: GrillState, intent: string): void {
  writeReceptionMetadata(sessionId, {
    clarificationState: serializeGrillState(state),
    clarificationIntent: intent,
  });
}

export function clearReceptionGrill(sessionId: string): void {
  writeReceptionMetadata(sessionId, {
    clarificationState: undefined,
    clarificationIntent: undefined,
  });
}

export function startReceptionGrill(intent: string): GrillState {
  const nodes: ClarificationNode[] = buildClarificationQuestions(intent).map((question) => ({
    id: question.dimension,
    dimension: question.dimension,
    question: question.question,
    options: (question.options ?? []).map((option, index) => ({
      ...option,
      recommended: index === 0,
    })),
    dependsOn: [],
  }));
  return createGrillState([...nodes, buildConfirmNode(nodes.map((node) => node.id))]);
}

function consensusNodes(state: GrillState): ClarificationNode[] {
  return state.nodes.filter((node) => node.id !== CONFIRM_NODE_ID);
}

export function formatFrontierPrompt(state: GrillState): string {
  const frontier = computeFrontier(state);
  if (frontier.length === 0) return '';

  const lines = [
    '在派发任务前，我需要先跟你确认几件事：',
    `本轮共 ${frontier.length} 项待确认，你可以一次性回复多项：`,
  ];
  frontier.forEach((node, index) => {
    lines.push(`${index + 1}. ${node.question}`);
    const recommended = node.options.find((option) => option.recommended === true);
    for (const option of node.options) {
      const suffix = option === recommended ? ' ← 推荐' : '';
      const description = option.description ? `（${option.description}）` : '';
      lines.push(`   - ${option.label}${description}${suffix}`);
    }
  });
  lines.push('写法一（按序号）：`1. 用 A；2. 用 B`；写法二（按维度）：`目标：A。约束：B`。');
  lines.push('未回复的项我会继续追问，全部认可后回复「确认」。请直接回复你的选择。');
  return lines.join('\n');
}

/** 确认被驳回后的重提：列出仍需用户拍板的共识项，而不是只重复一遍确认问句。 */
export function formatOutstandingPrompt(state: GrillState): string {
  const items = consensusNodes(state);
  if (items.length === 0) return formatFrontierPrompt(state);
  const lines = [`还需你拍板的还有 ${items.length} 项：`];
  items.forEach((node, index) => {
    const current = typeof node.answer === 'string' ? `（当前：${node.answer}）` : '';
    lines.push(`${index + 1}. ${node.question}${current}`);
    const recommended = node.options.find((option) => option.recommended === true);
    if (recommended) lines.push(`   - 推荐：${recommended.label}`);
  });
  lines.push(
    '请回复要修改的项即可（可一次写多项，例如「1. 用 B；2. 暂不限制」），全部认可后回复「确认」。',
  );
  return lines.join('\n');
}

/** 连续驳回达到上限后的终态提示：停止反复追问，给出继续 / 终止两条明确出路。 */
export function formatExhaustedPrompt(state: GrillState): string {
  const lines = [
    `已连续 ${GRILL_MAX_ROUNDS} 轮确认未达成共识，先暂停澄清，避免反复打扰：`,
    '- 未获确认的共识项：',
  ];
  consensusNodes(state).forEach((node, index) => {
    const current = typeof node.answer === 'string' ? `（当前：${node.answer}）` : '';
    lines.push(`  ${index + 1}. ${node.question}${current}`);
  });
  lines.push('可回复「按推荐项继续」让我按推荐默认值派发，或回复「取消」终止本次任务。');
  return lines.join('\n');
}

/** 多段回复无法确定归属时的重述提示：明确指出歧义片段并重申可用格式。 */
export function formatAmbiguousPrompt(
  state: GrillState,
  ambiguous: ReadonlyArray<{ segment: string; reason: GrillAmbiguityReason }>,
): string {
  const lines = ['我没能确定这几段回复对应哪一项，请用序号或维度名指明：'];
  for (const item of ambiguous) lines.push(`- 「${item.segment}」`);
  lines.push('', formatFrontierPrompt(state));
  return lines.join('\n');
}

/**
 * 耗尽态「按推荐项继续」时，对无推荐选项又无答案的节点记录的显式未决标记：
 * 不编造选项值（否则规划层会把假设当用户决定），但也不能留空（确认节点依赖全部共识节点，留空则门控无法结算）。
 */
export const EXHAUSTED_UNRESOLVED_ANSWER = '（未决：无推荐默认值，默认假设待规划层补充）';

const EXHAUSTED_CANCEL_PATTERN = /^(取消|终止|放弃|不做了|算了)[。.!！]?$/;
const EXHAUSTED_CONTINUE_PATTERN = /^按(推荐项?|默认(项|值)?)继续/;

function isExhaustedContinueReply(reply: string): boolean {
  return EXHAUSTED_CONTINUE_PATTERN.test(reply) || isConfirmAffirmative(reply);
}

function advanceExhaustedGrill(state: GrillState, reply: string): GrillAdvance {
  if (EXHAUSTED_CANCEL_PATTERN.test(reply)) {
    return { state, kind: 'cancelled' };
  }
  if (!isExhaustedContinueReply(reply)) {
    return { state, kind: 'exhausted', text: formatExhaustedPrompt(state) };
  }

  let next = state;
  for (const node of consensusNodes(state)) {
    if (typeof node.answer === 'string') continue;
    const recommended = node.options.find((option) => option.recommended === true);
    next = applyAnswer(
      next,
      node.id,
      recommended ? recommended.label : EXHAUSTED_UNRESOLVED_ANSWER,
    );
  }
  // 「按推荐项继续」即用户对共识的显式授权，故可写 confirmedAt；这是耗尽态唯一能设置它的路径。
  next = applyAnswer(next, CONFIRM_NODE_ID, CONFIRM_ANSWER);
  return { state: next, kind: 'confirmed' };
}

export interface GrillAdvance {
  state: GrillState;
  kind: 'question' | 'awaiting-confirmation' | 'confirmed' | 'exhausted' | 'cancelled' | 'none';
  text?: string;
}

export function advanceReceptionGrill(input: { state: GrillState; reply: string }): GrillAdvance {
  const frontier = computeFrontier(input.state);
  if (frontier.length === 0) {
    return { state: input.state, kind: 'none' };
  }

  const reply = input.reply.trim();

  // 耗尽态必须先于空回复/普通解析：提示承诺了「按推荐项继续 / 取消」两条出路，须在此解释回复。
  if (isGrillExhausted(input.state)) {
    if (reply.length === 0) {
      return { state: input.state, kind: 'exhausted', text: formatExhaustedPrompt(input.state) };
    }
    return advanceExhaustedGrill(input.state, reply);
  }

  if (reply.length === 0) {
    return { state: input.state, kind: 'question', text: formatFrontierPrompt(input.state) };
  }

  const parsed = parseMultiGrillReply(frontier, reply);
  if (parsed.assigned.length === 0) {
    return {
      state: input.state,
      kind: 'question',
      text: formatAmbiguousPrompt(input.state, parsed.ambiguous),
    };
  }

  let nextState = input.state;
  for (const item of parsed.assigned) {
    // 肯定确认的判定与 A 层共用引擎实现（`isConfirmAffirmative`），避免两侧漂移。
    const normalized =
      item.nodeId === CONFIRM_NODE_ID && isConfirmAffirmative(item.answer)
        ? CONFIRM_ANSWER
        : item.answer;
    nextState = applyAnswer(nextState, item.nodeId, normalized);
  }

  if (nextState.confirmedAt !== undefined) {
    return { state: nextState, kind: 'confirmed' };
  }
  if (isGrillExhausted(nextState)) {
    return { state: nextState, kind: 'exhausted', text: formatExhaustedPrompt(nextState) };
  }
  if (needsConfirmation(nextState)) {
    return {
      state: nextState,
      kind: 'awaiting-confirmation',
      text: formatOutstandingPrompt(nextState),
    };
  }
  return { state: nextState, kind: 'question', text: formatFrontierPrompt(nextState) };
}
