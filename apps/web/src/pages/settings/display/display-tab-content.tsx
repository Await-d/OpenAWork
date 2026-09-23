import React, { useEffect, useState } from 'react';
import type { DialogueMode } from '@openAwork/shared';
import {
  FILE_ICON_THEMES,
  FileIconThemeProvider,
  FileTypeIcon,
  FolderTypeIcon,
  type FileIconThemeId,
} from '@openAwork/shared-ui';
import { SS, ST } from '../shared/settings-section-styles.js';
import { SettingsOptionCardRow } from '../shared/settings-option-card-row.js';
import type { SettingsOptionCard } from '../shared/settings-option-card-row.js';
import { SettingsToggle } from '../shared/settings-toggle.js';
import { SettingsListRow } from '../shared/settings-row.js';
import {
  useDisplayPreferencesStore,
  type ThemeMode,
  type ThemeStyle,
  type ToolExpandCategory,
  type MessageLayoutMode,
  TOOL_EXPAND_CATEGORY_LABELS,
} from '../../../stores/settings/display-preferences.js';
import { DIALOGUE_MODE_OPTIONS } from '../../../pages/chat-page/mode/dialogue-mode.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import type { WorkbenchLayoutMode } from '../../../stores/ui/uiState.js';
import { CurrentUserProfileSection } from './current-user-profile-section.js';

// ── 设置行组件 ──────────────────────────────────────────────

interface SettingRowProps {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const SettingRow: React.FC<SettingRowProps> = ({ title, description, checked, onChange }) => (
  <SettingsListRow title={title} description={description}>
    <SettingsToggle checked={checked} onChange={onChange} ariaLabel={title} />
  </SettingsListRow>
);

// ── Section 容器 ────────────────────────────────────────────

const SECTION_LIST: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const SECTION_LAST_ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '10px 0',
};

const RESET_BUTTON: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--fg-default)',
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 13,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
};

// ── 主题模式选择器 ──────────────────────────────────────────

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

const THEME_STYLE_OPTIONS: {
  value: ThemeStyle;
  label: string;
  description: string;
  swatches: string[];
}[] = [
  {
    value: 'nebula',
    label: 'Nebula',
    description: '深海蓝调 · 靛青+琥珀四色系',
    swatches: ['#080b12', '#5cd4c0', '#f0b429'],
  },
  {
    value: 'aurora',
    label: 'Aurora',
    description: '极光毛玻璃 · 渐变 · 梦幻',
    swatches: ['#060818', '#8b9dff', '#a06bff'],
  },
  {
    value: 'linear',
    label: 'Linear',
    description: '极简精致 · 单一靛蓝强调',
    swatches: ['#0a0c10', '#5b6cff', '#e8eaf2'],
  },
  {
    value: 'forest',
    label: 'Forest',
    description: '森林墨绿 · 暖橙 · 自然有机',
    swatches: ['#0a0f0d', '#4ade80', '#f97316'],
  },
  {
    value: 'sakura',
    label: 'Sakura',
    description: '樱花粉墨 · 玫红 · 日系温柔',
    swatches: ['#100a10', '#f472b6', '#c084fc'],
  },
  {
    value: 'carbon',
    label: 'Carbon',
    description: '纯碳灰 · 电光蓝 · 硬核工业',
    swatches: ['#08090a', '#00b4ff', '#ffaa00'],
  },
  {
    value: 'sunset',
    label: 'Sunset',
    description: '暮光紫橙 · 落日金 · 温暖浪漫',
    swatches: ['#120a08', '#f97316', '#c084fc'],
  },
  {
    value: 'ocean',
    label: 'Ocean',
    description: '深海青蓝 · 珊瑚 · 清冷通透',
    swatches: ['#050e12', '#22d3ee', '#fb923c'],
  },
];

// ── 主组件 ──────────────────────────────────────────────────

