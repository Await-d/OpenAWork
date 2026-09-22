import type { DialogueMode } from '@openAwork/shared';
import { CLARIFY_DIALOGUE_MODE_PROMPT } from './clarify.js';
import { CODING_DIALOGUE_MODE_PROMPT } from './coding.js';
import { PROGRAMMER_DIALOGUE_MODE_PROMPT } from './programmer.js';

export {
  AGENTDOCS_PLAN_HANDOFF_SYSTEM_PROMPT,
  DIALOGUE_MODE_INSTRUCTION_PRIORITY_SYSTEM_PROMPT,
  EXECUTABLE_MODE_COMMON_DISCIPLINE_SYSTEM_PROMPT,
  MODE_REFERRAL_SYSTEM_PROMPT,
} from './shared.js';

/**
 * 对话模式提示词组装（SSOT）：模式值 → 本轮注入的提示词文本。
 *
 * 消费方：`routes/stream-system-prompts.ts`（re-export）、`routes/stream.ts`、
 * `routes/stream-runtime.ts` 与契约测试。
 */
export const DIALOGUE_MODE_SYSTEM_PROMPTS: Record<DialogueMode, string> = {
  clarify: CLARIFY_DIALOGUE_MODE_PROMPT,
  coding: CODING_DIALOGUE_MODE_PROMPT,
  programmer: PROGRAMMER_DIALOGUE_MODE_PROMPT,
};
