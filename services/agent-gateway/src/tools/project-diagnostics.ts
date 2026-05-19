/**
 * Project-Wide LSP Diagnostics
 *
 * After write/edit operations, collects diagnostics from all workspace files
 * (not just the changed files), giving the LLM visibility into ripple-effect
 * errors caused by its changes (e.g., broken imports, type mismatches).
 *
 * This is a best-effort enhancement — failures never block the write.
 */

import { lspManager } from '../lsp/router.js';

export interface ProjectDiagnostic {
  file: string;
  severity: string;
  line: number;
  message: string;
}

const MAX_PROJECT_DIAGNOSTICS = 50;
const ERROR_SEVERITIES = new Set(['error', 'Error', 'ERROR', '1']);

/**
 * Collect project-wide diagnostics, optionally filtering to errors only.
 *
 * @param errorsOnly - When true, only return error-severity diagnostics (default: true)
 * @param excludeFiles - Files to exclude from results (e.g., already reported via getPostWriteDiagnostics)
 */
export async function getProjectWideDiagnostics(
  errorsOnly = true,
  excludeFiles: string[] = [],
): Promise<ProjectDiagnostic[]> {
  try {
    const allDiagnostics = await lspManager.diagnostics();
    const excludeSet = new Set(excludeFiles);
    const result: ProjectDiagnostic[] = [];

    for (const [file, summaries] of Object.entries(allDiagnostics)) {
      if (excludeSet.has(file)) continue;
      for (const diag of summaries) {
        if (errorsOnly && !ERROR_SEVERITIES.has(String(diag.severity))) continue;
        result.push({
          file,
          severity: String(diag.severity),
          line: diag.line,
          message: diag.message,
        });
        if (result.length >= MAX_PROJECT_DIAGNOSTICS) {
          return result;
        }
      }
    }

    return result;
  } catch {
    return [];
  }
}

/**
 * Format project diagnostics as a concise summary string suitable for
 * appending to tool output.
 */
export function formatProjectDiagnostics(diagnostics: ProjectDiagnostic[]): string {
  if (diagnostics.length === 0) return '';

  const lines = diagnostics.map((d) => `  ${d.file}:${d.line} [${d.severity}] ${d.message}`);
  const header =
    diagnostics.length >= MAX_PROJECT_DIAGNOSTICS
      ? `\n\n⚠️ Project-wide errors (showing first ${MAX_PROJECT_DIAGNOSTICS}):`
      : `\n\n⚠️ Project-wide errors (${diagnostics.length}):`;
  return header + '\n' + lines.join('\n');
}
