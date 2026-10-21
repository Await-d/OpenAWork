/**
 * 流错误码分类（纯函数模块，不依赖 React / 浏览器 API）。
 *
 * 传输层（`useGatewayClient`）与呈现层（右侧面板 `applyChatRightPanelChunk`）
 * 都要按同一份名单区分「终态失败」与「流内非终态错误」，因此判定下沉到本模块，
 * 避免两处各自硬编码错误码字符串而漂移。
 */

/**
 * 「流内非终态」错误码白名单。
 *
 * 名单本身已下沉到 `@openAwork/shared`：网关的 attach 订阅也要用同一份名单决定
 * 「这条 error 事件是不是流的终点」。两侧各存一份时曾经漂移过一次——客户端认为
 * `TOOL_ERROR` 不结算，网关却把它当成终态事件把 SSE 关掉，客户端收不到 `done`
 * 只能判成断线重连，形成「attach 成功 → 几秒断开 → 重连」的死循环。
 *
 * 这里只做再导出，保持既有调用点不变。
 */
export { NON_TERMINAL_STREAM_ERROR_CODES, isNonTerminalStreamErrorCode } from '@openAwork/shared';