export function DisplayTabContent() {
  const store = useDisplayPreferencesStore();

  const renderRows = (rows: SettingRowProps[]) =>
    rows.map((row, i) => (
      <div key={row.title} style={i === rows.length - 1 ? SECTION_LAST_ROW : undefined}>
        <SettingRow {...row} />
      </div>
    ));

  const messageHeaderRows: SettingRowProps[] = [
    {
      title: '消息时间戳',
      description: '在每条消息头部显示发送/接收时间',
      checked: store.showMessageTimestamps,
      onChange: store.setShowMessageTimestamps,
    },
    {
      title: '模型名称',
      description: '在助手消息上显示所使用的模型名称标签',
      checked: store.showModelName,
      onChange: store.setShowModelName,
    },
    {
      title: 'Provider 标签',
      description: '当模型名与提供商名不一致时，显示提供商标签',
      checked: store.showProviderLabel,
      onChange: store.setShowProviderLabel,
    },
  ];

  const metaLineSubRows: SettingRowProps[] = [
    {
      title: '消息耗时',
      description: '显示每轮回复的生成耗时（如 5.2s）',
      checked: store.showDuration,
      onChange: store.setShowDuration,
    },
    {
      title: '停止原因',
      description: '显示本轮回复的结束原因（如"正常结束""工具调用结束"）',
      checked: store.showStopReason,
      onChange: store.setShowStopReason,
    },
    {
      title: 'Token 用量分项',
      description: '显示精确的 Token 明细（如 1.2k tokens (800↓ 400↑)）',
      checked: store.showTokenBreakdown,
      onChange: store.setShowTokenBreakdown,
    },
    {
      title: '估算 Token 数',
      description: '无精确用量数据时显示估算值（如 ~350 tok）',
      checked: store.showEstimatedTokens,
      onChange: store.setShowEstimatedTokens,
    },
    {
      title: '请求序号',
      description: '显示每轮请求的序号（如"请求 10"）',
      checked: store.showRequestIndex,
      onChange: store.setShowRequestIndex,
    },
    {
      title: '工具调用计数',
      description: '显示本轮使用的工具数量（如"3 工具"）',
      checked: store.showToolCount,
      onChange: store.setShowToolCount,
    },
  ];

  const composerRows: SettingRowProps[] = [
    {
      title: '输入框统计栏',
      description: '显示完整统计栏；关闭后保留上下文、耗时、费用等紧凑摘要',
      checked: store.showComposerStatsBar,
      onChange: store.setShowComposerStatsBar,
    },
  ];

  const interfaceRows: SettingRowProps[] = [
    {
      title: '命令面板按钮',
      description: '在顶栏显示命令面板入口（Cmd+K / Ctrl+K）',
      checked: store.showCommandPaletteButton,
      onChange: store.setShowCommandPaletteButton,
    },
    {
      title: '网关状态指示点',
      description: '在导航栏 Logo 旁显示网关连接状态指示点',
      checked: store.showGatewayStatusIndicator,
      onChange: store.setShowGatewayStatusIndicator,
    },
    {
      title: '顶栏终端按钮',
      description: '在顶栏显示终端芯片和快捷终端切换按钮',
      checked: store.showTerminalButton,
      onChange: store.setShowTerminalButton,
    },
  ];

  return (
    <>
      <CurrentUserProfileSection />

      <MessageLayoutSection />

      <section style={SS}>
        <h3 style={ST}>消息元信息</h3>
        <div style={SECTION_LIST}>{renderRows(messageHeaderRows)}</div>

        {/* 消息统计信息分组 */}
        <div
          style={{
            marginTop: 12,
            padding: '12px 14px',
            background: 'var(--bg-overlay)',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              marginBottom: store.showMetaLine ? 8 : 0,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)' }}>
                消息统计信息
              </div>
              <span style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                消息底部的请求序号、耗时、Token 用量等统计信息
              </span>
            </div>
            <SettingsToggle
              checked={store.showMetaLine}
              onChange={store.setShowMetaLine}
              ariaLabel="消息统计信息"
            />
          </div>
          {store.showMetaLine && (
            <div
              style={{
                borderTop: '1px solid var(--border-subtle)',
                paddingTop: 4,
              }}
            >
              <div style={{ ...SECTION_LIST, opacity: store.showMetaLine ? 1 : 0.5 }}>
                {renderRows(metaLineSubRows)}
              </div>
            </div>
          )}
        </div>
      </section>

      <ReasoningToolSection />

      <DialogueModeSection />

      <section style={SS}>
        <h3 style={ST}>输入区</h3>
        <div style={SECTION_LIST}>{renderRows(composerRows)}</div>
      </section>

      <section style={SS}>
        <h3 style={ST}>界面元素显隐</h3>
        <div style={SECTION_LIST}>{renderRows(interfaceRows)}</div>
      </section>

      <section style={SS}>
        <h3 style={ST}>外观</h3>
        <ThemeStyleRow />
        <SettingsOptionCardRow
          title="主题模式"
          description="选择界面的明暗模式（跟随系统 / 浅色 / 深色）"
          options={THEME_OPTIONS}
          value={store.themeMode}
          onChange={store.setThemeMode}
        />
        <FileIconThemeRow />
        <LayoutModeRow />
      </section>

      <section style={SS}>
        <h3 style={ST}>恢复默认</h3>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>将全部显示设置重置为初始值</span>
          <button type="button" style={RESET_BUTTON} onClick={() => store.resetToDefaults()}>
            重置全部
          </button>
        </div>
      </section>
    </>
  );
}

// ── 布局模式选择 ──────────────────────────────────────────

const LAYOUT_OPTIONS: { value: WorkbenchLayoutMode; label: string; description: string }[] = [
  {
    value: 'fusion',
    label: '融合布局',
    description: '侧栏 Rail + Panel 分离，支持工作区切换 peek',
  },
  { value: 'classic', label: '经典布局', description: '侧栏一体化，简洁紧凑' },
];

function LayoutModeRow() {
  const layoutMode = useUIStateStore((s) => s.workbenchLayoutMode);
  const setLayoutMode = useUIStateStore((s) => s.setWorkbenchLayoutMode);

  const options: SettingsOptionCard<WorkbenchLayoutMode>[] = LAYOUT_OPTIONS.map((opt) => ({
    value: opt.value,
    label: opt.label,
    description: opt.description,
  }));

  return (
    <SettingsOptionCardRow
      title="工作台布局"
      description="切换界面布局模式（融合 / 经典），切换后即时生效"
      options={options}
      value={layoutMode}
      onChange={setLayoutMode}
    />
  );
}

// ── 主题风格选择 ──────────────────────────────────────────

const SWATCH_ROW: React.CSSProperties = {
  display: 'flex',
  gap: 4,
};

const SWATCH: React.CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: 3,
  border: '1px solid var(--border-subtle)',
  flexShrink: 0,
};

