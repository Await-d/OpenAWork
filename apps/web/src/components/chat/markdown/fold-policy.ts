/**
 * FoldDisabledContext — 「禁用围栏块折叠」的开关。
 *
 * 为什么需要它：围栏块（代码块 / Markdown 预览块）进入折叠态后，会用
 * `max-height` + `overflow: hidden/clip` 把自身渲染高度钳住。以下两类场景
 * 下这种钳住是有害的：
 *
 * 1. 流式期间——高度不再随新内容增长 → 外层滚动容器的 `scrollHeight`
 *    提前触顶 → 自动贴底逻辑没有新的可滚动距离（表现为「页面停止滚动」），
 *    同时刚流出的尾部内容被直接裁掉、用户看不到。
 * 2. 最新一条已完成助手回复——它承载着用户刚问的问题的答案；若在 finalize
 *    瞬间把块收起来，用户刚读完的内容会突然塌缩，且收起造成的块高度突变
 *    会把视口向上顶（视口上跳）。
 *
 * 因此在上述场景禁用围栏折叠，让围栏块保持完整高度；其余场景（历史回复 /
 * 普通静态渲染）保留既有折叠行为，以便压缩回滚区。
 *
 * React 19 写法：`<FoldDisabledContext value={true}>` —— 不使用 `.Provider`。
 */

import { createContext, useContext } from 'react';

/** 默认 false：未显式提供的场景保留既有折叠行为。 */
export const FoldDisabledContext = createContext(false);

/** 读取「当前是否禁用围栏折叠」。默认 false，即保留折叠。 */
export function useFoldDisabled(): boolean {
  return useContext(FoldDisabledContext);
}

/**
 * MessageFoldContext — 「外层消息级折叠已接管这条正文」的信号。
 *
 * 为什么需要它：`CollapsibleAssistantContent` 在正文超过 1500 字符时会把整条正文
 * 裁到 ~60vh 并给出「展开全部 · N 字符」。此时正文里若还有**自带折叠**的片段
 * （如 ```thinking 围栏块的「展开思考」），用户就会先点一次「展开全部」、再点一次
 * 「展开思考」——同一屏出现两级展开提示，且第一次点击后内容仍被二次裁剪。
 *
 * 因此折叠归属外层：消息级折叠生效期间，内部片段不再自折叠；正文不长（没有外层
 * 折叠）时，片段保留自己的折叠控件。注意 `FoldDisabledContext` 是它的反向信号
 * （外层折叠被禁用，例如最新一条已定稿回复），两者都由 `useXxxFoldActive` 读取。
 */
export const MessageFoldContext = createContext(false);

/** 读取「外层消息级折叠是否已接管当前正文」。默认 false。 */
export function useMessageFoldActive(): boolean {
  return useContext(MessageFoldContext);
}
