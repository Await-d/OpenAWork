/**
 * GUI Agent 动作类型与别名归一化（纯数据 + 纯函数）。
 *
 * 规范动作名（连字符风格）取自 UI-TARS 的 actions 归一表；
 * 不同模型会输出不同写法（`left_double` / `doubleClick` / `leftdouble` 等），
 * 统一由 {@link normalizeActionName} 收敛到规范名，未知名称原样保留。
 */

/** 规范动作名联合类型（UI-TARS 动作空间）。 */
export type GuiActionName =
  | 'screenshot'
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'middle_click'
  | 'mouse_move'
  | 'mouse_down'
  | 'mouse_up'
  | 'drag'
  | 'swipe'
  | 'scroll'
  | 'type'
  | 'hotkey'
  | 'press'
  | 'release'
  | 'navigate'
  | 'navigate_back'
  | 'long_press'
  | 'press_home'
  | 'press_back'
  | 'open_app'
  | 'wait'
  | 'finished'
  | 'call_user';

/** 解析后的动作：`name` 为归一化后的动作名，`raw` 为原始文本，`params` 为位置参数。 */
export interface GuiParsedAction {
  readonly name: string;
  readonly raw: string;
  readonly params: readonly unknown[];
}

/**
 * 动作别名归一化表：键为小写别名，值为规范动作名。
 *
 * 仅借鉴参考实现的映射关系（不照搬其 any / eslint-disable 代码），
 * 同时保留规范名到自身的恒等映射。
 */
export const GUI_ACTION_ALIASES: Readonly<Record<string, string>> = {
  // ---- 截图 ----
  snapshot: 'screenshot',
  screenshot: 'screenshot',
  take_screenshot: 'screenshot',
  takescreenshot: 'screenshot',

  // ---- 鼠标：左键单击 ----
  click: 'click',
  left_click: 'click',
  left_single: 'click',
  leftclick: 'click',
  leftsingle: 'click',

  // ---- 鼠标：双击 ----
  double_click: 'double_click',
  left_double: 'double_click',
  doubleclick: 'double_click',
  leftdouble: 'double_click',

  // ---- 鼠标：右键 ----
  right_click: 'right_click',
  right_single: 'right_click',
  rightclick: 'right_click',
  rightsingle: 'right_click',

  // ---- 鼠标：中键 ----
  middle_click: 'middle_click',
  middle_single: 'middle_click',
  middleclick: 'middle_click',
  middlesingle: 'middle_click',

  // ---- 鼠标：移动 ----
  move: 'mouse_move',
  move_to: 'mouse_move',
  mouse_move: 'mouse_move',
  moveto: 'mouse_move',
  mousemove: 'mouse_move',
  hover: 'mouse_move',

  // ---- 鼠标：按下 / 抬起 ----
  mouse_down: 'mouse_down',
  mousedown: 'mouse_down',
  mouse_up: 'mouse_up',
  mouseup: 'mouse_up',

  // ---- 拖拽 / 滑动 / 滚动 ----
  drag: 'drag',
  select: 'drag',
  left_click_drag: 'drag',
  leftclickdrag: 'drag',
  swipe: 'swipe',
  scroll: 'scroll',

  // ---- 键盘 ----
  type: 'type',
  hotkey: 'hotkey',
  press: 'press',
  release: 'release',

  // ---- 浏览器 ----
  navigate: 'navigate',
  navigate_back: 'navigate_back',
  navigateback: 'navigate_back',

  // ---- 应用 ----
  long_press: 'long_press',
  longpress: 'long_press',
  home: 'press_home',
  press_home: 'press_home',
  presshome: 'press_home',
  back: 'press_back',
  press_back: 'press_back',
  pressback: 'press_back',
  open: 'open_app',
  open_app: 'open_app',
  openapp: 'open_app',

  // ---- Agent ----
  wait: 'wait',
  finished: 'finished',
  call_user: 'call_user',
  calluser: 'call_user',
};

/**
 * 归一化动作名：先 `trim + 小写化` 再查表；未知名称返回处理后的原字符串。
 */
export function normalizeActionName(name: string): string {
  const key = name.trim().toLowerCase();
  return GUI_ACTION_ALIASES[key] ?? key;
}
