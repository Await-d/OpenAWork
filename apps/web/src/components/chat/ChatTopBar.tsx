import DialogueModeToggle from '../../pages/DialogueModeToggle.js';
import type { DialogueMode } from '../../pages/dialogue-mode.js';
import { ContextUsageMeter } from './context-usage-meter.js';

interface ChatTopBarProps {
  agentOptions: Array<{ id: string; label: string }>;
  dialogueMode: DialogueMode;
  defaultAgentLabel: string;
  currentProfileLabel?: string;
  hasWorkspaceProfile: boolean;
  manualAgentId: string;
  toolSurfaceProfile: 'openawork' | 'claude_code_default' | 'claude_code_simple';
  onChangeDialogueMode: (mode: DialogueMode) => void;
  onChangeManualAgentId: (agentId: string) => void;
  onChangeToolSurfaceProfile: (
    profile: 'openawork' | 'claude_code_default' | 'claude_code_simple',
  ) => void;
  onClearManualAgentId: () => void;
  onSaveWorkspaceProfile: () => void;
  yoloMode: boolean;
  onToggleYolo: () => void;
  editorMode: boolean;
  onToggleEditorMode: () => void;
  rightOpen: boolean;
  onToggleRightOpen: () => void;
  contextUsedTokens?: number;
  contextMaxTokens?: number;
  contextIsEstimated?: boolean;
}

export function ChatTopBar({
  agentOptions,
  dialogueMode,
  defaultAgentLabel,
  currentProfileLabel,
  hasWorkspaceProfile,
  manualAgentId,
  toolSurfaceProfile,
  onChangeDialogueMode,
  onChangeManualAgentId,
  onChangeToolSurfaceProfile,
  onClearManualAgentId,
  onSaveWorkspaceProfile,
  yoloMode,
  onToggleYolo,
  editorMode,
  onToggleEditorMode,
  rightOpen,
  onToggleRightOpen,
  contextUsedTokens,
  contextMaxTokens,
  contextIsEstimated,
}: ChatTopBarProps) {
  const showContextMeter =
    contextUsedTokens != null && contextMaxTokens != null && contextMaxTokens > 0;
  return (
    <div
      data-testid="chat-controls-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        flexWrap: 'wrap',
        padding: '6px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
        background: 'var(--header-bg)',
        minHeight: 44,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
          flex: '1 1 420px',
          flexWrap: 'wrap',
        }}
      >
        <DialogueModeToggle
          mode={dialogueMode}
          onChange={onChangeDialogueMode}
          style={{ flexShrink: 0 }}
        />
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 6px',
            borderRadius: 10,
            border: '1px solid var(--border-subtle)',
            background: 'color-mix(in oklch, var(--surface) 84%, transparent)',
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>代理</span>
          <select
            aria-label="聊天代理"
            value={manualAgentId || '__mode_default__'}
            onChange={(event) => {
              const nextValue = event.target.value;
              onChangeManualAgentId(nextValue === '__mode_default__' ? '' : nextValue);
            }}
            style={{
              minWidth: 190,
              height: 30,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--surface)',
              color: 'var(--text-1)',
              fontSize: 12,
              padding: '0 8px',
            }}
          >
            <option value="__mode_default__">默认代理：{defaultAgentLabel}</option>
            {agentOptions.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.label}
              </option>
            ))}
          </select>
          {manualAgentId ? (
            <button
              type="button"
              onClick={onClearManualAgentId}
              aria-label="清除代理覆盖"
              title="清除手动代理覆盖，恢复模式默认代理"
              style={{
                height: 28,
                padding: '0 8px',
                borderRadius: 7,
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                color: 'var(--text-2)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              恢复默认
            </button>
          ) : null}
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 6px',
            borderRadius: 10,
            border: '1px solid var(--border-subtle)',
            background: 'color-mix(in oklch, var(--surface) 84%, transparent)',
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>配置</span>
          <select
            aria-label="工具配置档"
            value={toolSurfaceProfile}
            onChange={(event) =>
              onChangeToolSurfaceProfile(
                event.target.value as 'openawork' | 'claude_code_default' | 'claude_code_simple',
              )
            }
            style={{
              minWidth: 168,
              height: 30,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--surface)',
              color: 'var(--text-1)',
              fontSize: 12,
              padding: '0 8px',
            }}
          >
            <option value="openawork">OpenAWork 全功能</option>
            <option value="claude_code_default">Claude Code 默认</option>
            <option value="claude_code_simple">Claude Code 精简</option>
          </select>
        </div>
        {currentProfileLabel !== undefined ? (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 6px',
              borderRadius: 10,
              border: '1px solid var(--border-subtle)',
              background: 'color-mix(in oklch, var(--surface) 84%, transparent)',
            }}
          >
            <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>项目配置</span>
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{currentProfileLabel}</span>
            <button
              type="button"
              onClick={onSaveWorkspaceProfile}
              style={{
                height: 28,
                padding: '0 8px',
                borderRadius: 7,
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                color: 'var(--text)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {hasWorkspaceProfile ? '更新项目配置' : '保存为项目配置'}
            </button>
          </div>
        ) : null}
      </div>

      {/* Right group: YOLO + editor + panel — unified pill container */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          marginLeft: 'auto',
          flexShrink: 0,
          padding: '2px 3px',
          borderRadius: 8,
          background: 'color-mix(in oklch, var(--surface) 80%, transparent)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        {showContextMeter ? (
          <>
            <ContextUsageMeter
              usedTokens={contextUsedTokens}
              maxTokens={contextMaxTokens}
              estimated={contextIsEstimated}
            />
            <div
              aria-hidden="true"
              style={{
                width: 1,
                height: 14,
                background: 'var(--border-subtle)',
                flexShrink: 0,
              }}
            />
          </>
        ) : null}
        <button
          type="button"
          aria-pressed={yoloMode}
          onClick={onToggleYolo}
          title="YOLO 模式：更少确认、直达结果"
          style={{
            height: 26,
            padding: '0 8px',
            borderRadius: 5,
            border: 'none',
            background: yoloMode ? 'var(--accent)' : 'transparent',
            color: yoloMode ? 'var(--accent-text)' : 'var(--text-3)',
            fontSize: 10,
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0,
            letterSpacing: '0.04em',
          }}
        >
          YOLO
        </button>
        <button
          type="button"
          onClick={onToggleEditorMode}
          title={editorMode ? '关闭编辑器' : '打开文件编辑器'}
          className={`icon-btn${editorMode ? ' active' : ''}`}
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg
            aria-hidden="true"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onToggleRightOpen}
          title={rightOpen ? '收起面板' : '展开面板'}
          className={`icon-btn${rightOpen ? ' active' : ''}`}
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg
            aria-hidden="true"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </button>
      </div>
    </div>
  );
}
