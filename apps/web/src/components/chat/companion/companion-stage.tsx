import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildCompanionIntroText,
  createCompanionProfile,
  deriveCompanionFocusTags,
  deriveCompanionReaction,
  deriveCompanionStatus,
  type CompanionActivitySnapshot,
  type CompanionUtteranceSeed,
} from './companion-display-model.js';
import { CompanionTerminalSprite } from './companion-terminal-sprite.js';

export interface CompanionStageProps extends CompanionActivitySnapshot {
  editorMode: boolean;
  prefersReducedMotion: boolean;
}

interface CompanionOutputEntry extends CompanionUtteranceSeed {
  createdAt: number;
  id: string;
}

const LIVE_OUTPUT_FADE_MS = 7000;
const LIVE_OUTPUT_CLEAR_MS = 10000;
const OUTPUT_HISTORY_LIMIT = 3;

function CompanionModeButton({
  active,
  ariaLabel,
  label,
  onClick,
}: {
  active: boolean;
  ariaLabel?: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? label}
      aria-pressed={active}
      onClick={onClick}
      style={{
        height: 22,
        padding: '0 7px',
        borderRadius: 999,
        border: '1px solid var(--border-subtle)',
        background: active ? 'var(--accent-muted)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-3)',
        fontSize: 8.5,
        fontWeight: active ? 700 : 600,
        whiteSpace: 'nowrap',
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
        flex: '1 1 172px',
        borderRadius: 9,
        border: '1px solid var(--border-subtle)',
        background: 'color-mix(in oklch, var(--surface) 88%, transparent)',
        padding: '6px 7px',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      <div
        style={{
          fontSize: 8.5,
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
          fontSize: 10,
          lineHeight: 1.32,
          color: 'var(--text-2)',
          wordBreak: 'break-word',
          minWidth: 0,
          flex: '1 1 110px',
          textAlign: 'right',
        }}
      >
        {value}
      </div>
    </div>
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
        gap: 6,
        borderRadius: 10,
        border: '1px solid var(--border-subtle)',
        background: isLatest
          ? 'color-mix(in oklch, var(--surface-hover) 72%, transparent)'
          : 'color-mix(in oklch, var(--surface) 90%, transparent)',
        padding: '8px 9px',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 16,
          height: 16,
          borderRadius: 999,
          color: isLatest ? 'var(--accent)' : 'var(--text-3)',
          fontSize: 9,
          fontWeight: 800,
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        {isLatest ? '●' : '·'}
      </span>
      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <span
            style={{
              height: 18,
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0 6px',
              borderRadius: 999,
              background: badgeBackground,
              color: badgeColor,
              fontSize: 9,
              fontWeight: 700,
            }}
          >
            {entry.badge}
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-3)' }}>
            {isLatest ? '刚刚' : '前一条'}
          </span>
        </div>
        <div
          style={{
            fontSize: 10.5,
            lineHeight: 1.5,
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
  attachedCount,
  currentUserEmail,
  editorMode,
  input,
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
  const [muted, setMuted] = useState(false);
  const [quietMode, setQuietMode] = useState(false);
  const [liveOutputId, setLiveOutputId] = useState<string | null>(null);
  const [fadingOutputId, setFadingOutputId] = useState<string | null>(null);
  const [outputHistory, setOutputHistory] = useState<CompanionOutputEntry[]>([]);
  const [petNonce, setPetNonce] = useState(0);
  const lastIntroKeyRef = useRef<string | null>(null);
  const lastOutputKeyRef = useRef<string | null>(null);
  const buddyMentionActiveRef = useRef(false);

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

  const profile = useMemo(
    () => createCompanionProfile((currentUserEmail || sessionId) ?? 'guest'),
    [currentUserEmail, sessionId],
  );
  const introText = useMemo(() => buildCompanionIntroText(profile), [profile]);
  const reaction = useMemo(() => deriveCompanionReaction(snapshot), [snapshot]);
  const statusText = useMemo(() => deriveCompanionStatus(snapshot), [snapshot]);
  const focusTags = useMemo(() => deriveCompanionFocusTags(snapshot), [snapshot]);
  const shouldAnnounceReaction = !muted && (!quietMode || reaction.importance !== 'ambient');
  const baseTransition = prefersReducedMotion
    ? 'none'
    : 'transform 220ms ease, opacity 220ms ease, box-shadow 220ms ease, background 220ms ease';

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
      !muted,
    );
  }, [introText, muted, profile.name, profile.species, pushOutput, sessionId]);

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
      shouldAnnounceReaction,
    );
  }, [
    pushOutput,
    reaction.badge,
    reaction.importance,
    reaction.text,
    sessionId,
    shouldAnnounceReaction,
  ]);

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

  useEffect(() => {
    const mentionsBuddy = input.includes('/buddy');
    if (mentionsBuddy && !buddyMentionActiveRef.current) {
      setPetNonce((current) => current + 1);
    }
    buddyMentionActiveRef.current = mentionsBuddy;
  }, [input]);

  return (
    <section
      data-testid="companion-stage"
      style={{
        maxWidth: editorMode ? 680 : rightOpen ? 700 : 740,
        margin: '0 auto 5px',
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
            ? '0 10px 20px -24px rgba(0, 0, 0, 0.48)'
            : '0 6px 14px -22px rgba(0, 0, 0, 0.38)',
          padding: panelOpen ? '6px 7px 7px' : '5px 6px 5px',
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
              flex: '1 1 340px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <CompanionTerminalSprite
              fading={liveOutput !== null && fadingOutputId === liveOutput.id}
              liveOutput={muted ? null : liveOutput}
              petNonce={petNonce}
              prefersReducedMotion={prefersReducedMotion}
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
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text)' }}>
                  {profile.name}
                </span>
                <span
                  style={{
                    height: 17,
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '0 5px',
                    borderRadius: 999,
                    border: '1px solid var(--border-subtle)',
                    background: profile.accentTint,
                    color: profile.accentColor,
                    fontSize: 8.5,
                    fontWeight: 700,
                  }}
                >
                  Buddy 精灵
                </span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
                <span
                  style={{
                    height: 15,
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '0 4px',
                    borderRadius: 999,
                    background: 'var(--bg-2)',
                    color: 'var(--text-2)',
                    fontSize: 8,
                    fontWeight: 700,
                  }}
                >
                  {profile.species}
                </span>
                <span
                  style={{
                    height: 15,
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '0 4px',
                    borderRadius: 999,
                    background: 'color-mix(in oklch, var(--surface) 88%, transparent)',
                    color: 'var(--text-2)',
                    fontSize: 8,
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
              marginTop: 4,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 4,
                flexWrap: 'wrap',
                borderRadius: 10,
                border: '1px solid var(--border-subtle)',
                padding: '6px 6px 5px',
                background: 'color-mix(in oklch, var(--surface) 92%, transparent)',
              }}
            >
              <div style={{ minWidth: 0, flex: '1 1 220px' }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text)' }}>
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
              </div>
              <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                {profile.traits.map((trait) => (
                  <span
                    key={trait}
                    style={{
                      height: 17,
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '0 4px',
                      borderRadius: 999,
                      background: 'color-mix(in oklch, var(--surface-hover) 86%, transparent)',
                      color: 'var(--text-2)',
                      fontSize: 8,
                      fontWeight: 700,
                    }}
                  >
                    {trait}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <CompanionMetaCard label="当前状态" value={statusText} />
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
                          height: 17,
                          padding: '0 4px',
                          borderRadius: 999,
                          background: 'var(--bg-2)',
                          color: 'var(--text-2)',
                          fontSize: 8,
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
                value="终端同款精灵壳层；后续再接设置与 prompt 注入。"
              />
            </div>

            <div
              data-testid="companion-output-log"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                borderRadius: 10,
                border: '1px solid var(--border-subtle)',
                background: 'color-mix(in oklch, var(--surface) 92%, transparent)',
                padding: '6px 6px 5px',
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
