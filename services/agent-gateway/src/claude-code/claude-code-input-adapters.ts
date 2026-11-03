import { truncateQuestionLabels } from '../tools/question-label-truncator.js';
import {
  CLAUDE_CODE_AGENT_ALLOWED_AGENTS,
  isClaudeCodeAllowedAgent,
} from './claude-code-agent-allowed-agents.js';

export type ClaudeCodeCompatLevel = 'high' | 'medium' | 'low';

export interface ClaudeCodeToolEntry {
  readonly presentedName: string;
  readonly canonicalName: string | null;
  readonly compatLevel: ClaudeCodeCompatLevel;
  readonly note?: string;
}

export const CLAUDE_CODE_TOOL_REGISTRY: readonly ClaudeCodeToolEntry[] = [
  { presentedName: 'Edit', canonicalName: 'edit', compatLevel: 'high' },
  { presentedName: 'Write', canonicalName: 'write', compatLevel: 'high' },
  { presentedName: 'Glob', canonicalName: 'glob', compatLevel: 'high' },
  { presentedName: 'TodoWrite', canonicalName: 'todowrite', compatLevel: 'high' },
  { presentedName: 'TaskGet', canonicalName: 'task_get', compatLevel: 'high' },
  { presentedName: 'TaskList', canonicalName: 'task_list', compatLevel: 'high' },
  {
    presentedName: 'Bash',
    canonicalName: 'bash',
    compatLevel: 'medium',
    note: 'run_in_background maps to the gateway background-bash tool; description is retained there.',
  },
  {
    presentedName: 'Grep',
    canonicalName: 'grep',
    compatLevel: 'medium',
    note: 'The local grep tool supports only a subset of Claude Code Grep parameters.',
  },
  {
    presentedName: 'TaskCreate',
    canonicalName: 'task_create',
    compatLevel: 'medium',
    note: 'activeForm is not a first-class field in the local task_create contract.',
  },
  {
    presentedName: 'TaskUpdate',
    canonicalName: 'task_update',
    compatLevel: 'medium',
    note: 'taskId must be normalized to id; activeForm is stored in metadata when present.',
  },
  {
    presentedName: 'Read',
    canonicalName: 'read',
    compatLevel: 'medium',
    note: 'Read normalizes file_path to path for the canonical read tool.',
  },
  {
    presentedName: 'WebFetch',
    canonicalName: 'webfetch',
    compatLevel: 'medium',
    note: 'WebFetch maps to the canonical webfetch tool.',
  },
  {
    presentedName: 'WebSearch',
    canonicalName: 'websearch',
    compatLevel: 'medium',
    note: 'WebSearch maps to the canonical websearch tool.',
  },
  {
    presentedName: 'Skill',
    canonicalName: 'skill',
    compatLevel: 'medium',
    note: 'The local skill tool accepts only name/skill; args are rejected rather than ignored.',
  },
  {
    presentedName: 'AskUserQuestion',
    canonicalName: 'question',
    compatLevel: 'medium',
    note: 'The local question tool preserves preview data and renders it as plain text for single-select questions.',
  },
  {
    presentedName: 'Agent',
    canonicalName: 'subagent',
    compatLevel: 'medium',
    note: 'The current gateway supports a subset of the Claude Code Agent contract via the canonical subagent tool; the delegated agent must be in CLAUDE_CODE_AGENT_ALLOWED_AGENTS.',
  },
  {
    presentedName: 'EnterPlanMode',
    canonicalName: 'EnterPlanMode',
    compatLevel: 'high',
  },
  {
    presentedName: 'ExitPlanMode',
    canonicalName: 'ExitPlanMode',
    compatLevel: 'high',
  },
] as const;

const registryIndex = new Map<string, ClaudeCodeToolEntry>(
  CLAUDE_CODE_TOOL_REGISTRY.map((entry) => [entry.presentedName, entry]),
);

