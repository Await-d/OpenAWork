import { useEffect, useMemo, useRef, useState } from 'react';
import {
  renderCompanionFace,
  renderCompanionSprite,
  spriteFrameCount,
} from './companion-sprite-model.js';
import type { CompanionProfile, CompanionUtteranceSeed } from './companion-display-model.js';

export interface CompanionTerminalSpriteProps {
  fading: boolean;
  liveOutput: CompanionUtteranceSeed | null;
  petNonce: number;
  prefersReducedMotion: boolean;
  profile: CompanionProfile;
}

const TICK_MS = 500;
const PET_BURST_MS = 2500;
const IDLE_SEQUENCE = [0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 2, 0, 0, 0] as const;
const PET_HEARTS = ['   ♥    ♥   ', '  ♥  ♥   ♥  ', ' ♥   ♥  ♥   ', '♥  ♥      ♥ ', '·    ·   ·  '];

function resolveSpriteColor(
  tone: CompanionUtteranceSeed['tone'] | null,
  accentColor: string,
): string {
  if (tone === 'notice') {
    return 'var(--warning)';
  }
  if (tone === 'intro') {
    return 'var(--success)';
  }
  if (tone === 'active') {
    return accentColor;
  }
  return 'var(--text-2)';
}

function resolveBubbleBackground(tone: CompanionUtteranceSeed['tone'] | null): string {
  if (tone === 'notice') {
    return 'linear-gradient(135deg, color-mix(in oklch, var(--warning) 12%, transparent), color-mix(in oklch, var(--surface) 92%, transparent))';
  }
  if (tone === 'intro') {
    return 'linear-gradient(135deg, color-mix(in oklch, var(--success) 10%, transparent), color-mix(in oklch, var(--surface) 92%, transparent))';
  }
  if (tone === 'active') {
    return 'linear-gradient(135deg, color-mix(in oklch, var(--accent) 10%, transparent), color-mix(in oklch, var(--surface) 92%, transparent))';
  }
  return 'color-mix(in oklch, var(--surface) 92%, transparent)';
}

export function CompanionTerminalSprite({
  fading,
  liveOutput,
  petNonce,
  prefersReducedMotion,
  profile,
}: CompanionTerminalSpriteProps) {
  const [tick, setTick] = useState(0);
  const [petState, setPetState] = useState<{ petNonce: number; tick: number }>({
    petNonce: 0,
    tick: 0,
  });
  const tickRef = useRef(0);

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  useEffect(() => {
    if (petNonce === 0) {
      return;
    }
    setPetState({ petNonce, tick: tickRef.current });
  }, [petNonce]);

  useEffect(() => {
    if (prefersReducedMotion) {
      return;
    }
    const timer = globalThis.setInterval(() => {
      setTick((current) => current + 1);
    }, TICK_MS);
    return () => globalThis.clearInterval(timer);
  }, [prefersReducedMotion]);

  const petAge = petState.petNonce === 0 ? Number.POSITIVE_INFINITY : tick - petState.tick;
  const petting = !prefersReducedMotion && petAge * TICK_MS < PET_BURST_MS;
  const frameCount = spriteFrameCount(profile.sprite.species);
  let spriteFrame = 0;
  let blink = false;

  if (!prefersReducedMotion) {
    if (liveOutput || petting) {
      spriteFrame = tick % frameCount;
    } else {
      const sequenceStep = IDLE_SEQUENCE[tick % IDLE_SEQUENCE.length]!;
      if (sequenceStep === -1) {
        spriteFrame = 0;
        blink = true;
      } else {
        spriteFrame = sequenceStep % frameCount;
      }
    }
  }

  const spriteLines = useMemo(() => {
    const body = renderCompanionSprite(profile.sprite, spriteFrame).map((line) =>
      blink ? line.replaceAll(profile.sprite.eye, '-') : line,
    );
    const heartFrame = petting ? PET_HEARTS[petAge % PET_HEARTS.length] : null;
    return heartFrame ? [heartFrame, ...body] : body;
  }, [blink, petAge, petting, profile.sprite, spriteFrame]);

  const spriteColor = resolveSpriteColor(liveOutput?.tone ?? null, profile.accentColor);
  const face = renderCompanionFace(profile.sprite);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 6,
        flexWrap: 'wrap',
        minWidth: 0,
      }}
    >
      {liveOutput ? (
        <output
          data-testid="companion-reaction"
          aria-live="polite"
          aria-atomic="true"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            minWidth: 0,
            flex: '1 1 220px',
            maxWidth: 300,
            padding: '6px 8px',
            borderRadius: 11,
            border: '1px solid color-mix(in oklch, var(--border) 68%, transparent)',
            background: resolveBubbleBackground(liveOutput.tone),
            opacity: fading ? 0.52 : 1,
            transition: prefersReducedMotion
              ? 'opacity 160ms ease'
              : 'opacity 240ms ease, transform 240ms ease',
            transform: prefersReducedMotion || fading ? 'none' : 'translateY(-1px)',
            boxShadow: fading ? 'none' : '0 6px 14px -20px rgba(0,0,0,0.34)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 16,
                padding: '0 5px',
                borderRadius: 999,
                background:
                  liveOutput.tone === 'notice'
                    ? 'color-mix(in oklch, var(--warning) 16%, transparent)'
                    : liveOutput.tone === 'intro'
                      ? 'color-mix(in oklch, var(--success) 14%, transparent)'
                      : liveOutput.tone === 'active'
                        ? 'var(--accent-muted)'
                        : 'transparent',
                color: spriteColor,
                fontSize: 8.5,
                fontWeight: 700,
              }}
            >
              {liveOutput.badge}
            </span>
            <span
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: 8.5,
                color: 'var(--text-3)',
              }}
            >
              {profile.rarityStars}
            </span>
          </div>
          <div
            style={{
              fontSize: 10,
              lineHeight: 1.38,
              color: 'var(--text-2)',
              wordBreak: 'break-word',
            }}
          >
            {liveOutput.text}
          </div>
        </output>
      ) : null}

      <div
        data-testid="companion-terminal-sprite"
        style={{
          minWidth: 84,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1,
        }}
      >
        {spriteLines.map((line, index) => (
          <div
            key={`${index}-${line}`}
            data-testid={petting && index === 0 ? 'companion-pet-hearts' : undefined}
            style={{
              whiteSpace: 'pre',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: 9,
              lineHeight: 1.02,
              color:
                petting && index === 0
                  ? 'color-mix(in oklch, var(--danger) 82%, white 18%)'
                  : spriteColor,
              textShadow: fading
                ? 'none'
                : '0 0 10px color-mix(in oklch, currentColor 10%, transparent)',
              fontVariantLigatures: 'none',
            }}
          >
            {line}
          </div>
        ))}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            marginTop: 1,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: 8.5,
            color: liveOutput ? spriteColor : 'var(--text-2)',
          }}
        >
          <span>{profile.name}</span>
          <span style={{ color: 'var(--text-3)' }}>{profile.rarityStars}</span>
        </div>
        <div
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: 8,
            color: 'var(--text-3)',
          }}
        >
          {face}
        </div>
      </div>
    </div>
  );
}
