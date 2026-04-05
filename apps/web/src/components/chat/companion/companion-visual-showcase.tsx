import { useEffect, useMemo, useState } from 'react';
import { createCompanionPreviewProfile, type CompanionProfile } from './companion-display-model.js';
import { deriveCompanionStats, getCompanionRarityVisual } from './companion-visual-metadata.js';
import {
  renderCompanionFace,
  renderCompanionSprite,
  SPRITE_SPECIES,
  spriteFrameCount,
} from './companion-sprite-model.js';

const TICK_MS = 500;
const PET_BURST_MS = 2500;
const IDLE_SEQUENCE = [0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 2, 0, 0, 0] as const;
const PET_HEARTS = ['   ♥    ♥   ', '  ♥  ♥   ♥  ', ' ♥   ♥  ♥   ', '♥  ♥      ♥ ', '·    ·   ·  '];
const GALLERY_BUBBLES = [
  '我负责在边缘看节奏。',
  '点名 /buddy 时我会更靠近。',
  '这张卡正在播放源仓同款 idle 动画。',
  '我在这里，尽量不抢主线。',
] as const;

function useVisualTick(reducedMotion: boolean): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reducedMotion) {
      return;
    }
    const timer = globalThis.setInterval(() => {
      setTick((current) => current + 1);
    }, TICK_MS);
    return () => {
      globalThis.clearInterval(timer);
    };
  }, [reducedMotion]);

  return tick;
}

function resolveSpriteFrame(
  tick: number,
  frameCount: number,
  excited: boolean,
): {
  blink: boolean;
  spriteFrame: number;
} {
  if (excited) {
    return { blink: false, spriteFrame: tick % frameCount };
  }

  const sequenceStep = IDLE_SEQUENCE[tick % IDLE_SEQUENCE.length] ?? 0;
  if (sequenceStep === -1) {
    return { blink: true, spriteFrame: 0 };
  }

  return { blink: false, spriteFrame: sequenceStep % frameCount };
}

