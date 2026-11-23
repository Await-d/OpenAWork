/**
 * 工具失败态的结构化解析（纯函数，无副作用）。
 *
 * 背景：失败态原先只有一条红色单行 pill，取「首行 + 截 80 字符」。而 agentignore
 * 拦截、工作区越界这类错误的正文是「结论 + 原因 + 建议」的多段文本，压成一行后
 * 真正原因经常落在截断点之后。
 *
 * 这里**只按已知前缀 / 结构**匹配（`Access denied:`、`You must read file`、
 * `目标路径超出当前工作区范围：`、`ENOENT:` 等），不做关键词模糊推断——避免把
 * 普通错误文本误判成结构化字段。
 *
 * 两条不变量：
 * 1. `raw` 永远是**原文**，从不重排 / 重写；渲染器始终保留「原始输出」兜底，
 *    任何没被解析到的部分都不会丢。
 * 2. 解析器**永不抛错**：正则或输入异常时退回 `kind: 'plain'` 视图。
 */

/** 折叠态 / 标题行的字符上限：够放下一句中文结论，又不至于把折叠行撑爆。 */
const HEADLINE_CLAMP_LEN = 120;

/** 失败卡分类。`unknown` 只在结构化解析成功但分类无法进一步细分时出现。 */
export type ToolFailureCategory =
  'permission' | 'precondition' | 'workspace' | 'system' | 'guard' | 'unknown';

/** 卡片标题行的分类标签（中文硬编码，与同目录其它预览一致，不引入 i18n 框架）。 */
export const TOOL_FAILURE_CATEGORY_LABEL: Record<ToolFailureCategory, string> = {
  permission: '写入被拒绝',
  precondition: '需要先读取文件',
  workspace: '超出工作区范围',
  system: '系统错误',
  guard: '调用被拦截',
  unknown: '调用失败',
};

export interface ToolFailureField {
  label: string;
  value: string;
}

/**
 * 失败视图的判别联合：
 * - `structured`：已知形态，拆出了分类 / 结论 / 字段（可能还有建议）；
 * - `plain`：认不出的形态，只给一句结论 + 原文。
 */
export type ToolFailureView =
  | {
      kind: 'structured';
      category: ToolFailureCategory;
      headline: string;
      fields: ToolFailureField[];
      suggestion?: string;
      raw: string;
    }
  | {
      kind: 'plain';
      /** 已知的规则拦截（guard）会带上分类，标题行据此显示分类标签。 */
      category?: ToolFailureCategory;
      headline: string;
      raw: string;
    };

interface StructuredFailure {
  category: ToolFailureCategory;
  headline: string;
  fields: ToolFailureField[];
  suggestion?: string;
}

/**
 * 把一次失败的工具输出解析成失败卡视图。
 *
 * `isError` 为假时直接返回 `null`（调用方据此完全不渲染失败卡）。`isError` 为真时
 * **一定**返回视图——认不出形态也至少给一个 `plain` 视图，绝不渲染空卡片。
 */
export function buildToolFailureView(
  output: unknown,
  isError: boolean | undefined,
): ToolFailureView | null {
  if (!isError) return null;

  const raw = resolveRawText(output);
  try {
    const candidate = resolveFailureText(output);
    const structured = parseStructuredFailure(candidate);
    if (structured) return { kind: 'structured', ...structured, raw };
    return buildPlainView(candidate, raw);
  } catch (error) {
    // 解析器不允许把失败态打崩：任何异常都退回「原文 + 首行结论」。
    console.warn('[tool-failure-view] 失败输出解析异常，回退纯文本视图', error);
    return buildPlainView(raw, raw);
  }
}

/** 原文：字符串原样返回；其它形态序列化后返回（不参与任何改写）。 */
function resolveRawText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === null || output === undefined) return '';
  try {
    return JSON.stringify(output, null, 2) ?? String(output);
  } catch (error) {
    console.warn('[tool-failure-view] 失败输出无法序列化，改用 String()', error);
    return String(output);
  }
}

