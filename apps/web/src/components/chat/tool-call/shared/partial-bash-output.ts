/**
 * 把流式 bash 的部分输出合成为 `BashExecutionResult` 形状的 live 视图。
 *
 * 两个调用方共用：
 * - batch 子行：`_batchProgress.subTools[i].partialOutput`（子工具运行中）；
 * - 单条 bash：网关把滚动 stdout 以「单元素 subTools」形态复用 `tool_progress`
 *   事件（`_batchProgress`），前端按同一份数据渲染实时终端。
 *
 * `mode: 'live'` + 不设 `exitCode` 是给 `BashTerminalCard` 的信号：跳过「退出码 0」
 * 的收尾渲染、按运行中处理（等待态 / 自动贴底）。
 */
export function buildPartialBashOutput(
  input: Record<string, unknown>,
  partialOutput: string,
): Record<string, unknown> {
  const command = typeof input.command === 'string' ? (input.command as string) : '';
  return {
    command,
    output: partialOutput,
    mode: 'live',
    truncated: false,
  };
}