function CompanionPreviewCard({
  badge,
  bubbleText,
  hero = false,
  highlighted = false,
  profile,
  reducedMotion,
  tick,
}: {
  badge: string;
  bubbleText: string;
  hero?: boolean;
  highlighted?: boolean;
  profile: CompanionProfile;
  reducedMotion: boolean;
  tick: number;
}) {
  const [petTickStart, setPetTickStart] = useState<number | null>(null);
  const [focusVisible, setFocusVisible] = useState(false);
  const petting =
    petTickStart !== null && !reducedMotion && (tick - petTickStart) * TICK_MS < PET_BURST_MS;
  const frameCount = spriteFrameCount(profile.sprite.species);
  const { blink, spriteFrame } = resolveSpriteFrame(
    tick,
    frameCount,
    Boolean(bubbleText) || petting,
  );

  const spriteLines = useMemo(() => {
    const body = renderCompanionSprite(profile.sprite, spriteFrame).map((line) =>
      blink ? line.replaceAll(profile.sprite.eye, '-') : line,
    );
    if (!petting) {
      return body;
    }
    return [PET_HEARTS[tick % PET_HEARTS.length] ?? PET_HEARTS[0], ...body];
  }, [blink, petting, profile.sprite, spriteFrame, tick]);
  const rarityVisual = getCompanionRarityVisual(profile.sprite.rarity);
  const stats = useMemo(() => deriveCompanionStats(profile), [profile]);

  return (
    <button
      type="button"
      data-testid="companion-gallery-card"
      aria-label={`${profile.name} 预览卡片，点击播放爱心动效`}
      aria-current={highlighted ? 'true' : undefined}
      onMouseEnter={() => setPetTickStart(tick)}
      onFocus={() => {
        setPetTickStart(tick);
        setFocusVisible(true);
      }}
      onBlur={() => setFocusVisible(false)}
      onClick={() => setPetTickStart(tick)}
      title="点击只会播放预览动效，不会切换当前 Persona"
      style={{
        width: '100%',
        border: highlighted
          ? `1px solid ${rarityVisual.borderColor}`
          : '1px solid color-mix(in oklch, var(--border) 88%, transparent)',
        borderRadius: 14,
        background: hero
          ? `linear-gradient(180deg, ${profile.accentTint}, color-mix(in oklch, var(--surface) 94%, transparent))`
          : `linear-gradient(180deg, color-mix(in oklch, ${profile.accentTint} 84%, transparent), color-mix(in oklch, var(--surface) 94%, transparent))`,
        padding: hero ? 16 : 14,
        display: 'grid',
        gap: 10,
        textAlign: 'left',
        cursor: 'pointer',
        boxShadow: highlighted
          ? `0 0 0 1px ${rarityVisual.borderColor}, 0 22px 44px -32px rgba(0,0,0,0.48)`
          : focusVisible
            ? `0 0 0 2px color-mix(in oklch, var(--accent) 34%, transparent), 0 18px 40px -34px rgba(0,0,0,0.45)`
            : '0 18px 40px -34px rgba(0,0,0,0.45)',
        transform: hero ? 'translateY(-1px)' : 'none',
        transition: 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{profile.name}</div>
          <div style={{ marginTop: 3, fontSize: 11, color: 'var(--text-2)' }}>
            {profile.species} · {profile.rarityStars}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 20,
              padding: '0 8px',
              borderRadius: 999,
              background: rarityVisual.background,
              border: `1px solid ${rarityVisual.borderColor}`,
              color: rarityVisual.color,
              fontSize: 10,
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {rarityVisual.label}
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 20,
              padding: '0 8px',
              borderRadius: 999,
              background: 'color-mix(in oklch, var(--surface) 84%, transparent)',
              color: 'var(--text-2)',
              fontSize: 10,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {badge}
          </span>
        </div>
      </div>

      <div
        style={{
          borderRadius: 12,
          border: '1px solid color-mix(in oklch, var(--border-subtle) 88%, transparent)',
          background: 'color-mix(in oklch, var(--surface) 90%, transparent)',
          padding: '10px 12px',
          display: 'grid',
          gap: 10,
        }}
      >
        <div
          style={{
            maxWidth: 280,
            borderRadius: 12,
            border: '1px solid color-mix(in oklch, var(--border) 78%, transparent)',
            background: 'color-mix(in oklch, var(--surface) 92%, transparent)',
            padding: '10px 12px',
            fontSize: 11,
            lineHeight: 1.55,
            color: 'var(--text-2)',
            justifySelf: 'start',
          }}
        >
          {bubbleText}
        </div>

        <div
          style={{
            display: 'grid',
            justifyItems: 'center',
            gap: 4,
            minHeight: 130,
            alignContent: 'end',
          }}
        >
          {spriteLines.map((line, index) => (
            <div
              key={`${profile.sprite.species}-${index}-${line}`}
              style={{
                whiteSpace: 'pre',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: 10,
                lineHeight: 1.02,
                color:
                  petting && index === 0
                    ? 'color-mix(in oklch, var(--danger) 82%, white 18%)'
                    : profile.accentColor,
                textShadow: '0 0 10px color-mix(in oklch, currentColor 10%, transparent)',
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
              gap: 6,
              marginTop: 2,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: 10,
              color: 'var(--text-2)',
            }}
          >
            <span>{profile.name}</span>
            <span style={{ color: 'var(--text-3)' }}>{profile.rarityStars}</span>
          </div>
          <div
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: 9,
              color: 'var(--text-3)',
            }}
          >
            {renderCompanionFace(profile.sprite)}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {profile.traits.map((trait) => (
          <span
            key={trait}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 22,
              padding: '0 8px',
              borderRadius: 999,
              background: 'color-mix(in oklch, var(--surface) 84%, transparent)',
              color: 'var(--text-2)',
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            {trait}
          </span>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
          gap: 8,
        }}
      >
        {stats.map((stat) => (
          <div
            key={stat.key}
            style={{
              borderRadius: 10,
              border: '1px solid color-mix(in oklch, var(--border-subtle) 88%, transparent)',
              background: 'color-mix(in oklch, var(--surface) 90%, transparent)',
              padding: '8px 9px',
              display: 'grid',
              gap: 6,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-2)' }}>
                {stat.label}
              </span>
              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text)' }}>
                {stat.value}
              </span>
            </div>
            <div
              style={{
                height: 6,
                borderRadius: 999,
                background: 'color-mix(in oklch, var(--surface-hover) 88%, transparent)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${stat.value}%`,
                  height: '100%',
                  borderRadius: 999,
                  background: highlighted
                    ? `linear-gradient(90deg, ${rarityVisual.color}, ${profile.accentColor})`
                    : `linear-gradient(90deg, ${profile.accentColor}, color-mix(in oklch, ${profile.accentColor} 72%, white 28%))`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </button>
  );
}

export function CompanionVisualShowcase({
  profile,
  reducedMotion,
  seedBase,
}: {
  profile: CompanionProfile;
  reducedMotion: boolean;
  seedBase: string;
}) {
  const tick = useVisualTick(reducedMotion);
  const galleryPanelId = 'companion-gallery-panel';
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof globalThis.window !== 'undefined' ? globalThis.window.innerWidth <= 860 : false,
  );
  const [galleryExpanded, setGalleryExpanded] = useState(() =>
    typeof globalThis.window !== 'undefined' ? globalThis.window.innerWidth > 860 : true,
  );
  const [galleryToggledByUser, setGalleryToggledByUser] = useState(false);
  const galleryProfiles = useMemo(
    () =>
      SPRITE_SPECIES.map((species, index) =>
        createCompanionPreviewProfile(species, `${seedBase}:${species}:${index}`),
      ),
    [seedBase],
  );

  useEffect(() => {
    if (typeof globalThis.window === 'undefined') {
      return;
    }

    const updateViewport = () => {
      setIsNarrow(globalThis.window.innerWidth <= 860);
    };

    updateViewport();
    globalThis.window.addEventListener('resize', updateViewport);
    return () => {
      globalThis.window.removeEventListener('resize', updateViewport);
    };
  }, []);

  useEffect(() => {
    if (galleryToggledByUser) {
      return;
    }
    setGalleryExpanded(!isNarrow);
  }, [galleryToggledByUser, isNarrow]);

  return (
    <section style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-3)',
          }}
        >
          当前 Buddy
        </div>
        <CompanionPreviewCard
          badge="已激活"
          bubbleText={profile.note}
          hero={true}
          highlighted={true}
          profile={profile}
          reducedMotion={reducedMotion}
          tick={tick}
        />
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-3)',
              }}
            >
              伴侣图鉴
            </div>
            <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.6, color: 'var(--text-2)' }}>
              下方完整展示源仓 companion 物种与 idle / pet 动画。悬停或点击卡片会触发一次 pet
              hearts，但不会切换你当前正在使用的 Persona。
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
              {galleryProfiles.length} 种 companion
            </div>
            <button
              data-testid="companion-gallery-toggle"
              type="button"
              aria-controls={galleryPanelId}
              aria-expanded={galleryExpanded}
              onClick={() => {
                setGalleryToggledByUser(true);
                setGalleryExpanded((current) => !current);
              }}
              style={{
                borderRadius: 999,
                border: '1px solid var(--border-subtle)',
                background: 'color-mix(in oklch, var(--surface) 88%, transparent)',
                color: 'var(--text-2)',
                minHeight: 30,
                padding: '0 10px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {galleryExpanded ? '收起图鉴' : `展开图鉴 · ${galleryProfiles.length}`}
            </button>
          </div>
        </div>

        <div id={galleryPanelId}>
          {galleryExpanded ? (
            <div
              data-testid="companion-gallery-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12,
              }}
            >
              {galleryProfiles.map((item, index) => (
                <CompanionPreviewCard
                  key={`${item.sprite.species}-${index}`}
                  badge={item.sprite.species === profile.sprite.species ? '当前物种' : '点击试动效'}
                  bubbleText={GALLERY_BUBBLES[index % GALLERY_BUBBLES.length] ?? GALLERY_BUBBLES[0]}
                  highlighted={item.sprite.species === profile.sprite.species}
                  profile={item}
                  reducedMotion={reducedMotion}
                  tick={tick}
                />
              ))}
            </div>
          ) : (
            <div
              style={{
                borderRadius: 14,
                border: '1px solid var(--border-subtle)',
                padding: '12px 14px',
                background: 'color-mix(in oklch, var(--surface) 92%, transparent)',
                fontSize: 12,
                lineHeight: 1.7,
                color: 'var(--text-2)',
              }}
            >
              图鉴已收起，适合在移动端或快速调设置时减少滚动；需要时可以随时重新展开查看全部物种。
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
