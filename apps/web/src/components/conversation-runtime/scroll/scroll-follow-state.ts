/**
 * scroll-follow-state · 自动跟随的「用户意图 vs 位置」状态机
 *
 * 纯函数、零 DOM。模型（不要重新引入时间窗口）：
 *
 * - **输入事件 = 显式用户意图**：wheel / touch / key 只会由真实用户产生；程序化
 *   `scrollTo` 只会产生 `scroll` 事件，永远不会产生这三种输入事件。因此不需要
 *   用「忽略 scroll 事件 N 毫秒」这种时间窗口去猜（历史上那套窗口在流式期间
 *   被连续重新武装，直接吞掉了用户手势）。
 * - **位置是两态的，按落点来源分开裁决**（见 `resolveFollowInterrupted`）：
 *   - 当前位置 == 本模块记录的程序化落点（`isProgrammaticPosition`）⇒ 位移只
 *     可能来自内容 / 布局增长 ⇒ 宽松的 `atLatestEdge` 即可保持 / 恢复跟随；
 *   - 当前位置 != 程序化落点（用户手势、原生滚动条拖拽、`Cmd+↑/↓`、
 *     `scrollIntoView`、缓存恢复 `scrollTo`）⇒ 只有视口回到**真正底部**
 *     （`atTrueBottom`）才恢复，否则挂起。一个滚轮刻度上滑就会挂起跟随。
 *   单一宽松判定会把 80–160px 的 spacer 区当成「已在 latest」，让用户的第一个
 *   滚轮刻度被下一帧对账撤销。唯一例外是**显式向下意图**（`seek-latest`）：用户
 *   明确在追最新内容时，位置落在 latest 边缘内即可恢复（由
 *   `useScrollManager.handleSeekLatest` 裁决）；上滑手势永远分类为 `leave-latest`，
 *   不会触发这条例外。
 * - **布局变化 ≠ 外部滚动**：`scrollTop` 未发生位移时，位置偏离 latest 只可能是
 *   内容在长（首批内容到达 / 高度重排），不是用户或外部把位置改了。此时保持
 *   原状态（`positionMoved === false`），让自动跟随把视口带回最新处；否则会话
 *   开屏的第一帧就会因内容增高被判成「用户离开」而挂起跟随。
 * - **不变量**：suspend = 显式输入意图 OR **位置确实位移过**的非程序化位置离开真正底部；
 *   resume = 程序化落点在 latest 边缘内 OR 非程序化位置回到真正底部 OR
 *   显式向下意图 + 非程序化位置落在 latest 边缘内；
 *   永不使用时间窗口。
 */
export type ScrollUserIntent = 'leave-latest' | 'seek-latest';

/**
 * 触摸手势判定阈值（px）：位移小于该值视为点击/抖动，不算用户意图。
 * 手势位移以 touchstart 记录的起点为基准。
 */
export const SCROLL_TOUCH_INTENT_THRESHOLD_PX = 8;

/**
 * wheel 意图：
 * - `deltaY < 0`（向上 / 朝更早内容）→ `leave-latest`
 * - `deltaY > 0`（向下 / 朝更新内容）→ `seek-latest`
 * - `deltaY === 0` → `null`（无方向，不构成意图）
 */
export function resolveWheelIntent(input: { deltaY: number }): ScrollUserIntent | null {
  if (input.deltaY < 0) return 'leave-latest';
  if (input.deltaY > 0) return 'seek-latest';
  return null;
}

/**
 * touch 意图：以手势起点为基准的纵向位移。
 * - 手指向下移动（`currentY - startY > thresholdPx`）→ 内容朝更早滚动 → `leave-latest`
 * - 手指向上移动（`< -thresholdPx`）→ 内容朝更新滚动 → `seek-latest`
 * - 位移不足阈值 → `null`
 */
export function resolveTouchIntent(input: {
  startY: number;
  currentY: number;
  thresholdPx: number;
}): ScrollUserIntent | null {
  const delta = input.currentY - input.startY;
  if (delta > input.thresholdPx) return 'leave-latest';
  if (delta < -input.thresholdPx) return 'seek-latest';
  return null;
}

/**
 * 键盘意图：
 * - ArrowUp | PageUp | Home | Shift+Space → `leave-latest`
 * - ArrowDown | PageDown | End | Space → `seek-latest`
 * - 其他按键 → `null`
 */
