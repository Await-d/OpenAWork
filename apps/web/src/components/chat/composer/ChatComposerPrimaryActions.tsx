import type { PromptOptimizerResult } from '@openAwork/web-client';
import { useEffect, useState } from 'react';
import type { ComposerOptimizeError } from './composer-optimize-error.js';

export type ComposerStopCapability = 'none' | 'precise' | 'best_effort' | 'observe_only';
export type ComposerBusyState = 'running' | 'paused' | null;

export interface ChatComposerPrimaryActionsProps {
  readonly input: string;
  readonly streaming: boolean;
  readonly imageGenerationMode: boolean;
  readonly imageGenerationBusy: boolean;
  readonly canSubmit: boolean;
  readonly stoppingStream: boolean;
  readonly sessionBusyState: ComposerBusyState;
  readonly effectiveStopCapability: ComposerStopCapability;
  readonly showStopAction: boolean;
  readonly showQueueAction: boolean;
  readonly queuedMessageCount: number;
  readonly optimizeError: ComposerOptimizeError | null;
  readonly optimizeLoading: boolean;
  readonly optimizeResult: PromptOptimizerResult | null;
  readonly onRunOptimizePrompt?: () => void;
  readonly onClearOptimizeResult: () => void;
  readonly onClearOptimizeError: () => void;
  readonly onQueueMessage?: () => void | Promise<void>;
  readonly onSend: () => void | Promise<void>;
  readonly onStop: () => void | Promise<void>;
}

export function ChatComposerPrimaryActions(props: ChatComposerPrimaryActionsProps) {
  return (
    <div className="composer-primary-actions">
      {props.onRunOptimizePrompt && props.input.trim().length > 0 && !props.streaming && (
        <OptimizeButton {...props} />
      )}
      {props.showQueueAction && (
        <button
          type="button"
          onClick={() => {
            void props.onQueueMessage?.();
          }}
          className="btn-accent composer-secondary-action"
        >
          <span>追加</span>
          <PlusIcon />
        </button>
      )}
      <span className="composer-status-copy">{getComposerStatusLabel(props)}</span>
      <SendStopButton {...props} />
    </div>
  );
}

function OptimizeButton(props: ChatComposerPrimaryActionsProps) {
  return (
    <button
      type="button"
      onClick={() => {
        if (props.optimizeResult) {
          props.onClearOptimizeResult();
          props.onClearOptimizeError();
          return;
        }
        props.onRunOptimizePrompt?.();
      }}
      disabled={props.optimizeLoading || !props.onRunOptimizePrompt}
      title={
        props.optimizeLoading
          ? '正在优化提示词…'
          : props.optimizeError?.retryable
            ? '重新尝试提示词优化'
            : '提示词优化'
      }
      aria-busy={props.optimizeLoading}
      className={`icon-btn composer-optimize-button${props.optimizeResult ? ' active' : ''}`}
    >
      {props.optimizeLoading ? <SpinnerIcon /> : <SparkleIcon />}
    </button>
  );
}

function SendStopButton(props: ChatComposerPrimaryActionsProps) {
  const [sendPulse, setSendPulse] = useTransientPulse();
  const disabled = getPrimaryButtonDisabled(props);

  return (
    <button
      type="button"
      onClick={() => {
        if (props.showStopAction) {
          void props.onStop();
          return;
        }
        setSendPulse();
        void props.onSend();
      }}
      disabled={disabled}
      className={`btn-accent composer-send-button${sendPulse ? ' composer-pulse' : ''}`}
      data-tone={getPrimaryButtonTone(props)}
    >
      <span>{getPrimaryButtonLabel(props)}</span>
      <SendStopIcon
        showStopAction={props.showStopAction}
        sessionBusyState={props.sessionBusyState}
      />
    </button>
  );
}

function getPrimaryButtonDisabled(props: ChatComposerPrimaryActionsProps): boolean {
  if (props.showStopAction) return props.stoppingStream;
  if (props.sessionBusyState) return true;
  return props.imageGenerationBusy || !props.canSubmit;
}

function getPrimaryButtonTone(props: ChatComposerPrimaryActionsProps): string {
  if (props.showStopAction) {
    if (props.effectiveStopCapability === 'observe_only') return 'warning';
    return props.effectiveStopCapability === 'best_effort' ? 'warning' : 'danger';
  }
  if (props.sessionBusyState === 'running') return 'running';
  if (props.sessionBusyState === 'paused') return 'warning';
  return 'accent';
}

function getPrimaryButtonLabel(props: ChatComposerPrimaryActionsProps): string {
  if (props.showStopAction) {
    if (props.stoppingStream) return '停止中';
    if (props.effectiveStopCapability === 'observe_only') return '尝试停止';
    return props.effectiveStopCapability === 'best_effort' ? '尝试停止' : '停止';
  }
  if (props.sessionBusyState === 'running') return '运行中';
  if (props.sessionBusyState === 'paused') return '待处理';
  return props.imageGenerationMode ? '生成' : '发送';
}

function getComposerStatusLabel(props: ChatComposerPrimaryActionsProps): string {
  if (props.showStopAction) {
    if (props.stoppingStream) return '正在停止…';
    if (props.streaming) return '正在生成… · Esc 停止';
    if (props.effectiveStopCapability === 'observe_only') {
      return '远端运行中 · 将尝试发送停止请求';
    }
    return props.effectiveStopCapability === 'best_effort'
      ? '当前页未接管原始请求 · 将尝试停止本会话的当前运行'
      : '当前运行流仍受此页控制 · 可直接停止';
  }
  if (props.showQueueAction) {
    return `Tab / Enter 可排队${props.queuedMessageCount > 0 ? ` · 已排队 ${props.queuedMessageCount} 条` : ''}`;
  }
  if (props.imageGenerationBusy) return '图片生成中 · 请等待结果返回';
  if (props.sessionBusyState === 'running') return '会话持续运行中 · 正在同步最新结果';
  if (props.sessionBusyState === 'paused') return '会话等待处理 · 处理后继续同步';
  return props.imageGenerationMode ? 'Enter 生成 · Shift+Enter 换行' : 'Enter 发送';
}

function useTransientPulse(): readonly [boolean, () => void] {
  const [sendPulse, setSendPulse] = useState(false);
  useEffect(() => {
    if (!sendPulse) return;
    const id = window.setTimeout(() => setSendPulse(false), 450);
    return () => window.clearTimeout(id);
  }, [sendPulse]);
  return [sendPulse, () => setSendPulse(true)];
}

function SpinnerIcon() {
  return <span aria-hidden="true" className="composer-spinner" />;
}

function SparkleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function SendStopIcon({
  showStopAction,
  sessionBusyState,
}: {
  readonly showStopAction: boolean;
  readonly sessionBusyState: ComposerBusyState;
}) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {showStopAction ? (
        <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
      ) : sessionBusyState ? (
        <>
          <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="2.5" />
          <path d="M12 8v4l2.5 1.5" stroke="currentColor" strokeWidth="2.5" />
        </>
      ) : (
        <>
          <path d="M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <path
            d="m12 5 7 7-7 7"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}
