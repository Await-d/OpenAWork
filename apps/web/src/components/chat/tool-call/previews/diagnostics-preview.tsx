/* ── Diagnostics list (lsp_rename, write/edit post-write checks) ── */

export interface DiagnosticItem {
  filePath?: string;
  path?: string;
  line?: number;
  column?: number;
  severity?: string;
  source?: string;
  message: string;
}

export function extractDiagnosticsFromOutput(output: unknown): DiagnosticItem[] | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const record = output as Record<string, unknown>;
  const diags = record.diagnostics;
  if (!Array.isArray(diags)) return null;
  return diags as DiagnosticItem[];
}

export function DiagnosticsPreview({ items }: { items: DiagnosticItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="tool-call-diagnostics">
      {items.map((d, idx) => {
        const severity = (d.severity ?? 'error').toLowerCase();
        const where = d.filePath ?? d.path ?? '';
        const loc =
          d.line !== undefined
            ? d.column !== undefined
              ? `${where}:${d.line}:${d.column}`
              : `${where}:${d.line}`
            : where;
        return (
          <li key={idx} className="tool-call-diagnostic" data-severity={severity}>
            <span className="tool-call-diagnostic-sev">{severity}</span>
            {loc && <span className="tool-call-diagnostic-loc">{loc}</span>}
            <span className="tool-call-diagnostic-msg">{d.message}</span>
          </li>
        );
      })}
    </ul>
  );
}
