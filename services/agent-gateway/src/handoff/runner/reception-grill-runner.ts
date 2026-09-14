import {
  applyAnswer,
  buildClarificationQuestions,
  buildConfirmNode,
  computeFrontier,
  CONFIRM_ANSWER,
  CONFIRM_NODE_ID,
  createGrillState,
  needsConfirmation,
  parseGrillState,
  serializeGrillState,
  type ClarificationNode,
  type GrillState,
} from '@openAwork/agent-core';
import { sqliteGet, sqliteRun } from '../../infra/db.js';
import { parseSessionMetadataJson } from '../../session/session-workspace-metadata.js';

const AFFIRMATIVE_PATTERN = /^(确认|同意|可以|行|好|没问题|是的|对的|ok|okay|yes|yep|go)/i;

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
  writeReceptionMetadata(sessionId, { clarificationState: undefined, clarificationIntent: undefined });
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

export function formatFrontierPrompt(state: GrillState): string {
  const frontier = computeFrontier(state);
  if (frontier.length === 0) return '';

  const lines = ['在派发任务前，我需要先跟你确认几件事：'];
  frontier.forEach((node, index) => {
    lines.push(`${index + 1}. ${node.question}`);
    const recommended = node.options.find((option) => option.recommended === true);
    for (const option of node.options) {
      const suffix = option === recommended ? ' ← 推荐' : '';
      const description = option.description ? `（${option.description}）` : '';
      lines.push(`   - ${option.label}${description}${suffix}`);
    }
  });
  lines.push('请直接回复你的选择。');
  return lines.join('\n');
}

export interface GrillAdvance {
  state: GrillState;
  kind: 'question' | 'awaiting-confirmation' | 'confirmed' | 'none';
  text?: string;
}

export function advanceReceptionGrill(input: { state: GrillState; reply: string }): GrillAdvance {
  const frontier = computeFrontier(input.state);
  const target = frontier[0];
  if (!target) {
    return { state: input.state, kind: 'none' };
  }

  const reply = input.reply.trim();
  if (reply.length === 0) {
    return { state: input.state, kind: 'question', text: formatFrontierPrompt(input.state) };
  }

  const normalized =
    target.id === CONFIRM_NODE_ID && AFFIRMATIVE_PATTERN.test(reply) ? CONFIRM_ANSWER : reply;
  const nextState = applyAnswer(input.state, target.id, normalized);

  if (nextState.confirmedAt !== undefined) {
    return { state: nextState, kind: 'confirmed' };
  }
  if (needsConfirmation(nextState)) {
    return {
      state: nextState,
      kind: 'awaiting-confirmation',
      text: formatFrontierPrompt(nextState),
    };
  }
  return { state: nextState, kind: 'question', text: formatFrontierPrompt(nextState) };
}
