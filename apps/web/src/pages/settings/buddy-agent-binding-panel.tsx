import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type {
  CompanionAgentBinding,
  CompanionBehaviorTone,
  CompanionInjectionMode,
  CompanionThemeVariant,
  CompanionVerbosity,
  CompanionVoiceOutputMode,
  CompanionVoiceVariant,
} from '@openAwork/shared';
import type { CompanionProfile } from '../../components/chat/companion/companion-display-model.js';
import {
  SPRITE_SPECIES,
  spriteDisplayLabel,
  type CompanionSpriteSpecies,
} from '../../components/chat/companion/companion-sprite-model.js';
import type { BuddyAgentBindings } from '../../components/chat/companion/use-buddy-voice-preferences.js';
import type { BuddyAgentOption } from './use-buddy-agent-binding-manager.js';
import { BP, IS, SS, ST } from './settings-section-styles.js';

interface BuddyAgentBindingPanelProps {
  agentError: string | null;
  agentLoading: boolean;
  agentOptions: BuddyAgentOption[];
  bindings: BuddyAgentBindings;
  previewProfile: CompanionProfile | null;
  selectedAgentId: string;
  syncStatusLabel: string;
  onRemoveBinding: (agentId: string) => Promise<void>;
  onSaveBinding: (agentId: string, binding: CompanionAgentBinding) => Promise<void>;
  onSelectAgentId: (agentId: string) => void;
}

const THEME_OPTIONS: Array<{ label: string; value: CompanionThemeVariant }> = [
  { label: '默认主题', value: 'default' },
  { label: '活泼主题', value: 'playful' },
];

const TONE_OPTIONS: Array<{ label: string; value: CompanionBehaviorTone }> = [
  { label: '支持型', value: 'supportive' },
  { label: '聚焦型', value: 'focused' },
  { label: '轻快型', value: 'playful' },
];

const INJECTION_OPTIONS: Array<{ label: string; value: '' | CompanionInjectionMode }> = [
  { label: '继承全局', value: '' },
  { label: '关闭注入', value: 'off' },
  { label: '仅 /buddy 点名', value: 'mention_only' },
  { label: '始终注入', value: 'always' },
];

const VERBOSITY_OPTIONS: Array<{ label: string; value: '' | CompanionVerbosity }> = [
  { label: '继承全局', value: '' },
  { label: '极简', value: 'minimal' },
  { label: '正常', value: 'normal' },
];

const VOICE_MODE_OPTIONS: Array<{ label: string; value: '' | CompanionVoiceOutputMode }> = [
  { label: '继承全局', value: '' },
  { label: '关闭播报', value: 'off' },
  { label: '正常播报', value: 'buddy_only' },
  { label: '仅重点提醒', value: 'important_only' },
];

const VOICE_VARIANT_OPTIONS: Array<{ label: string; value: '' | CompanionVoiceVariant }> = [
  { label: '继承全局', value: '' },
  { label: '系统默认', value: 'system' },
  { label: '明亮', value: 'bright' },
  { label: '沉静', value: 'calm' },
];

const QUIET_BUTTON: CSSProperties = {
  height: 34,
  padding: '0 12px',
  borderRadius: 10,
  border: '1px solid var(--border-subtle)',
  background: 'transparent',
  color: 'var(--text-2)',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};

const FIELD_GROUP: CSSProperties = {
  display: 'grid',
  gap: 12,
  borderRadius: 14,
  border: '1px solid var(--border-subtle)',
  padding: '14px 16px',
  background: 'color-mix(in oklch, var(--surface) 92%, transparent)',
};

const SUMMARY_PILL: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 24,
  padding: '0 10px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.02em',
};

function createDraftSnapshot(input: {
  behaviorTone: CompanionBehaviorTone;
  displayName: string;
  injectionMode: '' | CompanionInjectionMode;
  species: CompanionSpriteSpecies;
  themeVariant: CompanionThemeVariant;
  verbosity: '' | CompanionVerbosity;
  voiceOutputMode: '' | CompanionVoiceOutputMode;
  voiceRateInput: string;
  voiceVariant: '' | CompanionVoiceVariant;
}) {
  return JSON.stringify({
    behaviorTone: input.behaviorTone,
    displayName: input.displayName.trim(),
    injectionMode: input.injectionMode,
    species: input.species,
    themeVariant: input.themeVariant,
    verbosity: input.verbosity,
    voiceOutputMode: input.voiceOutputMode,
    voiceRateInput: input.voiceRateInput.trim(),
    voiceVariant: input.voiceVariant,
  });
}

