import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildExportableSvg,
  detectMermaidDiagramKind,
  getMermaidDiagramLabel,
  parseSvgIntrinsicSize,
  type SvgIntrinsicSize,
} from '../../chat/markdown/mermaid-diagram-meta.js';
import { buildMermaidTheme, MERMAID_FONT_STACK } from '../../chat/markdown/mermaid-theme.js';
import { useMarkdownThemeTokens } from '../../chat/markdown/use-markdown-theme.js';
import { PreviewToolbar, ZoomControls } from './PreviewToolbar.js';
import { usePreviewZoom } from './use-preview-zoom.js';
import './preview-surface.css';

type MermaidApi = (typeof import('mermaid'))['default'];

const LOADING_HINT = '正在加载图表渲染…';
const LOAD_FAILED_HINT = '图表渲染库加载失败，可切换为源码查看。';
const PARSE_FAILED_HINT = '图表语法不完整或存在错误，可切换为源码查看并修正。';

/** mermaid 需要全局唯一的渲染容器 id，同页面多处预览时递增。 */
let chartRenderSeq = 0;

/**
 * 文件预览里的 Mermaid 图表渲染。
 *
 * 与消息内的 `MermaidPreviewCodeBlock` 共用同一套引擎与主题派生
 * （`mermaid-diagram-meta` / `mermaid-theme`），但自带样式与布局：
 * 文件预览可能出现在产物页、团队侧栏等**没有加载聊天页 CSS** 的位置，
 * 复用聊天组件会退化成无样式的裸 SVG。
 *
 * 相对消息场景的两点差异：
 * - 不用渲染防抖：文件内容是一次性读入的完整源码，不存在流式半截语法；
 * - 出错时保留源码 + 错误信息，方便直接对照修正。
 */
export const ChartPreview = memo(function ChartPreview({
  code,
  fileName,
  inline = false,
}: {
  code: string;
  /** 导出 SVG 时的文件名（不含扩展名）。 */
  fileName?: string;
  /** 内嵌在 Markdown 预览里时不再抢满整列高度。 */
  inline?: boolean;
}) {
  const [showSource, setShowSource] = useState(false);
  const [mermaid, setMermaid] = useState<MermaidApi | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [intrinsic, setIntrinsic] = useState<SvgIntrinsicSize | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const tokens = useMarkdownThemeTokens();
  const theme = useMemo(() => buildMermaidTheme(tokens), [tokens]);
  const diagramKind = useMemo(() => detectMermaidDiagramKind(code), [code]);
  const { zoom, zoomIn, zoomOut, resetZoom, fit } = usePreviewZoom(viewportRef, intrinsic);

  useEffect(() => {
    let cancelled = false;
    void import('mermaid')
      .then((mod) => {
        if (!cancelled) {
          setMermaid(mod.default);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mermaid || showSource) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          darkMode: theme.darkMode,
          fontFamily: MERMAID_FONT_STACK,
          themeVariables: theme.themeVariables,
          themeCSS: theme.themeCSS,
          flowchart: { curve: 'basis', padding: 12, nodeSpacing: 44, rankSpacing: 52 },
          sequence: { actorMargin: 44, diagramMarginX: 8, diagramMarginY: 8, wrap: true },
          mindmap: { padding: 12 },
        });
        const renderId = `oaw-file-chart-${(chartRenderSeq += 1)}`;
        await mermaid.parse(code);
        const { svg: renderedSvg } = await mermaid.render(renderId, code);
        if (cancelled) {
          return;
        }
        setSvg(renderedSvg);
        setIntrinsic(parseSvgIntrinsicSize(renderedSvg));
        setRenderError(null);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setSvg(null);
        setIntrinsic(null);
        setRenderError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mermaid, code, theme, showSource]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard?.writeText(code).catch(() => undefined);
  }, [code]);

  const handleDownloadSvg = useCallback(() => {
    if (!svg) {
      return;
    }

    const payload = buildExportableSvg(svg, tokens.bgRaised);
    const blob = new Blob([payload], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${fileName ?? 'diagram'}.svg`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [svg, tokens.bgRaised, fileName]);

  const canZoom = svg !== null && intrinsic !== null;
  const sourceClassName = `oaw-preview-source${inline ? ' oaw-preview-source--inline' : ''}`;

  return (
    <div
      className="oaw-preview"
      data-testid="file-editor-chart-preview"
      data-diagram-kind={diagramKind}
    >
      <PreviewToolbar label="MERMAID" badge={getMermaidDiagramLabel(diagramKind)}>
        <button
          type="button"
          className="oaw-preview-btn"
          data-testid="file-editor-chart-toggle"
          aria-pressed={!showSource}
          onClick={() => setShowSource((value) => !value)}
        >
          {showSource ? '查看图形' : '查看源码'}
        </button>
        {!showSource && canZoom && (
          <ZoomControls
            zoom={zoom}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onReset={resetZoom}
            onFit={fit}
            label="图表缩放"
          />
        )}
        {!showSource && svg !== null && (
          <button
            type="button"
            className="oaw-preview-btn"
            data-testid="file-editor-chart-download"
            onClick={handleDownloadSvg}
          >
            下载 SVG
          </button>
        )}
        <button type="button" className="oaw-preview-btn" onClick={handleCopy}>
          复制源码
        </button>
      </PreviewToolbar>

      {showSource ? (
        <pre className={sourceClassName} data-testid="file-editor-chart-source">
          {code}
        </pre>
      ) : svg !== null ? (
        intrinsic !== null ? (
          <div
            ref={viewportRef}
            className="oaw-preview-figure"
            data-testid="file-editor-chart-figure"
          >
            <div
              className="oaw-preview-canvas"
              style={{ width: intrinsic.width * zoom, height: intrinsic.height * zoom }}
            >
              <div
                className="oaw-preview-scaled"
                style={{
                  width: intrinsic.width,
                  height: intrinsic.height,
                  transform: `scale(${zoom})`,
                }}
                // mermaid `securityLevel: 'strict'` 已净化输出（剥离事件处理器与
                // 外部链接），与消息内图表的信任模型一致。
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
          </div>
        ) : (
          // 拿不到 viewBox 时退回按容器宽度自适应。
          <div
            className="oaw-preview-figure oaw-preview-figure--fluid"
            data-testid="file-editor-chart-figure"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )
      ) : (
        <>
          <div className="oaw-preview-status" data-load-failed={loadFailed || undefined}>
            {loadFailed ? LOAD_FAILED_HINT : mermaid ? PARSE_FAILED_HINT : LOADING_HINT}
          </div>
          {renderError !== null && <pre className="oaw-preview-error">{renderError}</pre>}
          <pre className={sourceClassName} data-testid="file-editor-chart-source">
            {code}
          </pre>
        </>
      )}
    </div>
  );
});
