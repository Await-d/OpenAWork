import path from 'node:path';
import { readReferenceFile } from './agent-reference-parser.js';
import { resolveReferencePath } from './reference-paths.js';

export interface ReferenceModelEntry {
  modelId: string;
  providerHints: string[];
  variant?: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildObjectKeyPattern(name: string): string {
  const escaped = escapeRegex(name);
  return `(?:"${escaped}"|${escaped})`;
}

function extractObjectBlock(content: string | undefined, name: string): string | undefined {
  if (!content) {
    return undefined;
  }

  const keyPattern = new RegExp(`${buildObjectKeyPattern(name)}\\s*:\\s*{`, 'm');
  const match = keyPattern.exec(content);
  if (!match || match.index < 0) {
    return undefined;
  }

  const start = content.indexOf('{', match.index);
  if (start < 0) {
    return undefined;
  }

  let depth = 0;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return content.slice(start, index + 1);
      }
    }
  }

  return undefined;
}

function extractModelIds(block: string | undefined): string[] {
  if (!block) {
    return [];
  }
  const matches = block.matchAll(/model:\s*"([^"]+)"/g);
  return Array.from(
    new Set(
      Array.from(matches, (match) => match[1] ?? '')
        .filter(Boolean)
        .map((model) => model.split('/').at(-1) ?? model),
    ),
  );
}

function extractArrayBlock(block: string | undefined, key: string): string | undefined {
  if (!block) {
    return undefined;
  }
  const keyPattern = new RegExp(`${buildObjectKeyPattern(key)}\\s*:\\s*\\[`, 'm');
  const match = keyPattern.exec(block);
  if (!match || match.index < 0) {
    return undefined;
  }
  const start = block.indexOf('[', match.index);
  if (start < 0) {
    return undefined;
  }
  let depth = 0;
  for (let index = start; index < block.length; index += 1) {
    const char = block[index];
    if (char === '[') {
      depth += 1;
    } else if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return block.slice(start, index + 1);
      }
    }
  }
  return undefined;
}

function extractObjectEntries(arrayBlock: string | undefined): string[] {
  if (!arrayBlock) {
    return [];
  }
  const entries: string[] = [];
  let start = -1;
  let depth = 0;
  for (let index = 0; index < arrayBlock.length; index += 1) {
    const char = arrayBlock[index];
    if (char === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        entries.push(arrayBlock.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return entries;
}

function extractStringArray(entryBlock: string, key: string): string[] {
  const keyPattern = new RegExp(`${buildObjectKeyPattern(key)}\\s*:\\s*\\[([^\\]]*)\\]`, 'm');
  const match = keyPattern.exec(entryBlock);
  if (!match?.[1]) {
    return [];
  }
  return Array.from(
    new Set(Array.from(match[1].matchAll(/"([^"]+)"/g), (item) => item[1] ?? '').filter(Boolean)),
  );
}

function extractVariant(entryBlock: string): string | undefined {
  const match = /variant:\s*"([^"]+)"/m.exec(entryBlock);
  return match?.[1];
}

function buildReferenceEntries(block: string | undefined): ReferenceModelEntry[] {
  if (!block) {
    return [];
  }
  const fallbackChainBlock = extractArrayBlock(block, 'fallbackChain');
  const defaultVariant = extractVariant(block.replace(fallbackChainBlock ?? '', ''));
  const entries: ReferenceModelEntry[] = [];
  for (const entryBlock of extractObjectEntries(fallbackChainBlock)) {
    const modelId = extractModelIds(entryBlock)[0];
    if (!modelId) {
      continue;
    }
    entries.push({
      modelId,
      providerHints: extractStringArray(entryBlock, 'providers'),
      ...((extractVariant(entryBlock) ?? defaultVariant)
        ? { variant: extractVariant(entryBlock) ?? defaultVariant }
        : {}),
    });
  }
  return entries;
}

const OMO_MODEL_REQUIREMENTS = readReferenceFile(
  path.join(
    resolveReferencePath('temp', 'oh-my-openagent', 'src', 'shared'),
    'model-requirements.ts',
  ),
);
const OMO_TASK_CONSTANTS = readReferenceFile(
  path.join(
    resolveReferencePath('temp', 'oh-my-openagent', 'src', 'tools', 'delegate-task'),
    'constants.ts',
  ),
);

function extractCategoryDefaultModelIds(category: string): string[] {
  const defaultBlock = extractObjectBlock(OMO_TASK_CONSTANTS, category);
  const defaultModels = extractModelIds(defaultBlock);
  const requirementBlock = extractObjectBlock(OMO_MODEL_REQUIREMENTS, category);
  const fallbackModels = extractModelIds(requirementBlock);
  return Array.from(new Set([...defaultModels, ...fallbackModels]));
}

export function getReferenceAgentModelCandidates(agentId: string | undefined): string[] {
  if (!agentId) {
    return [];
  }
  return getReferenceAgentModelEntries(agentId).map((entry) => entry.modelId);
}

export function getReferenceCategoryModelCandidates(category: string | undefined): string[] {
  if (!category) {
    return [];
  }
  return getReferenceCategoryModelEntries(category).map((entry) => entry.modelId);
}

export function getReferenceAgentModelEntries(agentId: string | undefined): ReferenceModelEntry[] {
  if (!agentId) {
    return [];
  }
  return buildReferenceEntries(extractObjectBlock(OMO_MODEL_REQUIREMENTS, agentId));
}

export function getReferenceCategoryModelEntries(
  category: string | undefined,
): ReferenceModelEntry[] {
  if (!category) {
    return [];
  }
  const entries = buildReferenceEntries(extractObjectBlock(OMO_MODEL_REQUIREMENTS, category));
  if (entries.length > 0) {
    return entries;
  }
  return extractCategoryDefaultModelIds(category).map((modelId) => ({
    modelId,
    providerHints: [],
  }));
}