export interface ResolveResult {
  readonly canonicalName: string;
  readonly compatLevel: ClaudeCodeCompatLevel;
  readonly note?: string;
}

export class UnsupportedToolError extends Error {
  readonly presentedName: string;
  readonly hint?: string;

  constructor(presentedName: string, hint?: string) {
    super(
      `Claude Code tool "${presentedName}" is not supported in this gateway environment.${
        hint ? ` Hint: ${hint}` : ''
      }`,
    );
    this.name = 'UnsupportedToolError';
    this.presentedName = presentedName;
    this.hint = hint;
  }
}

export interface UnsupportedToolResult {
  readonly supported: false;
  readonly presentedName: string;
  readonly message: string;
  readonly hint?: string;
}

export function buildUnsupportedToolResult(
  presentedName: string,
  hint?: string,
): UnsupportedToolResult {
  return {
    supported: false,
    presentedName,
    message: `Tool "${presentedName}" is not supported in this environment.`,
    ...(hint ? { hint } : {}),
  };
}

export function resolvePresentedName(presentedName: string): ResolveResult {
  const entry = registryIndex.get(presentedName);
  if (!entry) {
    return { canonicalName: presentedName, compatLevel: 'high' };
  }

  if (entry.compatLevel === 'low' || entry.canonicalName === null) {
    throw new UnsupportedToolError(presentedName, entry.note);
  }

  return {
    canonicalName: entry.canonicalName,
    compatLevel: entry.compatLevel,
    ...(entry.note ? { note: entry.note } : {}),
  };
}

export type RawInput = Record<string, unknown>;

export interface NormalizedInput {
  readonly canonicalName: string;
  readonly normalizedFields: RawInput;
  readonly remapped: boolean;
}

const UNSUPPORTED_AGENT_FIELDS = [
  'model',
  'name',
  'team_name',
  'mode',
  'isolation',
  'cwd',
] as const;

const UNSUPPORTED_GREP_FIELDS = [
  '-A',
  '-B',
  '-C',
  '-n',
  '-i',
  'context',
  'type',
  'offset',
  'multiline',
] as const;

function rejectUnsupportedFields(
  presentedName: string,
  rawInput: RawInput,
  fieldNames: readonly string[],
): void {
  const unsupportedFields = fieldNames.filter((fieldName) => rawInput[fieldName] !== undefined);
  if (unsupportedFields.length === 0) return;

  throw new UnsupportedToolError(
    presentedName,
    `Unsupported field${unsupportedFields.length === 1 ? '' : 's'}: ${unsupportedFields.join(', ')}`,
  );
}

function normalizeTaskMetadata(metadata: unknown, activeForm: unknown): unknown {
  if (activeForm === undefined) {
    return metadata;
  }

  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return { ...metadata, activeForm };
  }

  return { activeForm };
}

