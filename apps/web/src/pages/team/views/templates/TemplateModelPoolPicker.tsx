/**
 * 模型池选择器：按真实 provider 分组列出 enabled 模型，复选加入/移出模板候选池。
 *
 * 放在 TemplateMetaHeader「更多设置」里，替代原先单一的「默认 Provider」选择。
 * 勾选的模型构成候选池，供「智能分配模型」在池内挑选。
 */

import { type CSSProperties, useMemo } from 'react';
import type { WorkflowTeamTemplateModelRef } from '@openAwork/web-client';
import type { ChatSettingsProvider } from '../../../../utils/chat/chat-session-defaults.js';
import { compareModelsByName } from './model-assignment.js';

interface Props {
  providers: ChatSettingsProvider[];
  loading: boolean;
  error: string | null;
  editable: boolean;
  pool: WorkflowTeamTemplateModelRef[];
  onChange: (pool: WorkflowTeamTemplateModelRef[]) => void;
  onReload: () => void;
}

const CAP_BADGE: CSSProperties = {
  fontSize: 8,
  fontWeight: 700,
  padding: '0 4px',
  borderRadius: 4,
  lineHeight: '14px',
  height: 14,
  flexShrink: 0,
};

function poolKey(ref: WorkflowTeamTemplateModelRef): string {
  return `${ref.providerId}::${ref.modelId}`;
}

export function TemplateModelPoolPicker({
  providers,
  loading,
  error,
  editable,
  pool,
  onChange,
  onReload,
}: Props) {
  const selected = useMemo(() => new Set(pool.map(poolKey)), [pool]);

  const toggle = (providerId: string, modelId: string) => {
    if (!editable) return;
    const key = `${providerId}::${modelId}`;
    if (selected.has(key)) {
      onChange(pool.filter((ref) => poolKey(ref) !== key));
    } else {
      onChange([...pool, { providerId, modelId }]);
    }
  };

  const toggleProvider = (provider: ChatSettingsProvider) => {
    if (!editable) return;
    const modelIds = provider.defaultModels.map((m) => m.id);
    const allSelected = modelIds.every((id) => selected.has(`${provider.id}::${id}`));
    if (allSelected) {
      onChange(pool.filter((ref) => ref.providerId !== provider.id));
    } else {
      const additions = modelIds
        .filter((id) => !selected.has(`${provider.id}::${id}`))
        .map((id) => ({ providerId: provider.id, modelId: id }));
      onChange([...pool, ...additions]);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: 'var(--fg-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          模型池 · 已选 {pool.length}
        </span>
        <button
          type="button"
          onClick={onReload}
          style={{
            appearance: 'none',
            border: 'none',
            background: 'transparent',
            color: 'var(--accent)',
            fontSize: 10,
            fontWeight: 700,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          刷新
        </button>
        <span style={{ flex: 1 }} />
      </div>

      {loading ? (
        <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>加载模型列表…</span>
      ) : error ? (
        <span style={{ fontSize: 10, color: 'var(--danger)' }}>{error}</span>
      ) : providers.length === 0 ? (
        <span style={{ fontSize: 10, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          未检测到已启用的 Provider。请先在「设置 → 连接」里配置并启用模型。
        </span>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {providers.map((provider) => {
            // 模型按名称排序（数字感知），便于用户在池里快速定位。
            const sortedModels = [...provider.defaultModels].sort(compareModelsByName);
            const modelIds = sortedModels.map((m) => m.id);
            const selectedCount = modelIds.filter((id) =>
              selected.has(`${provider.id}::${id}`),
            ).length;
            const allSelected = modelIds.length > 0 && selectedCount === modelIds.length;
            return (
              <div
                key={provider.id}
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  background: 'var(--bg-base)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--fg-strong)' }}>
                    {provider.name}
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--fg-muted)' }}>
                    {selectedCount}/{modelIds.length}
                  </span>
                  <span style={{ flex: 1 }} />
                  {editable && modelIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => toggleProvider(provider)}
                      style={{
                        appearance: 'none',
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--accent)',
                        fontSize: 9,
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      {allSelected ? '全不选' : '全选'}
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {sortedModels.length === 0 ? (
                    <span style={{ fontSize: 9, color: 'var(--fg-muted)' }}>无启用模型</span>
                  ) : (
                    sortedModels.map((model) => {
                      const isSel = selected.has(`${provider.id}::${model.id}`);
                      return (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => toggle(provider.id, model.id)}
                          disabled={!editable}
                          title={model.id}
                          style={{
                            appearance: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            border: isSel
                              ? '1px solid color-mix(in oklch, var(--accent) 55%, transparent)'
                              : '1px solid var(--border-subtle)',
                            background: isSel
                              ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
                              : 'var(--bg-overlay)',
                            color: isSel ? 'var(--accent)' : 'var(--fg-default)',
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '3px 8px',
                            borderRadius: 999,
                            cursor: editable ? 'pointer' : 'default',
                          }}
                        >
                          {isSel ? '✓ ' : ''}
                          {model.label}
                          {model.supportsThinking && (
                            <span
                              style={{
                                ...CAP_BADGE,
                                color: 'var(--chart-5)',
                                background: 'color-mix(in oklch, var(--chart-5) 14%, transparent)',
                              }}
                              title="支持思考 / 推理"
                            >
                              R
                            </span>
                          )}
                          {model.supportsTools && (
                            <span
                              style={{
                                ...CAP_BADGE,
                                color: 'var(--aux)',
                                background: 'color-mix(in oklch, var(--aux) 14%, transparent)',
                              }}
                              title="支持工具调用"
                            >
                              T
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
