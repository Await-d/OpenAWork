import type { ReactElement } from 'react';

export type PluginId =
  'desktop-automation' | 'desktop-control' | 'image-generation' | 'mcp' | 'skills' | 'websearch';

export interface PluginToolInfo {
  /** 工具名（monospace 展示）。 */
  name: string;
  /** 一句话用途。 */
  summary: string;
  /** 参数名列表——行内展示，不再逐个大 chip 平铺。 */
  params: string[];
  /** 运行环境 / 模型能力等附加条件。 */
  requirement?: string;
}

export interface PluginDefinition {
  id: PluginId;
  label: string;
  /** 导航与详情页头共用的一句话说明。 */
  description: string;
  icon: ReactElement;
  /** 该插件是否是「开关型」能力插件（tool），还是资源管理面（resource）。 */
  kind: 'tool' | 'resource';
  /** kind=tool 时注入的工具清单。 */
  tools?: PluginToolInfo[];
  /** 启用后的效果说明（页头开关下方）。 */
  enabledHint?: string;
  /** 未启用时的效果说明。 */
  disabledHint?: string;
}

const SIZE = 16;

function Icon({ children }: { children: ReactElement }): ReactElement {
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/**
 * 插件定义表——左侧导航、详情页头与工具摘要都由这一份数据驱动，
 * 取代旧版每个插件手写四张重复卡片的结构。
 */
export const PLUGIN_REGISTRY: PluginDefinition[] = [
  {
    id: 'image-generation',
    label: '图片插件',
    description: '为 Agent 提供专用图片生成 Tool。',
    kind: 'tool',
    tools: [
      {
        name: 'ImageGenerate',
        summary: '按提示词生成图片，并使用当前配置的图片模型执行。',
        params: ['prompt', 'size', 'quality'],
      },
    ],
    enabledHint: 'Agent 可以调用 ImageGenerate 生成图片。',
    disabledHint: 'Agent 无法使用 ImageGenerate；历史调用会被拒绝。',
    icon: (
      <Icon>
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </>
      </Icon>
    ),
  },
  {
    id: 'desktop-control',
    label: '系统桌面控制',
    description: '控制 Agent 是否获得系统级桌面工具。',
    kind: 'tool',
    tools: [
      {
        name: 'desktop_control',
        summary: '截图、坐标点击（含按下/抬起/双击）、文本输入、单键与组合键、滚动、等待、拖拽。',
        params: ['action', 'x', 'y', 'text', 'key', 'keys', 'scrollX', 'scrollY', 'ms'],
      },
      {
        name: 'computer_use',
        summary: '内嵌「截图 → 视觉决策 → 动作」循环，每步进度实时显示在对话里。',
        params: ['instruction', 'maxSteps'],
        requirement: '需要当前模型具备 GUI grounding 能力，否则会直接返回原因而不执行。',
      },
    ],
    enabledHint: '后端会在本用户会话中注入 desktop_control 与 computer_use。',
    disabledHint: '后端不会注入这两个工具，历史调用会被拒绝。',
    icon: (
      <Icon>
        <>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8" />
          <path d="M12 16v4" />
          <path d="M8 9l2.5 2.5L16 7" />
        </>
      </Icon>
    ),
  },
  {
    id: 'desktop-automation',
    label: '浏览器自动化',
    description: '为 Agent 提供网页导航、点击、填写与截图 Tool。',
    kind: 'tool',
    tools: [
      {
        name: 'desktop_automation',
        summary:
          '导航与点击、输入、按键、滚动、等待、内容读取、页面快照、截图；检查面含悬停、勾选、下拉选择、查找元素、iframe 列表、执行脚本、控制台读取。',
        params: [
          'action',
          'url',
          'selector',
          'text',
          'key',
          'checked',
          'values',
          'limit',
          'script',
          'args',
          'level',
          'clear',
          'direction',
          'amount',
          'ms',
        ],
        requirement: '需要桌面端 sidecar 提供 DESKTOP_AUTOMATION=1；纯 Web 或远程网关不可用。',
      },
    ],
    enabledHint: '后端会在本用户会话中注入 desktop_automation。',
    disabledHint: '后端不会注入该工具，历史调用会被拒绝。',
    icon: (
      <Icon>
        <>
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M2 9h20" />
          <circle cx="5.5" cy="6.5" r="0.5" fill="currentColor" />
          <circle cx="8.5" cy="6.5" r="0.5" fill="currentColor" />
          <path d="M9 13.5l2 2 4-4" />
        </>
      </Icon>
    ),
  },
  {
    id: 'skills',
    label: '技能',
    description: '管理已安装的 Agent 技能，控制每条技能是否启用。',
    kind: 'resource',
    icon: (
      <Icon>
        <path d="M12 2l2.5 5 5.5.8-4 3.9.9 5.5L12 14.7 7.1 17.2l.9-5.5-4-3.9 5.5-.8L12 2z" />
      </Icon>
    ),
  },
  {
    id: 'websearch',
    label: 'Web 搜索',
    description: '统一管理默认搜索 MCP 与原生 Provider 回退策略。',
    kind: 'resource',
    icon: (
      <Icon>
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </>
      </Icon>
    ),
  },
  {
    id: 'mcp',
    label: 'MCP 服务器',
    description: '管理除 Web 搜索外的内置与自定义 MCP 服务器。',
    kind: 'resource',
    icon: (
      <Icon>
        <>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
          <path d="M10 6.5h4M6.5 10v4M17.5 10v4M10 17.5h4" />
        </>
      </Icon>
    ),
  },
];

export function findPluginDefinition(id: PluginId): PluginDefinition | undefined {
  return PLUGIN_REGISTRY.find((plugin) => plugin.id === id);
}