/** 色板预览暴露的是「其他主题」的取色，无法用当前 token 表达，只能内联。 */
function ThemeStylePreview({ swatches }: { swatches: string[] }) {
  return (
    <div aria-hidden style={SWATCH_ROW}>
      {swatches.map((swatch, index) => (
        <span key={index} style={{ ...SWATCH, background: swatch }} />
      ))}
    </div>
  );
}

function ThemeStyleRow() {
  const themeStyle = useDisplayPreferencesStore((s) => s.themeStyle);
  const setThemeStyle = useDisplayPreferencesStore((s) => s.setThemeStyle);

  const options: SettingsOptionCard<ThemeStyle>[] = THEME_STYLE_OPTIONS.map((opt) => ({
    value: opt.value,
    label: opt.label,
    description: opt.description,
    preview: <ThemeStylePreview swatches={opt.swatches} />,
  }));

  return (
    <SettingsOptionCardRow
      title="主题风格"
      description="选择界面的设计风格，与明暗模式独立组合"
      options={options}
      value={themeStyle}
      onChange={setThemeStyle}
    />
  );
}

// ── 文件图标主题选择 ──────────────────────────────────────

/** 预览条目覆盖「通用目录 / 特殊目录 / 扩展名 / 精确文件名 / 无扩展名」五类解析路径，差异最直观。 */
const FILE_ICON_THEME_PREVIEW: readonly { kind: 'folder' | 'file'; label: string }[] = [
  { kind: 'folder', label: 'src' },
  { kind: 'folder', label: 'node_modules' },
  { kind: 'file', label: 'src/App.tsx' },
  { kind: 'file', label: 'package.json' },
  { kind: 'file', label: 'Dockerfile' },
];

