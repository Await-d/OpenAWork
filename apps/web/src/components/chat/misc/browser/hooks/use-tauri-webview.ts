/**
 * `useTauriWebview` — 内置浏览器的 Tauri 原生 webview 生命周期。
 *
 * 从 `BuiltInBrowser.tsx` 抽出：负责创建 / 销毁绑定当前 url 的原生 webview、
 * 在容器可见性变化时同步位置，并把就绪 / 错误状态回传给宿主。非 Tauri 环境
 * （web 端 iframe）不参与，effect 内部自行提前返回。
 *
 * 原生 webview 是永远绘制在 HTML 之上的表面：一旦「创建了却没人再持有句柄」，
 * 它就变成盖住整个 UI、只能重启应用才能清掉的孤儿。这里必须堵死三处竞态：
 * 1. 隐藏意图可能在 `tauri://created` 之前到达 —— 仅靠 visibility effect 会丢掉这次
 *    隐藏，必须以 `latestHiddenRef` 为单一事实来源，在 created 回调里补应用；
 * 2. 卸载可能发生在 `new Webview(...)` 与 `tauri://created` 之间 —— 清理要先拿到句柄
 *    发起 close、且不能提前清空句柄，created 回调才能用同一句柄重试；
 * 3. `tauri://error` 之后 Rust 侧可能仍持有表面 —— 不能只把 JS ref 置空，必须显式关闭。
 *
 * `hidden` 刻意不进创建 effect 的依赖：它不重建 webview，只驱动位置；进依赖会让每次
 * 显隐切换都重建原生表面、丢掉页面状态。
 */

import { readRefCurrent, writeRefCurrent } from '../../../../../utils/ref/ref-current.js';
import { invoke } from '@tauri-apps/api/core';
import type { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import type { Webview } from '@tauri-apps/api/webview';
import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  loadTauriDpiOnce,
  loadTauriWebviewOnce,
  loadTauriWindowOnce,
} from '../../../../../utils/lazy/lazy-assets.js';

interface UseTauriWebviewParams {
  isTauri: boolean;
  /**
   * 是否允许创建原生表面。占位页（`about:blank`）由 DOM 开始页顶替：创建原生
   * webview 只会得到一块盖住开始页的空白表面，既看不到内容又挡住交互。
   * 关闭时 effect 仍是「有依赖变化就重跑」的，旧的表面会被正常 close。
   */
  enabled: boolean;
  activeUrl: string;
  refreshKey: number;
  hidden: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  internalNavRef: RefObject<{ tabId: string; url: string } | null>;
  activeTabIdRef: RefObject<string>;
  generationRef: RefObject<number>;
}

/** 隐藏时把原生表面挪到屏幕外（未授予 `core:webview:allow-webview-hide`，不能用 hide()）。 */
const OFFSCREEN_POSITION = -9999;

// label 必须全局唯一：所有关闭通道（JS close / Rust 按 label 收）都以 label 寻址，
// 纯毫秒时间戳在「同一毫秒内两次创建」时会重名，导致第二个创建失败甚至误关同名表面。
let webviewSequence = 0;

type LogicalPositionCtor = new (x: number, y: number) => LogicalPosition;
type LogicalSizeCtor = new (width: number, height: number) => LogicalSize;

interface TauriDpi {
  LogicalPosition: LogicalPositionCtor;
  LogicalSize: LogicalSizeCtor;
}

/** 定位 / 缩放同步失败时记日志（禁止空 catch：失败必须是可观测的）。 */
function logVisibilityError(err: unknown): void {
  console.error('[BuiltInBrowser] webview 位置同步失败:', err);
}

/**
 * 关闭原生 webview；JS `close()` 失败时按 label 交给 Rust reaper 兜底。
 *
 * 创建尚未完成时 `close()` 可能 reject（IPC 通道未就绪），此时句柄已不可信，
 * 但 label 由我们生成、Rust 侧可按 label 寻址——必须再收一次，否则孤儿表面会一直
 * 盖在 HTML 之上。这里吞掉所有异常：调用方多在 cleanup / 事件回调里，抛错会打断卸载。
 */
async function closeWebviewReliably(webview: Webview | null, label: string | null): Promise<void> {
  if (webview) {
    try {
      await webview.close();
      return;
    } catch (err) {
      console.error('[BuiltInBrowser] webview.close() 失败，改用 Rust 按 label 兜底:', err);
    }
  }
  if (!label) return;
  try {
    await invoke<boolean>('close_browser_webview', { label });
  } catch (err) {
    console.error('[BuiltInBrowser] close_browser_webview 调用失败:', err);
  }
}

/**
 * webview 初始化动作的统一包装：`run` 全流程留在 try 内，catch 交给 `onError`。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 try 内的值块
 * （`?.` / `||` / `in` / 三元），本 hook 这处 try 会让整个 hook 脱靶（实测）。
 * 语义逐字照搬（含 `disposed` / generation 的并发守卫）。
 */
