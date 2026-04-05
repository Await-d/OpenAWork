import { useMemo } from 'react';
import { useAuthStore } from '../../stores/auth.js';
import { CompanionVisualShowcase } from '../../components/chat/companion/companion-visual-showcase.js';
import { BuddyAgentBindingPanel } from './buddy-agent-binding-panel.js';
import { useBuddyVoicePreferences } from '../../components/chat/companion/use-buddy-voice-preferences.js';
import { useBuddyAgentBindingManager } from './use-buddy-agent-binding-manager.js';
import { BP, IS, SS, ST } from './settings-section-styles.js';

function ToggleRow({
  checked,
  description,
  label,
  onToggle,
}: {
  checked: boolean;
  description: string;
  label: string;
  onToggle: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        border: '1px solid var(--border-subtle)',
        borderRadius: 10,
        padding: '10px 12px',
        background: 'color-mix(in oklch, var(--surface) 92%, transparent)',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        <div style={{ marginTop: 3, fontSize: 11, lineHeight: 1.5, color: 'var(--text-3)' }}>
          {description}
        </div>
      </div>
      <button
        type="button"
        aria-label={label}
        aria-pressed={checked}
        onClick={onToggle}
        style={{
          position: 'relative',
          width: 42,
          height: 24,
          borderRadius: 999,
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          background: checked ? 'var(--accent)' : 'var(--border)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 20 : 2,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: 'var(--surface)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
            transition: 'left 180ms ease',
          }}
        />
      </button>
    </div>
  );
}

