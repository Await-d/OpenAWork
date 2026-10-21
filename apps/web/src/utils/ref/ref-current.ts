/**
 * 跨 hook 边界写 `ref.current` 的收敛点。
 *
 * ## 为什么需要它
 *
 * React Compiler 把 hook 的**参数**与**返回值**视为不可变值：直接写
 * `props.someRef.current = x`、`options.someRef.current = x`（参数解构同理）或
 * `useOtherHook().someRef.current = x`，都会被判为
 * 「Mutating component props or hook arguments」/「Mutating a value returned from a
 * function」，进而让**整个组件或 hook 静默退出优化**——不报错、不中断构建，
 * 只是拿不到自动 memoization（`bun run check:react-compiler` 可逐文件验证）。
 *
 * 写入收进模块函数后，编译器只看到一次普通函数调用，语义**逐字不变**：同一个
 * 单元格、同一时机、同一个值，只是「谁执行这条赋值」换了地方。同一惯用法已在
 * `pages/chat-page/conversation/render/use-chat-render-data.ts`（`writeHistoricalEntryCache`）
 * 与 `components/chat/message/chat-message-group-list.tsx` 落地。
 *
 * ## 使用边界
 *
 * 这只解决「可变单元的所有权不在本 hook 内」的场景（共享 ref 池：ref 由父组件或
 * 另一个 hook 创建，多个消费方读写同一份身份）。若某 ref 只服务单一 hook，优先把它
 * 收回该 hook 内部的 `useRef` —— 编译器允许修改自建 ref，无需本模块。
 *
 * 注意：本文件里的函数**必须**留在模块级。把等价逻辑写成 hook 内的普通函数再调用
 * 无效（实测仍报同一诊断），因为编译器分析的是词法作用域内的赋值语句。
 */

/** 写入 `ref.current`。 */
export function writeRefCurrent<T>(ref: { current: T }, value: T): void {
  ref.current = value;
}

/**
 * 读取 `ref.current` 的收敛点。
 *
 * 与 `writeRefCurrent` 同理：渲染期（尤其把「读 ref 的箭头函数」放进传给子 hook 的配置
 * 对象里）直接写 `ref.current` 会被判为 "Cannot access refs during render"，让整个 hook
 * 静默退出优化；收进模块函数后编译器只看到一次普通函数调用，读的时机与语义不变。
 */
export function readRefCurrent<T>(ref: { current: T }): T {
  return ref.current;
}

/**
 * 写入「ref 数组」的指定下标。
 *
 * 典型场景是 `ref={(node) => { itemRefs.current[i] = node; }}` 这类
 * 「本组件写、父组件读」的元素引用表：父组件要靠它做键盘导航聚焦，元素表只能放在
 * 父组件里，写入动作必须经由本函数。
 */
export function writeRefItem<T>(
  ref: { current: Array<T | null> },
  index: number,
  value: T | null,
): void {
  ref.current[index] = value;
}

/** 清空「ref 数组」的全部下标（长列表卸载 / 列表整体变化时回收元素引用）。 */
export function clearRefItems<T>(ref: { current: Array<T | null> }): void {
  ref.current.length = 0;
}
