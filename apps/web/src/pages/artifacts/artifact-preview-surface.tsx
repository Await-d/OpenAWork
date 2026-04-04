import type { ArtifactRecord } from '@openAwork/artifacts';
import { tokens } from '@openAwork/shared-ui';
import MarkdownMessageContent from '../../components/chat/markdown-message-content.js';
import { FilePreviewPane } from '../../components/FilePreviewPane.js';
import {
  buildArtifactVirtualPath,
  buildSvgPreviewDocument,
  canPreviewArtifact,
  parseCsvPreview,
} from './artifact-workbench-utils.js';

interface ArtifactPreviewSurfaceProps {
  artifact: ArtifactRecord;
  content: string;
}

export function ArtifactPreviewSurface({ artifact, content }: ArtifactPreviewSurfaceProps) {
  if (!canPreviewArtifact(artifact.type)) {
    return (
      <PreviewShell
        title="预览暂不可用"
        note={`${artifact.type} 产物当前仅支持代码编辑与版本管理。`}
      >
        <CodeFallback content={content} />
      </PreviewShell>
    );
  }

  if (artifact.type === 'html') {
    return (
      <PreviewShell title="HTML 沙箱预览" note="脚本运行在隔离 iframe 中，适合快速确认结构与布局。">
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <FilePreviewPane path={buildArtifactVirtualPath(artifact)} content={content} />
        </div>
      </PreviewShell>
    );
  }

  if (artifact.type === 'svg') {
    return (
      <PreviewShell title="SVG 即时预览" note="直接在白底沙箱中渲染矢量内容，便于检查图标与图示。">
        <iframe
          title={`${artifact.title} 预览`}
          sandbox=""
          loading="lazy"
          srcDoc={buildSvgPreviewDocument(content)}
          style={previewFrameStyle}
        />
      </PreviewShell>
    );
  }

  if (artifact.type === 'markdown') {
    return (
      <PreviewShell
        title="Markdown 阅读预览"
        note="渲染当前结构化文案，便于检查标题、列表和代码块层级。"
      >
        <div
          style={{
            padding: tokens.spacing.lg,
            borderRadius: tokens.radius.lg,
            border: `1px solid ${tokens.color.borderSubtle}`,
            background: 'color-mix(in oklch, var(--surface) 92%, var(--bg) 8%)',
            overflow: 'auto',
          }}
        >
          <MarkdownMessageContent content={content} />
        </div>
      </PreviewShell>
    );
  }

  const csv = parseCsvPreview(content);
  return (
    <PreviewShell title="CSV 结构预览" note="展示前 25 行数据，方便快速验证字段和内容分布。">
      {csv.headers.length === 0 ? (
        <CodeFallback content={content} />
      ) : (
        <div
          style={{
            borderRadius: tokens.radius.lg,
            border: `1px solid ${tokens.color.borderSubtle}`,
            overflow: 'auto',
            background: 'color-mix(in oklch, var(--surface) 90%, var(--bg) 10%)',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
            <thead>
              <tr>
                {csv.headers.map((header) => (
                  <th
                    key={header}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      fontSize: 11,
                      color: 'var(--text-2)',
                      borderBottom: `1px solid ${tokens.color.borderSubtle}`,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {csv.rows.map((row, rowIndex) => (
                <tr key={`${rowIndex}-${row.join('|')}`}>
                  {csv.headers.map((header, columnIndex) => (
                    <td
                      key={`${header}-${columnIndex}`}
                      style={{
                        padding: '10px 12px',
                        fontSize: 12,
                        color: 'var(--text)',
                        borderBottom: `1px solid ${tokens.color.borderSubtle}`,
                        fontVariantNumeric: 'tabular-nums',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {row[columnIndex] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PreviewShell>
  );
}

function PreviewShell(props: { children: React.ReactNode; note: string; title: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacing.sm,
        minHeight: 0,
        flex: 1,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          padding: '10px 12px',
          borderRadius: tokens.radius.lg,
          border: `1px solid ${tokens.color.borderSubtle}`,
          background: 'color-mix(in oklch, var(--surface) 88%, var(--bg) 12%)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <strong style={{ fontSize: 12, color: 'var(--text)' }}>{props.title}</strong>
          <span style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
            {props.note}
          </span>
        </div>
        <span
          style={{
            flexShrink: 0,
            fontSize: 10,
            fontWeight: 700,
            padding: '3px 7px',
            borderRadius: 999,
            background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
            color: 'var(--accent)',
          }}
        >
          Preview
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {props.children}
      </div>
    </div>
  );
}

function CodeFallback({ content }: { content: string }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: tokens.spacing.lg,
        borderRadius: tokens.radius.lg,
        border: `1px solid ${tokens.color.borderSubtle}`,
        background: 'color-mix(in oklch, var(--surface) 88%, var(--bg) 12%)',
        color: 'var(--text)',
        fontSize: 12,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        minHeight: 240,
      }}
    >
      {content}
    </pre>
  );
}

const previewFrameStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 380,
  border: `1px solid ${tokens.color.borderSubtle}`,
  borderRadius: tokens.radius.lg,
  background: '#ffffff',
};