/**
 * 参与结构化匹配的候选文本。
 *
 * 字符串输出直接用；对象信封按「错误信息优先级」取字段（与 `extractErrorSummary`
 * 的口径一致，避免两处摘要各说一套）。取不到任何文本时返回空串——此时卡片只显示
 * 一句「执行失败」，完整 JSON 仍在「原始输出」里。
 */
function resolveFailureText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (!output || typeof output !== 'object' || Array.isArray(output)) return '';
  const record = output as Record<string, unknown>;
  for (const key of ['error', 'message', 'stderr', 'output'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = (value as Record<string, unknown>)['message'];
      if (typeof nested === 'string' && nested.trim().length > 0) return nested;
    }
  }
  return '';
}

function buildPlainView(candidate: string, raw: string): ToolFailureView {
  const headline = clampHeadline(firstNonEmptyLine(candidate) ?? '执行失败');
  const category = matchGuardMessage(candidate);
  return category ? { kind: 'plain', category, headline, raw } : { kind: 'plain', headline, raw };
}

/** 按「结构最具体 → 最宽泛」的顺序尝试，命中即返回。 */
function parseStructuredFailure(text: string): StructuredFailure | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const firstLine = firstNonEmptyLine(trimmed) ?? '';
  return (
    parseAgentignoreDenial(trimmed) ??
    parseReadBeforeEdit(firstLine) ??
    parseWorkspaceEscape(firstLine, trimmed) ??
    parseErrno(firstLine)
  );
}

/**
 * agentignore 拦截：`Access denied: file "<path>" is protected by agentignore rules. <中文说明>`
 *
 * 说明部分本身是「原因。建议。」两段中文，按句号拆开：首句进「原因」，其余进「建议」。
 * 拿整段塞进一个字段就等于没结构，所以这里必须拆。
 */
const AGENTIGNORE_DENIAL =
  /^Access denied: file "([^"]+)" is protected by agentignore rules\.?([\s\S]*)$/;

function parseAgentignoreDenial(text: string): StructuredFailure | null {
  const matched = AGENTIGNORE_DENIAL.exec(text);
  if (!matched) return null;
  const path = (matched[1] ?? '').trim();
  const rest = (matched[2] ?? '').trim();
  const sentences = rest
    .split('。')
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  const [reason, ...advice] = sentences;
  const fields: ToolFailureField[] = [];
  if (path) fields.push({ label: '路径', value: path });
  fields.push({ label: '原因', value: reason ?? '该路径命中 agentignore 保护规则' });
  const adviceText = advice.join('。');
  return {
    category: 'permission',
    headline: 'agentignore 保护路径',
    fields,
    suggestion: adviceText ? `${adviceText}。` : '改用不受保护的等价文件，或让用户显式提供该值。',
  };
}

/** 前置条件缺失：`You must read file "<path>" before editing it` */
const READ_BEFORE_EDIT = /^You must read file "([^"]+)" before editing it\.?$/;

function parseReadBeforeEdit(line: string): StructuredFailure | null {
  const matched = READ_BEFORE_EDIT.exec(line);
  if (!matched) return null;
  const path = (matched[1] ?? '').trim();
  return {
    category: 'precondition',
    headline: '编辑前需先读取文件',
    fields: path ? [{ label: '路径', value: path }] : [],
    suggestion: '先读取该文件内容，再重试编辑。',
  };
}

const WORKSPACE_ESCAPE =
  /^目标路径超出当前工作区范围\s*[:：]\s*(.+?)(?:\s*[（(]\s*当前工作区\s*[:：]\s*(.+?)\s*[）)])?\s*$/;
const FORBIDDEN_WORKSPACE_PATH = /^Forbidden workspace path:\s*(.+)$/;

