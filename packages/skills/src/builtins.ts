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

// ---------------------------------------------------------------------------
// oh-my-opencode builtin skills (prompt-based, descriptionForModel carries
// the full SKILL.md content so the skill tool returns actionable instructions)
// ---------------------------------------------------------------------------

const agentBrowserManifest: SkillManifest = {
  apiVersion: 'agent-skill/v1',
  id: 'com.openAwork.builtin.agent-browser',
  name: 'agent-browser',
  displayName: 'agent-browser',
  version: '1.0.0',
  description: 'Automates browser interactions for web testing, form filling, screenshots, and data extraction.',
  descriptionForModel: `Browser Automation with agent-browser

## Quick start
\`\`\`bash
agent-browser open <url>        # Navigate to page
agent-browser snapshot -i       # Get interactive elements with refs
agent-browser click @e1         # Click element by ref
agent-browser fill @e2 "text"   # Fill input by ref
agent-browser close             # Close browser
\`\`\`

## Core workflow
1. Navigate: agent-browser open <url>
2. Snapshot: agent-browser snapshot -i (returns elements with refs like @e1, @e2)
3. Interact using refs from the snapshot
4. Re-snapshot after navigation or significant DOM changes

## Commands
### Navigation
agent-browser open <url> | back | forward | reload | close

### Snapshot (page analysis)
agent-browser snapshot            # Full accessibility tree
agent-browser snapshot -i         # Interactive elements only (recommended)
agent-browser snapshot -c         # Compact output
agent-browser snapshot -d 3       # Limit depth
agent-browser snapshot -s "#main" # Scope to CSS selector

### Interactions (use @refs from snapshot)
agent-browser click @e1 | dblclick @e1 | focus @e1
agent-browser fill @e2 "text"     # Clear and type
agent-browser type @e2 "text"     # Type without clearing
agent-browser press Enter | Control+a
agent-browser hover @e1 | check @e1 | uncheck @e1
agent-browser select @e1 "value" | scroll down 500
agent-browser drag @e1 @e2 | upload @e1 file.pdf

### Get information
agent-browser get text @e1 | html @e1 | value @e1 | attr @e1 href
agent-browser get title | url | count ".item" | box @e1

### Screenshots & PDF
agent-browser screenshot | screenshot path.png | screenshot --full | pdf output.pdf

### Wait
agent-browser wait @e1 | wait 2000 | wait --text "Success" | wait --url "**/dashboard" | wait --load networkidle

### Browser settings
agent-browser set viewport 1920 1080 | set device "iPhone 14" | set geo 37.77 -122.41
agent-browser set offline on | set headers '{"X-Key":"v"}' | set media dark

### Cookies & Storage
agent-browser cookies | cookies set name value | cookies clear
agent-browser storage local | storage local key | storage local set k v | storage local clear

### Tabs & Windows
agent-browser tab | tab new [url] | tab 2 | tab close | window new

### JavaScript
agent-browser eval "document.title"

## Global Options
--session <name> | --profile <path> | --headed | --json | --debug`,
  capabilities: ['browser.automation', 'web.testing', 'screenshot', 'form.filling', 'data.extraction'],
  permissions: [{ type: 'network', scope: 'https://*', required: true }],
  lifecycle: { activation: 'on-demand' },
  constraints: { timeout: 60000 },
};

