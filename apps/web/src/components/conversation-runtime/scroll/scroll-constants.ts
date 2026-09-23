/**
 * scroll-constants · 单 session 对话视图的滚动常量 SSOT
 *
 * 这些常量原本散落在 `chat-page-utils.ts`（公开）与 `use-chat-scroll.ts`
 * （部分公开 + 部分私有）两处，存在 drift 风险。集中到本文件后：
 *
 * - `chat-page-utils.ts` 从这里 re-export 存量消费方仍在用的常量
 * - `use-chat-scroll.ts` **已删除**（其私有副本曾与公开值 drift：锁定 700ms vs 公开 420ms，
 *   且整套「忽略 scroll 事件 N 毫秒」模型是抢占用户滚动的根因）
 * - `use-scroll-manager.ts` / `ChatPage.tsx` / `chat-message-group-list.tsx` 直接从这里引
 *
 * 滚动跟随模型（**两态位置裁决，不要重新引入时间窗口**）：
 *
 * - **suspend** = 显式输入意图（wheel / touch / key 指向更早内容）**或**一次
 *   **非程序化**的位置变化（原生滚动条拖拽 / 轨道点击 / `Cmd+↑/↓` /
 *   `scrollIntoView` / 缓存恢复 `scrollTo`）离开**真正底部**。区分依据是
 *   「当前位置是否等于本模块记录的程序化落点」，不靠时间窗口；**纯布局增长**
 *   （`scrollTop` 未位移，只有内容在长高）不构成位置变化，不据此挂起。
 * - **resume** = 程序化落点仍在 latest 边缘内（宽松：内容 / 布局增长的保持区），
 *   **或**非程序化位置回到**真正底部**（严格：用户明确回到最新），或显式
 *   「回到最新」。
 * - 两种容差各自独立（`CHAT_LATEST_EDGE_TOLERANCE_PX` vs
 *   `CHAT_TRUE_BOTTOM_TOLERANCE_PX`）：前者是末条消息贴底 + spacer 的保持区，
 *   后者是绝对底部。混用会让一个滚轮刻度上滑被下一帧对账撤销。
 * - 程序化滚动一律 `behavior: 'auto'` 并记录落点（smooth 动画的中间位置会被
 *   误判为外部滚动）；锚点几何不缓存，每次现测。
 *
 * 文件不依赖任何 chat 业务概念，迁移到 `components/conversation-runtime/`
 * 时随之搬移即可。
 */

/** 消息列底部 padding，与 composer 之间的视觉间距。 */
export const CHAT_SCROLL_BOTTOM_PADDING = '0.95rem';

/**
 * 消息列底部 spacer 高度：让最新消息可以滚到 viewport 中线/中下区域。
 * 之前 `clamp(180px, 34vh, 320px)` 留太多空，最新消息浮在视口中央；
 * 改为 `clamp(80px, 14vh, 160px)` 让它贴近输入框。
 *
 * 注意：spacer 会计入 `scrollHeight`（即 `maxScrollTop`）。锚点边缘判定走消息
 * 组底边、不受它影响；但「真正底部」判定（`distanceToBottom`）会把它算进去——
 * 这正是需要两种位置判定的原因。
 */
export const CHAT_SCROLL_BOTTOM_SPACER_HEIGHT = 'clamp(80px, 14vh, 160px)';

/**
 * `scrollToBottom(..., 'center')` 的居中落点阈值（像素）：center 对齐时预留的
 * 视口边距，以及 center 对齐下「是否需要真的滚动」的位移门槛。只服务这一个
 * 用途，与跟随恢复的两个位置容差无关。
 */
export const CHAT_LATEST_FOCUS_THRESHOLD_PX = 32;

/**
 * 宽松的「锚点边缘」容差（像素），服务于**程序化落点**（`scrollTop` 仍等于本
 * 模块记录的落点 ⇒ 位移只可能来自内容 / 布局增长）：锚点（最后一条消息组）底边
 * 进入视口 + 该容差即视为仍在 latest，保持 / 恢复跟随。
 *
 * 它刻意覆盖 spacer 区（spacer 高 80–160px，见
 * `CHAT_SCROLL_BOTTOM_SPACER_HEIGHT`）：用户把末条消息停在视口底部（最自然的
 * 阅读位置）时 `distanceToBottom` 恰好等于 spacer 高度，严格判定会误报「离开」。
 * 只在位置仍是本模块落点时使用；用户 / 外部滚动不使用它。
 */
export const CHAT_LATEST_EDGE_TOLERANCE_PX = 32;

/**
 * 严格的「真正底部」容差（像素），服务于**非程序化位置**（用户手势 / 原生滚动条
 * 拖拽 / 键盘跳转 / `scrollIntoView` / 缓存恢复）：只有 `distanceToBottom` 落进
 * 这个窗口内才恢复跟随。
 *
 * 必须显著小于 spacer 高度：一个滚轮刻度（~100px）或小型滚动条拖拽都要落在窗口
 * 之外，否则用户手势会被下一帧的位置对账静默撤销（跟随被错误恢复 → 流式 tick
 * 把视口拽回底部）。
 */
export const CHAT_TRUE_BOTTOM_TOLERANCE_PX = 32;

/**
 * `forceFollowToLatest` settle 循环的硬上限（帧）：**同步首帧**滚动 + 至多 2 帧复检。
 * 持续增高的内容由 ResizeObserver 接管，不在这里无限重试（也刻意不用 WebKit
 * 支持不可靠的 `scrollend`）。
 */
export const CHAT_FOLLOW_SETTLE_MAX_FRAMES = 3;

/**
 * 「等待容器完成布局」类重试的硬上限（帧）：`reconcileFollowState` 与
 * `autoFollowLatest` 在 `clientHeight === 0`（CSS containment / 路由过渡）时
 * 按此预算重排，避免布局窗口内增长的内容永远得不到结算。
 *
 * 与 `CHAT_FOLLOW_SETTLE_MAX_FRAMES` 语义不同（等待布局 vs 反复贴底），
 * 因此各自独立，调一个不会影响另一个。
 */
export const CHAT_LAYOUT_WAIT_MAX_FRAMES = 3;
