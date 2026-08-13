/**
 * TeamInitModal · 团队会话「初始化阶段」弹窗
 *
 * 进入接待（reception）会话时，如果该会话还有未完成的初始化清单（teamInit.phase
 * 为 proposed / in_progress），自动弹出一个**明显的居中弹窗**提示用户先做前置准备。
 * 用户可以逐项确认 / 跳过 / 全部执行，或关闭弹窗稍后再说。
 *
 * 与内联清单的区别：弹窗保证「一进会话就看得到」，不依赖空态卡片是否渲染。
 * 共用 useTeamInitChecklist 的同一份状态与 TeamInitChecklistBody 的渲染。
 *
 * 自动弹出策略：
 *   - 每条会话只在「首次检测到有未完成清单」时自动弹一次（按 sessionId 记忆，
 *     用 sessionStorage，刷新后不重复打扰）。
 *   - 用户手动点「初始化准备」入口可随时重开。
 *   - phase 变为 completed / skipped 后不再弹。
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { isTeamInitFinished } from '@openAwork/shared';
import { useTeamInitChecklist } from './use-team-init-checklist.js';
import { TeamInitChecklistBody } from './TeamInitChecklist.js';

export interface TeamInitModalProps {
  sessionId: string;
  sessionMetadata?: Record<string, unknown> | null;
}

const OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'grid',
  placeItems: 'center',
  background: 'color-mix(in srgb, var(--bg-base) 55%, transparent)',
  backdropFilter: 'blur(2px)',
  padding: 24,
};

const MODAL_STYLE: CSSProperties = {
  width: 'min(620px, 94vw)',
  maxHeight: '86vh',
  overflow: 'auto',
  borderRadius: 16,
  border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
  background: 'var(--bg-base)',
  boxShadow: 'var(--shadow-lg)',
  padding: 18,
  display: 'grid',
  gap: 12,
};

const MODAL_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
};

const CLOSE_BTN_STYLE: CSSProperties = {
  flexShrink: 0,
  width: 28,
  height: 28,
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-muted)',
  fontSize: 14,
  cursor: 'pointer',
  lineHeight: 1,
};

const REOPEN_BANNER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexShrink: 0,
  padding: '10px 14px',
  borderRadius: 12,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-raised)',
  boxShadow: 'var(--shadow-md)',
  margin: '10px 12px 2px',
};

const REOPEN_BANNER_TITLE_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: 'var(--fg-strong)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const REOPEN_BANNER_SUB_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-muted)',
  marginTop: 2,
};

const REOPEN_BANNER_BTN_STYLE: CSSProperties = {
  flexShrink: 0,
  padding: '6px 16px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--accent) 50%, transparent)',
  background: 'var(--accent)',
  color: 'var(--bg-base)',
  fontSize: 12,
  fontWeight: 800,
  cursor: 'pointer',
};

const REOPEN_PROGRESS_PILL_STYLE: CSSProperties = {
  flexShrink: 0,
  fontSize: 10,
  fontWeight: 700,
  padding: '2px 8px',
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--accent) 16%, transparent)',
  color: 'var(--accent)',
};

function autoOpenKey(sessionId: string): string {
  return `teamInit.autoOpened.${sessionId}`;
}

export function TeamInitModal({ sessionId, sessionMetadata }: TeamInitModalProps) {
  const checklist = useTeamInitChecklist({ sessionId, sessionMetadata });
  const { teamInit, finished } = checklist;
  const hasPlan = Boolean(teamInit) && !finished;

  const [open, setOpen] = useState(false);
  const autoOpenedRef = useRef(false);
  const lastSessionRef = useRef<string | null>(null);

  // 切换会话时重置自动弹出标记（让另一条会话也能自动弹）。
  // 注意：用 ref 比对而非 useEffect([sessionId])，避免与下方自动弹出 effect 在
  // 首次挂载时竞争执行顺序（reset effect 会把刚 setOpen(true) 清回 false）。
  if (lastSessionRef.current !== sessionId) {
    lastSessionRef.current = sessionId;
    autoOpenedRef.current = false;
  }

  // 首次检测到「有未完成清单」时自动弹一次（按 session 记忆，避免反复打扰）。
  useEffect(() => {
    if (!hasPlan || autoOpenedRef.current) return;
    let alreadyAutoOpened = false;
    try {
      alreadyAutoOpened = sessionStorage.getItem(autoOpenKey(sessionId)) === '1';
    } catch {
      alreadyAutoOpened = false;
    }
    if (!alreadyAutoOpened) {
      setOpen(true);
      autoOpenedRef.current = true;
      try {
        sessionStorage.setItem(autoOpenKey(sessionId), '1');
      } catch {
        // sessionStorage 不可用时忽略——大不了下次进会话再弹。
      }
    }
  }, [hasPlan, sessionId]);

  // 切换会话时关闭上一条会话残留的弹窗。
  const prevSessionForCloseRef = useRef(sessionId);
  useEffect(() => {
    if (prevSessionForCloseRef.current !== sessionId) {
      prevSessionForCloseRef.current = sessionId;
      setOpen(false);
    }
  }, [sessionId]);

  // ESC 关闭。
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!hasPlan || !teamInit) {
    // 没有未完成清单 → 既不显示重开入口，也不弹窗。
    return null;
  }

  const actionableSteps = teamInit.steps.filter((step) => step.status !== 'not_applicable');
  const doneCount = actionableSteps.filter(
    (step) => step.status === 'done' || step.status === 'skipped',
  ).length;
  const total = actionableSteps.length;
  const failedCount = actionableSteps.filter((step) => step.status === 'failed').length;

  return (
    <>
      {/* 关闭弹窗后常驻的明显提示横幅——保证用户随时能回到初始化准备。 */}
      {!open ? (
        <div style={REOPEN_BANNER_STYLE} role="status">
          <span aria-hidden style={{ fontSize: 16 }}>
            🧭
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={REOPEN_BANNER_TITLE_STYLE}>
              团队初始化准备未完成
              <span style={REOPEN_PROGRESS_PILL_STYLE}>
                {doneCount}/{total}
              </span>
              {failedCount > 0 ? (
                <span
                  style={{
                    ...REOPEN_PROGRESS_PILL_STYLE,
                    background: 'color-mix(in srgb, var(--danger) 16%, transparent)',
                    color: 'var(--danger)',
                  }}
                >
                  {failedCount} 项失败
                </span>
              ) : null}
            </div>
            <div style={REOPEN_BANNER_SUB_STYLE}>
              建议先完成前置准备，让团队更懂你的项目。也可直接提需求跳过。
            </div>
          </div>
          <button type="button" style={REOPEN_BANNER_BTN_STYLE} onClick={() => setOpen(true)}>
            查看 / 继续
          </button>
        </div>
      ) : null}

      {open
        ? createPortal(
            <div
              style={OVERLAY_STYLE}
              role="presentation"
              onClick={(e) => {
                if (e.target === e.currentTarget) setOpen(false);
              }}
            >
              <div style={MODAL_STYLE} role="dialog" aria-modal="true" aria-label="团队初始化准备">
                <div style={MODAL_HEADER_STYLE}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--fg-strong)' }}>
                      开始前的初始化准备
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--fg-muted)',
                        lineHeight: 1.5,
                        marginTop: 4,
                      }}
                    >
                      为了让团队更懂你的项目，建议先完成下列前置准备。每一步都由你确认后执行。
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="关闭"
                    style={CLOSE_BTN_STYLE}
                    onClick={() => setOpen(false)}
                  >
                    ✕
                  </button>
                </div>

                <TeamInitChecklistBody checklist={checklist} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
