import type { SkillManifest, SkillExecutor, ToolResult } from '@openAwork/skill-types';
import { promises as fs } from 'node:fs';

export interface BuiltinSkillDef {
  manifest: SkillManifest;
  executor: SkillExecutor;
}

const fileReadManifest: SkillManifest = {
  apiVersion: 'agent-skill/v1',
  id: 'com.openAwork.builtin.file-read',
  name: 'file_read',
  displayName: 'File Read',
  version: '1.0.0',
  description: 'Read file contents from the local filesystem',
  capabilities: ['filesystem.read'],
  permissions: [{ type: 'filesystem', scope: '**', required: true }],
  lifecycle: { activation: 'on-demand' },
};

const fileReadExecutor: SkillExecutor = async (args): Promise<ToolResult> => {
  const { path } = args as { path: string };
  try {
    const content = await fs.readFile(path, 'utf-8');
    return { content };
  } catch (e) {
    return { content: String(e), isError: true };
  }
};

const clipboardReadManifest: SkillManifest = {
  apiVersion: 'agent-skill/v1',
  id: 'com.openAwork.builtin.clipboard-read',
  name: 'clipboard_read',
  displayName: 'Clipboard Read',
  version: '1.0.0',
  description: 'Read text content from the system clipboard',
  capabilities: ['clipboard.read'],
  permissions: [{ type: 'clipboard', scope: 'read', required: true }],
  lifecycle: { activation: 'on-demand' },
  platforms: ['macos', 'windows'],
};

const clipboardReadExecutor: SkillExecutor = async (): Promise<ToolResult> => {
  return { content: '', isError: false };
};

const webSearchManifest: SkillManifest = {
  apiVersion: 'agent-skill/v1',
  id: 'com.openAwork.builtin.web-search',
  name: 'web_search',
  displayName: 'Web Search',
  version: '1.0.0',
  description: 'Search the web for current information',
  descriptionForModel:
    'Use this skill when the user needs real-time information, news, or current events.',
  capabilities: ['search.web', 'information.real-time'],
  permissions: [{ type: 'network', scope: 'https://*', required: true }],
  lifecycle: { activation: 'on-demand' },
  constraints: { timeout: 30000, rateLimitPerMinute: 30 },
};

interface DuckDuckGoResponse {
  Abstract: string;
  AbstractURL: string;
  AbstractSource: string;
  RelatedTopics: Array<{
    Text?: string;
    FirstURL?: string;
    Topics?: Array<{ Text?: string; FirstURL?: string }>;
  }>;
}

const webSearchExecutor: SkillExecutor = async (args): Promise<ToolResult> => {
  const { query, maxResults: maxResultsRaw } = args as { query: string; maxResults?: number };
  const maxResults = typeof maxResultsRaw === 'number' && maxResultsRaw > 0 ? maxResultsRaw : 5;

  try {
    const url = new URL('https://api.duckduckgo.com/');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('no_html', '1');
    url.searchParams.set('skip_disambig', '1');

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`DuckDuckGo API error: ${res.status}`);

    const data = (await res.json()) as DuckDuckGoResponse;

    const results: Array<{ title: string; snippet: string; url: string }> = [];

    if (data.Abstract) {
      results.push({
        title: data.AbstractSource || 'DuckDuckGo',
        snippet: data.Abstract,
        url: data.AbstractURL || '',
      });
    }

    for (const topic of data.RelatedTopics) {
      if (results.length >= maxResults) break;
      if (topic.Text && topic.FirstURL) {
        const dashIdx = topic.Text.indexOf(' - ');
        const title = dashIdx !== -1 ? topic.Text.slice(0, dashIdx) : topic.Text.slice(0, 60);
        const snippet = dashIdx !== -1 ? topic.Text.slice(dashIdx + 3) : topic.Text;
        results.push({ title, snippet, url: topic.FirstURL });
      } else if (topic.Topics) {
        for (const sub of topic.Topics) {
          if (results.length >= maxResults) break;
          if (sub.Text && sub.FirstURL) {
            const dashIdx = sub.Text.indexOf(' - ');
            const title = dashIdx !== -1 ? sub.Text.slice(0, dashIdx) : sub.Text.slice(0, 60);
            const snippet = dashIdx !== -1 ? sub.Text.slice(dashIdx + 3) : sub.Text;
            results.push({ title, snippet, url: sub.FirstURL });
          }
        }
      }
    }

    if (results.length === 0) {
      return { content: `No results found for: ${query}`, isError: false };
    }

    const content = results
      .slice(0, maxResults)
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.url}`)
      .join('\n\n');

    return { content, isError: false };
  } catch (e) {
    return { content: String(e), isError: true };
  }
};

export const BUILTIN_SKILLS: BuiltinSkillDef[] = [
  { manifest: fileReadManifest, executor: fileReadExecutor },
  { manifest: clipboardReadManifest, executor: clipboardReadExecutor },
  { manifest: webSearchManifest, executor: webSearchExecutor },
];
