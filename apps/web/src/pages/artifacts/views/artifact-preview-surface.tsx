import type { ArtifactRecord } from '@openAwork/artifacts';
import { tokens } from '@openAwork/shared-ui';
import MarkdownMessageContent from '../../../components/chat/markdown/markdown-message-content.js';
import { FilePreviewPane } from '../../../components/file-editor/preview/FilePreviewPane.js';
import {
  buildArtifactVirtualPath,
  buildSvgPreviewDocument,
  canPreviewArtifact,
  parseCsvPreview,
} from '../workspace/artifact-workbench-utils.js';

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
            background: 'var(--bg-overlay)',
            overflow: 'auto',
          }}
        >
          <MarkdownMessageContent content={content} />
        </div>
      </PreviewShell>
    );
  }

  if (artifact.type === 'image') {
    const metadataMimeType =
      artifact.metadata && typeof artifact.metadata['mimeType'] === 'string'
        ? artifact.metadata['mimeType']
        : 'image/png';
    const src = content.startsWith('data:')
      ? content
      : `data:${metadataMimeType};base64,${content}`;

    return (
      <PreviewShell title="图片预览" note="直接渲染内容型图片产物，便于确认生成结果与尺寸方向。">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 280,
            padding: tokens.spacing.lg,
            borderRadius: tokens.radius.lg,
            border: `1px solid ${tokens.color.borderSubtle}`,
            background: 'var(--bg-overlay)',
          }}
        >
          <img
            src={src}
            alt={artifact.title}
            style={{ maxWidth: '100%', maxHeight: 420, borderRadius: tokens.radius.md }}
          />
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
            background: 'var(--bg-overlay)',
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
                      color: 'var(--fg-default)',
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
                        color: 'var(--fg-strong)',
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
          background: 'var(--bg-overlay)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <strong style={{ fontSize: 12, color: 'var(--fg-strong)' }}>{props.title}</strong>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
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
        background: 'var(--bg-overlay)',
        color: 'var(--fg-strong)',
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
  background: 'var(--fg-on-accent)',
};
