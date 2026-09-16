/**
 * StreamingFoldDisabledContext — 流式输出期间「禁用围栏块折叠」的开关。
 *
 * 为什么需要它：围栏块（代码块 / Markdown 预览块）进入折叠态后，会用
 * `max-height` + `overflow: hidden/clip` 把自身渲染高度钳住。当消息还在流式
 * 输出时提前折叠，意味着该块的高度不再随新内容增长 → 外层滚动容器的
 * `scrollHeight` 提前触顶 → 自动贴底逻辑没有新的可滚动距离（表现为
 * 「页面停止滚动」），同时刚流出的尾部内容被直接裁掉、用户看不到。
 *
 * 因此在流式期间禁用折叠，让围栏块保持完整高度、滚动容器持续增长；消息
 * finalize（改走非流式渲染路径）后折叠行为自动恢复。
 *
 * React 19 写法：`<StreamingFoldDisabledContext value={true}>` —— 不使用 `.Provider`。
 */

import { createContext, useContext } from 'react';

/** 默认 false：非流式场景保留既有折叠行为，只有流式路径显式提供 true。 */
export const StreamingFoldDisabledContext = createContext(false);

/** 读取「当前是否处于流式、需要禁用折叠」。默认 false，即保留折叠。 */
export function useStreamingFoldDisabled(): boolean {
  return useContext(StreamingFoldDisabledContext);
}
