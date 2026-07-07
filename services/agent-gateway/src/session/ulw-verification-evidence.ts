import type { RunEvent } from '@openAwork/shared';
import { createArtifact } from './artifact-content-store.js';
import { publishSessionRunEvent } from './session-run-events.js';

export type UlwVerificationEvidenceStatus = 'pending' | 'passed' | 'failed';

export interface UlwVerificationEvidenceInput {
  readonly note?: string;
  readonly prompt: string;
  readonly sessionId: string;
  readonly status: UlwVerificationEvidenceStatus;
  readonly taskId: string;
  readonly taskTitle: string;
  readonly userId: string;
}

export interface UlwVerificationEvidenceResult {
  readonly artifactId: string;
  readonly clientRequestId: string;
  readonly events: readonly RunEvent[];
}

function taskStatus(status: UlwVerificationEvidenceStatus): 'done' | 'failed' | 'in_progress' {
  switch (status) {
    case 'passed':
      return 'done';
    case 'failed':
      return 'failed';
    case 'pending':
      return 'in_progress';
  }
}

function statusLabel(status: UlwVerificationEvidenceStatus): string {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'pending':
      return 'pending';
  }
}

function buildEvidenceContent(input: UlwVerificationEvidenceInput): string {
  return [
    `# ULW verification ${statusLabel(input.status)}`,
    '',
    `Task: ${input.taskTitle}`,
    `Task ID: ${input.taskId}`,
    `Status: ${statusLabel(input.status)}`,
    input.note ? `Note: ${input.note}` : null,
    '',
    'Original task:',
    input.prompt,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

export function recordUlwVerificationEvidence(
  input: UlwVerificationEvidenceInput,
): UlwVerificationEvidenceResult {
  const artifact = createArtifact(input.userId, {
    sessionId: input.sessionId,
    title: `ULW verification ${statusLabel(input.status)}`,
    content: buildEvidenceContent(input),
    type: 'markdown',
    metadata: {
      source: 'agent',
      ulwVerificationStatus: input.status,
      taskId: input.taskId,
    },
    createdBy: 'agent',
    createdByNote: 'ULW verification evidence',
  });
  const occurredAt = Date.now();
  const clientRequestId = `ulw-verification:${input.sessionId}:${input.taskId}:${input.status}:${occurredAt}`;
  const events: readonly RunEvent[] = [
    {
      type: 'task_update',
      taskId: input.taskId,
      label: input.taskTitle,
      status: taskStatus(input.status),
      result: `ULW verification ${statusLabel(input.status)}. Evidence artifact: ${artifact.id}`,
      sessionId: input.sessionId,
      category: 'ulw-verification',
      eventId: `${clientRequestId}:task`,
      runId: clientRequestId,
      occurredAt,
    },
    {
      type: 'audit_ref',
      auditLogId: artifact.id,
      toolName: 'ulw-verify',
      eventId: `${clientRequestId}:artifact`,
      runId: clientRequestId,
      occurredAt,
    },
  ];

  for (const event of events) {
    publishSessionRunEvent(input.sessionId, event, { clientRequestId });
  }

  return {
    artifactId: artifact.id,
    clientRequestId,
    events,
  };
}
