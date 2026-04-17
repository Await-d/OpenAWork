import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildCompanionIntroText,
  createCompanionProfile,
  deriveCompanionOutputPolicy,
  deriveCompanionFocusTags,
  deriveCompanionReaction,
  deriveCompanionStatus,
  type CompanionActivitySnapshot,
  type CompanionUtteranceSeed,
} from './companion-display-model.js';
import { deriveCompanionStats, getCompanionRarityVisual } from './companion-visual-metadata.js';
import { CompanionTerminalSprite } from './companion-terminal-sprite.js';
import { useBuddyVoicePreferences } from './use-buddy-voice-preferences.js';
import { useBuddyVoiceOutput } from './use-buddy-voice-output.js';
import { useBuddyInteractionMemory } from './use-buddy-interaction-memory.js';
import { useAuthStore } from '../../../stores/auth.js';

export interface CompanionStageProps extends CompanionActivitySnapshot {
  agentId?: string;
  editorMode: boolean;
  panelOpenSignal?: number;
  prefersReducedMotion: boolean;
}

interface CompanionOutputEntry extends CompanionUtteranceSeed {
  createdAt: number;
  id: string;
}

type CompanionSyncState = 'local' | 'loading' | 'saving' | 'synced' | 'error';

const LIVE_OUTPUT_FADE_MS = 7000;
const LIVE_OUTPUT_CLEAR_MS = 10000;
const OUTPUT_HISTORY_LIMIT = 3;
const RAINBOW_SWATCHES = [
  'var(--accent)',
  'var(--success)',
  'var(--warning)',
  'var(--danger)',
] as const;