const ICON_PREVIEW_ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
};

const ICON_PREVIEW_PATH: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.4,
  color: 'var(--fg-muted)',
  fontFamily: 'var(--font-mono, monospace)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: 0,
};

/**
 * 用真实图标组件渲染示例条目。`FileTypeIcon` / `FolderTypeIcon` 的主题取自 Context
 * 而非 store——只有按被预览的主题包一层 Provider，同页才能并排对比。
 * 预览整体标记 `aria-hidden`：它只是图标的可视化佐证，不该污染按钮的可访问名。
 */
function FileIconThemePreview({ theme, mode }: { theme: FileIconThemeId; mode: 'dark' | 'light' }) {
  return (
    <FileIconThemeProvider theme={theme} mode={mode}>
      <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {FILE_ICON_THEME_PREVIEW.map((item) => (
          <div key={item.label} style={ICON_PREVIEW_ROW}>
            {item.kind === 'folder' ? (
              <FolderTypeIcon name={item.label} size={16} />
            ) : (
              <FileTypeIcon path={item.label} size={16} />
            )}
            <span style={ICON_PREVIEW_PATH}>{item.label}</span>
          </div>
        ))}
      </div>
    </FileIconThemeProvider>
  );
}

/** `<html data-mode>` 是 App 写入的生效值；属性缺失时回退到系统媒体查询。 */
function readPreviewMode(): 'dark' | 'light' {
  const attr = document.documentElement.getAttribute('data-mode');
  if (attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * 预览要跟随「当前生效」的明暗：system 模式下同时监听 `data-mode` 属性（App 异步写入）
 * 与系统媒体查询（属性缺失时的回退来源），任一变化都重新取值。
 */
function usePreviewMode(themeMode: ThemeMode): 'dark' | 'light' {
  const [systemMode, setSystemMode] = useState<'dark' | 'light'>(readPreviewMode);

  useEffect(() => {
    if (themeMode !== 'system') return;
    const sync = () => setSystemMode(readPreviewMode());
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-mode'],
    });
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', sync);
    sync();
    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener('change', sync);
    };
  }, [themeMode]);

  return themeMode === 'system' ? systemMode : themeMode;
}

function FileIconThemeRow() {
  const fileIconTheme = useDisplayPreferencesStore((s) => s.fileIconTheme);
  const setFileIconTheme = useDisplayPreferencesStore((s) => s.setFileIconTheme);
  const themeMode = useDisplayPreferencesStore((s) => s.themeMode);
  const previewMode = usePreviewMode(themeMode);

  const options: SettingsOptionCard<FileIconThemeId>[] = FILE_ICON_THEMES.map((opt) => ({
    value: opt.id,
    label: opt.label,
    description: opt.description,
    preview: <FileIconThemePreview theme={opt.id} mode={previewMode} />,
  }));

  return (
    <SettingsOptionCardRow
      title="文件图标主题"
      description="文件树与文件列表的图标样式，切换后即时生效"
      options={options}
      value={fileIconTheme}
      onChange={setFileIconTheme}
      minCardWidth={180}
    />
  );
}

// ── 工具类别折叠控制 ────────────────────────────────────────

const TOOL_EXPAND_CATEGORIES: ToolExpandCategory[] = [
  'bash',
  'fileEdit',
  'fileRead',
  'mcp',
  'skill',
  'web',
  'batch',
  'other',
];

const TOOL_EXPAND_DESCRIPTIONS: Record<ToolExpandCategory, string> = {
  bash: 'bash / interactive_bash — Shell 命令执行',
  fileEdit: 'write / edit / multi_edit / patch — 文件写入与编辑',
  fileRead: 'read / grep / glob / list / codesearch — 文件读取与搜索',
  mcp: 'mcp_call / mcp_list_tools / skill_mcp — MCP 服务器工具调用',
  skill: 'skill — 技能调用',
  web: 'webfetch / websearch / google_search — 网络抓取与搜索',
  batch: 'batch — 批量并行工具调用',
  other: '其他未分类工具',
};

