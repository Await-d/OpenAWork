/**
 * 页面导航回报（`nav` 事件）的**标签归属**判定。
 *
 * 为什么需要：CDP 实时分支只有一个远端页面，`nav` 事件是它唯一的地址回报，但回报
 * 本身是**延迟**的（网关侧先等主文档提交、再等 150ms settle、还要读 title 才 emit）。
 * 用户在这个窗口里切标签，旧标签的回报就会在「新标签已成为激活标签」之后才到达。
 * 若宿主无条件把它写回激活标签，就会出现：
 *
 * > 新建一个空白标签 → 切到前面已打开的标签 → 再切回空白标签
 * > → 空白标签被替换成前一个标签的地址。
 *
 * 两条相互独立的判据（任一命中即丢弃）：
 *
 * 1. **代次单调**：`nav.generation` 是网关侧主文档导航的自增计数，属于更早页面的
 *    回报必然更小。已知当前标签已接受的代次时，更小的回报一定是迟到帧。
 * 2. **地址归属**：回报的地址恰好等于**其它**标签当前的地址、且不等于本标签的地址，
 *    说明它是另一个标签的回报。真正的页面内跳转（SPA / 点链接 / 重定向）会给出一个
 *    「不属于任何其它标签」的地址，因此不会被误伤。
 *
 * 判据 2 是启发式的兜底：两端标签访问同一地址时理论上可能误丢（地址栏不更新，
 * 刷新后自动纠正），但远好过把一个标签的地址写到另一个标签上。
 */

/** 一条待归属的导航回报。 */
export interface NavReport {
  url: string;
  /** 网关侧页面代次；老网关不提供时缺省。 */
  generation?: number;
}

export interface NavAttributionContext {
  /** 当前激活标签的地址。 */
  activeUrl: string;
  /** 除当前标签外，其它标签当前的地址（用于识别「这是别人的回报」）。 */
  otherTabUrls: readonly string[];
  /** 当前标签已接受过的最大代次；未知为 null。 */
  acceptedGeneration: number | null;
}

export type NavAttributionVerdict =
  /** 属于当前标签：写回标签，并记录代次。 */
  | { accept: true; generation: number | null }
  /** 迟到 / 属于别的标签：整条丢弃。 */
  | { accept: false; reason: 'stale-generation' | 'foreign-url' };

/**
 * 判定一条导航回报是否属于当前激活标签。
 *
 * 地址为空、或与当前标签地址完全相同时不需要写回（写回也是空操作），但仍算「已接受」：
 * 调用方据此更新代次门槛，避免后续更旧的回报被误判为可接受。
 */
export function attributeNavReport(
  report: NavReport,
  context: NavAttributionContext,
): NavAttributionVerdict {
  const generation = typeof report.generation === 'number' ? report.generation : null;

  // 判据 1：比已接受的代次更旧 → 上一轮页面留下的迟到回报。
  if (
    generation !== null &&
    context.acceptedGeneration !== null &&
    generation < context.acceptedGeneration
  ) {
    return { accept: false, reason: 'stale-generation' };
  }

  // 判据 2：这个地址正被别的标签占着，而本标签不是它 → 别人的回报。
  if (report.url !== context.activeUrl && context.otherTabUrls.includes(report.url)) {
    return { accept: false, reason: 'foreign-url' };
  }

  return { accept: true, generation };
}