export function normalizeInputForCanonical(
  presentedName: string,
  rawInput: RawInput,
): NormalizedInput {
  switch (presentedName) {
    case 'Edit': {
      const { file_path, old_string, new_string, replace_all } = rawInput;
      return {
        canonicalName: 'edit',
        normalizedFields: {
          filePath: file_path,
          oldString: old_string,
          newString: new_string,
          ...(replace_all !== undefined ? { replaceAll: replace_all } : {}),
        },
        remapped: true,
      };
    }
    case 'Write': {
      const { file_path, content } = rawInput;
      return {
        canonicalName: 'write',
        normalizedFields: {
          filePath: file_path,
          content,
        },
        remapped: true,
      };
    }
    case 'Glob': {
      const { pattern, path } = rawInput;
      return {
        canonicalName: 'glob',
        normalizedFields: {
          ...(pattern !== undefined ? { pattern } : {}),
          ...(path !== undefined ? { path } : {}),
        },
        remapped: false,
      };
    }
    case 'TodoWrite':
      return {
        canonicalName: 'todowrite',
        normalizedFields: rawInput,
        remapped: false,
      };
    case 'TaskGet': {
      const { taskId } = rawInput;
      return {
        canonicalName: 'task_get',
        normalizedFields: { id: taskId },
        remapped: true,
      };
    }
    case 'TaskList':
      return {
        canonicalName: 'task_list',
        normalizedFields: {},
        remapped: false,
      };
    case 'Bash': {
      if (rawInput['dangerouslyDisableSandbox'] === true) {
        throw new UnsupportedToolError(
          'Bash',
          'dangerouslyDisableSandbox is not permitted by the gateway.',
        );
      }

      const { command, description, run_in_background, timeout, workdir } = rawInput;
      if (run_in_background === true) {
        return {
          canonicalName: 'run_bash_in_background',
          normalizedFields: {
            ...(command !== undefined ? { command } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(timeout !== undefined ? { timeout } : {}),
            ...(workdir !== undefined ? { workdir } : {}),
          },
          remapped: true,
        };
      }
      return {
        canonicalName: 'bash',
        normalizedFields: {
          ...(command !== undefined ? { command } : {}),
          ...(timeout !== undefined ? { timeout } : {}),
          ...(workdir !== undefined ? { workdir } : {}),
        },
        remapped: true,
      };
    }
    case 'Grep': {
      rejectUnsupportedFields('Grep', rawInput, UNSUPPORTED_GREP_FIELDS);
      const { pattern, path, glob, output_mode, head_limit } = rawInput;
      return {
        canonicalName: 'grep',
        normalizedFields: {
          ...(pattern !== undefined ? { pattern } : {}),
          ...(path !== undefined ? { path } : {}),
          ...(glob !== undefined ? { include: glob } : {}),
          ...(output_mode !== undefined ? { output_mode } : {}),
          ...(head_limit !== undefined ? { head_limit } : {}),
        },
        remapped: true,
      };
    }
    case 'TaskCreate': {
      const { subject, description, metadata, activeForm } = rawInput;
      return {
        canonicalName: 'task_create',
        normalizedFields: {
          ...(subject !== undefined ? { subject } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(metadata !== undefined || activeForm !== undefined
            ? { metadata: normalizeTaskMetadata(metadata, activeForm) }
            : {}),
        },
        remapped: activeForm !== undefined,
      };
    }
    case 'TaskUpdate': {
      const { taskId, metadata, activeForm, ...rest } = rawInput;
      return {
        canonicalName: 'task_update',
        normalizedFields: {
          ...(taskId !== undefined ? { id: taskId } : {}),
          ...rest,
          ...(metadata !== undefined || activeForm !== undefined
            ? { metadata: normalizeTaskMetadata(metadata, activeForm) }
            : {}),
        },
        remapped: taskId !== undefined || activeForm !== undefined,
      };
    }
    case 'Skill': {
      rejectUnsupportedFields('Skill', rawInput, ['args']);
      const { name, skill } = rawInput;
      return {
        canonicalName: 'skill',
        normalizedFields: {
          name: typeof name === 'string' && name.length > 0 ? name : skill,
        },
        remapped: true,
      };
    }
    case 'AskUserQuestion': {
      const normalizedQuestions = Array.isArray(rawInput.questions)
        ? rawInput.questions.map((entry) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
              return entry;
            }

            const question = entry as Record<string, unknown>;
            const normalizedOptions = Array.isArray(question.options)
              ? question.options.map((option) => {
                  if (!option || typeof option !== 'object' || Array.isArray(option)) {
                    return option;
                  }

                  const normalizedOption = option as Record<string, unknown>;
                  return {
                    ...(normalizedOption.label !== undefined
                      ? { label: normalizedOption.label }
                      : {}),
                    ...(normalizedOption.description !== undefined
                      ? { description: normalizedOption.description }
                      : {}),
                    ...(normalizedOption.preview !== undefined
                      ? { preview: normalizedOption.preview }
                      : {}),
                  };
                })
              : question.options;

            const multiSelect =
              typeof question.multiSelect === 'boolean' ? question.multiSelect : undefined;

            return {
              ...(question.question !== undefined ? { question: question.question } : {}),
              ...(question.header !== undefined ? { header: question.header } : {}),
              ...(multiSelect !== undefined ? { multiSelect } : {}),
              ...(normalizedOptions !== undefined ? { options: normalizedOptions } : {}),
            };
          })
        : rawInput.questions;

      // Question label truncator (oh-my-opencode question-label-truncator pattern):
      // Truncate overly long option labels to prevent UI overflow.
      const truncatedFields =
        normalizedQuestions !== undefined
          ? truncateQuestionLabels({ questions: normalizedQuestions })
          : {};

      return {
        canonicalName: 'question',
        normalizedFields: {
          ...truncatedFields,
        },
        remapped: true,
      };
    }
    case 'Read': {
      rejectUnsupportedFields('Read', rawInput, ['pages']);
      const { file_path, offset, limit } = rawInput;
      return {
        canonicalName: 'read',
        normalizedFields: {
          ...(file_path !== undefined ? { path: file_path } : {}),
          ...(offset !== undefined ? { offset } : {}),
          ...(limit !== undefined ? { limit } : {}),
        },
        remapped: true,
      };
    }
    case 'WebFetch':
      rejectUnsupportedFields('WebFetch', rawInput, ['prompt']);
      return {
        canonicalName: 'webfetch',
        normalizedFields: rawInput,
        remapped: false,
      };
    case 'WebSearch':
      rejectUnsupportedFields('WebSearch', rawInput, ['allowed_domains', 'blocked_domains']);
      return {
        canonicalName: 'websearch',
        normalizedFields: rawInput,
        remapped: false,
      };
    case 'Agent': {
      rejectUnsupportedFields('Agent', rawInput, UNSUPPORTED_AGENT_FIELDS);
      const { description, prompt, subagent_type, run_in_background, session_id } = rawInput;
      if (typeof subagent_type !== 'string' || subagent_type.trim().length === 0) {
        throw new UnsupportedToolError(
          'Agent',
          'subagent_type is required by the gateway Agent contract.',
        );
      }
      // D2-a：Claude Code 兼容入口继续受 9 人白名单约束（语义与迁移前逐字一致）。
      // 原生 `subagent` / `task` 入口不走这里，仍接受任意内置 / 自定义 agent。
      const normalizedAgent = subagent_type.trim().toLowerCase();
      if (!isClaudeCodeAllowedAgent(normalizedAgent)) {
        const generalHint =
          normalizedAgent === 'general'
            ? ' `general` 不存在:通用研究与多步执行请改用 hephaestus(深度实施)或省略 subagent_type 走 category。'
            : '';
        throw new UnsupportedToolError(
          'Agent',
          `Invalid agent type "${subagent_type}". Only ${CLAUDE_CODE_AGENT_ALLOWED_AGENTS.join(', ')} are allowed.${generalHint}`,
        );
      }
      return {
        canonicalName: 'subagent',
        normalizedFields: {
          ...(description !== undefined ? { description } : {}),
          ...(prompt !== undefined ? { prompt } : {}),
          // 规范名 `subagent` 的 schema 同时接受 `subagent_type`；下游
          // `resolveDelegatedAgent` 优先按它解析，故保持字段名不变以兼容。
          subagent_type: normalizedAgent,
          ...(run_in_background !== undefined ? { run_in_background } : {}),
          ...(session_id !== undefined ? { session_id } : {}),
        },
        remapped: true,
      };
    }
    default: {
      const resolved = resolvePresentedName(presentedName);
      return {
        canonicalName: resolved.canonicalName,
        normalizedFields: rawInput,
        remapped: false,
      };
    }
  }
}
