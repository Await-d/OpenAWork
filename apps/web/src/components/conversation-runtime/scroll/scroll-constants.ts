/**
 * scroll-constants · 单 session 对话视图的滚动常量 SSOT
 *
 * 这些常量原本散落在 `chat-page-utils.ts`（公开）与 `use-chat-scroll.ts`
 * （部分公开 + 部分私有）两处，存在 drift 风险。集中到本文件后：
 *
 * - `chat-page-utils.ts` / `use-chat-scroll.ts` 改为从这里 re-export
 * - `use-scroll-manager.ts` / `SessionConversationView.tsx` / `ChatPage.tsx` 直接从这里引
 *
 * 文件不依赖任何 chat 业务概念，迁移到 `components/conversation-runtime/`
 * 时随之搬移即可（见 `.agentdocs/workflow/260518-team-conversation-decouple-plan.md`
 * §5.1 / §6.1）。
 */

/** 消息列底部 padding，与 composer 之间的视觉间距。 */
export const CHAT_SCROLL_BOTTOM_PADDING = '0.95rem';

/**
 * 消息列底部 spacer 高度：让最新消息可以滚到 viewport 中线/中下区域。
 * 之前 `clamp(180px, 34vh, 320px)` 留太多空，最新消息浮在视口中央；
 * 改为 `clamp(80px, 14vh, 160px)` 让它贴近输入框。
 */
export const CHAT_SCROLL_BOTTOM_SPACER_HEIGHT = 'clamp(80px, 14vh, 160px)';

/** "贴近最新"判断阈值（像素）。低于该阈值视为已对齐到最新边缘。 */
export const CHAT_LATEST_FOCUS_THRESHOLD_PX = 32;

/** "最新边缘可见"判断阈值（像素）。距底小于该值视为最新消息已露出。 */
export const CHAT_LATEST_EDGE_VISIBILITY_THRESHOLD_PX = 40;

/**
 * 找不到具体最新消息节点时的兜底"附近"判定阈值（像素）。
 * 距底小于该值视为大致贴近最新区。
 */
export const CHAT_LATEST_REGION_FALLBACK_PX = 420;

/**
 * 程序化平滑滚动期间忽略 user scroll 事件的锁定时长（毫秒）。
 * smooth scroll 触发后这段时间内的 onScroll 由动画产生，不应改变 near-bottom 状态。
 */
export const CHAT_PROGRAMMATIC_SCROLL_LOCK_SMOOTH_MS = 420;