const devBrowserManifest: SkillManifest = {
  apiVersion: 'agent-skill/v1',
  id: 'com.openAwork.builtin.dev-browser',
  name: 'dev-browser',
  displayName: 'dev-browser',
  version: '1.0.0',
  description: 'Browser automation with persistent page state. Use for navigating websites, filling forms, screenshots, extracting web data, testing web apps.',
  descriptionForModel: `Dev Browser Skill — Browser automation that maintains page state across script executions.

## Choosing Your Approach
- **Local/source-available sites**: Read the source code first to write selectors directly
- **Unknown page layouts**: Use getAISnapshot() to discover elements and selectSnapshotRef() to interact
- **Visual feedback**: Take screenshots to see what the user sees

## Setup
### Standalone Mode (Default)
\`\`\`bash
./skills/dev-browser/server.sh &
\`\`\`
Add --headless flag if user requests it. Wait for Ready message before running scripts.

### Extension Mode
Connects to user's existing Chrome browser. Use when user is already logged into sites.
\`\`\`bash
cd skills/dev-browser && npm i && npm run start-extension &
\`\`\`

## Writing Scripts
Execute scripts inline using heredocs:
\`\`\`bash
cd skills/dev-browser && npx tsx <<'EOF'
import { connect, waitForPageLoad } from "@/client.js";
const client = await connect();
const page = await client.page("example", { viewport: { width: 1920, height: 1080 } });
await page.goto("https://example.com");
await waitForPageLoad(page);
console.log({ title: await page.title(), url: page.url() });
await client.disconnect();
EOF
\`\`\`

### Key Principles
1. Small scripts: Each script does ONE thing
2. Evaluate state: Log/return state at the end to decide next steps
3. Descriptive page names: Use "checkout", "login", not "main"
4. Disconnect to exit: await client.disconnect() - pages persist on server
5. Plain JS in evaluate: page.evaluate() runs in browser - no TypeScript syntax

## Client API
\`\`\`typescript
const client = await connect();
const page = await client.page("name");
const pages = await client.list();
await client.close("name");
await client.disconnect();
const snapshot = await client.getAISnapshot("name");
const element = await client.selectSnapshotRef("name", "e5");
\`\`\`

## ARIA Snapshot (Element Discovery)
getAISnapshot() returns YAML accessibility tree with refs like [ref=eN].
Interact with refs via selectSnapshotRef().

## Screenshots
await page.screenshot({ path: "tmp/screenshot.png" });
await page.screenshot({ path: "tmp/full.png", fullPage: true });`,
  capabilities: ['browser.automation', 'web.testing', 'persistent.state', 'aria.snapshot'],
  permissions: [{ type: 'network', scope: 'https://*', required: true }],
  lifecycle: { activation: 'on-demand' },
  constraints: { timeout: 60000 },
};

const frontendUiUxManifest: SkillManifest = {
  apiVersion: 'agent-skill/v1',
  id: 'com.openAwork.builtin.frontend-ui-ux',
  name: 'frontend-ui-ux',
  displayName: 'frontend-ui-ux',
  version: '1.0.0',
  description: 'Designer-turned-developer who crafts stunning UI/UX even without design mockups',
  descriptionForModel: `Role: Designer-Turned-Developer

You are a designer who learned to code. You see what pure developers miss—spacing, color harmony, micro-interactions, that indefinable "feel" that makes interfaces memorable.

Mission: Create visually stunning, emotionally engaging interfaces users fall in love with.

## Work Principles
1. Complete what's asked — Execute the exact task. No scope creep.
2. Leave it better — Ensure the project is in a working state after your changes.
3. Study before acting — Examine existing patterns, conventions, and commit history before implementing.
4. Blend seamlessly — Match existing code patterns.
5. Be transparent — Announce each step. Explain reasoning.

## Design Process
Before coding, commit to a BOLD aesthetic direction:
1. Purpose: What problem does this solve? Who uses it?
2. Tone: Pick an extreme—brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian
3. Constraints: Technical requirements (framework, performance, accessibility)
4. Differentiation: What's the ONE thing someone will remember?

## Aesthetic Guidelines
### Typography
Choose distinctive fonts. Avoid: Arial, Inter, Roboto, system fonts, Space Grotesk.

### Color
Commit to a cohesive palette. Use CSS variables. Dominant colors with sharp accents. Avoid: purple gradients on white.

### Motion
Focus on high-impact moments. One well-orchestrated page load > scattered micro-interactions. Prioritize CSS-only. Use Motion library for React when available.

### Spatial Composition
Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements.

### Visual Details
Create atmosphere—gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows. Never default to solid colors.

## Anti-Patterns (NEVER)
- Generic fonts (Inter, Roboto, Arial, system fonts, Space Grotesk)
- Cliched color schemes (purple gradients on white)
- Predictable layouts and component patterns
- Cookie-cutter design lacking context-specific character

Match implementation complexity to aesthetic vision. No design should be the same.`,
  capabilities: ['frontend.design', 'ui.ux', 'visual.design', 'css.animation'],
  permissions: [{ type: 'filesystem', scope: '**', required: true }],
  lifecycle: { activation: 'on-demand' },
};