function parseWorkspaceEscape(line: string, raw: string): StructuredFailure | null {
  const canSuggestExport = /^建议：交付新文件时，先写入当前工作区/m.test(raw);
  const matched = WORKSPACE_ESCAPE.exec(line) ?? FORBIDDEN_WORKSPACE_PATH.exec(line);
  if (!matched) return null;
  const path = (matched[1] ?? '').trim();
  const root = (matched[2] ?? '').trim();
  const fields: ToolFailureField[] = [];
  if (path) fields.push({ label: '路径', value: path });
  if (root) fields.push({ label: '工作区', value: root });
  return {
    category: 'workspace',
    headline: line.startsWith('Forbidden workspace path:')
      ? '目标路径不允许访问'
      : '目标路径超出工作区范围',
    fields,
    suggestion: canSuggestExport
      ? '交付新文件时，先生成到当前工作区，再在文件编辑器中另存为或下载。要修改原文件，请切换到有权访问的工作区。'
      : '改用当前工作区内的路径，或切换到有权访问的工作区。',
  };
}

/**
 * errno 类系统错误：`ENOENT: no such file or directory, stat '<path>'`。
 *
 * 错误码只接受 errno 约定（以 `E` 开头且全大写）；未收录的码要求详情以小写开头，
 * 避免把 `ERROR: Something failed` 这类普通文本误判成系统错误。
 */
const ERRNO = /^([A-Z][A-Z0-9_]{2,}):\s*([\s\S]+)$/;
const ERRNO_DETAIL = /^(.*?),\s*([a-z][a-z_]*)\s+'([^']*)'\s*$/;

const ERRNO_HEADLINE: Record<string, string> = {
  EACCES: '没有访问权限',
  EBUSY: '资源被占用',
  ECONNREFUSED: '连接被拒绝',
  EEXIST: '目标已存在',
  EINVAL: '参数不合法',
  EISDIR: '目标是目录',
  ELOOP: '符号链接层级过深',
  EMFILE: '打开的文件过多',
  ENAMETOOLONG: '路径过长',
  ENETUNREACH: '网络不可达',
  ENOENT: '文件或目录不存在',
  ENOSPC: '磁盘空间不足',
  ENOTDIR: '路径中的某一级不是目录',
  ENOTEMPTY: '目录非空',
  EPERM: '操作不被允许',
  EROFS: '只读文件系统',
  ETIMEDOUT: '操作超时',
};

function parseErrno(line: string): StructuredFailure | null {
  const matched = ERRNO.exec(line);
  if (!matched) return null;
  const code = matched[1] ?? '';
  const rest = (matched[2] ?? '').trim();
  if (!code.startsWith('E') || !/^E[A-Z0-9_]+$/.test(code)) return null;
  const known = ERRNO_HEADLINE[code];
  if (!known && !/^[a-z]/.test(rest)) return null;

  const detail = ERRNO_DETAIL.exec(rest);
  const fields: ToolFailureField[] = [{ label: '错误码', value: code }];
  if (detail) {
    const message = (detail[1] ?? '').trim();
    const syscall = (detail[2] ?? '').trim();
    const path = (detail[3] ?? '').trim();
    if (message) fields.push({ label: '详情', value: message });
    if (syscall) fields.push({ label: '操作', value: syscall });
    if (path) fields.push({ label: '路径', value: path });
  } else {
    fields.push({ label: '详情', value: rest });
  }
  return {
    category: 'system',
    headline: known ?? `系统调用失败（${code}）`,
    fields,
  };
}

/**
 * 其它规则拦截：已知的**稳定前缀**清单，命中即按「一行结论」呈现。
 * 这里刻意不猜关键词——只有清单里的前缀算 guard，其余一律走通用回退。
 */
const GUARD_PREFIXES = [
  'Command substitution',
  'Command blocked',
  'Command not allowed',
  '该命令被拦截',
  '命令被拦截',
];

function matchGuardMessage(text: string): ToolFailureCategory | undefined {
  const firstLine = firstNonEmptyLine(text);
  if (!firstLine) return undefined;
  return GUARD_PREFIXES.some((prefix) => firstLine.startsWith(prefix)) ? 'guard' : undefined;
}

function firstNonEmptyLine(text: string): string | null {
  if (!text) return null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

/** 标题必须是一行：折叠空白 + 超长截断（完整内容在展开体的字段 / 原始输出里）。 */
function clampHeadline(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= HEADLINE_CLAMP_LEN) return flat;
  return `${flat.slice(0, HEADLINE_CLAMP_LEN - 1)}…`;
}
