import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildMermaidTheme, MERMAID_FONT_STACK } from './mermaid-theme.js';
import {
  buildExportableSvg,
  detectMermaidDiagramKind,
  getMermaidDiagramLabel,
  parseSvgIntrinsicSize,
  type SvgIntrinsicSize,
} from './mermaid-diagram-meta.js';
import { useMarkdownThemeTokens } from './use-markdown-theme.js';

type MermaidApi = (typeof import('mermaid'))['default'];

// mermaid 体积较大，走动态 import：只有消息里真正出现 mermaid 代码块时才加载。
// 流式输出期间源码不断追加，先 debounce 合并连续更新；语法未完整时 parse 失败
// 属于正常过程，保留源码展示并在补全后自动重试出图。
const MERMAID_RENDER_DEBOUNCE_MS = 250;
const MERMAID_INCOMPLETE_HINT = '图表语法尚未完整或存在错误，内容补全后将自动重试。';
const MERMAID_LOAD_FAILED_HINT = '图表渲染库加载失败，可切换为源码查看。';
const MERMAID_LOADING_HINT = '正在加载图表渲染…';

/** 缩放区间与步进。低于 1 是缩小，高于 1 会开启容器内滚动。 */
const MERMAID_MIN_ZOOM = 0.25;
const MERMAID_MAX_ZOOM = 4;
const MERMAID_ZOOM_STEP = 1.25;
/** 与样式里的视口内边距保持一致，用于「适应宽度」计算可视区。 */
const MERMAID_VIEWPORT_PADDING = 12;

let mermaidRenderSeq = 0;