/**
 * 工具类别折叠行——与通用 SettingRow 不同，右侧除了开关还附带
 * 明确的文字标签（"默认展开" / "默认折叠"），消除开/关语义歧义。
 */
function ToolExpandRow({
  title,
  description,
  expanded,
  onChange,
  disabled,
  isLast,
}: {
  title: string;
  description: string;
  expanded: boolean;
  onChange: (expanded: boolean) => void;
  disabled: boolean;
  isLast: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 20,
        padding: '12px 0',
        ...(isLast ? {} : { borderBottom: '1px solid var(--border-subtle)' }),
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-strong)' }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          {description}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: expanded ? 'var(--accent)' : 'var(--fg-muted)',
            minWidth: 56,
            textAlign: 'right',
          }}
        >
          {expanded ? '默认展开' : '默认折叠'}
        </span>
        <SettingsToggle
          checked={expanded}
          onChange={disabled ? () => undefined : onChange}
          ariaLabel={`${title} ${expanded ? '默认展开' : '默认折叠'}`}
        />
      </div>
    </div>
  );
}

function ReasoningToolSection() {
  const store = useDisplayPreferencesStore();
  const globalExpand = store.toolCallsExpandedByDefault;
  const setGlobalExpand = store.setToolCallsExpandedByDefault;
  const overrides = store.toolExpandedOverrides;
  const setOverride = store.setToolExpandedOverride;

  return (
    <section style={SS}>
      <h3 style={ST}>推理与工具调用</h3>

      {/* 推理过程设置 */}
      <div style={SECTION_LIST}>
        <SettingRow
          title="显示推理过程"
          description="显示 AI 的思考过程；关闭后聊天页退化为简化提示，团队页保持精简展示"
          checked={store.showReasoningBlock}
          onChange={store.setShowReasoningBlock}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 20,
            padding: '12px 0',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-strong)' }}>
              推理过程默认展开
            </span>
            <span style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
              AI 思考过程超过 5 行时默认展开，而非折叠
            </span>
          </div>
          <SettingsToggle
            checked={store.reasoningExpandedByDefault}
            onChange={store.setReasoningExpandedByDefault}
            ariaLabel="推理过程默认展开"
          />
        </div>
      </div>

      {/* 工具调用折叠分组 */}
      <div
        style={{
          marginTop: 16,
          padding: '16px 18px',
          background: 'var(--bg-overlay)',
          borderRadius: 10,
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 20,
            marginBottom: globalExpand ? 12 : 0,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)' }}>
              工具调用默认展开
            </div>
            <span style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
              开启后各工具卡片默认展开详情；关闭后全部折叠为摘要行。运行中和失败的工具始终自动展开。
            </span>
          </div>
          <SettingsToggle
            checked={globalExpand}
            onChange={setGlobalExpand}
            ariaLabel="工具调用默认展开"
          />
        </div>
        {globalExpand && (
          <div
            style={{
              borderTop: '1px solid var(--border-subtle)',
              paddingTop: 8,
            }}
          >
            <div style={SECTION_LIST}>
              {TOOL_EXPAND_CATEGORIES.map((cat, i) => (
                <ToolExpandRow
                  key={cat}
                  title={TOOL_EXPAND_CATEGORY_LABELS[cat]}
                  description={TOOL_EXPAND_DESCRIPTIONS[cat]}
                  expanded={overrides[cat] ?? false}
                  onChange={(checked) => setOverride(cat, checked)}
                  disabled={false}
                  isLast={i === TOOL_EXPAND_CATEGORIES.length - 1}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ── 默认对话模式选择 ────────────────────────────────────────

function DialogueModeSection() {
  const defaultDialogueMode = useDisplayPreferencesStore((s) => s.defaultDialogueMode);
  const setDefaultDialogueMode = useDisplayPreferencesStore((s) => s.setDefaultDialogueMode);

  const options: SettingsOptionCard<DialogueMode>[] = DIALOGUE_MODE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    description: option.description,
  }));
  const selected = DIALOGUE_MODE_OPTIONS.find((option) => option.value === defaultDialogueMode);

  return (
    <section style={SS}>
      <h3 style={ST}>默认对话模式</h3>
      <SettingsOptionCardRow
        description="新建会话时使用的默认对话模式。已有会话从其元数据恢复，不受此项影响。"
        options={options}
        value={defaultDialogueMode}
        onChange={setDefaultDialogueMode}
        minCardWidth={200}
      />
      {selected && (
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            background: 'var(--bg-overlay)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            padding: '12px 14px',
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>
            {selected.label} · 工作规则
          </span>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {selected.details.map((detail) => (
              <li key={detail} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <span
                  aria-hidden
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    flexShrink: 0,
                    marginTop: 6,
                  }}
                />
                <span style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                  {detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ── 消息布局模式选择 ────────────────────────────────────────

const MESSAGE_LAYOUT_OPTIONS: {
  value: MessageLayoutMode;
  label: string;
  description: string;
}[] = [
  {
    value: 'unified',
    label: '统一左对齐',
    description: '所有消息头像在左、内容在右，占满宽度',
  },
  {
    value: 'split',
    label: '左右分列',
    description: '用户消息靠右、助手消息靠左，类似即时通讯风格',
  },
];

/** 线框行：统一模式两行都在左，分列模式用户行整体靠右且内容条用 accent 色。 */
const MESSAGE_LAYOUT_PREVIEW_ROWS: Record<
  MessageLayoutMode,
  readonly { avatarSide: 'left' | 'right'; widths: readonly number[]; user: boolean }[]
> = {
  unified: [
    { avatarSide: 'left', widths: [70, 46], user: false },
    { avatarSide: 'left', widths: [56, 36], user: false },
  ],
  split: [
    { avatarSide: 'left', widths: [70, 46], user: false },
    { avatarSide: 'right', widths: [56, 36], user: true },
  ],
};

function PreviewRow({
  avatarSide,
  widths,
  user = false,
}: {
  avatarSide: 'left' | 'right';
  widths: readonly number[];
  user?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 6,
        flexDirection: avatarSide === 'right' ? 'row-reverse' : 'row',
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: 'var(--fg-subtle)',
          flexShrink: 0,
        }}
      />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          alignItems: user ? 'flex-end' : 'flex-start',
        }}
      >
        {widths.map((width, index) => (
          <span
            key={index}
            style={{
              width: `${width}%`,
              height: 5,
              borderRadius: 3,
              background: user ? 'var(--accent)' : 'var(--border-strong)',
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** 纯装饰的迷你布局线框图，差异一眼可辨；`aria-hidden` 避免污染卡片的可访问名。 */
function MessageLayoutPreview({ mode }: { mode: MessageLayoutMode }) {
  return (
    <div
      aria-hidden
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 6,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        minHeight: 56,
        justifyContent: 'center',
      }}
    >
      {MESSAGE_LAYOUT_PREVIEW_ROWS[mode].map((row, index) => (
        <PreviewRow key={index} avatarSide={row.avatarSide} widths={row.widths} user={row.user} />
      ))}
    </div>
  );
}

function MessageLayoutSection() {
  const messageLayout = useDisplayPreferencesStore((s) => s.messageLayout);
  const setMessageLayout = useDisplayPreferencesStore((s) => s.setMessageLayout);

  const options: SettingsOptionCard<MessageLayoutMode>[] = MESSAGE_LAYOUT_OPTIONS.map((opt) => ({
    value: opt.value,
    label: opt.label,
    description: opt.description,
    preview: <MessageLayoutPreview mode={opt.value} />,
  }));

  return (
    <section style={SS}>
      <h3 style={ST}>消息布局</h3>
      <SettingsOptionCardRow
        description="选择消息流的排列方式，切换后即时生效"
        options={options}
        value={messageLayout}
        onChange={setMessageLayout}
        minCardWidth={180}
      />
    </section>
  );
}
