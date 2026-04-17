import { truncateQuestionLabels } from './question-label-truncator.js';

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
    note: 'The local bash tool does not support description/run_in_background fields.',
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
    compatLevel: 'low',
    note: 'Read requires richer file_path/offset/pages semantics than the current gateway read tool.',
  },
  {
    presentedName: 'WebFetch',
    canonicalName: 'webfetch',
    compatLevel: 'low',
    note: 'WebFetch is intentionally kept on the OpenCode/local contract and is not migrated to the Claude-first prompt-driven variant.',
  },
  {
    presentedName: 'WebSearch',
    canonicalName: 'websearch',
    compatLevel: 'low',
    note: 'WebSearch is intentionally kept on the OpenCode/local contract and is not migrated to the Claude-first search semantics.',
  },
  {
    presentedName: 'Skill',
    canonicalName: 'skill',
    compatLevel: 'medium',
    note: 'The local skill tool expects name only; args are ignored for now.',
  },
  {
    presentedName: 'AskUserQuestion',
    canonicalName: 'question',
    compatLevel: 'medium',
    note: 'The local question tool uses a simplified schema and strips preview-specific fields.',
  },
  {
    presentedName: 'Agent',
    canonicalName: 'call_omo_agent',
    compatLevel: 'medium',
    note: 'The current gateway supports a subset of the Claude Code Agent contract via call_omo_agent.',
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
      const { command, timeout, workdir } = rawInput;
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
                  };
                })
              : question.options;

            const multiple =
              typeof question.multiple === 'boolean'
                ? question.multiple
                : typeof question.multiSelect === 'boolean'
                  ? question.multiSelect
                  : undefined;

            return {
              ...(question.question !== undefined ? { question: question.question } : {}),
              ...(question.header !== undefined ? { header: question.header } : {}),
              ...(multiple !== undefined ? { multiple } : {}),
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
    case 'Agent': {
      const { description, prompt, subagent_type, run_in_background, session_id } = rawInput;
      return {
        canonicalName: 'call_omo_agent',
        normalizedFields: {
          ...(description !== undefined ? { description } : {}),
          ...(prompt !== undefined ? { prompt } : {}),
          ...(subagent_type !== undefined ? { subagent_type } : {}),
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