export function resolveKeyboardIntent(input: {
  key: string;
  shiftKey: boolean;
}): ScrollUserIntent | null {
  switch (input.key) {
    case 'ArrowUp':
    case 'PageUp':
    case 'Home':
      return 'leave-latest';
    case 'ArrowDown':
    case 'PageDown':
    case 'End':
      return 'seek-latest';
    case ' ':
    case 'Spacebar':
      return input.shiftKey ? 'leave-latest' : 'seek-latest';
    default:
      return null;
  }
}

/**
 * 跟随状态的唯一决策函数（意图路径与位置路径共用，禁止任何调用方再复制一份判定）。
 * - 显式 leave 意图永远优先（抢占「意图已发出、scroll 事件尚未到达」的那一帧）。
 * - 未提供 position（意图路径的 seek-latest）⇒ 保持不变，交给位置路径裁决。
 * - programmatic（本模块自己的落点，只有内容增长）⇒ 宽松边界 atLatestEdge 即可恢复/保持。
 * - 非 programmatic（用户/外部把位置改了）⇒ 只有回到真正底部 atTrueBottom 才恢复。
 * - 非 programmatic 且未到真正底部时，再看位置是否发生位移（`positionMoved`）：
 *   未位移 ⇒ 只有**布局**在动（首批内容到达 / 高度重排），不构成用户 / 外部滚动的
 *   证据，保持原状态；已位移 / 未知 ⇒ 挂起。
 */
export function resolveFollowInterrupted(input: {
  intent: ScrollUserIntent | null;
  interrupted: boolean;
  position?: {
    programmatic: boolean;
    atLatestEdge: boolean;
    atTrueBottom: boolean;
    /**
     * 当前位置相对上一次观测是否发生了位移。**缺省按 true（保守）处理**：
     * 只有调用方明确知道本次对账由纯布局变化触发时才允许传 false
     * （见 `useScrollManager` 的 ResizeObserver 对账路径）。
     *
     * 为什么需要它：会话开屏 / 首次内容到达时，`scrollTop` 停在 0 不动，只有
     * 内容在长高。旧实现把「非程序化位置 + 未到真正底部」一律判成外部滚动，
     * 于是首个内容提交的那一帧就把跟随挂起——开屏贴底被迫依赖后续
     * `forceFollowToLatest` 再补一次，慢机 / 后台标签页下会永久停在中途。
     */
    positionMoved?: boolean;
  };
}): boolean {
  if (input.intent === 'leave-latest') return true;
  const p = input.position;
  if (!p) return input.interrupted;
  if (p.programmatic) return p.atLatestEdge ? false : input.interrupted;
  // 非程序化位置回到真正底部 ⇒ 恢复（与是否位移过无关）。
  if (p.atTrueBottom) return false;
  // 非程序化位置、未到真正底部、但位置没有位移 ⇒ 只有布局在长，不构成外部滚动证据。
  if (p.positionMoved === false) return input.interrupted;
  return true;
}

/**
 * 程序化落点判定容差（px）：浏览器对 `scrollTop` 的取整/亚像素误差不构成
 * 外部滚动，只有真正偏离记录落点的位移才算「别人滚的」。
 */
export const SCROLL_PROGRAMMATIC_POSITION_TOLERANCE_PX = 0.5;

/**
 * 当前位置是否就是本模块主动请求的程序化落点。
 *
 * - `programmaticScrollTop === null`（从未程序化滚动过）→ `false`：位移必然
 *   来自外部（原生滚动条拖拽 / 键盘跳转 / `scrollIntoView` / 缓存恢复）。
 * - `scrollTop` 仍等于记录落点 → `true`：内容在程序化滚动之后继续增长时
 *   位置不会跳变，因此不会被误判为「用户离开」。
 * - `scrollTop` 偏离记录落点 → `false`：这是外部滚动，reconcile 据此挂起跟随。
 */
export function isProgrammaticPosition(input: {
  programmaticScrollTop: number | null;
  scrollTop: number;
}): boolean {
  if (input.programmaticScrollTop === null) return false;
  return (
    Math.abs(input.scrollTop - input.programmaticScrollTop) <=
    SCROLL_PROGRAMMATIC_POSITION_TOLERANCE_PX
  );
}
