import { sanitizeRichHtmlStyle } from '../html/sanitize-rich-html.js';

/**
 * SVG 预览净化器（白名单模型）。
 *
 * 背景：SVG 预览的结果会直接注入**宿主 DOM**（而不是 sandbox iframe），所以
 * 「删 `<script>` + 删带引号的 `on*=`」这种黑名单做法形同虚设——历史上已确认
 * 可被以下手法绕过：
 *
 * - `<svg onload=alert(1)>`：无引号的 `on*=` 不匹配第二条正则
 * - `<a href="javascript:...">` / `<use href="javascript:...">`：URI 从未被过滤
 * - `<foreignObject>`：可承载任意 HTML，逃出 SVG 命名空间
 * - `<animate attributeName="href" values="javascript:...">`：间接改写链接
 * - `<script/src="x">`：`<script` 后是 `/`，不匹配 `<script[\s>][\s\S]*?<\/script>`
 *
 * 因此改为**白名单**：只保留绘图 / 渐变 / 滤镜类元素与属性，其余一律删除。
 * 白名单模型的关键性质是「输出的每个节点与属性都是显式允许的」，因此解析器在
 * 细节上的行为差异（XML 与 HTML 的 foreign content 处理等）不会成为绕过面。
 */

/** 允许出现在预览 SVG 中的元素（localName 小写比较，故驼峰写法已折叠）。 */
const ALLOWED_ELEMENTS = new Set<string>([
  // 结构
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'switch',
  'title',
  'desc',
  'metadata',
  'view',
  // 基本图形
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  // 文本
  'text',
  'tspan',
  'textpath',
  // 容器 / 装饰
  'marker',
  'pattern',
  'mask',
  'clippath',
  'a',
  'image',
  // 渐变
  'lineargradient',
  'radialgradient',
  'stop',
  // 滤镜
  'filter',
  'feblend',
  'fecolormatrix',
  'fecomponenttransfer',
  'fecomposite',
  'feconvolvematrix',
  'fediffuselighting',
  'fedisplacementmap',
  'fedistantlight',
  'fedropshadow',
  'feflood',
  'fefunca',
  'fefuncb',
  'fefuncg',
  'fefuncr',
  'fegaussianblur',
  'feimage',
  'femerge',
  'femergenode',
  'femorphology',
  'feoffset',
  'fepointlight',
  'fespecularlighting',
  'fespotlight',
  'fetile',
  'feturbulence',
]);

/**
 * 即便未来有人把它们误加进 `ALLOWED_ELEMENTS`，这里也会显式拒绝。
 *
 * `style` 尤其重要：净化结果注入的是宿主 DOM，SVG 内的 `<style>` 属于**文档级**
 * 样式表，能直接改写整个应用的观感（`body { display: none }`）。因此只保留
 * 元素级 `style` 属性（经清洗），禁止 `<style>` 元素。
 */
const DENIED_ELEMENTS = new Set<string>([
  'script',
  'style',
  'foreignobject',
  'animate',
  'animatemotion',
  'animatetransform',
  'set',
  'handler',
  'listener',
  'discard',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'font',
  'font-face',
]);

/** 允许保留的属性（localName 小写比较）。 */
const ALLOWED_ATTRIBUTES = new Set<string>([
  // 通用 / 命名空间
  'id',
  'class',
  'style',
  'version',
  'xmlns',
  'xmlns:xlink',
  'xml:space',
  'xml:lang',
  'lang',
  'space',
  'systemlanguage',
  'requiredfeatures',
  'requiredextensions',
  'externalresourcesrequired',
  'pathlength',
  // 几何
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'd',
  'points',
  'dx',
  'dy',
  'transform',
  'transformorigin',
  'viewbox',
  'preserveaspectratio',
  'viewtarget',
  // 填充 / 描边
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'stroke-miterlimit',
  'paint-order',
  'vector-effect',
  'shape-rendering',
  'image-rendering',
  'text-rendering',
  'color',
  'color-interpolation',
  'color-interpolation-filters',
  'opacity',
  'display',
  'visibility',
  'overflow',
  'mix-blend-mode',
  'isolation',
  'clip-path',
  'clip-rule',
  'clippathunits',
  'mask',
  'maskunits',
  'maskcontentunits',
  'filter',
  'filterunits',
  'primitiveunits',
  // 渐变
  'gradientunits',
  'gradienttransform',
  'spreadmethod',
  'offset',
  'stop-color',
  'stop-opacity',
  'flood-color',
  'flood-opacity',
  'lighting-color',
  // 图案 / 标记
  'patternunits',
  'patterncontentunits',
  'patterntransform',
  'markerunits',
  'markerwidth',
  'markerheight',
  'refx',
  'refy',
  'orient',
  // 文本
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'font-stretch',
  'text-anchor',
  'text-decoration',
  'dominant-baseline',
  'alignment-baseline',
  'baseline-shift',
  'letter-spacing',
  'word-spacing',
  'writing-mode',
  'direction',
  'unicode-bidi',
  'startoffset',
  'method',
  'spacing',
  'side',
  // 滤镜参数
  'in',
  'in2',
  'result',
  'stddeviation',
  'mode',
  'type',
  'values',
  'operator',
  'k1',
  'k2',
  'k3',
  'k4',
  'scale',
  'xchannelselector',
  'ychannelselector',
  'tablevalues',
  'slope',
  'intercept',
  'amplitude',
  'exponent',
  'azimuth',
  'elevation',
  'specularconstant',
  'specularexponent',
  'surfacescale',
  'diffuseconstant',
  'kernelmatrix',
  'order',
  'divisor',
  'bias',
  'preservealpha',
  'radius',
  'basefrequency',
  'numoctaves',
  'seed',
  'stitchtiles',
  'targetx',
  'targety',
  'edgemode',
  // 文本路径 / 图像引用
  'path',
  // URL 属性：仅通过白名单还不够，还必须额外通过 `isSafeUrlValue` 校验
  'href',
  'xlink:href',
  'src',
]);

