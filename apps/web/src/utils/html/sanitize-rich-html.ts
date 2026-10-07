/**
 * 富文本预览的 HTML 白名单净化器。
 *
 * 服务的两个调用方都把第三方库的输出直接注入**宿主 DOM**：
 * - `office-preview/DocxPreview.tsx` —— mammoth 的 `convertToHtml`
 * - `office-preview/XlsxPreview.tsx` —— SheetJS 的 `sheet_to_html`
 *
 * 两者都**不做** XSS 净化（mammoth 官方明确声明不保证安全；SheetJS 同样如此），
 * 而它们的输入是工作区文件——完全可能来自 `git clone` 的第三方仓库。原注释
 * 「mammoth which sanitizes via its style map」/「no untrusted user content」是
 * 错的，会让后续修复误判风险已消除。
 *
 * 与 `utils/svg/sanitize-svg.ts` 同为白名单模型：输出的每个节点与属性都是显式
 * 允许的，因此解析器行为差异不会成为绕过面。
 */

/** 允许的排版类标签。未列入的一律连子树删除（不做 unwrap），行为可预测。 */
const ALLOWED_TAGS = new Set<string>([
  // 块级
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'aside',
  'nav',
  'blockquote',
  'pre',
  'hr',
  'figure',
  'figcaption',
  // 标题
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  // 行内
  'span',
  'a',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'del',
  'ins',
  'sub',
  'sup',
  'small',
  'mark',
  'code',
  'kbd',
  'samp',
  'var',
  'abbr',
  'q',
  'cite',
  'dfn',
  'time',
  'wbr',
  'bdi',
  'bdo',
  'br',
  // 列表
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  // 表格
  'table',
  'caption',
  'colgroup',
  'col',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  // 图片
  'img',
]);

/** 直接连同子树一起丢弃的危险元素。 */
const FORBIDDEN_TAGS = new Set<string>([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'option',
  'textarea',
  'link',
  'meta',
  'base',
  'noscript',
  'template',
  'noscript',
  // 嵌套 SVG 会把 SVG 攻击面（`<animate attributeName=href>` 等）带回来
  'svg',
  'math',
]);

/** 允许保留的属性。刻意不含 `id`——避免 DOM clobbering 影响宿主查找。 */
const ALLOWED_ATTRIBUTES = new Set<string>([
  'class',
  'title',
  'lang',
  'dir',
  'style',
  // 链接
  'href',
  'target',
  'rel',
  // 图片
  'src',
  'alt',
  'width',
  'height',
  'loading',
  'decoding',
  // 表格
  'colspan',
  'rowspan',
  'headers',
  'scope',
  'align',
  'valign',
  'border',
  'cellpadding',
  'cellspacing',
  'nowrap',
  // 列表
  'start',
  'reversed',
  'type',
  'value',
  'span',
]);

/** 可安全内联的 data URI：仅位图，脚本类（`svg+xml`）一律拒绝。 */
const SAFE_DATA_URI = /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=]+$/i;

/** 链接/图片可用的协议。相对地址与页内片段放行，其余显式列举。 */
const SAFE_URL_PROTOCOL = /^(?:https?:|mailto:|tel:)/i;

/**
 * 清洗元素级 `style` 属性：移除可执行表达式、外部引用与 `@import`。
 * 与 SVG 预览共用同一份规则。
 */
export function sanitizeRichHtmlStyle(value: string): string {
  return value
    .replace(/@import[^;]*;?/giu, '')
    .replace(/expression\s*\(/giu, '(')
    .replace(/behaviou?r\s*:/giu, '')
    .replace(/-moz-binding\s*:/giu, '')
    .replace(/(?:javascript|vbscript)\s*:/giu, '')
    .replace(/url\(\s*(['"]?)(?!#)(?!data:image\/)[^)]*\)/giu, 'none');
}

function isSafeUrlValue(value: string): boolean {
  // 去掉 ASCII 控制字符与空格，阻断 `java\nscript:` 之类拼接绕过
  const normalized = value.replace(/[\u0000-\u0020\u007f]+/g, '');
  if (normalized.length === 0) return false;
  if (normalized.startsWith('#')) return true;
  if (normalized.startsWith('/') || normalized.startsWith('./') || normalized.startsWith('../')) {
    return true;
  }
  if (SAFE_URL_PROTOCOL.test(normalized)) return true;
  return SAFE_DATA_URI.test(normalized);
}

function sanitizeElementAttributes(element: Element): void {
  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();

    if (name.startsWith('on')) {
      element.removeAttributeNode(attr);
      continue;
    }
    if (name === 'href' || name === 'src' || name === 'xlink:href') {
      if (!isSafeUrlValue(attr.value)) {
        element.removeAttributeNode(attr);
      }
      continue;
    }
    if (!ALLOWED_ATTRIBUTES.has(name)) {
      element.removeAttributeNode(attr);
      continue;
    }
    if (name === 'style') {
      element.setAttribute('style', sanitizeRichHtmlStyle(attr.value));
    }
  }
}

function sanitizeChildren(parent: Element): void {
  for (const child of Array.from(parent.children)) {
    const tag = child.localName.toLowerCase();
    if (FORBIDDEN_TAGS.has(tag) || !ALLOWED_TAGS.has(tag)) {
      // 连子树一并删除：unwrap 会把未知标签里可能藏着的节点原样提升上来，
      // 与「白名单」语义相悖。
      child.remove();
      continue;
    }
    sanitizeElementAttributes(child);
    sanitizeChildren(child);
  }
}

/**
 * 把第三方库生成的富文本 HTML 净化为可安全注入宿主 DOM 的字符串。
 *
 * @param html 原始 HTML
 * @returns 净化后的 HTML；无法解析时返回空字符串
 */
export function sanitizeRichHtml(html: string): string {
  if (typeof html !== 'string' || html.trim().length === 0) return '';
  if (typeof DOMParser === 'undefined') return '';
  // 上限：超大文档在解析阶段就会阻塞主线程
  if (html.length > 8 * 1024 * 1024) return '';

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const body = parsed.body;
  if (!body) return '';

  sanitizeChildren(body);
  return body.innerHTML;
}
