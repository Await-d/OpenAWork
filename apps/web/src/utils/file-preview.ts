export const DEFAULT_FILE_PREVIEW_HEIGHT = 280;
export const PREVIEW_RESIZE_MSG_TYPE = 'oaw-preview-resize';

export type FilePreviewKind = 'html' | 'css' | 'javascript';

export function getCodeBlockPreviewKind(language: string | undefined): FilePreviewKind | null {
  if (language === 'html') {
    return 'html';
  }

  if (language === 'css') {
    return 'css';
  }

  if (language === 'javascript' || language === 'js') {
    return 'javascript';
  }

  return null;
}

export function getFilePreviewKind(path: string): FilePreviewKind | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'html' || ext === 'htm') {
    return 'html';
  }

  if (ext === 'css') {
    return 'css';
  }

  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') {
    return 'javascript';
  }

  return null;
}

const RESIZE_SCRIPT = `<script>
(function () {
  function postHeight() {
    var h = document.documentElement.scrollHeight;
    if (h > 0) {
      parent.postMessage({ type: '${PREVIEW_RESIZE_MSG_TYPE}', height: h }, '*');
    }
  }

  postHeight();

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(postHeight).observe(document.body);
  }

  window.addEventListener('load', postHeight);

  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(postHeight).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  }
})();
<\/script>`;

function isFullHtmlDocument(code: string): boolean {
  const trimmed = code.trimStart().slice(0, 200).toLowerCase();
  return trimmed.startsWith('<!doctype') || trimmed.startsWith('<html');
}

function buildFullPagePreview(code: string): string {
  const safe = stripScriptTags(code);
  const baseTag = '<base href="about:srcdoc" target="_blank">';

  if (/<head[\s>]/iu.test(safe)) {
    const withBase = safe.replace(/(<head[^>]*>)/iu, `$1\n    ${baseTag}`);
    return withBase.replace(/<\/body\s*>/iu, `${RESIZE_SCRIPT}\n</body>`);
  }

  if (/<html[\s>]/iu.test(safe)) {
    const withHead = safe.replace(/(<html[^>]*>)/iu, `$1\n<head>${baseTag}</head>`);
    return withHead.replace(/<\/body\s*>/iu, `${RESIZE_SCRIPT}\n</body>`);
  }

  return `<!DOCTYPE html>
<html><head>${baseTag}</head>
<body>${safe}${RESIZE_SCRIPT}</body></html>`;
}

export function buildPreviewDocument(previewKind: FilePreviewKind, code: string): string {
  if (previewKind === 'html' && isFullHtmlDocument(code)) {
    return buildFullPagePreview(code);
  }

  const safeCode = previewKind === 'html' ? stripScriptTags(code) : code;
  const previewBody =
    previewKind === 'css'
      ? buildCssPreviewBody()
      : previewKind === 'javascript'
        ? buildJavascriptPreviewBody()
        : safeCode;
  const previewHead =
    previewKind === 'css'
      ? `<style>
${escapeForStyleTag(code)}
      </style>`
      : '';
  const previewScript =
    previewKind === 'javascript'
      ? `<script>
      (function () {
        const report = function (message) {
          const errorBox = document.getElementById('preview-errors');
          if (!errorBox) {
            return;
          }

          errorBox.hidden = false;
          errorBox.textContent = message;
        };

        window.addEventListener('error', function (event) {
          report('脚本执行失败：' + (event.message || '未知错误'));
        });

        try {
${escapeForInlineScript(code)}
        } catch (error) {
          report('脚本执行失败：' + (error && error.message ? error.message : String(error)));
        }
      })();
      <\/script>`
      : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <base href="about:srcdoc" target="_blank">
    <style>
      :root {
        color-scheme: light;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        min-height: 100%;
        background: #ffffff;
        color: #111827;
      }

      body {
        padding: 12px;
        font-family: 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
      }
    </style>
    ${previewHead}
  </head>
  <body>
${previewBody}
    ${previewScript}
    ${RESIZE_SCRIPT}
  </body>
</html>`;
}

export function getPreviewBadgeLabel(previewKind: FilePreviewKind): string {
  if (previewKind === 'css') {
    return '样式预览';
  }

  if (previewKind === 'javascript') {
    return '脚本预览';
  }

  return '静态预览';
}

export function getPreviewTitle(previewKind: FilePreviewKind): string {
  if (previewKind === 'css') {
    return 'CSS 预览';
  }

  if (previewKind === 'javascript') {
    return 'JavaScript 预览';
  }

  return 'HTML 预览';
}

export function getPreviewNote(previewKind: FilePreviewKind): string {
  if (previewKind === 'css') {
    return '当前使用固定示例骨架承载样式效果，便于安全观察布局、颜色和组件外观变化。';
  }

  if (previewKind === 'javascript') {
    return '当前脚本仅在隔离 iframe 中运行：允许脚本执行，但不会获得宿主页同源权限。';
  }

  return '安全沙箱预览：用户脚本已移除，外链将在新窗口打开。';
}

export function getPreviewSandbox(_previewKind: FilePreviewKind): string {
  return 'allow-scripts';
}

function escapeForStyleTag(code: string): string {
  return code.replace(/<\/style/giu, '<\\/style');
}

function escapeForInlineScript(code: string): string {
  return code.replace(/<\/script/giu, '<\\/script');
}

function stripScriptTags(html: string): string {
  return html
    .replace(/<script[\s>][\s\S]*?<\/script\s*>/giu, '')
    .replace(/<script[^>]*\/\s*>/giu, '');
}

function buildCssPreviewBody(): string {
  return `<main class="oa-css-preview-shell">
  <section class="oa-css-preview-hero">
    <span class="oa-css-preview-kicker">CSS Preview</span>
    <h1>前端样式效果预览</h1>
    <p>当前展示的是一组固定示例元素，方便直接观察颜色、层次、圆角、阴影与排版变化。</p>
    <div class="oa-css-preview-actions">
      <button class="demo-button" type="button">主按钮</button>
      <a class="demo-link" href="https://example.com">辅助链接</a>
    </div>
  </section>
  <section class="oa-css-preview-grid">
    <article class="oa-css-preview-card demo-card">
      <strong>统计卡片</strong>
      <p>支持观察容器、标题、正文与 badge 的样式组合。</p>
      <span class="oa-css-preview-badge">新增能力</span>
    </article>
    <article class="oa-css-preview-card demo-card">
      <label class="oa-css-preview-field demo-field">
        <span>搜索输入</span>
        <input class="demo-input" type="text" placeholder="输入关键字" />
      </label>
      <ul>
        <li>列表项 A</li>
        <li>列表项 B</li>
        <li>列表项 C</li>
      </ul>
    </article>
  </section>
</main>`;
}

function buildJavascriptPreviewBody(): string {
  return `<main class="oa-js-preview-shell demo-shell">
  <section class="oa-js-preview-stage demo-card">
    <span class="oa-js-preview-kicker">JavaScript Preview</span>
    <h1 id="preview-title">脚本预览基座</h1>
    <p id="preview-copy">这里是隔离沙箱中的演示 DOM，可供脚本直接操作。</p>
    <div class="oa-js-preview-actions">
      <button id="preview-button" class="demo-button" type="button">主按钮</button>
      <span id="preview-badge" class="oa-css-preview-badge">待运行</span>
    </div>
    <pre id="preview-errors" hidden></pre>
  </section>
</main>`;
}