const gitMasterManifest: SkillManifest = {
  apiVersion: 'agent-skill/v1',
  id: 'com.openAwork.builtin.git-master',
  name: 'git-master',
  displayName: 'git-master',
  version: '1.0.0',
  description: 'MUST USE for ANY git operations. Atomic commits, rebase/squash, history search (blame, bisect, log -S).',
  descriptionForModel: `Git Master Agent — Combines three specializations:
1. Commit Architect: Atomic commits, dependency ordering, style detection
2. Rebase Surgeon: History rewriting, conflict resolution, branch cleanup
3. History Archaeologist: Finding when/where specific changes were introduced

## MODE DETECTION (FIRST STEP)
| User Request Pattern | Mode |
| "commit", changes to commit | COMMIT |
| "rebase", "squash", "cleanup history" | REBASE |
| "find when", "who changed", "blame", "bisect" | HISTORY_SEARCH |

## CORE PRINCIPLE: MULTIPLE COMMITS BY DEFAULT
3+ files changed -> MUST be 2+ commits
5+ files changed -> MUST be 3+ commits
10+ files changed -> MUST be 5+ commits

Split by: Different directories/modules, Different component types, Can be reverted independently, Different concerns (UI/logic/config/test)

ONLY COMBINE when: EXACT same atomic unit (function + its test), Splitting would break compilation

## COMMIT MODE Phases
### Phase 0: Parallel Context Gathering (MANDATORY)
\`\`\`bash
git status; git diff --staged --stat; git diff --stat
git log -30 --oneline; git branch --show-current
git merge-base HEAD main 2>/dev/null; git rev-parse --abbrev-ref @{upstream}
\`\`\`

### Phase 1: Style Detection (BLOCKING)
Detect language (Korean/English) and commit style (SEMANTIC/PLAIN/SENTENCE/SHORT) from recent git log.
MUST output STYLE DETECTION RESULT before proceeding.

### Phase 2: Branch Context Analysis
Determine branch state and rewrite safety.

### Phase 3: Atomic Unit Planning (BLOCKING)
min_commits = ceil(file_count / 3)
Split by directory first, then by concern.
Test files MUST be in same commit as implementation.
MUST justify each commit with 3+ files before executing.
MUST output COMMIT PLAN before proceeding.

### Phase 4: Commit Strategy Decision
Decide FIXUP vs NEW COMMIT for each group.

### Phase 5: Commit Execution
Stage and commit in dependency order (Level 0 -> Level 4).

### Phase 6: Verification & Cleanup
Verify clean state, decide push strategy.

## REBASE MODE Phases
- R1: Context analysis + safety assessment
- R2: Execution (autosquash, rebase onto, conflict resolution)
- R3: Post-rebase verification
- R4: Report

NEVER rebase main/master. Always use --force-with-lease instead of --force.

## HISTORY SEARCH MODE Phases
- H1: Determine search type (pickaxe/regex/blame/bisect/file_log)
- H2: Execute search (git log -S, git log -G, git blame, git bisect)
- H3: Present results with actionable context

Quick reference:
| When was "X" added? | git log -S "X" --oneline |
| Who wrote line N? | git blame -L N,N file.py |
| When did bug start? | git bisect start |
| File history | git log --follow -- path/file.py |`,
  capabilities: ['git.commit', 'git.rebase', 'git.history', 'git.bisect', 'git.blame'],
  permissions: [{ type: 'filesystem', scope: '**', required: true }],
  lifecycle: { activation: 'on-demand' },
};

const noopExecutor: SkillExecutor = async (): Promise<ToolResult> => {
  return { content: 'This is a prompt-based skill. Content is injected via descriptionForModel.', isError: false };
};

export const BUILTIN_SKILLS: BuiltinSkillDef[] = [
  { manifest: fileReadManifest, executor: fileReadExecutor },
  { manifest: clipboardReadManifest, executor: clipboardReadExecutor },
  { manifest: webSearchManifest, executor: webSearchExecutor },
  // oh-my-opencode builtin skills (prompt-based)
  { manifest: agentBrowserManifest, executor: noopExecutor },
  { manifest: devBrowserManifest, executor: noopExecutor },
  { manifest: frontendUiUxManifest, executor: noopExecutor },
  { manifest: gitMasterManifest, executor: noopExecutor },
];
