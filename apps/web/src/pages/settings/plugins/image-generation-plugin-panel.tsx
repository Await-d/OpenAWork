import type { CSSProperties, ReactElement } from 'react';
import type { AIProviderRef } from '@openAwork/shared-ui';
import type { ImageGenerationPluginSettings } from './plugin-settings-types.js';

interface ImageGenerationPluginPanelProps {
  settings: ImageGenerationPluginSettings;
  providers: AIProviderRef[];
  activeImageProviderId?: string;
  activeImageModelId?: string;
  onChange: (patch: Partial<ImageGenerationPluginSettings>) => void;
}

const SELECT_STYLE: CSSProperties = {
  appearance: 'none',
  WebkitAppearance: 'none',
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  color: 'var(--fg-strong)',
  cursor: 'pointer',
  fontSize: 12,
  padding: '7px 30px 7px 10px',
  width: '100%',
  backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394a3b8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
};

const LABEL: CSSProperties = {
  color: 'var(--fg-default)',
  fontSize: 11,
  fontWeight: 600,
};

export function ImageGenerationPluginPanel({
  settings,
  providers,
  activeImageProviderId,
  activeImageModelId,
  onChange,
}: ImageGenerationPluginPanelProps): ReactElement {
  const imageProviders = providers.filter(
    (p) => p.enabled && p.defaultModels.some((m) => m.enabled && m.supportsImageGeneration),
  );
  const activeImageProvider = providers.find((p) => p.id === activeImageProviderId);
  const activeImageModel = activeImageProvider?.defaultModels.find(
    (m) => m.id === activeImageModelId,
  );
  const modelSource = settings.modelSource ?? 'global';

  return (
    <section
      style={{
        background: 'var(--bg-overlay)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        display: 'grid',
        gap: 12,
        padding: '12px 14px',
      }}
    >
      <div>
        <h3 style={{ color: 'var(--fg-strong)', fontSize: 12, fontWeight: 700, margin: 0 }}>
          图片模型来源
        </h3>
        <p style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.5, margin: '2px 0 0' }}>
          可以沿用全局绘图模型，也可以为该插件单独指定图片模型。
        </p>
      </div>

      <select
        aria-label="图片模型来源"
        value={modelSource}
        onChange={(e) => onChange({ modelSource: e.target.value as 'global' | 'dedicated' })}
        style={SELECT_STYLE}
      >
        <option value="global">使用全局绘图模型</option>
        <option value="dedicated">为此插件单独指定模型</option>
      </select>

      {modelSource === 'dedicated' ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={LABEL}>服务商</div>
          <select
            aria-label="图片服务商"
            value={settings.dedicatedProviderId ?? ''}
            onChange={(e) =>
              onChange({ dedicatedProviderId: e.target.value, dedicatedModelId: '' })
            }
            style={SELECT_STYLE}
          >
            <option value="">选择服务商…</option>
            {imageProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {settings.dedicatedProviderId
            ? (() => {
                const provider = providers.find((p) => p.id === settings.dedicatedProviderId);
                const models =
                  provider?.defaultModels.filter((m) => m.enabled && m.supportsImageGeneration) ??
                  [];
                return (
                  <>
                    <div style={LABEL}>模型</div>
                    <select
                      aria-label="图片模型"
                      value={settings.dedicatedModelId ?? ''}
                      onChange={(e) => onChange({ dedicatedModelId: e.target.value })}
                      style={SELECT_STYLE}
                    >
                      <option value="">选择模型…</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label || m.id}
                        </option>
                      ))}
                    </select>
                  </>
                );
              })()
            : null}
        </div>
      ) : activeImageProvider && activeImageModel ? (
        <div
          style={{
            alignItems: 'center',
            background: 'var(--bg-base)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            display: 'flex',
            gap: 10,
            padding: '8px 10px',
          }}
        >
          <span
            aria-hidden
            style={{
              background: 'var(--accent)',
              borderRadius: '50%',
              flexShrink: 0,
              height: 8,
              width: 8,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--fg-strong)', fontSize: 12, fontWeight: 600 }}>
              {activeImageProvider.name}
            </div>
            <div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
              {activeImageModel.label || activeImageModel.id}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