export function CompanionTabContent() {
  const email = useAuthStore((state) => state.email) ?? 'guest';
  const { agentError, agentLoading, agentOptions, selectedAgentId, setSelectedAgentId } =
    useBuddyAgentBindingManager();
  const {
    activeBinding,
    bindings,
    companionFeatureMode,
    enabled,
    injectionMode,
    isCompanionFeatureEnabled,
    muted,
    profile,
    quietMode,
    reducedMotion,
    syncStatus,
    syncStatusLabel,
    setEnabled,
    setInjectionMode,
    setMuted,
    setQuietMode,
    setReducedMotion,
    setVoiceOutputEnabled,
    saveAgentBinding,
    removeAgentBinding,
    voiceOutputEnabled,
  } = useBuddyVoicePreferences(email, selectedAgentId || undefined);

  const statusLabel = useMemo(() => {
    if (!isCompanionFeatureEnabled) {
      return '已关闭';
    }
    return companionFeatureMode === 'ga' ? '已启用' : 'Beta';
  }, [companionFeatureMode, isCompanionFeatureEnabled]);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section style={SS}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 0, flex: '1 1 280px' }}>
            <div style={ST}>Buddy 伴侣</div>
            <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
              在聊天工作台里保留一个低打扰陪跑层
            </div>
            <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.7, color: 'var(--text-2)' }}>
              这里控制 companion 的主开关、注入策略和交互强度。关闭后，Chat 页不再显示
              Buddy，模型侧也不会继续注入 companion 上下文。
            </div>
          </div>
          <div
            style={{
              minWidth: 180,
              borderRadius: 12,
              border: '1px solid var(--border)',
              padding: '12px 14px',
              background: 'color-mix(in oklch, var(--surface) 94%, var(--bg) 6%)',
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-3)',
              }}
            >
              当前状态
            </div>
            <div
              aria-live="polite"
              style={{
                marginTop: 8,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
                {statusLabel}
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  minHeight: 22,
                  padding: '0 8px',
                  borderRadius: 999,
                  background:
                    syncStatus === 'error'
                      ? 'color-mix(in oklch, var(--danger) 14%, var(--surface))'
                      : syncStatus === 'saving'
                        ? 'color-mix(in oklch, var(--accent) 14%, var(--surface))'
                        : 'color-mix(in oklch, var(--surface-hover) 80%, var(--surface))',
                  color: syncStatus === 'error' ? 'var(--danger)' : 'var(--text-2)',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {syncStatusLabel}
              </span>
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
              主控制会在你切换开关后的约 0.5 秒内自动同步；Agent 绑定需要在下方手动保存。
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-3)' }}>
              Companion prompt 与 Chat 页舞台都会跟随这里的状态变化。
            </div>
            {profile ? (
              <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.6, color: 'var(--text-2)' }}>
                {profile.name} · {profile.species}
              </div>
            ) : null}
            {activeBinding?.behaviorTone ? (
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-3)' }}>
                当前绑定风格：{activeBinding.behaviorTone}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section style={SS}>
        <div style={ST}>主控制</div>
        <ToggleRow
          checked={enabled}
          label="启用 Buddy 伴侣"
          description="关闭后，聊天页隐藏 Buddy，request-scoped companion prompt 也会停用。"
          onToggle={() => setEnabled((value) => !value)}
        />
        <ToggleRow
          checked={voiceOutputEnabled}
          label="启用本地播报"
          description="允许 Buddy 在关键短句上用本地 TTS 出声；不影响主开关。"
          onToggle={() => setVoiceOutputEnabled((value) => !value)}
        />
        <ToggleRow
          checked={muted}
          label="静音 Buddy"
          description="保留面板与 companion prompt，但阻止当前设备的可听播报。"
          onToggle={() => setMuted((value) => !value)}
        />
        <ToggleRow
          checked={quietMode}
          label="安静模式"
          description="减少环境提示与主动表达，只保留更克制的陪跑反馈。"
          onToggle={() => setQuietMode((value) => !value)}
        />
        <ToggleRow
          checked={reducedMotion}
          label="减少动效"
          description="在 Chat 页 companion shell 中降低动画强度，适合长时间停留。"
          onToggle={() => setReducedMotion((value) => !value)}
        />
      </section>

      <section style={SS}>
        <div style={ST}>注入策略</div>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
            模型提示注入模式
          </span>
          <select
            aria-label="Buddy 注入模式"
            value={injectionMode}
            onChange={(event) => {
              const value = event.target.value;
              setInjectionMode(
                value === 'off' || value === 'always' || value === 'mention_only'
                  ? value
                  : 'mention_only',
              );
            }}
            style={IS}
          >
            <option value="off">关闭注入</option>
            <option value="mention_only">仅 /buddy 显式点名时注入</option>
            <option value="always">始终注入 companion 上下文</option>
          </select>
        </label>
        <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--text-3)' }}>
          推荐保留为“仅 /buddy 显式点名时注入”。这样 Buddy
          在工作台里常驻可见，但只有你明确叫它时才会进入本轮模型上下文。
        </div>
      </section>

      <BuddyAgentBindingPanel
        agentError={agentError}
        agentLoading={agentLoading}
        agentOptions={agentOptions}
        bindings={bindings}
        previewProfile={profile}
        selectedAgentId={selectedAgentId}
        syncStatusLabel={syncStatusLabel}
        onRemoveBinding={removeAgentBinding}
        onSaveBinding={saveAgentBinding}
        onSelectAgentId={setSelectedAgentId}
      />

      <section style={SS}>
        <div style={ST}>当前 Persona</div>
        {profile ? (
          <>
            <CompanionVisualShowcase
              profile={profile}
              reducedMotion={reducedMotion}
              seedBase={email}
            />
            <button type="button" style={BP} onClick={() => setEnabled(true)}>
              保持这个 Persona 在线
            </button>
          </>
        ) : (
          <div
            aria-live="polite"
            style={{
              borderRadius: 14,
              border: '1px solid var(--border-subtle)',
              padding: '14px 16px',
              background: 'color-mix(in oklch, var(--surface) 92%, transparent)',
              display: 'grid',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              {syncStatus === 'loading'
                ? '正在读取 Persona 预览…'
                : syncStatus === 'error'
                  ? '暂时拿不到 Persona 预览'
                  : '当前还没有可展示的 Persona'}
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--text-2)' }}>
              {syncStatus === 'loading'
                ? '正在同步远端 companion 设置，预览会在读取完成后自动出现。'
                : syncStatus === 'error'
                  ? '这不影响你继续调整主控制和 Agent 绑定；切换 Agent 或稍后重新进入页面后会再次读取。'
                  : 'Buddy 当前仍可按默认配置工作；当远端返回 companion profile 后，这里会自动补齐预览。'}
            </div>
            {!enabled ? (
              <button type="button" style={BP} onClick={() => setEnabled(true)}>
                先启用 Buddy 伴侣
              </button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
