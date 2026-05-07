/**
 * 桌面端父进程死亡监视器。
 *
 * 当 agent-gateway 作为 Tauri sidecar 启动时，桌面端 Rust 侧会注入
 * `OPENAWORK_PARENT_PID` 环境变量。本模块周期性用 `kill(pid, 0)` 探测
 * 父进程是否仍存在；一旦不存在（用户被 SIGKILL、强制重启、卸载残留、
 * Tauri 自身崩溃等），sidecar 立刻自我退出，避免变成孤儿继续占用端口
 * 与监听 LAN 流量。
 *
 * 在以下场景下补足现有 `RunEvent::Exit → shutdown_gateway_child` 的盲区：
 * - 用户通过任务管理器 / kill -9 直接杀掉 OpenAWork 主进程；
 * - 系统强制关机/重启没走正常退出钩子；
 * - .deb / .rpm / 安装器卸载时未带 prerm 钩子，但用户应用还在跑；
 * - Tauri 进程异常崩溃（panic 时 RunEvent::Exit 也未必触发）。
 *
 * 非 Tauri 场景（独立 docker / 自托管 / 手机扫码 server）下没有
 * `OPENAWORK_PARENT_PID`，本模块直接 no-op，不影响生命周期。
 */

const PARENT_WATCH_INTERVAL_MS = 2000;

let timer: ReturnType<typeof setInterval> | null = null;

export function startParentProcessWatch(): void {
  // 已经启动过 → 幂等返回，避免热重启时挂多个 timer。
  if (timer) return;

  const proc = globalThis.process;
  const raw = proc?.env?.['OPENAWORK_PARENT_PID'];
  if (!raw) return;

  const parentPid = Number.parseInt(raw, 10);
  if (!Number.isFinite(parentPid) || parentPid <= 0) return;

  timer = setInterval(() => {
    try {
      // signal 0 = 仅做存在性 / 权限检查，不实际投递信号。
      proc?.kill(parentPid, 0);
    } catch {
      // ESRCH（进程不存在）→ 父进程已死，立刻自我退出。
      // EPERM（权限不足）虽然也会抛，但桌面端 sidecar 与 Tauri 同 uid，
      // 实际不会出现 EPERM；保险起见统一退出更安全。
      try {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      } catch {
        // ignore
      }
      try {
        proc?.exit(0);
      } catch {
        // ignore
      }
    }
  }, PARENT_WATCH_INTERVAL_MS);

  // 不要因为这个 watcher 让事件循环长存——Node/Bun 在没有其它工作时仍然
  // 能正常退出（虽然 fastify listen 已经持住事件循环，这里 unref 是稳妥兜底）。
  if (timer && typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
    (timer as unknown as { unref: () => void }).unref();
  }
}
