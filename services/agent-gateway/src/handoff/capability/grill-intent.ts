/**
 * 260914 · grill 触发判定（高影响意图检测）
 *
 * reception（b 层）与 pm1（c 层）都需要同一个「该意图是否需要先做 grill 澄清拷问」判定：
 *   - b 层：`reception-router` 用它把高影响意图路由到 `grill` 分支
 *   - c 层：`artifact-chain` 用它（配合 spec 的 `[NEEDS CLARIFICATION]` 标记）决定是否启动 grill
 *
 * 该判定原先内联在 `runner/reception-router.ts`。c 层直接 import b 层 runner 会触发
 * `team-architecture/no-cross-layer-runner-import`（见 handoff/AGENTS.md §跨层禁止直连），
 * 故下沉到 capability（runner → capability 是合法依赖方向）。
 *
 * **算法归属**：R0–R3 分级本身仍只在 `@openAwork/agent-core`（`context/routing.ts`）实现一次；
 * 本模块只做「中文高影响模式 + 分级阈值」的编排，不重复实现澄清/路由算法（§5.1 SSOT 铁律）。
 */

import { createSessionContext, evaluate } from '@openAwork/agent-core';

/**
 * 澄清信号：仅空/单字输入不做分级探测（与 reception-router 的 `MIN_LLM_FALLBACK_LENGTH` 一致）。
 * 门槛不能过高——中文架构级措辞常短于 8 字（如「重构整个架构」），过高会让 R3 探测对中文失效。
 */
const GRILL_MIN_PROBE_LENGTH = 2;

/** 仅用于 R0–R3 分级探测的伪 session id：无状态、不写库。 */
const GRILL_PROBE_SESSION_ID = 'grill-intent:probe';

/**
 * 高影响模式（保守）：仅收录「不可逆 / 生产数据损坏」这类必须先行澄清的措辞。
 * 重构/重写/迁移等架构级措辞交由下方 R0–R3 分级探测判定，避免日常任务被误拷问。
 */
const GRILL_HIGH_IMPACT_PATTERN =
  /(删库|清空数据|全量删除|删除生产|删除线上|回滚生产|数据丢失|不可逆|破坏性|生产环境|线上环境|drop\s+(?:the\s+)?database|\btruncate\b)/i;

/** 该意图是否属于「高影响、需先 grill 澄清」的候选。纯函数，无副作用。 */
export function shouldGrillIntent(userIntent: string): boolean {
  const trimmed = userIntent.trim();
  if (trimmed.length === 0) return false;
  if (GRILL_HIGH_IMPACT_PATTERN.test(trimmed)) return true;
  if (trimmed.length < GRILL_MIN_PROBE_LENGTH) return false;
  return evaluate(trimmed, createSessionContext(GRILL_PROBE_SESSION_ID)).level === 'R3';
}
