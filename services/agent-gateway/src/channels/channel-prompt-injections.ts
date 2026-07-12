import type { ChannelCapabilityContextPromptInjections, ChannelPromptInjections } from './types.js';
import {
  DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS,
  normalizeChannelCapabilityContextToolPromptInjections,
} from './channel-capability-tool-groups.js';

export const DEFAULT_CHANNEL_CAPABILITY_CONTEXT_PROMPT_INJECTIONS: Readonly<
  Required<ChannelCapabilityContextPromptInjections>
> = {
  agents: true,
  skills: true,
  mcps: true,
  tools: true,
  toolGroups: DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS,
  commands: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolvePromptInjectionFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeChannelCapabilityContextPromptInjections(
  input?: ChannelCapabilityContextPromptInjections | null,
): Required<ChannelCapabilityContextPromptInjections> {
  return {
    agents: resolvePromptInjectionFlag(
      input?.agents,
      DEFAULT_CHANNEL_CAPABILITY_CONTEXT_PROMPT_INJECTIONS.agents,
    ),
    skills: resolvePromptInjectionFlag(
      input?.skills,
      DEFAULT_CHANNEL_CAPABILITY_CONTEXT_PROMPT_INJECTIONS.skills,
    ),
    mcps: resolvePromptInjectionFlag(
      input?.mcps,
      DEFAULT_CHANNEL_CAPABILITY_CONTEXT_PROMPT_INJECTIONS.mcps,
    ),
    tools: resolvePromptInjectionFlag(
      input?.tools,
      DEFAULT_CHANNEL_CAPABILITY_CONTEXT_PROMPT_INJECTIONS.tools,
    ),
    toolGroups: normalizeChannelCapabilityContextToolPromptInjections(input?.toolGroups),
    commands: resolvePromptInjectionFlag(
      input?.commands,
      DEFAULT_CHANNEL_CAPABILITY_CONTEXT_PROMPT_INJECTIONS.commands,
    ),
  };
}

export function normalizeChannelPromptInjections(input?: ChannelPromptInjections | null): {
  capabilityContext: Required<ChannelCapabilityContextPromptInjections>;
} {
  return {
    capabilityContext: normalizeChannelCapabilityContextPromptInjections(input?.capabilityContext),
  };
}

export function parseChannelPromptInjections(input: unknown): {
  capabilityContext: Required<ChannelCapabilityContextPromptInjections>;
} {
  if (!isRecord(input)) {
    return normalizeChannelPromptInjections();
  }

  const capabilityContext = isRecord(input['capabilityContext'])
    ? input['capabilityContext']
    : null;

  return normalizeChannelPromptInjections({
    capabilityContext: capabilityContext
      ? {
          agents:
            typeof capabilityContext['agents'] === 'boolean'
              ? capabilityContext['agents']
              : undefined,
          skills:
            typeof capabilityContext['skills'] === 'boolean'
              ? capabilityContext['skills']
              : undefined,
          mcps:
            typeof capabilityContext['mcps'] === 'boolean' ? capabilityContext['mcps'] : undefined,
          tools:
            typeof capabilityContext['tools'] === 'boolean'
              ? capabilityContext['tools']
              : undefined,
          toolGroups: isRecord(capabilityContext['toolGroups'])
            ? {
                web:
                  typeof capabilityContext['toolGroups']['web'] === 'boolean'
                    ? capabilityContext['toolGroups']['web']
                    : undefined,
                lsp:
                  typeof capabilityContext['toolGroups']['lsp'] === 'boolean'
                    ? capabilityContext['toolGroups']['lsp']
                    : undefined,
                files:
                  typeof capabilityContext['toolGroups']['files'] === 'boolean'
                    ? capabilityContext['toolGroups']['files']
                    : undefined,
                shell:
                  typeof capabilityContext['toolGroups']['shell'] === 'boolean'
                    ? capabilityContext['toolGroups']['shell']
                    : undefined,
                orchestration:
                  typeof capabilityContext['toolGroups']['orchestration'] === 'boolean'
                    ? capabilityContext['toolGroups']['orchestration']
                    : undefined,
                session:
                  typeof capabilityContext['toolGroups']['session'] === 'boolean'
                    ? capabilityContext['toolGroups']['session']
                    : undefined,
                mcp:
                  typeof capabilityContext['toolGroups']['mcp'] === 'boolean'
                    ? capabilityContext['toolGroups']['mcp']
                    : undefined,
                desktop:
                  typeof capabilityContext['toolGroups']['desktop'] === 'boolean'
                    ? capabilityContext['toolGroups']['desktop']
                    : undefined,
                repo:
                  typeof capabilityContext['toolGroups']['repo'] === 'boolean'
                    ? capabilityContext['toolGroups']['repo']
                    : undefined,
                channel:
                  typeof capabilityContext['toolGroups']['channel'] === 'boolean'
                    ? capabilityContext['toolGroups']['channel']
                    : undefined,
                other:
                  typeof capabilityContext['toolGroups']['other'] === 'boolean'
                    ? capabilityContext['toolGroups']['other']
                    : undefined,
              }
            : undefined,
          commands:
            typeof capabilityContext['commands'] === 'boolean'
              ? capabilityContext['commands']
              : undefined,
        }
      : undefined,
  });
}