async function runWebviewInitOnce(ctx: {
  onError: (error: unknown) => void;
  run: () => Promise<void>;
}): Promise<void> {
  try {
    await ctx.run();
  } catch (error) {
    ctx.onError(error);
  }
}

/** 把任意抛出物归一成可展示的文案（Error / 带 message 的对象 / 其它）。 */
function readThrownMessageOnce(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as Record<string, unknown>).message);
  }
  return String(err);
}

export function useTauriWebview({
  isTauri,
  enabled,
  activeUrl,
  refreshKey,
  hidden,
  containerRef,
  internalNavRef,
  activeTabIdRef,
  generationRef,
}: UseTauriWebviewParams): { webviewReady: boolean; webviewError: string | null } {
  const [webviewReady, setWebviewReady] = useState(false);
  const [webviewError, setWebviewError] = useState<string | null>(null);
  const activeWebviewRef = useRef<Webview | null>(null);
  // label 由我们生成、Rust 可寻址：即使 JS 句柄丢失，也能按它收掉孤儿表面。
  const activeLabelRef = useRef<string | null>(null);
  const tauriDpiRef = useRef<TauriDpi | null>(null);
  // 同步「此刻该不该隐藏」。隐藏意图可能先于 `tauri://created` 到达，created 回调据此
  // 决定创建完成瞬间的可见性——这是唯一事实来源。
  // 走 effect 而非渲染期直接写 ref：编译器会判为 "Cannot access refs during render"
  // 并放弃优化整个 hook（实测）。
  const latestHiddenRef = useRef(hidden);
  useEffect(() => {
    latestHiddenRef.current = hidden;
  }, [hidden]);

  // ── Tauri native webview lifecycle ──────────────────────────────────
  useEffect(() => {
    if (!isTauri || !enabled || !containerRef.current || !activeUrl) return;

    // 内部 navigate 同步：iframe/webview 已经在新 url，只是 React state 落后。
    // 这种情况不要重建 webview（否则页面状态丢失）。
    const internalNav = internalNavRef.current;
    if (
      internalNav &&
      internalNav.tabId === activeTabIdRef.current &&
      internalNav.url === activeUrl
    ) {
      // internalNavRef 由调用方创建后作为参数传入，直接写 .current 会被判为「修改函数
      // 返回值」；写入统一走收敛函数（见 utils/ref/ref-current.ts）。
      writeRefCurrent(internalNavRef, null);
      return;
    }

    const gen = readRefCurrent(generationRef) + 1;
    writeRefCurrent(generationRef, gen);
    let webview: Webview | null = null;
    let observer: ResizeObserver | null = null;
    let rafId = 0;
    let disposed = false;
    let label: string | null = null;

    setWebviewReady(false);
    setWebviewError(null);

    async function create() {
      // try/catch 下沉到模块级 `runWebviewInitOnce`（见其注释）。
      await runWebviewInitOnce({
        onError: (err) => {
          // 守卫与原 catch 内逐字一致（`!disposed && gen === generationRef.current`）。
          if (!disposed && gen === generationRef.current) {
            const msg = readThrownMessageOnce(err);
            console.error('[BuiltInBrowser] init error:', msg);
            setWebviewError(msg);
          }
        },
        run: async () => {
          // import() 只能在模块级：见 utils/lazy/lazy-assets.ts。
          const [{ Webview }, { getCurrentWindow }, dpi] = await Promise.all([
            loadTauriWebviewOnce(),
            loadTauriWindowOnce(),
            loadTauriDpiOnce(),
          ]);

          const { LogicalPosition, LogicalSize } = dpi;
          if (disposed || gen !== generationRef.current) return;
          tauriDpiRef.current = { LogicalPosition, LogicalSize };

          const container = containerRef.current;
          if (!container) return;

          const appWindow = getCurrentWindow();
          let rect = container.getBoundingClientRect();

          // 容器尚未完成布局（display:none 或零尺寸）时，用 ResizeObserver 等待
          // 它变为可见且有尺寸后再创建 webview，避免 Tauri 原生 webview 初始化失败。
          if (rect.width < 1 || rect.height < 1) {
            await new Promise<void>((resolve) => {
              const wait = new ResizeObserver(() => {
                const r = container.getBoundingClientRect();
                if (r.width >= 1 && r.height >= 1) {
                  wait.disconnect();
                  resolve();
                }
              });
              wait.observe(container);
              // 安全超时：5s 后即使容器仍零尺寸也继续（用 Math.max 兜底）。
              const timer = setTimeout(() => {
                wait.disconnect();
                resolve();
              }, 5000);
              // 清理：组件卸载或 generation 变化时中止等待。
              const check = setInterval(() => {
                if (disposed || gen !== generationRef.current) {
                  clearInterval(check);
                  clearTimeout(timer);
                  wait.disconnect();
                  resolve();
                }
              }, 200);
            });
            if (disposed || gen !== generationRef.current) return;
            rect = container.getBoundingClientRect();
          }

          webviewSequence += 1;
          const generatedLabel = `browser-${Date.now().toString(36)}-${webviewSequence.toString(36)}`;
          label = generatedLabel;

          const instance = new Webview(appWindow, generatedLabel, {
            url: activeUrl,
            x: rect.x,
            y: rect.y,
            width: Math.max(rect.width, 100),
            height: Math.max(rect.height, 100),
            focus: false,
          });
          webview = instance;

          const syncPosition = (target: Webview): void => {
            // 隐藏期间必须持续离屏：原生表面永远盖在 HTML 之上，任何时刻都不能把它
            // 移回容器矩形，否则会在 UI 之上闪现。
            if (latestHiddenRef.current) {
              target
                .setPosition(new LogicalPosition(OFFSCREEN_POSITION, OFFSCREEN_POSITION))
                .catch(logVisibilityError);
              return;
            }
            const r = container.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) {
              target
                .setPosition(new LogicalPosition(OFFSCREEN_POSITION, OFFSCREEN_POSITION))
                .catch(logVisibilityError);
              return;
            }
            target.setPosition(new LogicalPosition(r.x, r.y)).catch(logVisibilityError);
            target
              .setSize(new LogicalSize(Math.max(r.width, 1), Math.max(r.height, 1)))
              .catch(logVisibilityError);
          };

          instance.once('tauri://created', () => {
            // 创建完成前组件已卸载 / 已被新 generation 取代：这次创建是废的，句柄
            // 此刻仍可重试，必须再关一次——否则它会变成无引用的孤儿表面。
            if (disposed || gen !== generationRef.current) {
              void closeWebviewReliably(instance, generatedLabel);
              return;
            }

            activeWebviewRef.current = instance;
            activeLabelRef.current = generatedLabel;
            setWebviewReady(true);

            // 创建完成前 hidden 已翻成 true 的话，那次 hide 因句柄为空而丢失：这里按
            // 最新意图补上，否则这个表面会永远盖在 UI 上。
            if (latestHiddenRef.current) {
              instance
                .setPosition(new LogicalPosition(OFFSCREEN_POSITION, OFFSCREEN_POSITION))
                .catch(logVisibilityError);
            } else {
              syncPosition(instance);
            }

            observer = new ResizeObserver(() => {
              if (disposed) return;
              cancelAnimationFrame(rafId);
              rafId = requestAnimationFrame(() => syncPosition(instance));
            });
            observer.observe(container);
          });

          instance.once('tauri://error', (e: unknown) => {
            if (disposed || gen !== generationRef.current) return;
            const raw =
              typeof e === 'object' && e !== null && 'payload' in e
                ? (e as Record<string, unknown>).payload
                : e;
            const msg =
              raw instanceof Error
                ? raw.message
                : typeof raw === 'object' && raw !== null && 'message' in raw
                  ? String((raw as Record<string, unknown>).message)
                  : typeof raw === 'string'
                    ? raw
                    : String(raw);
            console.error('[BuiltInBrowser] webview error:', msg);
            // error 之后 Rust 侧可能仍持有这个表面：只置空 JS ref 会留下孤儿，
            // 必须显式关闭（close 失败再由 label 兜底）。
            void closeWebviewReliably(instance, generatedLabel);
            webview = null;
            activeWebviewRef.current = null;
            activeLabelRef.current = null;
            setWebviewError(msg);
          });
        },
      });
    }

    void create();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      // 关键顺序：先拿到句柄发起 close，再清 ref。若提前清空句柄，`new Webview(...)`
      // 之后、`tauri://created` 之前的卸载会让 created 回调误以为「没有句柄可关」，
      // 原生表面就此失去引用。
      const handle = webview;
      const labelToClose = label ?? activeLabelRef.current;
      void closeWebviewReliably(handle, labelToClose);
      activeWebviewRef.current = null;
      activeLabelRef.current = null;
    };
  }, [isTauri, enabled, activeUrl, refreshKey]);

  // ── 切 tab 不重建 webview 的优化：Tauri webview 仍然要重建，因为它绑定 url。
  // 已通过 activeUrl 依赖驱动。

  // ── Visibility toggle ───────────────────────────────────────────────
  useEffect(() => {
    if (!isTauri) return;
    const wv = activeWebviewRef.current;
    const dpi = tauriDpiRef.current;
    // 句柄 / DPI 尚未就绪（创建中）时什么都不做：created 回调会读 latestHiddenRef
    // 补上此刻的隐藏状态，因此这次 toggle 不会丢。
    if (!wv || !dpi) return;

    if (hidden) {
      wv.setPosition(new dpi.LogicalPosition(OFFSCREEN_POSITION, OFFSCREEN_POSITION)).catch(
        logVisibilityError,
      );
      return;
    }

    const container = containerRef.current;
    if (!container) return;
    const r = container.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      wv.setPosition(new dpi.LogicalPosition(r.x, r.y)).catch(logVisibilityError);
      wv.setSize(new dpi.LogicalSize(Math.max(r.width, 1), Math.max(r.height, 1))).catch(
        logVisibilityError,
      );
    }
  }, [isTauri, hidden, containerRef]);

  return { webviewReady, webviewError };
}
