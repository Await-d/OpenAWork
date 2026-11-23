import { useEffect, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type { DialogueMode } from '@openAwork/shared';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { DIALOGUE_MODE_OPTIONS } from '../../../pages/chat-page/mode/dialogue-mode.js';
import { BS_GHOST, SS, ST } from '../shared/settings-section-styles.js';
import { useDialogueModePromptOverrides } from './use-dialogue-mode-prompt-overrides.js';

const HINT: CSSProperties = {
  margin: '0 0 12px',
  fontSize: 12,
  lineHeight: 1.6,
  color: 'var(--fg-muted)',
};

const LIST: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const CARD: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  padding: '12px 14px',
};

const CARD_HEAD: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const CARD_TITLE: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--fg-strong)',
};

const BADGE: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-subtle)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 999,
  padding: '1px 8px',
};

const TEXTAREA: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 140,
  resize: 'vertical',
  borderRadius: 6,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)',
  color: 'var(--fg-default)',
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: 12,
  lineHeight: 1.6,
  padding: '8px 10px',
};

const CARD_FOOT: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const COUNTER: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-subtle)',
  marginRight: 'auto',
};

const COUNTER_OVER: CSSProperties = {
  ...COUNTER,
  color: 'var(--danger)',
};

const NOTICE: CSSProperties = {
  margin: '0 0 12px',
  fontSize: 12,
  color: 'var(--fg-muted)',
};

const NOTICE_WARN: CSSProperties = {
  ...NOTICE,
  color: 'var(--danger)',
};

function modeLabel(mode: DialogueMode): string {
  return DIALOGUE_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}

/**
 * 对话模式提示词的用户级覆盖编辑器。
 *
 * 挂载在设置页「显示」tab 内，作为独立 section —— 父文件只做薄挂载，
 * 避免把数据获取与草稿状态继续堆进过大的 `display-tab-content.tsx`。
 */
export function DialogueModePromptOverridesSection(): ReactElement {
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const {
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
  } = useDialogueModePromptOverrides({ active: true, gatewayUrl, token: accessToken });
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // 草稿以「有效值」为起点；已存在的草稿保留，避免父层刷新把用户正在编辑的内容冲掉。
  useEffect(() => {
    setDrafts((current) => {
      const next: Record<string, string> = {};
      for (const view of modes) {
        next[view.mode] = current[view.mode] ?? view.effectiveText;
      }
      return next;
    });
  }, [modes]);

  function handleDraftChange(mode: DialogueMode, value: string) {
    setDrafts((current) => ({ ...current, [mode]: value }));
  }

  async function handleSave(mode: DialogueMode, text: string) {
    await save(mode, text);
  }

  async function handleReset(mode: DialogueMode) {
    const ok = await reset(mode);
    if (!ok) {
      return;
    }
    // 清掉草稿，让 effect 用服务端返回的默认值重新填充。
    setDrafts((current) => {
      const next = { ...current };
      delete next[mode];
      return next;
    });
  }

  return (
    <section style={SS}>
      <h3 style={ST}>模式提示词</h3>
      <p style={HINT}>
        修改后对后续请求生效（正在进行的对话不受影响）。当前会话若已绑定显式 Agent，则只注入该 Agent
        的提示词，模式提示词不会额外注入。模式提示词位于系统提示的稳定前缀，
        内容越长，每轮请求的缓存成本越高。
      </p>
      {configState === 'corrupt' ? (
        <p style={NOTICE_WARN}>
          检测到无法解析的历史配置，当前已按默认值运行。保存或恢复任一项即可重建配置。
        </p>
      ) : null}
      {status === 'loading' ? <p style={NOTICE}>正在读取模式提示词…</p> : null}
      {status === 'error' && errorMessage ? (
        <p style={NOTICE_WARN}>
          {errorMessage}
          <button type="button" onClick={reload} style={{ ...BS_GHOST, marginLeft: 8 }}>
            重试
          </button>
        </p>
      ) : null}
      {feedback ? <p style={NOTICE}>{feedback}</p> : null}

      <div style={LIST}>
        {modes.map((view) => {
          const draft = drafts[view.mode] ?? view.effectiveText;
          const overLimit = maxChars > 0 && draft.length > maxChars;
          const isEmpty = draft.trim().length === 0;
          // 未编辑（草稿逐字等于当前生效值）时禁用保存：初值就是默认值，此时提交会把
          // 默认文本当成「已覆盖」落库（hasOverride 由 false 变 true），既污染覆盖状态，
          // 又让后续默认值升级不再生效。已覆盖时重复保存同一文本同样无意义，一并禁用。
          const isUnchanged = draft === view.effectiveText;
          return (
            <div key={view.mode} style={CARD}>
              <div style={CARD_HEAD}>
                <span style={CARD_TITLE}>{modeLabel(view.mode)}</span>
                <span style={BADGE}>{view.hasOverride ? '已覆盖' : '使用默认'}</span>
              </div>
              <textarea
                aria-label={`${modeLabel(view.mode)}模式提示词`}
                value={draft}
                onChange={(event) => handleDraftChange(view.mode, event.target.value)}
                rows={8}
                spellCheck={false}
                style={TEXTAREA}
              />
              <div style={CARD_FOOT}>
                <span style={overLimit ? COUNTER_OVER : COUNTER}>
                  {draft.length}
                  {maxChars > 0 ? ` / ${maxChars}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void handleSave(view.mode, draft);
                  }}
                  disabled={saving || isEmpty || overLimit || isUnchanged}
                  style={BS_GHOST}
                >
                  保存
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleReset(view.mode);
                  }}
                  disabled={saving || (!view.hasOverride && configState !== 'corrupt')}
                  style={BS_GHOST}
                >
                  恢复默认
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