export const MermaidPreviewCodeBlock = memo(function MermaidPreviewCodeBlock({
  code,
  className,
  codeProps,
  language,
}: {
  code: string;
  className?: string;
  codeProps: Record<string, unknown>;
  language?: string;
}) {
  const [previewOpen, setPreviewOpen] = useState(true);
  const [mermaid, setMermaid] = useState<MermaidApi | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [intrinsic, setIntrinsic] = useState<SvgIntrinsicSize | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const tokens = useMarkdownThemeTokens();
  const theme = useMemo(() => buildMermaidTheme(tokens), [tokens]);
  const diagramKind = useMemo(() => detectMermaidDiagramKind(code), [code]);

  // 按需加载 mermaid 库（组件首次挂载时才开始拉取）
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

  // 渲染为 SVG：strict 安全级别净化输出，配色来自当前主题 token。
  useEffect(() => {
    if (!mermaid || !previewOpen) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            // 用 base 主题 + 自定义 themeVariables：内置的 dark/default 只有两档，
            // 无法跟随应用的 8 套主题风格。
            theme: 'base',
            darkMode: theme.darkMode,
            fontFamily: MERMAID_FONT_STACK,
            themeVariables: theme.themeVariables,
            themeCSS: theme.themeCSS,
            flowchart: { curve: 'basis', padding: 12, nodeSpacing: 44, rankSpacing: 52 },
            sequence: { actorMargin: 44, diagramMarginX: 8, diagramMarginY: 8, wrap: true },
            mindmap: { padding: 12 },
          });
          const renderId = `oaw-mermaid-${(mermaidRenderSeq += 1)}`;
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
    }, MERMAID_RENDER_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mermaid, code, theme, previewOpen]);

  const fitToViewport = useCallback((size: SvgIntrinsicSize) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const available = viewport.clientWidth - MERMAID_VIEWPORT_PADDING * 2 - 2;
    if (available <= 0) {
      return;
    }

    setZoom(clampZoom(available / size.width));
  }, []);

  // 图形尺寸变化（首次出图、流式补全、切换主题）后自动回到「适应宽度」。
  useEffect(() => {
    if (intrinsic) {
      fitToViewport(intrinsic);
    }
  }, [intrinsic, fitToViewport]);

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
    anchor.download = `diagram-${Date.now()}.svg`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [svg, tokens.bgRaised]);

  const zoomIn = useCallback(() => setZoom((value) => clampZoom(value * MERMAID_ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoom((value) => clampZoom(value / MERMAID_ZOOM_STEP)), []);
  const resetZoom = useCallback(() => setZoom(1), []);
  const handleFit = useCallback(() => {
    if (intrinsic) {
      fitToViewport(intrinsic);
    }
  }, [intrinsic, fitToViewport]);

  const canZoom = svg !== null && intrinsic !== null;

  return (
    <div
      className="chat-markdown-code-block"
      data-preview-open={previewOpen ? 'true' : undefined}
      data-diagram-kind={diagramKind}
    >
      <div className="chat-markdown-code-toolbar">
        <div className="chat-markdown-code-toolbar-meta">
          <div className="chat-markdown-code-label">{language ?? 'MERMAID'}</div>
          <span className="chat-markdown-preview-badge">{getMermaidDiagramLabel(diagramKind)}</span>
        </div>
        <div className="chat-markdown-code-actions">
          <button
            type="button"
            data-testid="chat-markdown-mermaid-toggle"
            className="chat-markdown-code-copy"
            aria-pressed={previewOpen}
            onClick={() => setPreviewOpen((value) => !value)}
          >
            {previewOpen ? '查看源码' : '查看图形'}
          </button>
          {previewOpen && canZoom && (
            <div className="chat-markdown-mermaid-zoom" role="group" aria-label="图表缩放">
              <button
                type="button"
                data-testid="chat-markdown-mermaid-zoom-out"
                className="chat-markdown-code-copy"
                aria-label="缩小"
                disabled={zoom <= MERMAID_MIN_ZOOM}
                onClick={zoomOut}
              >
                −
              </button>
              <button
                type="button"
                data-testid="chat-markdown-mermaid-zoom-reset"
                className="chat-markdown-code-copy chat-markdown-mermaid-zoom-value"
                title="恢复到 100%"
                onClick={resetZoom}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                data-testid="chat-markdown-mermaid-zoom-in"
                className="chat-markdown-code-copy"
                aria-label="放大"
                disabled={zoom >= MERMAID_MAX_ZOOM}
                onClick={zoomIn}
              >
                ＋
              </button>
              <button
                type="button"
                data-testid="chat-markdown-mermaid-fit"
                className="chat-markdown-code-copy"
                title="缩放到刚好占满可用宽度"
                onClick={handleFit}
              >
                适应宽度
              </button>
            </div>
          )}
          {previewOpen && svg !== null && (
            <button
              type="button"
              data-testid="chat-markdown-mermaid-download"
              className="chat-markdown-code-copy"
              onClick={handleDownloadSvg}
            >
              下载 SVG
            </button>
          )}
          <button
            type="button"
            data-testid="chat-markdown-mermaid-copy"
            className="chat-markdown-code-copy"
            onClick={handleCopy}
          >
            复制
          </button>
        </div>
      </div>
      {previewOpen ? (
        svg !== null ? (
          intrinsic !== null ? (
            <div
              ref={viewportRef}
              data-testid="chat-markdown-mermaid-figure"
              className="chat-markdown-mermaid-figure"
              data-zoomed={zoom !== 1 ? 'true' : undefined}
            >
              <div
                className="chat-markdown-mermaid-canvas"
                style={{ width: intrinsic.width * zoom, height: intrinsic.height * zoom }}
              >
                <div
                  className="chat-markdown-mermaid-scaled"
                  style={{
                    width: intrinsic.width,
                    height: intrinsic.height,
                    transform: `scale(${zoom})`,
                  }}
                  // mermaid `securityLevel: 'strict'` 已对输出做净化（剥离事件
                  // 处理器与外部链接），与 StaticPreviewCodeBlock 的信任模型一致。
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              </div>
            </div>
          ) : (
            // 拿不到 viewBox 时退回「按容器宽度自适应」的直接渲染。
            <div
              data-testid="chat-markdown-mermaid-figure"
              className="chat-markdown-mermaid-figure chat-markdown-mermaid-figure--fluid"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )
        ) : (
          <>
            <div
              className="chat-markdown-mermaid-status"
              data-load-failed={loadFailed || undefined}
            >
              {loadFailed
                ? MERMAID_LOAD_FAILED_HINT
                : mermaid
                  ? MERMAID_INCOMPLETE_HINT
                  : MERMAID_LOADING_HINT}
            </div>
            {renderError !== null && (
              <pre className="chat-markdown-mermaid-error">{renderError}</pre>
            )}
            <pre className="chat-markdown-pre">
              <code className={className} {...codeProps}>
                {code}
              </code>
            </pre>
          </>
        )
      ) : (
        <pre className="chat-markdown-pre">
          <code className={className} {...codeProps}>
            {code}
          </code>
        </pre>
      )}
    </div>
  );
});

function clampZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(MERMAID_MAX_ZOOM, Math.max(MERMAID_MIN_ZOOM, value));
}
