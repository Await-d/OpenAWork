/**
 * `desktop_automation` / `desktop_control` 的视图模型（纯函数，无 React）。
 *
 * 这两个工具的输出是 JSON 字符串（`{"ok":true}` / 状态快照 / 截图句柄），落通用
 * 渲染时用户只看到 `ok: true`、`artifactId` 这类键值，看不出「刚才点了哪里」。
 * 这里把入参的 action 与关键目标提炼成一句话，并区分「确认型动作」与「带数据的
 * 读取动作」——卡片据此决定是否展开原始返回。
 */

export type DesktopToolName = 'desktop_automation' | 'desktop_control';

/** 输出语义：ack = 仅确认（`{ok:true}`）；data = 读取类结果；image = 截图。 */
export type DesktopPayloadKind = 'ack' | 'data' | 'image';

export interface DesktopToolView {
  /** 动作中文名（如「点击」「截图」）；未知动作回退原始 action。 */
  actionLabel: string;
  /** 目标描述（url / selector / 坐标 / 按键…）；无可描述目标时为空串。 */
  targetLabel: string;
  /** 输出侧状态；`unknown` 表示尚未落定或输出不可解析。 */
  status: 'failed' | 'ok' | 'unknown';
  /** 失败原因（输出里的 error / message / reason）。 */
  errorText?: string;
  payloadKind: DesktopPayloadKind;
}

const DESKTOP_TOOL_NAMES: ReadonlySet<string> = new Set(['desktop_automation', 'desktop_control']);

export function isDesktopTool(toolName: string): boolean {
  return DESKTOP_TOOL_NAMES.has(toolName.trim().toLowerCase());
}

/**
 * 动作 → 中文名。
 *
 * 两个工具的动作集合有交集（status / screenshot / click / type / scroll / wait），
 * 语义一致，共用一张表；`desktop_control` 独有的是 `hotkey` / `drag` / `mouse_move`
 * / `long_press`，`desktop_automation` 独有的是页面读取类动作。
 */
const ACTION_LABELS: Readonly<Record<string, string>> = {
  status: '读取运行状态',
  start: '启动浏览器',
  goto: '打开网页',
  back: '后退',
  forward: '前进',
  reload: '刷新页面',
  click: '点击',
  type: '输入文本',
  press: '按键',
  key: '按键',
  hotkey: '组合键',
  hover: '悬停',
  check: '勾选',
  select: '选择下拉项',
  find: '查找元素',
  frames: '读取 iframe 列表',
  evaluate: '执行页面脚本',
  console: '读取控制台',
  network_list: '读取网络请求列表',
  network_get: '读取单条网络请求',
  scroll: '滚动',
  wait: '等待',
  content: '读取页面 HTML',
  snapshot: '读取页面快照',
  screenshot: '截图',
  drag: '拖拽',
  mouse_move: '移动鼠标',
  long_press: '长按',
};

/** 读取类动作：输出是真实数据，值得展示原始结果。 */
const DATA_ACTIONS: ReadonlySet<string> = new Set([
  'status',
  'find',
  'frames',
  'evaluate',
  'console',
  'network_list',
  'network_get',
  'content',
  'snapshot',
  'select',
]);

const MAX_TEXT_PREVIEW = 60;

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function truncate(value: string, max = MAX_TEXT_PREVIEW): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  return singleLine.length > max ? `${singleLine.slice(0, max - 1)}…` : singleLine;
}

/** 坐标点：优先 `x/y`，其次 `box`（绝对截图像素的 [x1,y1,x2,y2]，落点取中心）。 */
function formatPoint(input: Record<string, unknown>): string {
  const x = readNumber(input, 'x');
  const y = readNumber(input, 'y');
  if (x !== undefined && y !== undefined) {
    return `(${Math.round(x)}, ${Math.round(y)})`;
  }

  const box = input['box'];
  if (Array.isArray(box) && box.length === 4) {
    const [x1, y1, x2, y2] = box;
    if (
      typeof x1 === 'number' &&
      typeof y1 === 'number' &&
      typeof x2 === 'number' &&
      typeof y2 === 'number'
    ) {
      return `(${Math.round((x1 + x2) / 2)}, ${Math.round((y1 + y2) / 2)})`;
    }
  }

  return '';
}

