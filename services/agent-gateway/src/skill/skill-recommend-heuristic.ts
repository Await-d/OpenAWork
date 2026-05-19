/**
 * Heuristic fallback for skill recommendation. Used when the LLM call
 * fails or returns garbage so the UX doesn't deadlock — a deterministic
 * `manifest.capabilities × project signals` rule engine that produces a
 * non-empty (best-effort) recommendation set.
 *
 * Scoring: capability tokens that match any signal token contribute
 * weighted points. Top scorers above the score floor become recommendations;
 * the rest fall into `rejected` with a "no signal match" reason.
 */

import type { SkillManifest } from '@openAwork/skill-types';
import type { WorkspaceSignals } from '../workspace/workspace-skill-signals.js';

export interface HeuristicCandidate {
  skillId: string;
  manifest: SkillManifest;
}

export interface HeuristicRecommendation {
  skill_id: string;
  pinned: boolean;
  reason: string;
  score: number;
}

export interface HeuristicRejection {
  skill_id: string;
  reason: string;
}

export interface HeuristicResult {
  recommendations: HeuristicRecommendation[];
  rejected: HeuristicRejection[];
}

const SCORE_FLOOR = 30;
const PIN_FLOOR = 70;
const MAX_PINS = 3;

const LANGUAGE_BY_EXT: Record<string, string[]> = {
  ts: ['typescript', 'node', 'web'],
  tsx: ['typescript', 'react', 'web'],
  js: ['javascript', 'node', 'web'],
  jsx: ['javascript', 'react', 'web'],
  py: ['python'],
  rs: ['rust'],
  go: ['go', 'golang'],
  java: ['java', 'jvm'],
  kt: ['kotlin', 'jvm'],
  cs: ['csharp', 'dotnet'],
  rb: ['ruby'],
  php: ['php'],
  swift: ['swift', 'ios', 'apple'],
  c: ['c'],
  cpp: ['cpp', 'cplusplus'],
  h: ['c', 'cpp'],
  hpp: ['cpp'],
  scala: ['scala', 'jvm'],
  vue: ['vue', 'web'],
  svelte: ['svelte', 'web'],
  sh: ['bash', 'shell'],
  yaml: ['config', 'yaml'],
  yml: ['config', 'yaml'],
  toml: ['config', 'toml'],
};

const FRAMEWORK_KEYWORDS: Array<[RegExp, string[]]> = [
  [/\b(react)\b/i, ['react', 'frontend', 'web']],
  [/\b(vue)\b/i, ['vue', 'frontend', 'web']],
  [/\b(svelte)\b/i, ['svelte', 'frontend', 'web']],
  [/\b(next\.?js|next-)/i, ['nextjs', 'frontend', 'web']],
  [/\b(nuxt)\b/i, ['nuxt', 'frontend', 'web']],
  [/\b(express|fastify|hono|koa)\b/i, ['nodejs-server', 'backend']],
  [/\b(tailwind)\b/i, ['tailwind', 'css', 'frontend']],
  [/\b(prisma|drizzle|typeorm)\b/i, ['database', 'orm']],
  [/\b(postgres|postgresql|mysql|sqlite|mongodb)\b/i, ['database']],
  [/\b(docker|kubernetes|k8s)\b/i, ['devops', 'infrastructure']],
  [/\b(electron|tauri)\b/i, ['desktop', 'cross-platform']],
  [/\b(react-native|expo)\b/i, ['mobile', 'react-native']],
  [/\b(swift|swiftui|xcode)\b/i, ['ios', 'mobile', 'apple']],
  [/\b(android|gradle)\b/i, ['android', 'mobile']],
  [/\b(fastapi|flask|django)\b/i, ['python-server', 'backend']],
  [/\b(spring\s?boot|spring-)/i, ['spring', 'java', 'backend']],
  [/\b(rust|cargo|tokio|axum|actix)\b/i, ['rust', 'systems']],
  [/\b(test|jest|vitest|playwright|pytest)\b/i, ['testing']],
  [/\b(graphql|apollo)\b/i, ['graphql', 'api']],
  [/\b(openai|anthropic|llm|gpt|claude|gemini)\b/i, ['llm', 'ai']],
  [/\b(slack|discord|github|jira)\b/i, ['integration']],
];

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length >= 2 && token.length <= 32),
  );
}

