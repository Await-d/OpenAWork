import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { BrandLogo } from '@openAwork/shared-ui';
import { isTauriRuntime } from '../../../utils/gateway/desktop-gateway.js';
import { listenTauriEvent, type UnlistenFn } from '../../../utils/tauri/tauri-events.js';
import { logger } from '../../../utils/log/logger.js';
import { tauriInvoke } from '../../../pages/settings/shared/settings-page-helpers.js';
import { AppDialog, DialogActionButton } from './AppDialog.js';

/** Rust 端在托盘菜单「关于 OpenAWork」被点击时 emit 的事件名（见 lib.rs 的 EVT_ABOUT_REQUESTED）。 */
const EVT_ABOUT_REQUESTED = 'tray:about';

/**
 * 把构建时间格式化为本地可读串。
 *
 * 构建时间来自打包时的 ISO 字符串，解析失败时原样展示（宁可显示原文也不要 'Invalid Date'）。
 */
function formatBuildTime(input: string): string {
  if (!input) return '未知';
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return input;
  return parsed.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 一行「标签 / 值」信息，值用等宽字体展示版本与哈希这类不可读性文本。 */
function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '72px 1fr',
        gap: 10,
        alignItems: 'baseline',
        padding: '7px 0',
        borderTop: '1px solid var(--border-subtle)',
      }}
    >
      <span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{label}</span>
      <span
        translate="no"
        style={{
          fontSize: 12.5,
          color: 'var(--fg-strong)',
          fontVariantNumeric: 'tabular-nums',
          fontFamily: mono
            ? 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)'
            : undefined,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * 「关于 OpenAWork」应用内弹窗。
 *
 * 取代原先的系统原生 `MessageDialog`：托盘菜单点击后 Rust 端 emit `tray:about`，
 * 这里渲染应用内弹窗。展示版本与构建信息，并把「完整信息」（构建信息、提交日志、
 * 更新检查）交给 `设置 → 关于` 页面——那里是唯一真正能跑通更新流程的地方。
 *
 * 行为约定与 `CloseConfirmDialog` 一致（外壳由 AppDialog 提供）：右上角 X / Esc /
 * 点击遮罩都只是收起弹窗，不做任何动作。
 *
 * 仅在 Tauri 桌面端渲染，浏览器环境直接返回 null。
 */
export function AboutDialog() {
  const desktopRuntime = isTauriRuntime();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // 与 CloseConfirmDialog 同样的顺序约束：监听注册成功后**才**告知 Rust 端就绪，
  // 否则 Rust 会把托盘动作交给一个还没挂上监听的应用内弹窗。
  useEffect(() => {
    if (!desktopRuntime) return;
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const fn = await listenTauriEvent<void>(EVT_ABOUT_REQUESTED, () => setOpen(true));
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
        await tauriInvoke('mark_dialog_host_ready', { channel: 'about' }).catch((err: unknown) => {
          logger.warn('mark_dialog_host_ready(about) failed', err);
        });
      } catch (err) {
        logger.error('listen tray:about failed', err);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [desktopRuntime]);

  const dismiss = useCallback(() => setOpen(false), []);

  const openFullAboutPage = useCallback(() => {
    setOpen(false);
    void navigate('/settings/about');
  }, [navigate]);

  if (!desktopRuntime || !open) return null;

  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '未知';
  const buildVersion = typeof __APP_BUILD_VERSION__ === 'string' ? __APP_BUILD_VERSION__ : '';
  const buildTime = formatBuildTime(
    typeof __APP_BUILD_TIME__ === 'string' ? __APP_BUILD_TIME__ : '',
  );
  const gitHash = typeof __APP_GIT_HASH__ === 'string' ? __APP_GIT_HASH__ : '';

  return (
    <AppDialog
      badge={
        <span
          aria-hidden
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent)',
          }}
        >
          <BrandLogo size={40} />
        </span>
      }
      title="关于 OpenAWork"
      description="跨平台 AI Agent 工作台"
      onDismiss={dismiss}
      maxWidth={432}
      footerLeft={
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          完整构建信息、提交日志与更新检查见「设置 → 关于」
        </span>
      }
      footerRight={
        <>
          <DialogActionButton variant="secondary" label="查看更多" onClick={openFullAboutPage} />
          <DialogActionButton variant="primary" label="确定" onClick={dismiss} />
        </>
      }
    >
      <div
        style={{
          borderRadius: 12,
          border: '1px solid var(--border-subtle)',
          background: 'color-mix(in srgb, var(--bg-surface) 55%, transparent)',
          padding: '2px 14px 8px',
        }}
      >
        <InfoRow label="版本号" value={`v${version}`} mono />
        {buildVersion ? <InfoRow label="构建版本" value={buildVersion} mono /> : null}
        <InfoRow label="构建时间" value={buildTime} />
        {gitHash ? <InfoRow label="Git 提交" value={gitHash} mono /> : null}
      </div>
      <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: 'var(--fg-muted)' }}>
        文件图标来自{' '}
        <a
          href="https://github.com/material-extensions/vscode-material-icon-theme"
          target="_blank"
          rel="noreferrer"
          style={{ color: 'var(--info)' }}
        >
          material-icon-theme
        </a>
        （MIT License）
      </p>
    </AppDialog>
  );
}