/** 按动作挑出「用户最想确认的那个目标」，拼成一段可读描述。 */
function formatTarget(action: string, input: Record<string, unknown>): string {
  const selector = readString(input, 'selector');
  const url = readString(input, 'url');

  switch (action) {
    case 'start':
    case 'goto':
      return url;
    case 'click':
    case 'hover':
    case 'mouse_move':
    case 'long_press': {
      const point = formatPoint(input);
      return selector || point;
    }
    case 'type': {
      const text = truncate(readString(input, 'text'));
      const head = selector || formatPoint(input);
      return [head, text ? `“${text}”` : ''].filter(Boolean).join(' ');
    }
    case 'press':
    case 'key': {
      const key = readString(input, 'key');
      return selector ? `${selector} ${key}` : key;
    }
    case 'hotkey': {
      const keys = input['keys'];
      return Array.isArray(keys) ? keys.filter((k) => typeof k === 'string').join(' + ') : '';
    }
    case 'check': {
      const checked = input['checked'] === false ? '取消勾选' : '勾选';
      return selector ? `${checked} ${selector}` : checked;
    }
    case 'select': {
      const values = input['values'];
      const selected = Array.isArray(values) ? values.filter((v) => typeof v === 'string') : [];
      return selector
        ? `${selector} → ${selected.length > 0 ? selected.join(', ') : '（未指定值）'}`
        : selected.join(', ');
    }
    case 'find': {
      const limit = readNumber(input, 'limit');
      return limit !== undefined ? `${selector}（上限 ${limit}）` : selector;
    }
    case 'network_list': {
      const filters = [
        readString(input, 'method'),
        readString(input, 'urlContains') ? `url~${truncate(readString(input, 'urlContains'))}` : '',
      ].filter(Boolean);
      return filters.join(' ');
    }
    case 'network_get':
      return readString(input, 'requestId');
    case 'scroll': {
      const direction = readString(input, 'direction');
      const amount = readNumber(input, 'amount');
      const scrollY = readNumber(input, 'scrollY');
      const deltaY = amount ?? scrollY;
      const label = direction === 'up' ? '向上' : direction === 'down' ? '向下' : '';
      return [label, deltaY !== undefined ? `${Math.abs(deltaY)}px` : ''].filter(Boolean).join(' ');
    }
    case 'wait': {
      const ms = readNumber(input, 'ms');
      return [selector, ms !== undefined ? `${ms}ms` : ''].filter(Boolean).join(' ');
    }
    case 'drag': {
      const fromX = readNumber(input, 'fromX');
      const fromY = readNumber(input, 'fromY');
      const toX = readNumber(input, 'toX');
      const toY = readNumber(input, 'toY');
      if (fromX === undefined || fromY === undefined || toX === undefined || toY === undefined) {
        return '';
      }
      return `(${Math.round(fromX)}, ${Math.round(fromY)}) → (${Math.round(toX)}, ${Math.round(toY)})`;
    }
    case 'evaluate': {
      const script = readString(input, 'script');
      return script ? truncate(script) : '';
    }
    case 'screenshot': {
      const delayMs = readNumber(input, 'delayMs');
      return delayMs !== undefined && delayMs > 0 ? `延迟 ${delayMs}ms` : '';
    }
    default:
      return '';
  }
}

/** 把 JSON 字符串 / 对象统一成 record；不可解析返回 null。 */
function normalizeOutput(output: unknown): Record<string, unknown> | null {
  if (output !== null && typeof output === 'object' && !Array.isArray(output)) {
    return output as Record<string, unknown>;
  }
  if (typeof output !== 'string') {
    return null;
  }
  const trimmed = output.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // 截断 / 非 JSON：交给调用方按 isError 与纯文本兜底，这里不猜结构。
    return null;
  }
}

/**
 * 解析一帧桌面/浏览器动作的展示模型。
 *
 * `isError` 优先于输出内容：工具抛错时 output 往往只是错误文本，不能被当成「成功」。
 */
export function resolveDesktopToolView(params: {
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  isError?: boolean;
}): DesktopToolView {
  const action = typeof params.input['action'] === 'string' ? params.input['action'].trim() : '';
  const record = normalizeOutput(params.output);

  const rawError = record
    ? readString(record, 'error') || readString(record, 'message') || readString(record, 'reason')
    : '';
  const failed =
    params.isError === true ||
    rawError.length > 0 ||
    (record !== null && (record['ok'] === false || record['success'] === false));
  const succeeded =
    record !== null &&
    (record['ok'] === true || record['success'] === true || record['started'] === true);

  const payloadKind: DesktopPayloadKind =
    action === 'screenshot' ? 'image' : DATA_ACTIONS.has(action) ? 'data' : 'ack';

  return {
    actionLabel: ACTION_LABELS[action] ?? (action.length > 0 ? action : '桌面操作'),
    targetLabel: formatTarget(action, params.input),
    status: failed ? 'failed' : succeeded ? 'ok' : 'unknown',
    ...(failed && rawError.length > 0 ? { errorText: rawError } : {}),
    payloadKind,
  };
}

/** 卡片标题：标明是浏览器自动化还是本机桌面控制。 */
export function desktopToolTitle(toolName: string): string {
  return toolName.trim().toLowerCase() === 'desktop_control' ? '桌面控制' : '浏览器自动化';
}