export function BuddyAgentBindingPanel({
  agentError,
  agentLoading,
  agentOptions,
  bindings,
  previewProfile,
  selectedAgentId,
  syncStatusLabel,
  onRemoveBinding,
  onSaveBinding,
  onSelectAgentId,
}: BuddyAgentBindingPanelProps) {
  const selectedBinding = selectedAgentId ? bindings[selectedAgentId] : undefined;
  const [species, setSpecies] = useState<CompanionSpriteSpecies>('duck');
  const [themeVariant, setThemeVariant] = useState<CompanionThemeVariant>('default');
  const [displayName, setDisplayName] = useState('');
  const [behaviorTone, setBehaviorTone] = useState<CompanionBehaviorTone>('focused');
  const [injectionMode, setInjectionMode] = useState<'' | CompanionInjectionMode>('');
  const [verbosity, setVerbosity] = useState<'' | CompanionVerbosity>('');
  const [voiceOutputMode, setVoiceOutputMode] = useState<'' | CompanionVoiceOutputMode>('');
  const [voiceVariant, setVoiceVariant] = useState<'' | CompanionVoiceVariant>('');
  const [voiceRateInput, setVoiceRateInput] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const lastHydratedAgentIdRef = useRef<string>('');
  const lastHydratedSnapshotRef = useRef<string>('');
  const pendingHydrationRef = useRef(false);

  const hydrateDraftFromBinding = useCallback((binding: CompanionAgentBinding | undefined) => {
    setSpecies((binding?.species as CompanionSpriteSpecies | undefined) ?? 'duck');
    setThemeVariant(binding?.themeVariant ?? 'default');
    setDisplayName(binding?.displayName ?? '');
    setBehaviorTone(binding?.behaviorTone ?? 'focused');
    setInjectionMode(binding?.injectionMode ?? '');
    setVerbosity(binding?.verbosity ?? '');
    setVoiceOutputMode(binding?.voiceOutputMode ?? '');
    setVoiceVariant(binding?.voiceVariant ?? '');
    setVoiceRateInput(typeof binding?.voiceRate === 'number' ? String(binding.voiceRate) : '');
    setSubmitError(null);
  }, []);

  const selectedAgentLabel = useMemo(
    () => agentOptions.find((agent) => agent.id === selectedAgentId)?.label ?? selectedAgentId,
    [agentOptions, selectedAgentId],
  );
  const boundAgentOptions = useMemo(
    () => agentOptions.filter((agent) => bindings[agent.id]),
    [agentOptions, bindings],
  );
  const savedDraftSnapshot = useMemo(
    () =>
      createDraftSnapshot({
        behaviorTone: selectedBinding?.behaviorTone ?? 'focused',
        displayName: selectedBinding?.displayName ?? '',
        injectionMode: selectedBinding?.injectionMode ?? '',
        species: (selectedBinding?.species as CompanionSpriteSpecies | undefined) ?? 'duck',
        themeVariant: selectedBinding?.themeVariant ?? 'default',
        verbosity: selectedBinding?.verbosity ?? '',
        voiceOutputMode: selectedBinding?.voiceOutputMode ?? '',
        voiceRateInput:
          typeof selectedBinding?.voiceRate === 'number' ? String(selectedBinding.voiceRate) : '',
        voiceVariant: selectedBinding?.voiceVariant ?? '',
      }),
    [selectedBinding],
  );
  const currentDraftSnapshot = useMemo(
    () =>
      createDraftSnapshot({
        behaviorTone,
        displayName,
        injectionMode,
        species,
        themeVariant,
        verbosity,
        voiceOutputMode,
        voiceRateInput,
        voiceVariant,
      }),
    [
      behaviorTone,
      displayName,
      injectionMode,
      species,
      themeVariant,
      verbosity,
      voiceOutputMode,
      voiceRateInput,
      voiceVariant,
    ],
  );
  const isDirty = currentDraftSnapshot !== savedDraftSnapshot;
  const bindingCount = Object.keys(bindings).length;

  useEffect(() => {
    const agentChanged = lastHydratedAgentIdRef.current !== selectedAgentId;
    const draftMatchesLastHydrated = currentDraftSnapshot === lastHydratedSnapshotRef.current;
    const draftMatchesIncoming = currentDraftSnapshot === savedDraftSnapshot;

    if (pendingHydrationRef.current || agentChanged || draftMatchesLastHydrated) {
      hydrateDraftFromBinding(selectedBinding);
      pendingHydrationRef.current = false;
      lastHydratedAgentIdRef.current = selectedAgentId;
      lastHydratedSnapshotRef.current = savedDraftSnapshot;
      return;
    }

    if (draftMatchesIncoming) {
      lastHydratedSnapshotRef.current = savedDraftSnapshot;
    }

    lastHydratedAgentIdRef.current = selectedAgentId;
  }, [
    currentDraftSnapshot,
    hydrateDraftFromBinding,
    savedDraftSnapshot,
    selectedAgentId,
    selectedBinding,
  ]);

  function resetDraftToSavedBinding() {
    hydrateDraftFromBinding(selectedBinding);
    lastHydratedSnapshotRef.current = savedDraftSnapshot;
  }

  function handleAgentSelectionChange(nextAgentId: string) {
    if (!nextAgentId || nextAgentId === selectedAgentId) {
      onSelectAgentId(nextAgentId);
      return;
    }

    if (isDirty && typeof globalThis.window !== 'undefined') {
      const shouldContinue = globalThis.window.confirm(
        '当前 Agent 的 Buddy 绑定还有未保存修改。继续切换会丢失这些草稿，是否继续？',
      );
      if (!shouldContinue) {
        return;
      }
    }

    setSubmitError(null);
    onSelectAgentId(nextAgentId);
  }

  const actionStatusText = submitting
    ? '正在保存当前 Agent 的 Buddy 绑定…'
    : submitError
      ? submitError
      : isDirty
        ? '有未保存的绑定更改'
        : selectedBinding
          ? '当前 Agent 绑定已同步'
          : '当前 Agent 还没有专属绑定';
  const primaryActionLabel = submitting
    ? '保存中…'
    : !selectedAgentId
      ? '先选择 Agent'
      : selectedBinding
        ? isDirty
          ? '更新绑定'
          : '已保存'
        : isDirty
          ? '创建绑定'
          : '设置后创建';

  return (
    <section style={SS}>
      <div style={ST}>Agent 绑定</div>
      <div style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--text-2)' }}>
        为某个 Agent 指定专属 Buddy。聊天时 Buddy 会跟着当前 effective agent
        自动切换；未绑定时仍回退到默认 companion。
      </div>

      <div
        style={{
          borderRadius: 14,
          border: '1px solid var(--border-subtle)',
          padding: '14px 16px',
          background: 'color-mix(in oklch, var(--surface) 92%, transparent)',
          display: 'grid',
          gap: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              当前编辑对象：{selectedAgentLabel || '未选择'}
            </div>
            <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.7, color: 'var(--text-2)' }}>
              上方主控制会自动同步；这里的 Agent 绑定是手动保存模型，适合批量改完一次提交。
            </div>
          </div>
          <span
            style={{
              ...SUMMARY_PILL,
              background: selectedBinding
                ? 'color-mix(in oklch, var(--accent) 14%, var(--surface))'
                : 'color-mix(in oklch, var(--surface-hover) 82%, var(--surface))',
              color: selectedBinding ? 'var(--accent)' : 'var(--text-2)',
            }}
          >
            {selectedBinding ? '已绑定专属 Persona' : '默认回退中'}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
            已绑定 {bindingCount} 个 Agent
            {bindingCount > 0
              ? '；可以用下方快捷入口直接跳转到已有绑定。'
              : '；尚未创建任何专属 Buddy。'}
          </div>
          <div aria-live="polite" style={{ fontSize: 12, color: 'var(--text-3)' }}>
            设置同步：{syncStatusLabel}
          </div>
        </div>
        {boundAgentOptions.length > 0 ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {boundAgentOptions.map((agent) => {
              const selected = agent.id === selectedAgentId;
              return (
                <button
                  key={agent.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={submitting}
                  onClick={() => handleAgentSelectionChange(agent.id)}
                  style={{
                    ...QUIET_BUTTON,
                    height: 30,
                    borderRadius: 999,
                    padding: '0 10px',
                    borderColor: selected ? 'var(--accent)' : 'var(--border-subtle)',
                    background: selected
                      ? 'color-mix(in oklch, var(--accent) 12%, var(--surface))'
                      : QUIET_BUTTON.background,
                    color: selected ? 'var(--accent)' : QUIET_BUTTON.color,
                    opacity: submitting ? 0.65 : 1,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {agent.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {agentLoading ? (
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>正在读取 Agent 列表…</div>
      ) : null}
      {agentError ? <div style={{ fontSize: 12, color: 'var(--danger)' }}>{agentError}</div> : null}

      {agentOptions.length > 0 ? (
        <>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>选择 Agent</span>
            <select
              aria-label="Buddy 绑定 Agent"
              disabled={submitting}
              value={selectedAgentId}
              onChange={(event) => handleAgentSelectionChange(event.target.value)}
              style={IS}
            >
              {agentOptions.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.label}
                </option>
              ))}
            </select>
          </label>

          <div style={FIELD_GROUP}>
            <div style={{ display: 'grid', gap: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>外观绑定</div>
              <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--text-3)' }}>
                这些字段决定当前 Agent 在 Chat 页看到的是谁、叫什么、呈现什么气质。
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 10,
              }}
            >
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                  绑定物种
                </span>
                <select
                  aria-label="Buddy 绑定物种"
                  value={species}
                  onChange={(event) => setSpecies(event.target.value as CompanionSpriteSpecies)}
                  style={IS}
                >
                  {SPRITE_SPECIES.map((item) => (
                    <option key={item} value={item}>
                      {spriteDisplayLabel(item)}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                  绑定主题
                </span>
                <select
                  aria-label="Buddy 绑定主题"
                  value={themeVariant}
                  onChange={(event) => setThemeVariant(event.target.value as CompanionThemeVariant)}
                  style={IS}
                >
                  {THEME_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                  Buddy 名称
                </span>
                <input
                  aria-label="Buddy 绑定名称"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="例如：Heph 小锤…"
                  autoComplete="off"
                  name="buddy-binding-name"
                  spellCheck={false}
                  style={IS}
                />
              </label>
            </div>
          </div>

          <div style={FIELD_GROUP}>
            <div style={{ display: 'grid', gap: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>行为覆盖</div>
              <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--text-3)' }}>
                用来控制这个 Agent 下的陪跑风格；留空时会继续继承上方全局主控制。
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 10,
              }}
            >
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                  行为语气
                </span>
                <select
                  aria-label="Buddy 行为语气"
                  value={behaviorTone}
                  onChange={(event) => setBehaviorTone(event.target.value as CompanionBehaviorTone)}
                  style={IS}
                >
                  {TONE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                  注入模式覆盖
                </span>
                <select
                  aria-label="Buddy 注入覆盖"
                  value={injectionMode}
                  onChange={(event) =>
                    setInjectionMode(event.target.value as '' | CompanionInjectionMode)
                  }
                  style={IS}
                >
                  {INJECTION_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                  输出简洁度覆盖
                </span>
                <select
                  aria-label="Buddy 简洁度覆盖"
                  value={verbosity}
                  onChange={(event) => setVerbosity(event.target.value as '' | CompanionVerbosity)}
                  style={IS}
                >
                  {VERBOSITY_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div style={FIELD_GROUP}>
            <div style={{ display: 'grid', gap: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>语音覆盖</div>
              <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--text-3)' }}>
                只覆盖这个 Agent 的播报方式；不填时会继承当前账号的 Buddy 语音偏好。
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 10,
              }}
            >
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                  播报模式覆盖
                </span>
                <select
                  aria-label="Buddy 播报模式覆盖"
                  value={voiceOutputMode}
                  onChange={(event) =>
                    setVoiceOutputMode(event.target.value as '' | CompanionVoiceOutputMode)
                  }
                  style={IS}
                >
                  {VOICE_MODE_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                  语音变体覆盖
                </span>
                <select
                  aria-label="Buddy 语音变体覆盖"
                  value={voiceVariant}
                  onChange={(event) =>
                    setVoiceVariant(event.target.value as '' | CompanionVoiceVariant)
                  }
                  style={IS}
                >
                  {VOICE_VARIANT_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                  语速覆盖
                </span>
                <input
                  aria-label="Buddy 语速覆盖"
                  value={voiceRateInput}
                  onChange={(event) => setVoiceRateInput(event.target.value)}
                  placeholder="继承全局，例如 1.08"
                  autoComplete="off"
                  inputMode="decimal"
                  min={0.5}
                  max={2}
                  name="buddy-binding-voice-rate"
                  spellCheck={false}
                  step="0.01"
                  style={IS}
                  type="number"
                />
              </label>
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--text-3)' }}>
              语速可填 0.50–2.00；留空表示完全继承全局设置。
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              borderRadius: 12,
              border: '1px solid var(--border-subtle)',
              padding: '12px 14px',
              background: 'color-mix(in oklch, var(--surface) 92%, transparent)',
            }}
          >
            <div style={{ minWidth: 0, flex: '1 1 260px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                当前绑定：{selectedAgentLabel || '未选择'}
              </div>
              <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.6, color: 'var(--text-2)' }}>
                {selectedBinding
                  ? `${selectedBinding.displayName ?? '未自定义名称'} · ${spriteDisplayLabel(selectedBinding.species)} · ${selectedBinding.themeVariant ?? 'default'} 主题 · ${selectedBinding.behaviorTone ?? 'focused'} 风格`
                  : '这个 Agent 目前还没有专属 Buddy，聊天时会回退到默认 companion。'}
              </div>
              {selectedBinding ? (
                <div
                  style={{ marginTop: 4, fontSize: 11, lineHeight: 1.6, color: 'var(--text-3)' }}
                >
                  语音覆盖：{selectedBinding.voiceOutputMode ?? '继承全局'} ·{' '}
                  {selectedBinding.voiceVariant ?? '继承全局'} ·{' '}
                  {typeof selectedBinding.voiceRate === 'number'
                    ? `${selectedBinding.voiceRate.toFixed(2)}x`
                    : '继承全局'}
                </div>
              ) : null}
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-3)' }}>
                设置同步：{syncStatusLabel}
              </div>
              {previewProfile ? (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-3)' }}>
                  当前预览：{previewProfile.name} · {previewProfile.species}
                </div>
              ) : null}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={submitting || !isDirty}
                onClick={resetDraftToSavedBinding}
                style={{
                  ...QUIET_BUTTON,
                  opacity: submitting || !isDirty ? 0.65 : 1,
                  cursor: submitting || !isDirty ? 'not-allowed' : 'pointer',
                }}
              >
                恢复已保存
              </button>
              <button
                type="button"
                style={BP}
                disabled={submitting || !selectedAgentId || !isDirty}
                onClick={() => {
                  if (!selectedAgentId) {
                    return;
                  }
                  setSubmitting(true);
                  setSubmitError(null);
                  const parsedVoiceRate =
                    voiceRateInput.trim().length > 0 ? Number(voiceRateInput) : undefined;
                  if (
                    typeof parsedVoiceRate === 'number' &&
                    (!Number.isFinite(parsedVoiceRate) ||
                      parsedVoiceRate < 0.5 ||
                      parsedVoiceRate > 2)
                  ) {
                    setSubmitError('语速覆盖必须介于 0.50 到 2.00 之间');
                    setSubmitting(false);
                    return;
                  }
                  pendingHydrationRef.current = true;
                  void onSaveBinding(selectedAgentId, {
                    behaviorTone,
                    displayName: displayName.trim() || undefined,
                    injectionMode: injectionMode || undefined,
                    species,
                    themeVariant,
                    verbosity: verbosity || undefined,
                    voiceOutputMode: voiceOutputMode || undefined,
                    voiceRate: parsedVoiceRate,
                    voiceVariant: voiceVariant || undefined,
                  })
                    .catch(() => {
                      pendingHydrationRef.current = false;
                      setSubmitError('Buddy 绑定保存失败');
                    })
                    .finally(() => {
                      setSubmitting(false);
                    });
                }}
                aria-disabled={submitting || !selectedAgentId || !isDirty}
              >
                {primaryActionLabel}
              </button>
              <button
                type="button"
                disabled={submitting || !selectedBinding}
                onClick={() => {
                  if (!selectedAgentId) {
                    return;
                  }
                  setSubmitting(true);
                  setSubmitError(null);
                  pendingHydrationRef.current = true;
                  void onRemoveBinding(selectedAgentId)
                    .catch(() => {
                      pendingHydrationRef.current = false;
                      setSubmitError('Buddy 绑定移除失败');
                    })
                    .finally(() => {
                      setSubmitting(false);
                    });
                }}
                style={{
                  ...QUIET_BUTTON,
                  opacity: submitting || !selectedBinding ? 0.65 : 1,
                  cursor: submitting || !selectedBinding ? 'not-allowed' : 'pointer',
                }}
              >
                清除绑定
              </button>
            </div>
          </div>

          <div
            aria-live="polite"
            style={{
              fontSize: 12,
              color: submitError ? 'var(--danger)' : isDirty ? 'var(--accent)' : 'var(--text-3)',
            }}
          >
            {actionStatusText}
          </div>
        </>
      ) : !agentLoading && !agentError ? (
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          当前没有可绑定的 Agent。请先在 Agents 页面启用或创建 Agent。
        </div>
      ) : null}
    </section>
  );
}
