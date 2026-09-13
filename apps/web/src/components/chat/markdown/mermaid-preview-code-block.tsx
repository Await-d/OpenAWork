import { memo, useCallback, useEffect, useState } from 'react';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';

type MermaidApi = (typeof import('mermaid'))['default'];

// mermaid 体积较大，走动态 import：只有消息里真正出现 mermaid 代码块时才加载。
// 流式输出期间源码不断追加，先 debounce 合并连续更新；语法未完整时 parse 失败
// 属于正常过程，保留源码展示并在补全后自动重试出图。
const MERMAID_RENDER_DEBOUNCE_MS = 250;
const MERMAID_INCOMPLETE_HINT = '图表语法尚未完整或存在错误，内容补全后将自动重试。';
const MERMAID_LOAD_FAILED_HINT = '图表渲染库加载失败，可切换为源码查看。';
const MERMAID_LOADING_HINT = '正在加载图表渲染…';

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
  const [renderError, setRenderError] = useState<string | null>(null);
  const themeMode = useDisplayPreferencesStore((s) => s.themeMode);

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

  // 渲染为 SVG：strict 安全级别净化输出，主题跟随应用的深浅色模式。
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
            theme: themeMode === 'dark' ? 'dark' : 'default',
          });
          const renderId = `oaw-mermaid-${(mermaidRenderSeq += 1)}`;
          await mermaid.parse(code);
          const { svg: renderedSvg } = await mermaid.render(renderId, code);
          if (cancelled) {
            return;
          }
          setSvg(renderedSvg);
          setRenderError(null);
        } catch (err) {
          if (cancelled) {
            return;
          }
          setSvg(null);
          setRenderError(err instanceof Error ? err.message : String(err));
        }
      })();
    }, MERMAID_RENDER_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mermaid, code, themeMode, previewOpen]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard?.writeText(code).catch(() => undefined);
  }, [code]);

  return (
    <div className="chat-markdown-code-block" data-preview-open={previewOpen ? 'true' : undefined}>
      <div className="chat-markdown-code-toolbar">
        <div className="chat-markdown-code-toolbar-meta">
          <div className="chat-markdown-code-label">{language ?? 'MERMAID'}</div>
          <span className="chat-markdown-preview-badge">图表预览</span>
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
          <div
            data-testid="chat-markdown-mermaid-figure"
            className="chat-markdown-mermaid-figure"
            // mermaid `securityLevel: 'strict'` 已对输出做净化（剥离事件
            // 处理器与外部链接），与 StaticPreviewCodeBlock 的信任模型一致。
            dangerouslySetInnerHTML={{ __html: svg }}
          />
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
