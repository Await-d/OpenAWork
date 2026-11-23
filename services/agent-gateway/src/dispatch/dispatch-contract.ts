import { z } from 'zod';

export const dispatchId = z.string().uuid();
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const title = z.string().trim().min(1).max(120);
const itemDraft = z
  .object({
    title,
    objective: z.string().trim().min(1).max(1200),
    acceptance: z.string().trim().min(1).max(600),
    role: z.enum(['summarize', 'extract', 'review']),
  })
  .strict();

export const dispatchDraftInput = z
  .object({
    request: z.string().trim().min(1).max(3000),
    excerpt: z.string().trim().max(16000),
  })
  .strict();

export const dispatchPlan = z.object({ title, items: z.array(itemDraft).min(1).max(5) }).strict();
export const dispatchPlanningOutput = z.union([
  dispatchPlan,
  z.object({ clarification: z.string().trim().min(1).max(500) }).strict(),
]);
export const dispatchEdit = dispatchPlan.extend({ revision });
export const dispatchConfirm = z.object({ revision }).strict();
export const dispatchQuestion = z
  .object({
    expectedAttemptId: dispatchId,
    question: z.string().trim().min(1).max(2000),
  })
  .strict();
export const dispatchAttemptRef = dispatchQuestion.pick({ expectedAttemptId: true });
export const dispatchCursor = z.tuple([z.number().int().nonnegative(), dispatchId]);

export const DISPATCH_MAX_RESULT_CHARS = 8000;
export const DISPATCH_DETAIL_ATTEMPT_LIMIT = 10;
export const DISPATCH_USER_ACTIVE_LIMIT = 20;
export const DISPATCH_GLOBAL_ACTIVE_LIMIT = 200;
