export type DispatchAttemptStatus =
  'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted' | 'cancelled';

export type DispatchStatus = DispatchAttemptStatus | 'draft' | 'partial';
export type DispatchRole = 'summarize' | 'extract' | 'review';

export interface DispatchItemDraft {
  title: string;
  objective: string;
  acceptance: string;
  role: DispatchRole;
}

export interface DispatchDraftInput {
  request: string;
  excerpt: string;
}

export interface DispatchSummary {
  id: string;
  title: string;
  status: DispatchStatus;
  total: number;
  succeeded: number;
  updatedAt: number;
}

export interface DispatchAttempt {
  id: string;
  threadId: string;
  number: number;
  kind: 'initial' | 'follow-up' | 'retry';
  status: DispatchAttemptStatus;
  question: string | null;
  result: string | null;
  error: 'model-unavailable' | 'generation-failed' | 'gateway-stopped' | null;
  stopRequested: boolean;
  createdAt: number;
  finishedAt: number | null;
}

export interface DispatchItem extends DispatchItemDraft {
  id: string;
  attempts: DispatchAttempt[];
  hasEarlierAttempts: boolean;
}

export interface DispatchDetail extends DispatchSummary, DispatchDraftInput {
  revision: number;
  selection: { providerId: string; modelId: string };
  draftItems: DispatchItemDraft[];
  items: DispatchItem[];
}

export interface DispatchList {
  enabled: boolean;
  entries: DispatchSummary[];
  nextCursor: string | null;
}

export interface DispatchDraftEdit {
  revision: number;
  title: string;
  items: DispatchItemDraft[];
}

export type DispatchItemAction =
  | { kind: 'cancel' | 'retry'; expectedAttemptId: string }
  | { kind: 'follow-up'; expectedAttemptId: string; question: string };
