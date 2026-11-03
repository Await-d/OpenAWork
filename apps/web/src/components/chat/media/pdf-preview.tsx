import { useEffect, useRef, useState } from 'react';
import './pdf-preview.css';

/**
 * 消息内 PDF 预览（pdfjs-dist **按需加载**）。
 *
 * ## 为什么动态 import
 *
 * `pdfjs-dist` 及其 worker 体积可观（见 `OfficePreview.tsx:5-7` 的历史注释：「PDF needs
 * pdfjs-dist which is heavy」），所以这里把它压到「用户真的点了预览」之后：
 * 组件本身不静态引用 pdfjs，`import()` 只在挂载时发生一次，Vite 会把它切成独立 chunk。
 * 同理，worker 通过 `?url` 拿到资源地址（worker 代码不会进主 bundle）。
 *
 * ## 为什么渲染到 canvas 而不是 iframe
 *
 * iframe 依赖浏览器内置 PDF 阅读器：Electron/Tauri 打包环境与部分移动端浏览器没有，
 * 且无法控制页码与缩放。canvas 渲染行为一致。
 *
 * ## 已覆盖 / 未覆盖
 *
 * - 覆盖：逐页渲染、分批「加载更多」、单页渲染失败不拖垮整篇、卸载时销毁文档
 * - 未覆盖：文本选择层、搜索、缩放控件、批注（本期只做「看得见」）
 */

const PAGES_PER_BATCH = 3;
const PAGE_SCALE = 1.5;

type PdfjsModule = typeof import('pdfjs-dist');
/**
 * `getDocument()` 返回的加载任务；**销毁必须作用在它身上** —— v6 的 `PDFDocumentProxy`
 * 只有 `cleanup()`，没有 `destroy()`（类型实测），销毁加载任务才会真正释放 worker。
 */
type PdfLoadingTask = ReturnType<PdfjsModule['getDocument']>;
type PdfDocumentProxy = Awaited<PdfLoadingTask['promise']>;

async function loadPdfjs(): Promise<PdfjsModule> {
  const pdfjs = await import('pdfjs-dist');
  // `?url` 让 Vite 把 worker 作为独立资源产出，只回传地址字符串。
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

async function openPdfDocument(src: string): Promise<PdfLoadingTask> {
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({ url: src });
}

/** 单页渲染。渲染失败只影响本页，不把整篇预览打成错误态。 */
function PdfPage({ doc, pageNumber }: { doc: PdfDocumentProxy; pageNumber: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;

    doc
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return null;
        const viewport = page.getViewport({ scale: PAGE_SCALE });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法创建画布上下文');
        // v6 的 RenderParameters 同时接受 `canvas` 与 `canvasContext`。
        return page.render({ canvas, canvasContext: context, viewport }).promise;
      })
      .catch((renderError: unknown) => {
        if (cancelled) return;
        setPageError(renderError instanceof Error ? renderError.message : String(renderError));
      });

    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber]);

  return (
    <div className="pdf-preview__page">
      {pageError ? (
        <p className="pdf-preview__page-error" role="status">
          第 {pageNumber} 页渲染失败
        </p>
      ) : (
        <canvas ref={canvasRef} aria-label={`第 ${pageNumber} 页`} />
      )}
    </div>
  );
}

export interface PdfPreviewProps {
  /** PDF 的 object URL / data URL。 */
  readonly src: string;
  readonly fileName: string;
}

export function PdfPreview({ src, fileName }: PdfPreviewProps) {
  const [doc, setDoc] = useState<PdfDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [visibleCount, setVisibleCount] = useState(PAGES_PER_BATCH);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let openedTask: PdfLoadingTask | null = null;
    setLoading(true);
    setError(null);
    setDoc(null);
    setPageCount(0);
    setVisibleCount(PAGES_PER_BATCH);

    const fail = (loadError: unknown): void => {
      if (cancelled) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setLoading(false);
    };

    openPdfDocument(src).then((loadingTask) => {
      openedTask = loadingTask;
      if (cancelled) {
        // 已卸载：把刚建好的加载任务直接销毁，否则 worker 与内存一直被占着。
        void loadingTask.destroy();
        return;
      }
      return loadingTask.promise.then((loaded) => {
        if (cancelled) return;
        setDoc(loaded);
        setPageCount(loaded.numPages);
        setLoading(false);
      }, fail);
    }, fail);

    return () => {
      cancelled = true;
      if (openedTask) void openedTask.destroy();
    };
  }, [src]);

  // 三种状态（加载中 / 失败 / 成功）都带「<文件名> 预览」的可访问名。
  // 只报「正在加载 PDF…」会让读屏用户无法分辨是哪一个 —— 一条消息里可能同时有多个
  // 附件在加载（成功态本来就有 label，加载态与失败态此前漏了，属同一件事的不一致）。
  if (loading) {
    return (
      <div
        className="pdf-preview pdf-preview--message"
        role="status"
        aria-label={`${fileName} 预览`}
      >
        <span className="pdf-preview__hint">正在加载 PDF…</span>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div
        className="pdf-preview pdf-preview--message"
        role="status"
        aria-label={`${fileName} 预览`}
      >
        <span className="pdf-preview__hint pdf-preview__hint--error">
          PDF 预览失败{error ? `：${error}` : ''}
        </span>
      </div>
    );
  }

  const shown = Math.min(visibleCount, pageCount);

  return (
    <div className="pdf-preview" aria-label={`${fileName} 预览`}>
      <div className="pdf-preview__pages">
        {Array.from({ length: shown }, (_, index) => (
          <PdfPage key={`page-${index + 1}`} doc={doc} pageNumber={index + 1} />
        ))}
      </div>
      {shown < pageCount ? (
        <button
          type="button"
          className="pdf-preview__more"
          onClick={() => setVisibleCount((count) => count + PAGES_PER_BATCH)}
        >
          继续加载（已显示 {shown} / {pageCount} 页）
        </button>
      ) : (
        <p className="pdf-preview__hint">已显示全部 {pageCount} 页</p>
      )}
    </div>
  );
}
