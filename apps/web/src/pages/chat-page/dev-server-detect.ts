/**
 * Detects dev-server URLs (localhost / 127.0.0.1) from terminal output.
 *
 * When an AI agent runs `npm run dev`, `vite`, `next dev`, etc., the
 * terminal output typically contains a line like:
 *
 *   ➜  Local:   http://localhost:5173/
 *   - ready started server on 0.0.0.0:3000, url: http://localhost:3000
 *   Server running at http://127.0.0.1:8080
 *
 * This module extracts the first such URL so the built-in browser panel
 * can auto-navigate to it.
 */

/**
 * Regex that matches http(s)://localhost:<port> or http(s)://127.0.0.1:<port>
 * URLs commonly printed by dev servers.  Captures the full URL including
 * optional path.
 */
const DEV_SERVER_URL_RE =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d{1,5})(?:\/[^\s)}\]"'`]*)?/i;

/**
 * Well-known keywords that typically surround dev-server ready messages.
 * Used as a confidence booster — if the line also contains one of these,
 * we are almost certain it's a dev server URL rather than, say, a URL
 * appearing in a `curl` command or a log dump.
 */
const DEV_SERVER_HINT_KEYWORDS = [
  'local:',
  'localhost:',
  'ready',
  'started',
  'listening',
  'server',
  'running',
  'network:',
  'vite',
  'next',
  'dev',
  'webpack',
  'remix',
  'astro',
  'nuxt',
  'svelte',
  'angular',
  'expo',
  'http://',
];

export interface DetectedDevServer {
  /** The URL to preview (always normalized to localhost when 0.0.0.0) */
  url: string;
  /** The terminal output line that contained the URL */
  matchLine: string;
}

/**
 * Extract a dev-server preview URL from terminal output text.
 *
 * Returns the **first** localhost/127.0.0.1 URL found.  When the output
 * contains `0.0.0.0`, it is rewritten to `localhost` since `0.0.0.0`
 * is not directly reachable in a browser on most platforms.
 *
 * @param outputText — typically `SessionTerminalSummary.outputTail`
 */
export function detectDevServerUrl(outputText: string): DetectedDevServer | null {
  if (!outputText) return null;

  const matches = outputText.match(DEV_SERVER_URL_RE);
  if (!matches || matches.length === 0) return null;

  // Prefer a match on a line that also contains a hint keyword
  const lines = outputText.split('\n');
  for (const line of lines) {
    const lineLC = line.toLowerCase();
    const lineMatches = line.match(DEV_SERVER_URL_RE);
    if (!lineMatches) continue;

    // Skip lines that look like download/fetch operations
    if (/\b(download(?:ing)?|fetch(?:ing)?|curl|wget)\b/i.test(line)) continue;

    const hasHint = DEV_SERVER_HINT_KEYWORDS.some((kw) => lineLC.includes(kw));
    if (hasHint) {
      return {
        url: normalizeDevUrl(lineMatches[0]),
        matchLine: line.trim(),
      };
    }
  }

  // Fallback: return the first URL found anywhere
  return {
    url: normalizeDevUrl(matches[0]),
    matchLine: '',
  };
}

function normalizeDevUrl(raw: string): string {
  // 0.0.0.0 is not browsable — swap to localhost
  return raw.replace(/0\.0\.0\.0/, 'localhost');
}

/**
 * Returns true if the command string looks like a dev-server launcher.
 * Useful to decide whether to monitor a terminal for preview URLs.
 */
export function isLikelyDevServerCommand(command: string): boolean {
  const c = command.toLowerCase();
  return (
    /\b(dev|start|serve|preview)\b/.test(c) ||
    /\b(vite|next|nuxt|remix|astro|webpack-dev-server|ng serve|expo start)\b/.test(c) ||
    /\bpython[\d.]*\b.*-m\s+http\.server/.test(c) ||
    /\bruby\b.*\b-run\b/.test(c) ||
    /\bphp[\d.]*\b.*-s\b/i.test(c)
  );
}
