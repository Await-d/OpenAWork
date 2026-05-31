/**
 * Regression (§0.111, registry source per-file isolation): fetchGitHubSkills
 * builds each discovered SKILL.md into a SkillEntry via a nested
 * `Promise.all(skillFiles.map(buildGitHubFrontmatterSkillEntry))`.
 * buildGitHubFrontmatterSkillEntry's contract is "return undefined on failure",
 * but its `mdRes.text()` body read was unguarded — a reject after an ok
 * response (mid-body connection reset, malformed chunked transfer) sank the
 * whole source's Promise.all, and the outer catch then discarded EVERY skill
 * from that registry source, not just the one bad file. The body read is now
 * guarded. We mock fetch so one file's text() rejects and assert the healthy
 * file's skill still comes back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchGitHubSkills, type BuiltinRegistrySource } from '../../routes/skills.js';

const OriginalFetch = globalThis.fetch;

const GOOD_URL = 'https://raw.example.test/good/SKILL.md';
const POISON_URL = 'https://raw.example.test/poison/SKILL.md';

function buildSource(): BuiltinRegistrySource {
  return {
    id: 'github:test/repo',
    name: 'Test Repo',
    url: 'https://github.com/test/repo',
    type: 'community',
    trust: 'verified',
    enabled: true,
    priority: 1,
    readonly: true,
    metadata: { provider: 'github', repo: 'test/repo' },
    // directSkillFiles bypasses the GitHub discovery API entirely, so both
    // files route straight into buildGitHubFrontmatterSkillEntry.
    directSkillFiles: [
      { path: 'skills/good/SKILL.md', downloadUrl: GOOD_URL },
      { path: 'skills/poison/SKILL.md', downloadUrl: POISON_URL },
    ],
    repo: {
      owner: 'test',
      repo: 'repo',
      rootPaths: [],
      maxDepth: 1,
      // frontmatter (default) → buildGitHubFrontmatterSkillEntry (the fixed path)
      metadataMode: 'frontmatter',
    },
  };
}

beforeEach(() => {
  globalThis.fetch = ((url: string) => {
    if (url === POISON_URL) {
      // ok response whose body read rejects mid-stream.
      return Promise.resolve({
        ok: true,
        text: () => Promise.reject(new Error('simulated connection reset mid-body')),
      } as unknown as Response);
    }
    return Promise.resolve(
      new Response('---\nname: good-skill\ndescription: a healthy skill\n---\nBody', {
        status: 200,
      }),
    );
  }) as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = OriginalFetch;
});

describe('fetchGitHubSkills per-file resilience', () => {
  it('单个文件 body 读取抛错时不丢整个 source，其余技能仍返回', async () => {
    const result = await fetchGitHubSkills([buildSource()], '');

    // The healthy file's skill survived despite the poison file's text() reject.
    const ids = result.map((entry) => entry.id);
    expect(ids).toContain('github:test/repo/skills/good');
    // The poison file produced no entry (returned undefined, filtered out).
    expect(ids).not.toContain('github:test/repo/skills/poison');
  });
});
