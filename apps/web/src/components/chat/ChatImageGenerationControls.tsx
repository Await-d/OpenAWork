import React, { useState } from 'react';
import {
  IMAGE_GENERATION_SIZE_PRESET_GROUPS,
  resolveImageGenerationSizePresetId,
  sizeForPreset,
  validateImageGenerationSize,
} from '@openAwork/shared';
import type { SavedChatImageDefaults } from '../../utils/chat-session-defaults.js';

export interface ChatImageGenerationControlsProps {
  busy: boolean;
  disabled: boolean;
  hasConfiguredModel: boolean;
  imageDefaults: SavedChatImageDefaults;
  imageMode: boolean;
  imageModelLabel: string;
  imagePluginEnabled?: boolean;
  onToggleImageMode: () => void;
  onUpdateImageDefaults: (updates: Partial<SavedChatImageDefaults>) => void;
  variant: 'toggle' | 'panel';
}

const iconButtonBaseStyle: React.CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  width: 26,
  height: 26,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'width 220ms ease, height 220ms ease, opacity 150ms ease, background 150ms ease, color 150ms ease',
};

const selectStyle: React.CSSProperties = {
  minHeight: 30,
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 12,
  padding: '0 10px',
};

export function ChatImageGenerationControls({
  busy,
  disabled,
  hasConfiguredModel,
  imageDefaults,
  imageMode,
  imageModelLabel,
  imagePluginEnabled = true,
  onToggleImageMode,
  onUpdateImageDefaults,
  variant,
}: ChatImageGenerationControlsProps) {
  const [forceCustomSize, setForceCustomSize] = useState(false);
  const pluginOff = !imagePluginEnabled;
  const toggleDisabled = disabled || !hasConfiguredModel || pluginOff;

  if (variant === 'toggle') {
    return (
      <button
        type="button"
        onClick={onToggleImageMode}
        disabled={toggleDisabled}
        title={
          pluginOff
            ? '图片插件未启用，请在设置 → 插件中开启'
            : hasConfiguredModel
              ? imageMode
                ? '切回普通对话模式'
                : '切换到图片生成模式'
              : '请先在设置中配置图片模型'
        }
        className={`icon-btn${imageMode ? ' active' : ''}`}
        style={{
          ...iconButtonBaseStyle,
          opacity: toggleDisabled ? 0.45 : 1,
          background: imageMode
            ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
            : 'var(--surface)',
          color: imageMode ? 'var(--accent)' : 'var(--text-3)',
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
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="8.5" cy="10" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      </button>
    );
  }

  if (!imageMode) {
    return null;
  }

  const sizePresetId = resolveImageGenerationSizePresetId(imageDefaults.size);
  const sizeValidation = validateImageGenerationSize(imageDefaults.size);
  const isCustomSize = forceCustomSize || sizePresetId === 'custom';

  return (
    <div
      style={{
        display: 'grid',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid var(--border-subtle)',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="8.5" cy="10" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
        <strong style={{ fontSize: 12, color: 'var(--text)', flex: 1, minWidth: 0 }}>
          图片生成
        </strong>
        {busy && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 999,
              padding: '2px 7px',
              background: 'color-mix(in oklch, var(--warning) 14%, transparent)',
              color: 'var(--warning)',
            }}
          >
            生成中…
          </span>
        )}
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-3)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 160,
          }}
          title={imageModelLabel || '未配置'}
        >
          {imageModelLabel || '未配置'}
        </span>
        <button
          type="button"
          onClick={onToggleImageMode}
          title="关闭图片生成模式"
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--text-3)',
            cursor: 'pointer',
            padding: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4,
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18" /><path d="M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Size presets - compact */}
      <div style={{ display: 'grid', gap: 6 }}>
        {IMAGE_GENERATION_SIZE_PRESET_GROUPS.map((group) => (
          <div key={group.tier} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span
              style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, minWidth: 28 }}
              title={group.description}
            >
              {group.label}
            </span>
            {group.presets.map((preset) => {
              const active = sizePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={busy}
                  onClick={() => { setForceCustomSize(false); onUpdateImageDefaults({ size: preset.size }); }}
                  title={preset.description}
                  style={{
                    borderRadius: 999,
                    border: '1px solid var(--border-subtle)',
                    background: active
                      ? 'color-mix(in oklch, var(--accent) 16%, transparent)'
                      : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-2)',
                    padding: '2px 8px',
                    fontSize: 11,
                    fontWeight: active ? 700 : 500,
                    cursor: busy ? 'default' : 'pointer',
                    opacity: busy ? 0.5 : 1,
                  }}
                >
                  {preset.label}
                </button>
              );
            })}
            {group.tier === '2k' && (
              <span style={{ fontSize: 9, color: 'var(--text-3)', fontStyle: 'italic' }}>
                ~4MP
              </span>
            )}
            {group.tier === '4k' && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: 'var(--warning)',
                  borderRadius: 4,
                  padding: '1px 5px',
                  background: 'color-mix(in oklch, var(--warning) 10%, transparent)',
                }}
              >
                ~8MP · 实验性
              </span>
            )}
          </div>
        ))}
        {/* Custom size inline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!isCustomSize) {
                setForceCustomSize(true);
              }
            }}
            style={{
              borderRadius: 999,
              border: '1px solid var(--border-subtle)',
              background: isCustomSize
                ? 'color-mix(in oklch, var(--accent) 16%, transparent)'
                : 'transparent',
              color: isCustomSize ? 'var(--accent)' : 'var(--text-2)',
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: isCustomSize ? 700 : 500,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.5 : 1,
            }}
          >
            自定义
          </button>
          {isCustomSize && (
            <input
              disabled={busy}
              value={imageDefaults.size}
              onChange={(event) => onUpdateImageDefaults({ size: event.target.value })}
              placeholder="WxH, 如 2560x1440"
              style={{
                ...selectStyle,
                minHeight: 26,
                padding: '0 8px',
                fontSize: 11,
                width: 130,
              }}
            />
          )}
          {isCustomSize && !sizeValidation.valid && (
            <span style={{ fontSize: 10, color: 'var(--warning)' }}>
              {sizeValidation.message}
            </span>
          )}
        </div>
      </div>

      {/* Quality / Format / Background - compact row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600 }}>质量</span>
        {(['low', 'medium', 'high'] as const).map((q) => {
          const qLabel = q === 'low' ? '速度优先' : q === 'medium' ? '平衡' : '细节优先';
          const active = imageDefaults.quality === q;
          return (
            <button
              key={q}
              type="button"
              disabled={busy}
              onClick={() => onUpdateImageDefaults({ quality: q })}
              style={{
                borderRadius: 999,
                border: '1px solid var(--border-subtle)',
                background: active
                  ? 'color-mix(in oklch, var(--accent) 16%, transparent)'
                  : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text-2)',
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: active ? 700 : 500,
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.5 : 1,
              }}
            >
              {qLabel}
            </button>
          );
        })}
        <span style={{ width: 1, height: 14, background: 'var(--border-subtle)', flexShrink: 0 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, color: 'var(--text-3)' }}>格式</span>
          <select
            disabled={busy}
            value={imageDefaults.outputFormat}
            onChange={(event) =>
              onUpdateImageDefaults({
                outputFormat: event.target.value as SavedChatImageDefaults['outputFormat'],
              })
            }
            style={{ ...selectStyle, minHeight: 26, padding: '0 6px', fontSize: 11 }}
          >
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, color: 'var(--text-3)' }}>背景</span>
          <select
            disabled={busy}
            value={imageDefaults.background}
            onChange={(event) =>
              onUpdateImageDefaults({
                background: event.target.value as SavedChatImageDefaults['background'],
              })
            }
            style={{ ...selectStyle, minHeight: 26, padding: '0 6px', fontSize: 11 }}
          >
            <option value="auto">自动</option>
            <option value="opaque">不透明</option>
          </select>
        </label>
      </div>
    </div>
  );
}
