import { OFFICIAL_REGISTRY_SOURCE } from '@openAwork/skill-registry';
import type { RegistrySource } from '@openAwork/skill-registry';

export interface GitHubDirEntry {
  name: string;
  path: string;
  type: string;
  download_url: string | null;
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  license?: string;
  metadata?: { author?: string; version?: string };
}

interface DirectSkillFile {
  path: string;
  downloadUrl: string;
}

type GitHubRepoDiscoveryMode = 'contents' | 'code-search';
type GitHubRepoMetadataMode = 'frontmatter' | 'path';

export interface GitHubRepoConfig {
  owner: string;
  repo: string;
  rootPaths: string[];
  maxDepth: number;
  ref?: string;
  discoveryMode?: GitHubRepoDiscoveryMode;
  metadataMode?: GitHubRepoMetadataMode;
  browseLimit?: number;
}

interface BuiltinGitHubSourceDefinition extends GitHubRepoConfig {
  name: string;
  priority: number;
  directSkillFiles?: DirectSkillFile[];
}

interface GitHubCodeSearchItem {
  path: string;
}

export interface GitHubCodeSearchResponse {
  items?: GitHubCodeSearchItem[];
}

export interface DiscoveredGitHubSkillFile extends GitHubDirEntry {
  download_url: string;
}

export interface BuiltinRegistrySource extends RegistrySource {
  readonly: true;
  directSkillFiles?: DirectSkillFile[];
  repo?: GitHubRepoConfig;
}

function createBuiltinGitHubSource({
  name,
  owner,
  repo,
  rootPaths,
  maxDepth,
  ref,
  priority,
  directSkillFiles,
  discoveryMode,
  metadataMode,
  browseLimit,
}: BuiltinGitHubSourceDefinition): BuiltinRegistrySource {
  return {
    id: `github:${owner}/${repo}`,
    name,
    url: `https://github.com/${owner}/${repo}`,
    type: 'community',
    trust: 'verified',
    enabled: true,
    priority,
    readonly: true,
    metadata: { provider: 'github', repo: `${owner}/${repo}` },
    directSkillFiles,
    repo: {
      owner,
      repo,
      rootPaths,
      maxDepth,
      ref,
      discoveryMode,
      metadataMode,
      browseLimit,
    },
  };
}

