import React from 'react';
import { SS, ST } from '../shared/settings-section-styles.js';
import {
  useDisplayPreferencesStore,
  type ThemeMode,
} from '../../../stores/settings/display-preferences.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import type { WorkbenchLayoutMode } from '../../../stores/ui/uiState.js';

// ── Toggle 开关组件 ─────────────────────────────────────────

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

const Toggle: React.FC<ToggleProps> = ({ checked, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    style={{
      position: 'relative',
      width: 38,
      height: 22,
      borderRadius: 999,
      border: 'none',
      background: checked ? 'var(--accent)' : 'var(--bg-surface)',
      cursor: 'pointer',
      flexShrink: 0,
      transition: 'background 180ms ease',
      boxShadow: checked ? 'none' : 'inset 0 0 0 1px var(--border-default)',
    }}
  >
    <span
      style={{
        position: 'absolute',
        top: 3,
        left: checked ? 19 : 3,
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: checked ? 'var(--fg-on-accent)' : 'var(--fg-muted)',
        transition: 'left 180ms ease, background 180ms ease',
      }}
    />
  </button>
);

// ── 设置行组件 ──────────────────────────────────────────────

interface SettingRowProps {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const SettingRow: React.FC<SettingRowProps> = ({ title, description, checked, onChange }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      padding: '10px 0',
      borderBottom: '1px solid var(--border-subtle)',
    }}
  >
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-strong)' }}>{title}</span>
      <span style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>{description}</span>
    </div>
    <Toggle checked={checked} onChange={onChange} label={title} />
  </div>
);

// ── 页面头部 ────────────────────────────────────────────────

const PAGE_HEADER: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginBottom: '1.5rem',
};

const PAGE_TITLE: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: 'var(--fg-strong)',
};

const PAGE_SUBTITLE: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--fg-muted)',
  lineHeight: 1.6,
};

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
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

// ── 主题模式选择器 ──────────────────────────────────────────

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

const THEME_SELECT: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 12,
  color: 'var(--fg-strong)',
  cursor: 'pointer',
  outline: 'none',
};

interface SelectRowProps {
  title: string;
  description: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

const SelectRow: React.FC<SelectRowProps> = ({ title, description, value, options, onChange }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      padding: '10px 0',
    }}
  >
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-strong)' }}>{title}</span>
      <span style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>{description}</span>
    </div>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={THEME_SELECT}
      aria-label={title}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  </div>
);

// ── 主组件 ──────────────────────────────────────────────────

export function DisplayTabContent() {
  const store = useDisplayPreferencesStore();

  const renderRows = (rows: SettingRowProps[]) =>
    rows.map((row, i) => (
      <div key={row.title} style={i === rows.length - 1 ? SECTION_LAST_ROW : undefined}>
        <SettingRow {...row} />
      </div>
    ));

  const messageMetaRows: SettingRowProps[] = [
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
  ];

  const reasoningToolRows: SettingRowProps[] = [
    {
      title: '显示推理过程',
      description: '显示 AI 的思考过程（Thinking）区块，关闭则完全隐藏',
      checked: store.showReasoningBlock,
      onChange: store.setShowReasoningBlock,
    },
    {
      title: '推理过程默认展开',
      description: 'AI 思考过程超过 3 行时默认展开，而非折叠',
      checked: store.reasoningExpandedByDefault,
      onChange: store.setReasoningExpandedByDefault,
    },
    {
      title: '工具调用默认展开',
      description: '工具调用结果默认以展开形式展示（否则仅在输出超长时折叠）',
      checked: store.toolCallsExpandedByDefault,
      onChange: store.setToolCallsExpandedByDefault,
    },
  ];

  const composerRows: SettingRowProps[] = [
    {
      title: '输入框统计栏',
      description: '在输入框下方显示费用、Token 明细、上下文使用率等统计信息',
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
      <div style={PAGE_HEADER}>
        <h2 style={PAGE_TITLE}>显示设置</h2>
        <p style={PAGE_SUBTITLE}>
          控制聊天消息、工具调用、界面元素和主题的展示行为。所有设置即时生效并自动保存。
        </p>
      </div>

      <section style={SS}>
        <h3 style={ST}>消息元信息</h3>
        <div style={SECTION_LIST}>{renderRows(messageMetaRows)}</div>
      </section>

      <section style={SS}>
        <h3 style={ST}>推理与工具调用</h3>
        <div style={SECTION_LIST}>{renderRows(reasoningToolRows)}</div>
      </section>

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
        <SelectRow
          title="主题模式"
          description="选择界面的颜色主题（跟随系统 / 浅色 / 深色）"
          value={store.themeMode}
          options={THEME_OPTIONS}
          onChange={(v) => store.setThemeMode(v as ThemeMode)}
        />
        <LayoutModeRow />
      </section>

      <section style={SS}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-strong)' }}>
              恢复默认
            </span>
            <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
              将全部显示设置重置为初始值
            </span>
          </div>
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
  { value: 'fusion', label: '融合布局', description: '侧栏 Rail + Panel 分离，支持工作区切换 peek' },
  { value: 'classic', label: '经典布局', description: '侧栏一体化，简洁紧凑' },
];

function LayoutModeRow() {
  const layoutMode = useUIStateStore((s) => s.workbenchLayoutMode);
  const setLayoutMode = useUIStateStore((s) => s.setWorkbenchLayoutMode);

  return (
    <SelectRow
      title="工作台布局"
      description="切换界面布局模式（融合 / 经典），切换后即时生效"
      value={layoutMode}
      options={LAYOUT_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
      onChange={(v) => setLayoutMode(v as WorkbenchLayoutMode)}
    />
  );
}
