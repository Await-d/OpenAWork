import path from 'node:path';
import type { ManagedAgentBody } from '@openAwork/shared';
import {
  extractBlockDescription,
  extractInlinePrompt,
  extractNamedTemplate,
  extractPromptVariable,
  extractQuotedDescription,
  extractReturnedTemplate,
  readReferenceFile,
} from './agent-reference-parser.js';

const ROOT = '/home/await/project/OpenAWork/temp';
const OMO = path.join(ROOT, 'oh-my-openagent', 'src', 'agents');
const OPCODE = path.join(ROOT, 'opencode', 'packages', 'opencode', 'src', 'agent');

function trim(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function make(body: Partial<ManagedAgentBody>): Partial<ManagedAgentBody> {
  return {
    label: trim(body.label),
    description: trim(body.description),
    systemPrompt: trim(body.systemPrompt),
  };
}

const opencodeAgent = readReferenceFile(path.join(OPCODE, 'agent.ts'));
const opencodeExplorePrompt = readReferenceFile(path.join(OPCODE, 'prompt', 'explore.txt'));
const oracle = readReferenceFile(path.join(OMO, 'oracle.ts'));
const metis = readReferenceFile(path.join(OMO, 'metis.ts'));
const librarian = readReferenceFile(path.join(OMO, 'librarian.ts'));
const explore = readReferenceFile(path.join(OMO, 'explore.ts'));
const momus = readReferenceFile(path.join(OMO, 'momus.ts'));
const atlas = readReferenceFile(path.join(OMO, 'atlas', 'agent.ts'));
const atlasDefault = readReferenceFile(path.join(OMO, 'atlas', 'default.ts'));
const hephaestus = readReferenceFile(path.join(OMO, 'hephaestus', 'agent.ts'));
const hephaestusGpt = readReferenceFile(path.join(OMO, 'hephaestus', 'gpt.ts'));
const sisyphus = readReferenceFile(path.join(OMO, 'sisyphus.ts'));
const sisyphusDefault = readReferenceFile(path.join(OMO, 'sisyphus', 'default.ts'));
const sisyphusJunior = readReferenceFile(path.join(OMO, 'sisyphus-junior', 'agent.ts'));
const sisyphusJuniorDefault = readReferenceFile(path.join(OMO, 'sisyphus-junior', 'default.ts'));
const multimodal = readReferenceFile(path.join(OMO, 'multimodal-looker.ts'));
const prometheusConfig = readReferenceFile(
  path.join(
    ROOT,
    'oh-my-openagent',
    'src',
    'plugin-handlers',
    'prometheus-agent-config-builder.ts',
  ),
);
const prometheusIdentity = readReferenceFile(
  path.join(OMO, 'prometheus', 'identity-constraints.ts'),
);

export const BUILTIN_AGENT_REFERENCE_SNAPSHOT: Record<string, Partial<ManagedAgentBody>> = {
  build: make({ description: extractBlockDescription(opencodeAgent, 'build') }),
  plan: make({ description: extractBlockDescription(opencodeAgent, 'plan') }),
  general: make({ description: extractBlockDescription(opencodeAgent, 'general') }),
  explore: make({
    description:
      extractBlockDescription(opencodeAgent, 'explore') ?? extractQuotedDescription(explore),
    systemPrompt: opencodeExplorePrompt ?? extractInlinePrompt(explore),
  }),
  sisyphus: make({
    description: extractQuotedDescription(sisyphus),
    systemPrompt: extractReturnedTemplate(sisyphusDefault),
  }),
  hephaestus: make({
    description: extractQuotedDescription(hephaestus),
    systemPrompt: extractReturnedTemplate(hephaestusGpt),
  }),
  prometheus: make({
    description: extractQuotedDescription(prometheusConfig),
    systemPrompt: extractNamedTemplate(prometheusIdentity, 'PROMETHEUS_IDENTITY_CONSTRAINTS'),
  }),
  oracle: make({
    description: extractQuotedDescription(oracle),
    systemPrompt: extractNamedTemplate(oracle, 'ORACLE_DEFAULT_PROMPT'),
  }),
  librarian: make({
    description: extractQuotedDescription(librarian),
    systemPrompt: extractInlinePrompt(librarian),
  }),
  metis: make({
    description: extractQuotedDescription(metis),
    systemPrompt: extractNamedTemplate(metis, 'METIS_SYSTEM_PROMPT'),
  }),
  momus: make({
    description: extractQuotedDescription(momus),
    systemPrompt: extractNamedTemplate(momus, 'MOMUS_DEFAULT_PROMPT'),
  }),
  atlas: make({
    description: extractQuotedDescription(atlas),
    systemPrompt: extractNamedTemplate(atlasDefault, 'ATLAS_SYSTEM_PROMPT'),
  }),
  'multimodal-looker': make({
    description: extractQuotedDescription(multimodal),
    systemPrompt: extractInlinePrompt(multimodal),
  }),
  'sisyphus-junior': make({
    description: extractQuotedDescription(sisyphusJunior),
    systemPrompt: extractPromptVariable(sisyphusJuniorDefault, 'prompt'),
  }),
};