/** 这些属性的值是 URL，必须逐个校验。 */
const URL_ATTRIBUTES = new Set<string>(['href', 'xlink:href', 'src']);

/** 预览源体积上限：超大 SVG 在解析阶段会阻塞主线程，直接放弃渲染。 */
const MAX_SVG_SOURCE_LENGTH = 4 * 1024 * 1024;

/** 可安全内联的 data URI（位图；`image/svg+xml` 自身可携带脚本，故排除）。 */
const SAFE_DATA_URI = /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=]+$/i;

/**
 * 只允许「文档内片段引用」与「位图 data URI」。
 *
 * 注意这里读的是 DOM 的 `attr.value`——实体已在解析阶段解码完成，因此
 * `href="javascript&#58;alert(1)"` 这类实体绕过在本函数面前是失效的。
 */
function isSafeUrlValue(value: string): boolean {
  // 去掉控制字符，阻断 `java\nscript:` / `java\tscript:` 之类拼接绕过
  const normalized = value.replace(/[\u0000-\u0020\u007f]+/g, '');
  if (normalized.length === 0) return false;
  if (normalized.startsWith('#')) return true;
  return SAFE_DATA_URI.test(normalized);
}

/**
 * 清洗元素级 `style` 属性。
 *
 * 规则实现在 `utils/html/sanitize-rich-html.ts`，与 DOCX / XLSX 富文本预览共用
 * 一份，避免两个净化器在 CSS 绕过面上各自演化。
 */
function sanitizeStyleValue(value: string): string {
  return sanitizeRichHtmlStyle(value);
}

/** 就地清洗单个元素：先清属性，再递归子元素。 */
function sanitizeElement(element: Element): void {
  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();

    // 事件处理器：白名单本就不含 `on*`，这里再显式兜一层
    if (name.startsWith('on')) {
      element.removeAttributeNode(attr);
      continue;
    }
    // 命名空间声明必须保留，否则 xlink 引用在序列化后会失效
    if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
    if (!ALLOWED_ATTRIBUTES.has(name)) {
      element.removeAttributeNode(attr);
      continue;
    }
    if (URL_ATTRIBUTES.has(name)) {
      if (!isSafeUrlValue(attr.value)) element.removeAttributeNode(attr);
      continue;
    }
    if (name === 'style') {
      element.setAttribute('style', sanitizeStyleValue(attr.value));
    }
  }

  // SVG 文本内容依赖文本节点，故只遍历元素子节点并保留文本
  for (const child of Array.from(element.children)) {
    const tag = child.localName.toLowerCase();
    if (DENIED_ELEMENTS.has(tag) || !ALLOWED_ELEMENTS.has(tag)) {
      element.removeChild(child);
      continue;
    }
    sanitizeElement(child);
  }
}

/**
 * 解析出根 `<svg>`。先走严格 XML（命名空间与大小写最可靠），失败再回退容错
 * 的 HTML 解析（真实世界的 SVG 未必是合法 XML）。两者都拿不到则安全失败。
 */
function parseSvgRoot(source: string): Element | null {
  if (typeof DOMParser === 'undefined') return null;

  const xml = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (!xml.querySelector('parsererror')) {
    const root = xml.documentElement;
    if (root && root.localName.toLowerCase() === 'svg') return root;
  }

  const html = new DOMParser().parseFromString(source, 'text/html');
  return html.body?.querySelector('svg') ?? null;
}

/**
 * 把工作区里的 SVG 源净化为可安全注入宿主 DOM 的字符串。
 *
 * @param svg 原始 SVG 文本
 * @returns 净化后的 SVG 标记；无法安全解析时返回空字符串
 */
export function sanitizeSvg(svg: string): string {
  if (typeof svg !== 'string') return '';
  const source = svg.trim();
  if (source.length === 0) return '';
  if (source.length > MAX_SVG_SOURCE_LENGTH) return '';

  const root = parseSvgRoot(source);
  if (!root) return '';

  sanitizeElement(root);
  return root.outerHTML;
}