export const BUILTIN_REGISTRY_SOURCES: BuiltinRegistrySource[] = [
  {
    ...OFFICIAL_REGISTRY_SOURCE,
    readonly: true,
  },
  createBuiltinGitHubSource({
    name: 'Anthropic Skills',
    owner: 'anthropics',
    repo: 'skills',
    rootPaths: ['skills'],
    maxDepth: 1,
    ref: '887114fd09f8f24a7e6c907f9ee505348498ab6a',
    priority: 2,
  }),
  createBuiltinGitHubSource({
    name: 'OpenAI Skills',
    owner: 'openai',
    repo: 'skills',
    rootPaths: ['skills'],
    maxDepth: 2,
    ref: '82d2c5b44ac234ec0f204f647562a4349d90ef43',
    priority: 3,
  }),
  createBuiltinGitHubSource({
    name: 'Vercel Skills',
    owner: 'vercel-labs',
    repo: 'skills',
    rootPaths: ['skills'],
    maxDepth: 1,
    ref: 'fc3b8b8d68bd640028d2ceedaa5fe2fdf129d05a',
    priority: 4,
  }),
  createBuiltinGitHubSource({
    name: 'Matt Pocock Skills',
    owner: 'mattpocock',
    repo: 'skills',
    rootPaths: [''],
    maxDepth: 1,
    ref: 'fb3629d3a2ba638a65ef336061204995be7f5d5e',
    priority: 5,
  }),
  createBuiltinGitHubSource({
    name: 'Hugging Face Skills',
    owner: 'huggingface',
    repo: 'skills',
    rootPaths: ['skills', 'hf-mcp/skills'],
    maxDepth: 1,
    ref: 'f4ea9f5008150ef5524ac9f5577e02807ef7b00e',
    priority: 6,
  }),
  createBuiltinGitHubSource({
    name: 'Obra Superpowers',
    owner: 'obra',
    repo: 'superpowers',
    rootPaths: ['skills'],
    maxDepth: 1,
    ref: '8ea39819eed74fe2a0338e71789f06b30e953041',
    priority: 7,
  }),
  createBuiltinGitHubSource({
    name: 'Everything Claude Code',
    owner: 'affaan-m',
    repo: 'everything-claude-code',
    rootPaths: ['skills'],
    maxDepth: 4,
    ref: 'df4f2df297847687bd8835c440803de36966b2c9',
    discoveryMode: 'code-search',
    metadataMode: 'path',
    browseLimit: 80,
    priority: 8,
  }),
  createBuiltinGitHubSource({
    name: 'OpenClaw Skills',
    owner: 'openclaw',
    repo: 'skills',
    rootPaths: ['skills'],
    maxDepth: 4,
    ref: '8a697172559d73608fb16eae017a82f26beb4c5c',
    discoveryMode: 'code-search',
    metadataMode: 'path',
    browseLimit: 80,
    priority: 9,
  }),
  createBuiltinGitHubSource({
    name: 'Vercel Agent Skills',
    owner: 'vercel-labs',
    repo: 'agent-skills',
    rootPaths: ['skills'],
    maxDepth: 2,
    priority: 10,
  }),
  createBuiltinGitHubSource({
    name: 'Vercel Deploy Claude Plugin',
    owner: 'vercel',
    repo: 'vercel-deploy-claude-code-plugin',
    rootPaths: ['skills'],
    maxDepth: 2,
    ref: 'ae067751b4f42c97d13054211657275029ca8b6d',
    priority: 11,
  }),
  createBuiltinGitHubSource({
    name: 'Daymade Claude Code Skills',
    owner: 'daymade',
    repo: 'claude-code-skills',
    rootPaths: [''],
    maxDepth: 1,
    ref: '392d34c161043ab7029b3db8204521cd71b983d3',
    priority: 12,
  }),
  createBuiltinGitHubSource({
    name: 'Block Agent Skills',
    owner: 'block',
    repo: 'agent-skills',
    rootPaths: [''],
    maxDepth: 1,
    ref: '60bfdadb7a35cdb71bc34a2c3b91c560e69c4044',
    priority: 13,
  }),
  createBuiltinGitHubSource({
    name: 'Binance Skills Hub',
    owner: 'binance',
    repo: 'binance-skills-hub',
    rootPaths: ['skills'],
    maxDepth: 4,
    ref: '79c4cb4ab9af64cd03e579206bad5f9864fcb1d1',
    priority: 14,
  }),
  createBuiltinGitHubSource({
    name: 'Trail of Bits Skills Curated',
    owner: 'trailofbits',
    repo: 'skills-curated',
    rootPaths: ['plugins'],
    maxDepth: 4,
    ref: '022fa0948818c9f2f738a428f4546cc65c427767',
    priority: 15,
  }),
  createBuiltinGitHubSource({
    name: 'Claude Skills Marketplace',
    owner: 'mhattingpete',
    repo: 'claude-skills-marketplace',
    rootPaths: [''],
    maxDepth: 3,
    ref: '3fa16a94e0aba3509e4d4b318ca175d3191b5b7d',
    priority: 16,
  }),
  createBuiltinGitHubSource({
    name: 'Await Agentdocs Orchestrator',
    owner: 'Await-d',
    repo: 'agentdocs-orchestrator',
    rootPaths: [''],
    maxDepth: 1,
    ref: '229dec2616341c68382ebfee8f462add420c3483',
    priority: 17,
    directSkillFiles: [
      {
        path: 'agentdocs-orchestrator/SKILL.md',
        downloadUrl:
          'https://raw.githubusercontent.com/Await-d/agentdocs-orchestrator/229dec2616341c68382ebfee8f462add420c3483/agentdocs-orchestrator/SKILL.md',
      },
      {
        path: 'schema-architect/SKILL.md',
        downloadUrl:
          'https://raw.githubusercontent.com/Await-d/agentdocs-orchestrator/229dec2616341c68382ebfee8f462add420c3483/schema-architect/SKILL.md',
      },
    ],
  }),
  createBuiltinGitHubSource({
    name: 'Cloudflare Skills',
    owner: 'cloudflare',
    repo: 'skills',
    rootPaths: ['skills'],
    maxDepth: 2,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 18,
  }),
  createBuiltinGitHubSource({
    name: 'Expo Skills',
    owner: 'expo',
    repo: 'skills',
    rootPaths: ['plugins'],
    maxDepth: 4,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 19,
  }),
  createBuiltinGitHubSource({
    name: 'Firebase Skills',
    owner: 'firebase',
    repo: 'skills',
    rootPaths: ['skills'],
    maxDepth: 2,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 20,
  }),
  createBuiltinGitHubSource({
    name: 'Angular Skills',
    owner: 'angular',
    repo: 'skills',
    rootPaths: ['skills'],
    maxDepth: 2,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 21,
  }),
  createBuiltinGitHubSource({
    name: 'Auth0 Agent Skills',
    owner: 'auth0',
    repo: 'agent-skills',
    rootPaths: ['plugins'],
    maxDepth: 3,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 22,
  }),
  createBuiltinGitHubSource({
    name: 'Apollo GraphQL Skills',
    owner: 'apollographql',
    repo: 'skills',
    rootPaths: ['skills'],
    maxDepth: 2,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 23,
  }),
  createBuiltinGitHubSource({
    name: 'fal.ai Skills',
    owner: 'fal-ai-community',
    repo: 'skills',
    rootPaths: ['skills'],
    maxDepth: 2,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 24,
  }),
  createBuiltinGitHubSource({
    name: 'Resend Email Skills',
    owner: 'resend',
    repo: 'resend-skills',
    rootPaths: ['skills'],
    maxDepth: 2,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 25,
  }),
  createBuiltinGitHubSource({
    name: 'CodeRabbit Skills',
    owner: 'coderabbitai',
    repo: 'skills',
    rootPaths: ['skills'],
    maxDepth: 2,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 26,
  }),
  createBuiltinGitHubSource({
    name: 'Better Auth Skills',
    owner: 'better-auth',
    repo: 'skills',
    rootPaths: ['skills'],
    maxDepth: 2,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 27,
  }),
  createBuiltinGitHubSource({
    name: 'Browserbase Skills',
    owner: 'browserbase',
    repo: 'skills',
    rootPaths: ['skills'],
    maxDepth: 2,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 28,
  }),
  createBuiltinGitHubSource({
    name: 'Remotion Video Skills',
    owner: 'remotion-dev',
    repo: 'skills',
    rootPaths: ['skills'],
    maxDepth: 2,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 29,
  }),
  createBuiltinGitHubSource({
    name: 'Composio Skills',
    owner: 'composiohq',
    repo: 'skills',
    rootPaths: ['skills'],
    maxDepth: 2,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 30,
  }),
  createBuiltinGitHubSource({
    name: 'AWS Labs Agent Plugins',
    owner: 'awslabs',
    repo: 'agent-plugins',
    rootPaths: ['plugins'],
    maxDepth: 3,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 31,
  }),
  createBuiltinGitHubSource({
    name: 'Adobe Skills',
    owner: 'adobe',
    repo: 'skills',
    rootPaths: ['plugins'],
    maxDepth: 5,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 32,
  }),
  createBuiltinGitHubSource({
    name: 'Microsoft Azure Skills',
    owner: 'microsoft',
    repo: 'azure-skills',
    rootPaths: ['skills', 'plugins'],
    maxDepth: 3,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 33,
  }),
  createBuiltinGitHubSource({
    name: 'Pydantic Skills',
    owner: 'pydantic',
    repo: 'skills',
    rootPaths: ['plugins'],
    maxDepth: 3,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 34,
  }),
  createBuiltinGitHubSource({
    name: 'Shopify Liquid Skills',
    owner: 'Shopify',
    repo: 'liquid-skills',
    rootPaths: ['plugins'],
    maxDepth: 3,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 35,
  }),
  createBuiltinGitHubSource({
    name: 'Bright Data Skills',
    owner: 'brightdata',
    repo: 'skills',
    rootPaths: ['skills'],
    maxDepth: 2,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 36,
  }),
  createBuiltinGitHubSource({
    name: 'Wix Skills',
    owner: 'wix',
    repo: 'skills',
    rootPaths: ['plugins'],
    maxDepth: 4,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 37,
  }),
  createBuiltinGitHubSource({
    name: 'Railway Skills',
    owner: 'railwayapp',
    repo: 'railway-skills',
    rootPaths: ['plugins'],
    maxDepth: 3,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 38,
  }),
  createBuiltinGitHubSource({
    name: 'Amplitude MCP Marketplace',
    owner: 'amplitude',
    repo: 'mcp-marketplace',
    rootPaths: ['plugins'],
    maxDepth: 3,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 39,
  }),
  createBuiltinGitHubSource({
    name: 'AI Skills Store Marketplace',
    owner: 'aiskillstore',
    repo: 'marketplace',
    rootPaths: ['skills'],
    maxDepth: 2,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 40,
  }),
  createBuiltinGitHubSource({
    name: 'Alireza Rezvani Claude Skills',
    owner: 'alirezarezvani',
    repo: 'claude-skills',
    rootPaths: [''],
    maxDepth: 4,
    discoveryMode: 'code-search',
    metadataMode: 'path',
    priority: 41,
  }),
  {
    id: 'builtin',
    name: 'OpenAWork Built-in Skills',
    url: 'builtin://local-skills',
    type: 'local',
    trust: 'full',
    enabled: true,
    priority: 1,
    readonly: true,
    metadata: { provider: 'builtin' },
  },
];
