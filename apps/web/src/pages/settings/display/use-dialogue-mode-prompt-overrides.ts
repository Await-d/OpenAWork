import { useCallback, useEffect, useRef, useState } from 'react';
import { createPromptOverridesClient } from '@openAwork/web-client';
import type { DialogueModePromptView } from '@openAwork/web-client';
import type { DialogueMode } from '@openAwork/shared';
import { logger } from '../../../utils/log/logger.js';

export type PromptOverrideLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseDialogueModePromptOverridesInput {
  gatewayUrl: string;
  token: string | null;
  /** 页面是否激活：非激活（keep-alive 缓存路由）时不发起请求。 */
  active: boolean;
}

export interface UseDialogueModePromptOverridesResult {
  status: PromptOverrideLoadStatus;
  errorMessage: string | null;
  modes: DialogueModePromptView[];
  maxChars: number;
  configState: 'ok' | 'corrupt';
  saving: boolean;
  feedback: string | null;
  reload: () => void;
  save: (mode: DialogueMode, text: string) => Promise<boolean>;
  reset: (mode: DialogueMode) => Promise<boolean>;
}

const FEEDBACK_CLEAR_MS = 4000;

/**
 * 动作包装：置状态 → try → 成功/失败分流 → finally 收尾。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持组件/hook 内联的 `try/catch` finally 子句，
 * 也不支持 try 内的值块。语义与 `use-memory-management.ts` 的同名辅助保持一致。
 */
async function runPromptOverrideActionOnce(ctx: {
  onStart: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onFinally: () => void;
  run: () => Promise<string>;
}): Promise<boolean> {
  ctx.onStart();
  try {
    const message = await ctx.run();
    ctx.onSuccess(message);
    return true;
  } catch (error) {
    ctx.onError(error instanceof Error ? error.message : '操作失败');
    return false;
  } finally {
    ctx.onFinally();
  }
}

function mergeModeView(
  list: DialogueModePromptView[],
  view: DialogueModePromptView,
): DialogueModePromptView[] {
  const index = list.findIndex((entry) => entry.mode === view.mode);
  if (index < 0) {
    return [...list, view];
  }
  const next = [...list];
  next[index] = view;
  return next;
}

/**
 * 模式提示词覆盖的读写状态。
 *
 * 取消门控：用自增 `revisionRef` 丢弃晚到的响应（切换网关/账号、快速重试），
 * 避免旧响应把新状态覆盖回去。
 */
export function useDialogueModePromptOverrides({
  gatewayUrl,
  token,
  active,
}: UseDialogueModePromptOverridesInput): UseDialogueModePromptOverridesResult {
  const [status, setStatus] = useState<PromptOverrideLoadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [modes, setModes] = useState<DialogueModePromptView[]>([]);
  const [maxChars, setMaxChars] = useState(0);
  const [configState, setConfigState] = useState<'ok' | 'corrupt'>('ok');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const revisionRef = useRef(0);

  const reload = useCallback(() => {
    if (!active || !token) {
      return;
    }
    const revision = revisionRef.current + 1;
    revisionRef.current = revision;
    const client = createPromptOverridesClient(gatewayUrl);
    setStatus('loading');
    setErrorMessage(null);
    void client
      .read(token)
      .then((snapshot) => {
        if (revisionRef.current !== revision) {
          return;
        }
        setModes(snapshot.modes);
        setMaxChars(snapshot.maxChars);
        setConfigState(snapshot.configState);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        // 取消门控必须同时覆盖 catch：卸载/换号后仍写日志会污染诊断。
        if (revisionRef.current !== revision) {
          return;
        }
        logger.warn('加载模式提示词配置失败', error);
        setErrorMessage(error instanceof Error ? error.message : '加载模式提示词配置失败');
        setStatus('error');
      });
  }, [active, gatewayUrl, token]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!feedback) {
      return;
    }
    const timer = window.setTimeout(() => setFeedback(null), FEEDBACK_CLEAR_MS);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const save = useCallback(
    async (mode: DialogueMode, text: string): Promise<boolean> => {
      if (!token) {
        return false;
      }
      const client = createPromptOverridesClient(gatewayUrl);
      return runPromptOverrideActionOnce({
        onStart: () => {
          setSaving(true);
          setFeedback(null);
          setErrorMessage(null);
        },
        onSuccess: (message) => setFeedback(message),
        onError: (message) => setErrorMessage(message),
        onFinally: () => setSaving(false),
        run: async () => {
          const revisionAtStart = revisionRef.current;
          const view = await client.writeDialogueMode(token, mode, text);
          // 并发门控：若响应到达前发生过重新加载（切换账号 / 网关 / 重试），
          // 晚到的视图不得写回，否则会把上一个账号的覆盖混进当前账号的状态
          //（去掉该判断的回归会失败于 `expected '账号 A 的覆盖' to be 'B-coding'`）。
          if (revisionRef.current === revisionAtStart) {
            setModes((current) => mergeModeView(current, view));
          }
          return '已保存模式提示词';
        },
      });
    },
    [gatewayUrl, token],
  );

  const reset = useCallback(
    async (mode: DialogueMode): Promise<boolean> => {
      if (!token) {
        return false;
      }
      const client = createPromptOverridesClient(gatewayUrl);
      return runPromptOverrideActionOnce({
        onStart: () => {
          setSaving(true);
          setFeedback(null);
          setErrorMessage(null);
        },
        onSuccess: (message) => setFeedback(message),
        onError: (message) => setErrorMessage(message),
        onFinally: () => setSaving(false),
        run: async () => {
          const revisionAtStart = revisionRef.current;
          const view = await client.resetDialogueMode(token, mode);
          if (revisionRef.current === revisionAtStart) {
            setModes((current) => mergeModeView(current, view));
          }
          return '已恢复该模式的默认提示词';
        },
      });
    },
    [gatewayUrl, token],
  );

  return {
    status,
    errorMessage,
    modes,
    maxChars,
    configState,
    saving,
    feedback,
    reload,
    save,
    reset,
  };
}
