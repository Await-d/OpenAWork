/**
 * 错误捕获安装入口（side-effect 模块）。
 *
 * 必须是 `app/_layout.tsx` 的**第一条 import**：Metro / ESM 按书写顺序执行 import，
 * 把安装写成模块体里的函数调用会晚于其余依赖的顶层求值——而顶层抛错（原生模块缺失、
 * 环境探测失败）恰恰是最需要留痕的一类。
 *
 * 这里完成两件事：
 * 1. 安装 RN 全局错误处理器（`ErrorUtils`）与未处理 Promise 拒绝监听；
 * 2. 把本地记录接到 Sentry 上报通道——**仅在配置了 DSN 时才真正外发**，未配置时
 *    全部记录只留在设备内存与控制台，不产生任何网络请求。
 */
import { installGlobalErrorHandlers, mobileErrorRecorder } from './error-recorder';
import { captureError } from './sentry';

installGlobalErrorHandlers();

// 无条件订阅：是否外发由 captureError 内部的 initialized 守卫决定，
// 接线因此不必随环境配置分支，减少「本地有记录、远端没接线」这类半吊子状态。
mobileErrorRecorder.subscribe((record) => {
  captureError(new Error(`${record.name}: ${record.message}`), {
    source: record.source,
    timestamp: record.timestamp,
    ...record.context,
  });
});