function CompanionModeButton({
  active,
  ariaLabel,
  disabled = false,
  label,
  onClick,
}: {
  active: boolean;
  ariaLabel?: string;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      style={{
        height: 18,
        padding: '0 5px',
        borderRadius: 999,
        border: '1px solid var(--border-subtle)',
        background: disabled ? 'transparent' : active ? 'var(--accent-muted)' : 'transparent',
        color: disabled ? 'var(--text-3)' : active ? 'var(--accent)' : 'var(--text-3)',
        fontSize: 7.5,
        fontWeight: active ? 700 : 600,
        whiteSpace: 'nowrap',
        opacity: disabled ? 0.52 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function CompanionMetaCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        minWidth: 0,
        flex: '1 1 140px',
        borderRadius: 7,
        border: '1px solid var(--border-subtle)',
        background: 'color-mix(in oklch, var(--surface) 88%, transparent)',
        padding: '4px 5px',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      <div
        style={{
          fontSize: 7.5,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--text-3)',
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 9,
          lineHeight: 1.32,
          color: 'var(--text-2)',
          wordBreak: 'break-word',
          minWidth: 0,
          flex: '1 1 90px',
          textAlign: 'right',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function CompanionSyncBadge({ label, state }: { label: string; state: CompanionSyncState }) {
  const background =
    state === 'synced'
      ? 'color-mix(in oklch, var(--success) 14%, transparent)'
      : state === 'saving' || state === 'loading'
        ? 'color-mix(in oklch, var(--warning) 12%, transparent)'
        : state === 'error'
          ? 'color-mix(in oklch, var(--danger) 14%, transparent)'
          : 'var(--bg-2)';
  const color =
    state === 'synced'
      ? 'var(--success)'
      : state === 'saving' || state === 'loading'
        ? 'var(--warning)'
        : state === 'error'
          ? 'var(--danger)'
          : 'var(--text-3)';

  return (
    <output
      data-testid="companion-sync-badge"
      aria-live="polite"
      aria-atomic="true"
      style={{
        height: 15,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: '0 4px',
        borderRadius: 999,
        background,
        color,
        fontSize: 7,
        fontWeight: 700,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 5,
          height: 5,
          borderRadius: 999,
          background: 'currentColor',
          boxShadow:
            state === 'saving' || state === 'loading'
              ? '0 0 0 2px color-mix(in oklch, currentColor 12%, transparent)'
              : 'none',
          opacity: state === 'local' ? 0.7 : 1,
        }}
      />
      <span>{label}</span>
    </output>
  );
}

function RainbowTriggerBadge({ text }: { text: string }) {
  const keyCounts = new Map<string, number>();

  return (
    <span
      style={{
        height: 15,
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0 4px',
        borderRadius: 999,
        background:
          'linear-gradient(90deg, color-mix(in oklch, var(--accent) 12%, transparent), color-mix(in oklch, var(--success) 10%, transparent), color-mix(in oklch, var(--warning) 12%, transparent))',
        border: '1px solid color-mix(in oklch, var(--accent) 34%, transparent)',
        fontSize: 7,
        fontWeight: 800,
        gap: 1,
      }}
    >
      {[...text].map((character) => {
        const nextCount = (keyCounts.get(character) ?? 0) + 1;
        keyCounts.set(character, nextCount);
        return (
          <span
            key={`${character}-${nextCount}`}
            style={{ color: RAINBOW_SWATCHES[(nextCount - 1) % RAINBOW_SWATCHES.length] }}
          >
            {character}
          </span>
        );
      })}
    </span>
  );
}

function CompanionOutputRow({
  entry,
  isLatest,
}: {
  entry: CompanionOutputEntry;
  isLatest: boolean;
}) {
  const badgeBackground =
    entry.tone === 'active'
      ? 'var(--accent-muted)'
      : entry.tone === 'notice'
        ? 'color-mix(in oklch, var(--warning) 16%, transparent)'
        : entry.tone === 'intro'
          ? 'color-mix(in oklch, var(--success) 14%, transparent)'
          : 'transparent';
  const badgeColor =
    entry.tone === 'notice'
      ? 'var(--warning)'
      : entry.tone === 'intro'
        ? 'var(--success)'
        : entry.tone === 'active'
          ? 'var(--accent)'
          : 'var(--text-3)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 4,
        borderRadius: 8,
        border: '1px solid var(--border-subtle)',
        background: isLatest
          ? 'color-mix(in oklch, var(--surface-hover) 72%, transparent)'
          : 'color-mix(in oklch, var(--surface) 90%, transparent)',
        padding: '5px 6px',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 13,
          height: 13,
          borderRadius: 999,
          color: isLatest ? 'var(--accent)' : 'var(--text-3)',
          fontSize: 8,
          fontWeight: 800,
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        {isLatest ? '●' : '·'}
      </span>
      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
          <span
            style={{
              height: 15,
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0 4px',
              borderRadius: 999,
              background: badgeBackground,
              color: badgeColor,
              fontSize: 8,
              fontWeight: 700,
            }}
          >
            {entry.badge}
          </span>
          <span style={{ fontSize: 8, color: 'var(--text-3)' }}>
            {isLatest ? '刚刚' : '前一条'}
          </span>
        </div>
        <div
          style={{
            fontSize: 9.5,
            lineHeight: 1.4,
            color: 'var(--text-2)',
            wordBreak: 'break-word',
          }}
        >
          {entry.text}
        </div>
      </div>
    </div>
  );
}

export function CompanionStage({
  agentId,
  attachedCount,
  currentUserEmail,
  editorMode,
  input,
  panelOpenSignal = 0,
  pendingPermissionCount,
  prefersReducedMotion,
  queuedCount,
  rightOpen,
  sessionBusyState,
  sessionId,
  showVoice,
  streaming,
  todoCount,
}: CompanionStageProps) {
  const [panelOpen, setPanelOpen] = useState<boolean>(() => sessionId === null);
  const [liveOutputId, setLiveOutputId] = useState<string | null>(null);
  const [fadingOutputId, setFadingOutputId] = useState<string | null>(null);
  const [outputHistory, setOutputHistory] = useState<CompanionOutputEntry[]>(() => {
    if (typeof globalThis.window === 'undefined') {
      return [];
    }
    try {
      const raw = globalThis.window.localStorage.getItem(
        `openawork-buddy-output:${sessionId ?? 'home'}`,
      );
      if (!raw) return [];
      return JSON.parse(raw) as CompanionOutputEntry[];
    } catch {
      return [];
    }
  });
  const [petNonce, setPetNonce] = useState(0);
  const lastIntroKeyRef = useRef<string | null>(null);
  const lastOutputKeyRef = useRef<string | null>(null);
  const buddyMentionActiveRef = useRef(false);
  const lastPanelOpenSignalRef = useRef(panelOpenSignal);

  useEffect(() => {
    setPanelOpen(sessionId === null);
  }, [sessionId]);

  const snapshot = useMemo<CompanionActivitySnapshot>(
    () => ({
      attachedCount,
      currentUserEmail,
      input,
      pendingPermissionCount,
      queuedCount,
      rightOpen,
      sessionBusyState,
      sessionId,
      showVoice,
      streaming,
      todoCount,
    }),
    [
      attachedCount,
      currentUserEmail,
      input,
      pendingPermissionCount,
      queuedCount,
      rightOpen,
      sessionBusyState,
      sessionId,
      showVoice,
      streaming,
      todoCount,
    ],
  );

  const {
    activeBinding,
    companionFeatureMode,
    effectiveVoiceOutputMode,
    effectiveVoiceRate,
    effectiveVoiceVariant,
    enabled,
    isCompanionFeatureEnabled,
    isVoiceOutputFeatureReady,
    isVoiceOutputFeatureEnabled,
    muted,
    profile: remoteProfile,
    quietMode,
    reducedMotion,
    syncStatus,
    syncStatusLabel,
    setEnabled,
    setMuted,
    setQuietMode,
    setReducedMotion,
    voiceOutputEnabled,
    setVoiceOutputEnabled,
  } = useBuddyVoicePreferences(currentUserEmail || sessionId || 'guest', agentId);
  const profile = useMemo(
    () => remoteProfile ?? createCompanionProfile((currentUserEmail || sessionId) ?? 'guest'),
    [currentUserEmail, remoteProfile, sessionId],
  );
  const introText = useMemo(() => buildCompanionIntroText(profile), [profile]);
  const reaction = useMemo(() => deriveCompanionReaction(snapshot), [snapshot]);
  const statusText = useMemo(() => deriveCompanionStatus(snapshot), [snapshot]);
  const focusTags = useMemo(() => deriveCompanionFocusTags(snapshot), [snapshot]);
  const companionStats = useMemo(() => deriveCompanionStats(profile), [profile]);
  const rarityVisual = useMemo(
    () => getCompanionRarityVisual(profile.sprite.rarity),
    [profile.sprite.rarity],
  );
  const effectiveReducedMotion = prefersReducedMotion || reducedMotion;
  const buddyTriggerActive = input.includes('/buddy');
  const introOutputPolicy = useMemo(
    () =>
      deriveCompanionOutputPolicy(
        { badge: '初次亮相', text: introText, tone: 'intro' },
        { muted, quietMode },
      ),
    [introText, muted, quietMode],
  );
  const reactionOutputPolicy = useMemo(
    () =>
      deriveCompanionOutputPolicy(
        { badge: reaction.badge, text: reaction.text, tone: reaction.importance },
        { muted, quietMode },
      ),
    [muted, quietMode, reaction.badge, reaction.importance, reaction.text],
  );
  const baseTransition = effectiveReducedMotion
    ? 'none'
    : 'transform 220ms ease, opacity 220ms ease, box-shadow 220ms ease, background 220ms ease';

  const { memory: interactionMemory, recordInteraction } = useBuddyInteractionMemory(
    currentUserEmail || sessionId || 'guest',
  );

  const pushOutput = useCallback((entry: CompanionUtteranceSeed, announce: boolean) => {
    const createdAt = Date.now();
    const nextEntry: CompanionOutputEntry = {
      ...entry,
      createdAt,
      id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    };
    setOutputHistory((previous) => [nextEntry, ...previous].slice(0, OUTPUT_HISTORY_LIMIT));
    if (announce) {
      setLiveOutputId(nextEntry.id);
      setFadingOutputId(null);
    }
  }, []);

  useEffect(() => {
    if (typeof globalThis.window === 'undefined' || outputHistory.length === 0) {
      return;
    }
    try {
      globalThis.window.localStorage.setItem(
        `openawork-buddy-output:${sessionId ?? 'home'}`,
        JSON.stringify(outputHistory),
      );
    } catch {
      // localStorage may be unavailable
    }
  }, [outputHistory, sessionId]);

  useEffect(() => {
    const introKey = `${sessionId ?? 'home'}:${profile.name}:${profile.species}`;
    if (lastIntroKeyRef.current === introKey) {
      return;
    }
    lastIntroKeyRef.current = introKey;
    lastOutputKeyRef.current = null;
    setOutputHistory([]);
    setLiveOutputId(null);
    setFadingOutputId(null);
    pushOutput(
      {
        badge: '初次亮相',
        text: introText,
        tone: 'intro',
      },
      introOutputPolicy.shouldShowLiveOutput,
    );
  }, [
    introOutputPolicy.shouldShowLiveOutput,
    introText,
    profile.name,
    profile.species,
    pushOutput,
    sessionId,
  ]);

  useEffect(() => {
    const outputKey = `${sessionId ?? 'home'}:${reaction.badge}:${reaction.text}`;
    if (lastOutputKeyRef.current === outputKey) {
      return;
    }
    lastOutputKeyRef.current = outputKey;
    pushOutput(
      {
        badge: reaction.badge,
        text: reaction.text,
        tone: reaction.importance,
      },
      reactionOutputPolicy.shouldShowLiveOutput,
    );
  }, [
    pushOutput,
    reaction.badge,
    reaction.importance,
    reaction.text,
    reactionOutputPolicy.shouldShowLiveOutput,
    sessionId,
  ]);

  const prevStreamingRef = useRef(streaming);
  const prevPendingRef = useRef(pendingPermissionCount);
  useEffect(() => {
    if (muted || quietMode) {
      prevStreamingRef.current = streaming;
      prevPendingRef.current = pendingPermissionCount;
      return;
    }

    const wasStreaming = prevStreamingRef.current;
    const wasPending = prevPendingRef.current;
    prevStreamingRef.current = streaming;
    prevPendingRef.current = pendingPermissionCount;

    if (wasStreaming && !streaming) {
      pushOutput(
        { badge: '生成完成', text: '这轮输出结束了，需要我帮忙看看吗？', tone: 'notice' },
        true,
      );
      recordInteraction('notification', '生成完成');
    }

    if (pendingPermissionCount > wasPending && pendingPermissionCount > 0) {
      pushOutput(
        {
          badge: '新审批',
          text: `有 ${pendingPermissionCount} 项新审批等你处理。`,
          tone: 'notice',
        },
        true,
      );
      recordInteraction('notification', `新审批:${pendingPermissionCount}`);
    }
  }, [muted, quietMode, streaming, pendingPermissionCount, pushOutput, recordInteraction]);

  useEffect(() => {
    if (!liveOutputId) {
      return;
    }

    const fadeTimer = globalThis.setTimeout(() => {
      setFadingOutputId((current) => (current === null ? liveOutputId : current));
    }, LIVE_OUTPUT_FADE_MS);
    const clearTimer = globalThis.setTimeout(() => {
      setLiveOutputId((current) => (current === liveOutputId ? null : current));
      setFadingOutputId((current) => (current === liveOutputId ? null : current));
    }, LIVE_OUTPUT_CLEAR_MS);

    return () => {
      globalThis.clearTimeout(fadeTimer);
      globalThis.clearTimeout(clearTimer);
    };
  }, [liveOutputId]);

  const liveOutput = useMemo(
    () => outputHistory.find((entry) => entry.id === liveOutputId) ?? null,
    [liveOutputId, outputHistory],
  );
  const voiceOutputEffectiveEnabled = voiceOutputEnabled && isVoiceOutputFeatureEnabled;
  const { isSpeaking, isVoiceOutputAvailable, speechStatusLabel } = useBuddyVoiceOutput({
    enabled: voiceOutputEffectiveEnabled,
    featureEnabled: isVoiceOutputFeatureEnabled,
    featureReady: isVoiceOutputFeatureReady,
    liveOutput,
    liveOutputId,
    muted,
    profileName: profile.name,
    quietMode,
    voiceOutputMode: effectiveVoiceOutputMode,
    voiceRate: effectiveVoiceRate,
    voiceVariant: effectiveVoiceVariant,
    voiceInputVisible: showVoice,
  });

  const { accessToken, gatewayUrl } = useAuthStore();
  const [buddyChatBusy, setBuddyChatBusy] = useState(false);

  const requestBuddyChat = useCallback(
    async (userMessage: string) => {
      if (!gatewayUrl || !accessToken || buddyChatBusy) {
        return;
      }

      setBuddyChatBusy(true);
      try {
        const response = await fetch(`${gatewayUrl}/settings/companion/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            message: userMessage,
            context: {
              sessionBusy: sessionBusyState === 'running',
              pendingApprovals: pendingPermissionCount,
              pendingQuestions: pendingPermissionCount,
              runningTasks: attachedCount,
              todoCount,
            },
            agentId,
          }),
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as {
          text: string;
          profileName: string;
          profileSpecies: string;
          tone: string;
        };

        if (data.text) {
          pushOutput(
            { badge: data.profileName, text: data.text, tone: 'chat' },
            !muted && !quietMode,
          );
          recordInteraction('chat', data.text);
        }
      } catch {
        // Silently fail - buddy chat is non-critical
      } finally {
        setBuddyChatBusy(false);
      }
    },
    [
      accessToken,
      agentId,
      attachedCount,
      buddyChatBusy,
      gatewayUrl,
      muted,
      pendingPermissionCount,
      pushOutput,
      quietMode,
      recordInteraction,
      sessionBusyState,
      todoCount,
    ],
  );

  useEffect(() => {
    const mentionsBuddy = input.includes('/buddy');
    if (mentionsBuddy && !buddyMentionActiveRef.current) {
      setPetNonce((current) => current + 1);
      setPanelOpen(true);
      recordInteraction('trigger', input);

      const buddyMessage = input.replace(/\/buddy/g, '').trim() || '嘿';
      void requestBuddyChat(buddyMessage);
    }
    buddyMentionActiveRef.current = mentionsBuddy;
  }, [input, recordInteraction, requestBuddyChat]);

  useEffect(() => {
    if (panelOpenSignal === lastPanelOpenSignalRef.current) {
      return;
    }
    lastPanelOpenSignalRef.current = panelOpenSignal;
    setPanelOpen(true);
  }, [panelOpenSignal]);

  if (isVoiceOutputFeatureReady && !isCompanionFeatureEnabled) {
    return (
      <section
        data-testid="companion-stage"
        style={{
          maxWidth: editorMode ? 680 : rightOpen ? 700 : 740,
          margin: '0 auto 3px',
          width: '100%',
        }}
      >
        <button
          type="button"
          onClick={() => setEnabled(true)}
          aria-label="重新启用 Buddy 伴侣"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '3px 8px',
            borderRadius: 999,
            border: '1px solid var(--border-subtle)',
            background: 'transparent',
            color: 'var(--text-3)',
            fontSize: 9,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'color 160ms ease, border-color 160ms ease',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 10 }}>
            ◈
          </span>
          <span>启用 Buddy</span>
        </button>
      </section>
    );
  }

  return (
    <section
      data-testid="companion-stage"
      style={{
        maxWidth: editorMode ? 680 : rightOpen ? 700 : 740,
        margin: '0 auto 3px',
        width: '100%',
      }}
    >
      <div
        style={{
          borderRadius: 12,
          border: '1px solid var(--bg-glass-border)',
          background:
            'linear-gradient(180deg, color-mix(in oklch, var(--bg-glass) 88%, transparent), color-mix(in oklch, var(--surface) 94%, transparent))',
          backdropFilter: 'blur(12px)',
          boxShadow: panelOpen
            ? '0 6px 14px -20px rgba(0, 0, 0, 0.36)'
            : '0 3px 8px -16px rgba(0, 0, 0, 0.26)',
          padding: panelOpen ? '4px 5px 5px' : '3px 5px 3px',
          transition: baseTransition,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 6,
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              minWidth: 0,
              flex: '1 1 260px',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <CompanionTerminalSprite
              fading={liveOutput !== null && fadingOutputId === liveOutput.id}
              liveOutput={muted ? null : liveOutput}
              petNonce={petNonce}
              prefersReducedMotion={effectiveReducedMotion}
              profile={profile}
            />
            <button
              type="button"
              onClick={() => setPanelOpen((value) => !value)}
              aria-label={panelOpen ? '收起 Buddy 展示详情' : '展开 Buddy 展示详情'}
              aria-expanded={panelOpen}
              aria-controls="chat-companion-panel"
              style={{
                minWidth: 0,
                flex: '1 1 176px',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                padding: 0,
                textAlign: 'left',
                alignItems: 'flex-start',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text)' }}>
                  {profile.name}
                </span>
                <span
                  style={{
                    height: 15,
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '0 4px',
                    borderRadius: 999,
                    border: '1px solid var(--border-subtle)',
                    background: profile.accentTint,
                    color: profile.accentColor,
                    fontSize: 7.5,
                    fontWeight: 700,
                  }}
                >
                  Buddy 精灵
                </span>
                <span
                  style={{
                    height: 15,
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '0 4px',
                    borderRadius: 999,
                    background: rarityVisual.background,
                    border: `1px solid ${rarityVisual.borderColor}`,
                    color: rarityVisual.color,
                    fontSize: 7.5,
                    fontWeight: 800,
                  }}
                >
                  {rarityVisual.label}
                </span>
                {activeBinding?.behaviorTone ? (
                  <span
                    style={{
                      height: 15,
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '0 4px',
                      borderRadius: 999,
                      border: '1px solid var(--border-subtle)',
                      background: 'color-mix(in oklch, var(--surface) 90%, transparent)',
                      color: 'var(--text-2)',
                      fontSize: 7.5,
                      fontWeight: 700,
                    }}
                  >
                    {activeBinding.behaviorTone}
                  </span>
                ) : null}
                {buddyTriggerActive ? <RainbowTriggerBadge text="/buddy" /> : null}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <span
                  style={{
                    height: 14,
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '0 3px',
                    borderRadius: 999,
                    background: 'var(--bg-2)',
                    color: 'var(--text-2)',
                    fontSize: 7.5,
                    fontWeight: 700,
                  }}
                >
                  {profile.species}
                </span>
                <span
                  style={{
                    height: 14,
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '0 3px',
                    borderRadius: 999,
                    background: 'color-mix(in oklch, var(--surface) 88%, transparent)',
                    color: 'var(--text-2)',
                    fontSize: 7.5,
                    fontWeight: 700,
                  }}
                >
                  {statusText}
                </span>
              </span>
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              flex: '0 1 auto',
            }}
          >
            <CompanionModeButton
              active={enabled}
              ariaLabel={enabled ? '关闭 Buddy 主开关' : '开启 Buddy 主开关'}
              label={enabled ? '伴侣开' : '伴侣关'}
              onClick={() => setEnabled((value) => !value)}
            />
            <CompanionModeButton
              active={voiceOutputEffectiveEnabled && isVoiceOutputAvailable}
              ariaLabel={
                !isVoiceOutputFeatureReady
                  ? '正在读取 Buddy 远端设置'
                  : !isVoiceOutputFeatureEnabled
                    ? '远端已关闭 Buddy 播报功能'
                    : isVoiceOutputAvailable
                      ? voiceOutputEnabled
                        ? '关闭 Buddy 本地播报'
                        : '开启 Buddy 本地播报'
                      : '当前环境不支持 Buddy 本地播报'
              }
              disabled={
                !isVoiceOutputAvailable ||
                !isVoiceOutputFeatureReady ||
                !isVoiceOutputFeatureEnabled
              }
              label={
                !isVoiceOutputFeatureReady
                  ? '读取中'
                  : !isVoiceOutputFeatureEnabled
                    ? companionFeatureMode === 'off'
                      ? '功能关闭'
                      : '远端关闭'
                    : !isVoiceOutputAvailable
                      ? '无播报'
                      : isSpeaking
                        ? '播报中'
                        : voiceOutputEnabled
                          ? '播报开'
                          : '播报关'
              }
              onClick={() => setVoiceOutputEnabled((value) => !value)}
            />
            <CompanionSyncBadge label={syncStatusLabel} state={syncStatus} />
            <CompanionModeButton
              active={quietMode}
              ariaLabel={quietMode ? '关闭安静模式' : '开启安静模式'}
              label={quietMode ? '安静模式' : '低打扰'}
              onClick={() => setQuietMode((value) => !value)}
            />
            <CompanionModeButton
              active={muted}
              ariaLabel={muted ? '取消 Buddy 静音' : '将 Buddy 设为静音'}
              label={muted ? '已静音' : '可出声'}
              onClick={() => setMuted((value) => !value)}
            />
            <CompanionModeButton
              active={reducedMotion}
              ariaLabel={reducedMotion ? '关闭 Buddy 减少动效' : '开启 Buddy 减少动效'}
              label={reducedMotion ? '减动效' : '完整动效'}
              onClick={() => setReducedMotion((value) => !value)}
            />
            <CompanionModeButton
              active={panelOpen}
              ariaLabel={panelOpen ? '收起 Buddy 详情面板' : '展开 Buddy 详情面板'}
              label={panelOpen ? '收起详情' : '展开详情'}
              onClick={() => setPanelOpen((value) => !value)}
            />
          </div>
        </div>

        {panelOpen ? (
          <div
            id="chat-companion-panel"
            data-testid="companion-panel"
            style={{
              marginTop: 3,
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 4,
                flexWrap: 'wrap',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                padding: '4px 5px 4px',
                background: 'color-mix(in oklch, var(--surface) 92%, transparent)',
              }}
            >
              <div style={{ minWidth: 0, flex: '1 1 220px' }}>
                <div style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--text)' }}>
                  {profile.name} · {profile.species}
                </div>
                <div
                  style={{
                    marginTop: 1,
                    fontSize: 9,
                    lineHeight: 1.28,
                    color: 'var(--text-2)',
                    wordBreak: 'break-word',
                    display: '-webkit-box',
                    WebkitLineClamp: 1,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {profile.note}
                </div>
                <div style={{ marginTop: 3, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {companionStats.map((stat) => (
                    <span
                      key={stat.key}
                      style={{
                        height: 15,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        padding: '0 4px',
                        borderRadius: 999,
                        background: 'color-mix(in oklch, var(--surface-hover) 88%, transparent)',
                        color: 'var(--text-2)',
                        fontSize: 7.5,
                        fontWeight: 700,
                      }}
                    >
                      <span>{stat.label}</span>
                      <span style={{ color: 'var(--text)' }}>{stat.value}</span>
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                {profile.traits.map((trait) => (
                  <span
                    key={trait}
                    style={{
                      height: 15,
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '0 3px',
                      borderRadius: 999,
                      background: 'color-mix(in oklch, var(--surface-hover) 86%, transparent)',
                      color: 'var(--text-2)',
                      fontSize: 7.5,
                      fontWeight: 700,
                    }}
                  >
                    {trait}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              <CompanionMetaCard label="当前状态" value={statusText} />
              <CompanionMetaCard
                label="语音播报"
                value={`${speechStatusLabel} · ${syncStatusLabel}`}
              />
              <CompanionMetaCard
                label="关注范围"
                value={
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                    {focusTags.map((tag) => (
                      <span
                        key={tag}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          height: 15,
                          padding: '0 3px',
                          borderRadius: 999,
                          background: 'var(--bg-2)',
                          color: 'var(--text-2)',
                          fontSize: 7.5,
                          fontWeight: 700,
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                }
              />
              <CompanionMetaCard
                label="当前阶段"
                value={`注入模式：${enabled ? companionFeatureMode : 'off'}`}
              />
              <CompanionMetaCard
                label="稀有度"
                value={
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                      justifyContent: 'flex-end',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span>{profile.rarityStars}</span>
                    <span style={{ color: rarityVisual.color }}>{rarityVisual.label}</span>
                  </span>
                }
              />
            </div>

            <div
              data-testid="companion-output-log"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'color-mix(in oklch, var(--surface) 92%, transparent)',
                padding: '4px 5px 4px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 3,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 8,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      color: 'var(--text-3)',
                      fontWeight: 700,
                    }}
                  >
                    最近会话输出
                  </div>
                  <div style={{ marginTop: 1, fontSize: 8.5, color: 'var(--text-2)' }}>
                    短句出声后退回边缘。
                  </div>
                </div>
                <span
                  style={{
                    height: 17,
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '0 4px',
                    borderRadius: 999,
                    background: 'var(--bg-2)',
                    color: 'var(--text-3)',
                    fontSize: 8,
                    fontWeight: 700,
                  }}
                >
                  {outputHistory.length} 条
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {outputHistory.map((entry, index) => (
                  <CompanionOutputRow key={entry.id} entry={entry} isLatest={index === 0} />
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
