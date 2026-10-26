/* ── lsp_prepare_rename（可重命名判定） ── */

import type { LspPrepareRenameView } from '../shared/lsp-prepare-rename-view.js';

const MONO =
  'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace';

export function LspPrepareRenamePreview({ view }: { view: LspPrepareRenameView }) {
  const available = view.kind === 'available';

  return (
    <div className="tool-call-confirm" data-prepare-rename={view.kind}>
      <span className="tool-call-confirm-glyph" aria-hidden="true">
        {available ? '✓' : '✗'}
      </span>
      <span className="tool-call-confirm-text">{available ? '可重命名' : '不可重命名'}</span>
      {available && view.range && (
        <span style={{ fontFamily: MONO, color: 'var(--fg-muted)', fontSize: 10.5 }}>
          {view.range}
        </span>
      )}
    </div>
  );
}