function deriveSignalTokens(signals: WorkspaceSignals): Set<string> {
  const tokens = new Set<string>();

  // 1. extension histogram → language tokens
  for (const [ext, count] of Object.entries(signals.fileExtensionHistogram)) {
    if (count <= 0) continue;
    const langs = LANGUAGE_BY_EXT[ext];
    if (langs) {
      for (const tag of langs) tokens.add(tag);
    }
    // also keep the extension itself, useful for skills tagged "yaml" / "toml"
    tokens.add(ext);
  }

  // 2. tree directory names → coarse domain hints
  for (const entry of signals.topLevelTree) {
    const name = entry.replace(/\/$/, '').toLowerCase();
    if (
      name === 'apps' ||
      name === 'web' ||
      name === 'mobile' ||
      name === 'desktop' ||
      name === 'docs' ||
      name === 'docs/' ||
      name === 'tests' ||
      name === 'test' ||
      name === 'docker'
    ) {
      tokens.add(name);
    }
  }

  // 3. README + manifests + agentdocs → framework keywords
  const blob = [
    signals.readme?.content ?? '',
    ...signals.manifests.map((entry) => entry.content),
    signals.agentdocsIndex?.content ?? '',
  ].join('\n');
  for (const [pattern, tags] of FRAMEWORK_KEYWORDS) {
    if (pattern.test(blob)) {
      for (const tag of tags) tokens.add(tag);
    }
  }
  return tokens;
}

function deriveSkillTokens(manifest: SkillManifest): Set<string> {
  const tokens = new Set<string>();
  for (const cap of manifest.capabilities ?? []) {
    for (const t of tokenize(cap)) tokens.add(t);
  }
  if (manifest.displayName) for (const t of tokenize(manifest.displayName)) tokens.add(t);
  if (manifest.name) for (const t of tokenize(manifest.name)) tokens.add(t);
  if (manifest.description) for (const t of tokenize(manifest.description)) tokens.add(t);
  return tokens;
}

interface ScoredCandidate {
  candidate: HeuristicCandidate;
  score: number;
  matched: string[];
}

function scoreCandidates(
  candidates: HeuristicCandidate[],
  signalTokens: Set<string>,
): ScoredCandidate[] {
  return candidates
    .map((candidate) => {
      const skillTokens = deriveSkillTokens(candidate.manifest);
      const matched: string[] = [];
      for (const token of skillTokens) {
        if (signalTokens.has(token)) matched.push(token);
      }
      const tokenScore = Math.min(60, matched.length * 12);
      const capabilityBonus = Math.min(
        20,
        (candidate.manifest.capabilities ?? []).length > 0 ? 10 : 0,
      );
      // Skills with no detectable token still get a small floor when the
      // workspace yielded barely-any signal — this matches the "guarantee
      // non-empty UX" requirement.
      const baseline = signalTokens.size === 0 ? 25 : 0;
      const score = Math.min(100, tokenScore + capabilityBonus + baseline);
      return { candidate, score, matched };
    })
    .sort((a, b) => b.score - a.score);
}

function buildReason(matched: string[], signalTokenCount: number): string {
  if (matched.length > 0) {
    return `Capabilities match project signals: ${matched.slice(0, 4).join(', ')}`;
  }
  if (signalTokenCount === 0) {
    return 'Workspace yielded no strong signal — surfacing as low-confidence baseline.';
  }
  return 'No direct signal match.';
}

export function recommendByHeuristic(
  candidates: HeuristicCandidate[],
  signals: WorkspaceSignals,
): HeuristicResult {
  const signalTokens = deriveSignalTokens(signals);
  const scored = scoreCandidates(candidates, signalTokens);
  const recommendations: HeuristicRecommendation[] = [];
  const rejected: HeuristicRejection[] = [];
  let pinsAssigned = 0;
  for (const entry of scored) {
    if (entry.score < SCORE_FLOOR) {
      rejected.push({
        skill_id: entry.candidate.skillId,
        reason: buildReason(entry.matched, signalTokens.size),
      });
      continue;
    }
    const pinned = entry.score >= PIN_FLOOR && pinsAssigned < MAX_PINS;
    if (pinned) pinsAssigned += 1;
    recommendations.push({
      skill_id: entry.candidate.skillId,
      pinned,
      reason: buildReason(entry.matched, signalTokens.size),
      score: entry.score,
    });
  }
  return { recommendations, rejected };
}
