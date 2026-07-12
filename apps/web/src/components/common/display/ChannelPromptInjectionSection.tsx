import { useMemo } from 'react';
import {
  buildAvailableChannelCapabilityToolGroups,
  buildAvailableChannelCapabilityToolGroupsFromCounts,
  CHANNEL_CAPABILITY_TOOL_GROUP_OPTIONS,
  hasAvailableChannelCapabilityToolGroups,
} from './channel-capability-tool-groups.js';
import type {
  ChannelCapabilityCatalogCounts,
  ChannelCapabilityContextPromptInjections,
  ChannelDescriptorTool,
  ChannelPermissionsEntry,
  ChannelPromptInjections,
} from './channel-subscription-settings.types.js';

const PROMPT_INJECTION_OPTIONS: Array<{
  key: Exclude<keyof ChannelCapabilityContextPromptInjections, 'toolGroups'>;
  label: string;
  description: string;
}> = [
  {
    key: 'agents',
    label: '注入 Agents 目录',
    description: '在 capabilityContext 中列出当前可见的系统 Agents 目录。',
  },
  {
    key: 'skills',
    label: '注入 Skills 目录',
    description: '在 capabilityContext 中列出当前已启用的 Skills 目录。',
  },
  {
    key: 'mcps',
    label: '注入 MCP 目录',
    description: '在 capabilityContext 中列出当前可见的 MCP Servers 目录。',
  },
  {
    key: 'tools',
    label: '注入 Tools 目录',
    description: '在 capabilityContext 中列出聊天回合可调用的工具目录。',
  },
  {
    key: 'commands',
    label: '注入 Commands 目录',
    description: '在 capabilityContext 中列出系统命令与参考命令目录。',
  },
];

interface ChannelPromptInjectionSectionProps {
  channelLlmToolsEnabled: boolean;
  descriptorTools?: readonly ChannelDescriptorTool[];
  tools: Record<string, boolean>;
  permissions: ChannelPermissionsEntry;
  promptInjections: ChannelPromptInjections;
  capabilityCatalogCounts?: ChannelCapabilityCatalogCounts | null;
  onChange: (promptInjections: ChannelPromptInjections) => void;
}

export function ChannelPromptInjectionSection({
  channelLlmToolsEnabled,
  descriptorTools,
  tools,
  permissions,
  promptInjections,
  capabilityCatalogCounts,
  onChange,
}: ChannelPromptInjectionSectionProps) {
  const countedAvailableToolPromptGroups = useMemo(
    () =>
      capabilityCatalogCounts
        ? buildAvailableChannelCapabilityToolGroupsFromCounts({
            channelLlmToolsEnabled,
            toolGroups: capabilityCatalogCounts.toolGroups,
          })
        : null,
    [capabilityCatalogCounts, channelLlmToolsEnabled],
  );

  const availableToolPromptGroups = useMemo(
    () =>
      countedAvailableToolPromptGroups ??
      buildAvailableChannelCapabilityToolGroups({
        channelLlmToolsEnabled,
        tools,
        permissions,
        descriptorTools,
      }),
    [channelLlmToolsEnabled, countedAvailableToolPromptGroups, descriptorTools, permissions, tools],
  );

  const hasAvailableToolPromptGroups = useMemo(
    () => hasAvailableChannelCapabilityToolGroups(availableToolPromptGroups),
    [availableToolPromptGroups],
  );

  const toolPromptInjectionOptions = useMemo(
    () =>
      CHANNEL_CAPABILITY_TOOL_GROUP_OPTIONS.filter(
        (option) => availableToolPromptGroups[option.key],
      ),
    [availableToolPromptGroups],
  );

  function updatePromptInjection(
    key: Exclude<keyof ChannelCapabilityContextPromptInjections, 'toolGroups'>,
    enabled: boolean,
  ): void {
    onChange({
      capabilityContext: {
        ...promptInjections.capabilityContext,
        [key]: enabled,
      },
    });
  }

  function updatePromptInjectionToolGroup(
    key: keyof ChannelPromptInjections['capabilityContext']['toolGroups'],
    enabled: boolean,
  ): void {
    onChange({
      capabilityContext: {
        ...promptInjections.capabilityContext,
        toolGroups: {
          ...promptInjections.capabilityContext.toolGroups,
          [key]: enabled,
        },
      },
    });
  }

  function renderPromptInjectionCount(
    key: Exclude<keyof ChannelCapabilityContextPromptInjections, 'toolGroups'>,
  ): string | null {
    const count = capabilityCatalogCounts?.[key];
    return typeof count === 'number' ? `当前共 ${count} 个` : null;
  }

  function renderToolPromptInjectionCount(
    key: keyof ChannelPromptInjections['capabilityContext']['toolGroups'],
  ): string | null {
    const count = capabilityCatalogCounts?.toolGroups[key];
    return typeof count === 'number' && count > 0 ? `当前共 ${count} 个` : null;
  }

  return (
    <section className="channel-section">
      <div className="channel-section__head">
        <div>
          <h4 className="channel-section__title">提示词注入</h4>
          <div className="channel-muted">
            真实工具会先按白名单与权限自动收敛；这里仅决定是否继续在 capabilityContext
            中展示这些目录，不改变实际执行权限。
          </div>
        </div>
      </div>
      <div className="channel-section__body" style={{ display: 'grid', gap: 14 }}>
        <div className="channel-tool-grid">
          {PROMPT_INJECTION_OPTIONS.map((option) => (
            <label key={option.key} className="channel-check-card">
              <input
                type="checkbox"
                checked={promptInjections.capabilityContext[option.key]}
                onChange={(event) => updatePromptInjection(option.key, event.target.checked)}
              />
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <div className="channel-check-card__title">{option.label}</div>
                  {renderPromptInjectionCount(option.key) ? (
                    <span className="channel-mini-badge">
                      {renderPromptInjectionCount(option.key)}
                    </span>
                  ) : null}
                </div>
                <div className="channel-check-card__desc">{option.description}</div>
              </div>
            </label>
          ))}
        </div>
        <div
          style={{
            display: 'grid',
            gap: 12,
            opacity:
              promptInjections.capabilityContext.tools && hasAvailableToolPromptGroups ? 1 : 0.64,
          }}
        >
          <div className="channel-muted">
            Tools
            目录会先跟随白名单与权限自动收敛。这里仅做额外隐藏，不改变真实工具白名单与执行权限。
          </div>
          {hasAvailableToolPromptGroups ? (
            <div className="channel-tool-grid">
              {toolPromptInjectionOptions.map((option) => (
                <label key={option.key} className="channel-check-card">
                  <input
                    type="checkbox"
                    disabled={!promptInjections.capabilityContext.tools}
                    checked={promptInjections.capabilityContext.toolGroups[option.key]}
                    onChange={(event) =>
                      updatePromptInjectionToolGroup(option.key, event.target.checked)
                    }
                  />
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div className="channel-check-card__title">{option.label}</div>
                      {renderToolPromptInjectionCount(option.key) ? (
                        <span className="channel-mini-badge">
                          {renderToolPromptInjectionCount(option.key)}
                        </span>
                      ) : null}
                    </div>
                    <div className="channel-check-card__desc">{option.description}</div>
                  </div>
                </label>
              ))}
            </div>
          ) : (
            <div className="channel-muted">
              当前白名单与权限下没有可注入的 Tools 分组。先在上方开启模型工具并放开对应白名单。
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
