import {
  requestWorkflowLlmCompletion,
  WorkflowOutputError,
  type WorkflowLlmRequestConfig,
} from '../../routes/workflow-llm.js';
import { PlanningFailure } from '../capability/planning-failure.js';

/** One budget adjustment, shared by initial generation and document repair. */
export async function requestPlanningCompletion(input: WorkflowLlmRequestConfig): Promise<string> {
  for (const maxOutputTokens of [8192, 16384]) {
    input.signal?.throwIfAborted();
    try {
      return await requestWorkflowLlmCompletion({
        ...input,
        maxOutputTokens,
        requireCompleteOutput: true,
      });
    } catch (error) {
      if (!(error instanceof WorkflowOutputError)) throw error;
      if (maxOutputTokens === 16384) {
        throw new PlanningFailure(`${error.message}；模型未交付完整正文`);
      }
      console.warn(`[planning] ${error.message}；将输出预算提高到 16384 后重试一次`);
    }
  }
  throw new PlanningFailure('规划输出预算耗尽');
}
