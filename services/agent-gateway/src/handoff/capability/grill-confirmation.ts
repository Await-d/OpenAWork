/**
 * reception → pm1 的「共识已确认」传播载荷（P4：跨层单次确认）。
 *
 * reception 层完成 grill 并由用户显式确认后，把冻结的意图与已结算答案随 handoff payload
 * 传给 pm1（handoff payload 是 untyped `unknown`，因此不需要新增 session metadata 键、
 * 也不需要 DB migration）。pm1 读取后用这些答案把自己的决策树直接置为已确认态，
 * 从而不再对同一共识二次拷问用户，同时保留「无显式确认不得生成 plan」的硬门控。
 *
 * 归属 capability 而非某个 runner：reception 与 pm1 都需要 import 本模块，而 runner 之间
 * 禁止跨层直连（`team-architecture/no-cross-layer-runner-import`）。
 */

import { CONFIRM_NODE_ID, type GrillState } from '@openAwork/agent-core';

export interface GrillConfirmationAnswer {
  nodeId: string;
  answer: string;
}

export interface GrillConfirmationPayload {
  kind: 'reception-confirmed';
  confirmedAt: number;
  intent: string;
  answers: GrillConfirmationAnswer[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseAnswers(value: unknown): GrillConfirmationAnswer[] | null {
  if (!Array.isArray(value)) return null;
  const answers: GrillConfirmationAnswer[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (typeof item['nodeId'] !== 'string' || typeof item['answer'] !== 'string') return null;
    answers.push({ nodeId: item['nodeId'], answer: item['answer'] });
  }
  return answers;
}

/** 从 handoff payload 里读出 reception 的确认传播数据；缺失或结构不符时返回 null。 */
export function readGrillConfirmation(payload: unknown): GrillConfirmationPayload | null {
  if (!isRecord(payload)) return null;
  const raw = payload['grillConfirmation'];
  if (!isRecord(raw)) return null;
  if (raw['kind'] !== 'reception-confirmed') return null;
  if (typeof raw['confirmedAt'] !== 'number') return null;
  if (typeof raw['intent'] !== 'string') return null;
  const answers = parseAnswers(raw['answers']);
  if (!answers) return null;
  return {
    kind: 'reception-confirmed',
    confirmedAt: raw['confirmedAt'],
    intent: raw['intent'],
    answers,
  };
}

/** 从已确认的 reception GrillState 构造传播载荷；未确认（无 confirmedAt）时返回 null。 */
export function buildGrillConfirmation(
  state: GrillState,
  intent: string,
): GrillConfirmationPayload | null {
  if (typeof state.confirmedAt !== 'number') return null;
  const answers: GrillConfirmationAnswer[] = [];
  for (const node of state.nodes) {
    if (node.id === CONFIRM_NODE_ID) continue;
    if (typeof node.answer !== 'string') continue;
    answers.push({ nodeId: node.id, answer: node.answer });
  }
  return { kind: 'reception-confirmed', confirmedAt: state.confirmedAt, intent, answers };
}
