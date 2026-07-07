import React, { useState } from 'react';
import type {
  DesktopControlActionResult,
  DesktopControlCapabilities,
  DesktopControlStatus,
} from '@openAwork/web-client';
import type { DevtoolsSourceState } from '../state/settings-types.js';
import { InlineFailureNotice } from '../devtools/devtools-workbench-primitives.js';

const CONTROL_ACTIONS = ['screenshot', 'click', 'type', 'key', 'hotkey', 'scroll', 'wait'] as const;
type DesktopControlActionType = (typeof CONTROL_ACTIONS)[number];

interface SystemDesktopControlCardProps {
  desktopControlEnabled: boolean;
  desktopControlStatus: DesktopControlStatus | null;
  desktopControlSourceState: DevtoolsSourceState;
  onDesktopControlScreenshot: (delayMs?: number) => Promise<DesktopControlActionResult>;
  onDesktopControlClick: (x: number, y: number) => Promise<DesktopControlActionResult>;
  onDesktopControlType: (text: string) => Promise<DesktopControlActionResult>;
  onDesktopControlKey: (key: string) => Promise<DesktopControlActionResult>;
  onDesktopControlHotkey: (keys: readonly string[]) => Promise<DesktopControlActionResult>;
  onDesktopControlScroll: (scrollX: number, scrollY: number) => Promise<DesktopControlActionResult>;
  onDesktopControlWait: (ms?: number) => Promise<DesktopControlActionResult>;
}

const CARD: React.CSSProperties = {
  borderRadius: 8,
  border: '1px solid var(--border-default)',
  background: 'color-mix(in srgb, var(--bg-overlay) 92%, var(--bg-base))',
  padding: '8px 10px',
};

const ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const SECTION_TITLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--fg-strong)',
  margin: 0,
  lineHeight: 1.3,
  letterSpacing: '0.01em',
};

const SECTION_SUB: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  margin: 0,
  marginTop: 2,
  lineHeight: 1.4,
};

const ACTION_BTN: React.CSSProperties = {
  borderRadius: 6,
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: 'var(--fg-on-accent)',
  fontSize: 10,
  fontWeight: 600,
  padding: '4px 9px',
  cursor: 'pointer',
  lineHeight: 1.4,
};

const GHOST_BTN: React.CSSProperties = {
  borderRadius: 6,
  border: '1px solid var(--border-default)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 10,
  padding: '4px 8px',
  cursor: 'pointer',
  lineHeight: 1.4,
};

const FIELD_INPUT: React.CSSProperties = {
  borderRadius: 6,
  border: '1px solid var(--border-default)',
  background: 'color-mix(in srgb, var(--bg-base) 70%, var(--bg-overlay))',
  color: 'var(--fg-strong)',
  fontSize: 10,
  padding: '5px 8px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const ACTION_LABELS: Record<DesktopControlActionType, string> = {
  screenshot: '截图',
  click: '点击',
  type: '输入',
  key: '按键',
  hotkey: '组合键',
  scroll: '滚动',
  wait: '等待',
};

const CAPABILITY_LABELS: ReadonlyArray<{
  readonly key: keyof DesktopControlCapabilities;
  readonly label: string;
}> = [
  { key: 'screenshot', label: '截图' },
  { key: 'click', label: '点击' },
  { key: 'typeText', label: '输入' },
  { key: 'key', label: '按键' },
  { key: 'hotkey', label: '组合键' },
  { key: 'scroll', label: '滚动' },
  { key: 'wait', label: '等待' },
];

function parseNumberInput(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalNumberInput(value: string): number | undefined {
  if (value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readStringField(result: DesktopControlActionResult, key: string): string | null {
  const value = result[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function formatResult(result: DesktopControlActionResult): string {
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result)) {
    compact[key] =
      typeof value === 'string' && value.length > 120 ? `${value.slice(0, 120)}…` : value;
  }
  return JSON.stringify(compact, null, 2);
}

function CapabilityGrid({
  capabilities,
  enabled,
}: {
  capabilities: DesktopControlCapabilities | undefined;
  enabled: boolean;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))',
        gap: '4px 8px',
        marginTop: 8,
      }}
    >
      {CAPABILITY_LABELS.map((item) => {
        const capability = capabilities?.[item.key];
        const available = capability?.available ?? enabled;
        return (
          <div
            key={item.key}
            title={capability?.reason ?? capability?.driver ?? item.label}
            style={{
              ...ROW,
              minWidth: 0,
              fontSize: 10,
              color: available ? 'var(--accent)' : 'var(--fg-muted)',
            }}
          >
            <span style={{ fontSize: 9, fontWeight: 700 }}>{available ? '✓' : '○'}</span>
            <span style={{ flexShrink: 0 }}>{item.label}</span>
            {capability?.driver ? (
              <span
                style={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: 'var(--fg-subtle)',
                  fontFamily: 'monospace',
                }}
              >
                {capability.driver}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function SystemDesktopControlCard({
  desktopControlEnabled,
  desktopControlStatus,
  desktopControlSourceState,
  onDesktopControlScreenshot,
  onDesktopControlClick,
  onDesktopControlType,
  onDesktopControlKey,
  onDesktopControlHotkey,
  onDesktopControlScroll,
  onDesktopControlWait,
}: SystemDesktopControlCardProps) {
  const [action, setAction] = useState<DesktopControlActionType>('screenshot');
  const [x, setX] = useState('120');
  const [y, setY] = useState('120');
  const [text, setText] = useState('');
  const [key, setKey] = useState('Enter');
  const [keys, setKeys] = useState('Control,K');
  const [scrollX, setScrollX] = useState('0');
  const [scrollY, setScrollY] = useState('-600');
  const [waitMs, setWaitMs] = useState('250');
  const [delayMs, setDelayMs] = useState('0');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [screenshotData, setScreenshotData] = useState<string | null>(null);

  async function runAction() {
    setLoading(true);
    setResult(null);
    setScreenshotData(null);
    try {
      let actionResult: DesktopControlActionResult;
      if (action === 'screenshot') {
        actionResult = await onDesktopControlScreenshot(parseOptionalNumberInput(delayMs));
        setScreenshotData(
          readStringField(actionResult, 'data') ??
            readStringField(actionResult, 'screenshotBase64'),
        );
      } else if (action === 'click') {
        actionResult = await onDesktopControlClick(parseNumberInput(x, 0), parseNumberInput(y, 0));
      } else if (action === 'type') {
        actionResult = await onDesktopControlType(text);
      } else if (action === 'key') {
        actionResult = await onDesktopControlKey(key);
      } else if (action === 'hotkey') {
        actionResult = await onDesktopControlHotkey(
          keys
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
        );
      } else if (action === 'scroll') {
        actionResult = await onDesktopControlScroll(
          parseNumberInput(scrollX, 0),
          parseNumberInput(scrollY, 0),
        );
      } else {
        actionResult = await onDesktopControlWait(parseOptionalNumberInput(waitMs));
      }
      setResult({ ok: true, msg: formatResult(actionResult) });
    } catch (error: unknown) {
      setResult({ ok: false, msg: error instanceof Error ? error.message : '操作失败' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={CARD}>
      {desktopControlSourceState.status === 'error' && desktopControlSourceState.error ? (
        <InlineFailureNotice
          title="系统桌面控制状态加载失败"
          message={desktopControlSourceState.error}
        />
      ) : null}
      <div style={{ ...ROW, justifyContent: 'space-between' }}>
        <div style={ROW}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: desktopControlEnabled ? 'var(--success)' : 'var(--fg-muted)',
              flexShrink: 0,
            }}
          />
          <span style={SECTION_TITLE}>系统桌面控制</span>
        </div>
      </div>
      <CapabilityGrid
        capabilities={desktopControlStatus?.capabilities}
        enabled={desktopControlEnabled}
      />
      <div
        style={{
          marginTop: 5,
          paddingTop: 5,
          borderTop: '1px solid var(--border-default)',
          fontSize: 10,
          color: desktopControlEnabled ? 'var(--accent)' : 'var(--fg-muted)',
        }}
      >
        当前模式：
        {desktopControlEnabled
          ? '系统桥接可用'
          : (desktopControlStatus?.reason ?? '当前环境不可用')}
      </div>
      {desktopControlEnabled ? (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border-default)' }}>
          <span style={{ ...SECTION_SUB, fontWeight: 700, color: 'var(--fg-default)' }}>
            操作控制台
          </span>
          <div style={{ ...ROW, marginTop: 8, flexWrap: 'wrap', gap: 4 }}>
            {CONTROL_ACTIONS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setAction(item);
                  setResult(null);
                  setScreenshotData(null);
                }}
                style={{
                  ...GHOST_BTN,
                  background:
                    action === item
                      ? 'color-mix(in srgb, var(--accent) 15%, transparent)'
                      : 'transparent',
                  borderColor: action === item ? 'var(--accent)' : 'var(--border-default)',
                  color: action === item ? 'var(--accent)' : 'var(--fg-default)',
                }}
              >
                {ACTION_LABELS[item]}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {action === 'screenshot' ? (
              <input
                style={FIELD_INPUT}
                placeholder="延迟毫秒"
                value={delayMs}
                onChange={(event) => setDelayMs(event.target.value)}
              />
            ) : null}
            {action === 'click' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <input
                  style={FIELD_INPUT}
                  placeholder="X"
                  value={x}
                  onChange={(event) => setX(event.target.value)}
                />
                <input
                  style={FIELD_INPUT}
                  placeholder="Y"
                  value={y}
                  onChange={(event) => setY(event.target.value)}
                />
              </div>
            ) : null}
            {action === 'type' ? (
              <input
                style={FIELD_INPUT}
                placeholder="输入内容"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            ) : null}
            {action === 'key' ? (
              <input
                style={FIELD_INPUT}
                placeholder="按键，例如 Enter"
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
            ) : null}
            {action === 'hotkey' ? (
              <input
                style={FIELD_INPUT}
                placeholder="组合键，例如 Control,K"
                value={keys}
                onChange={(event) => setKeys(event.target.value)}
              />
            ) : null}
            {action === 'scroll' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <input
                  style={FIELD_INPUT}
                  placeholder="scrollX"
                  value={scrollX}
                  onChange={(event) => setScrollX(event.target.value)}
                />
                <input
                  style={FIELD_INPUT}
                  placeholder="scrollY"
                  value={scrollY}
                  onChange={(event) => setScrollY(event.target.value)}
                />
              </div>
            ) : null}
            {action === 'wait' ? (
              <input
                style={FIELD_INPUT}
                placeholder="等待毫秒"
                value={waitMs}
                onChange={(event) => setWaitMs(event.target.value)}
              />
            ) : null}
            <button
              type="button"
              onClick={() => void runAction()}
              disabled={loading}
              style={{ ...ACTION_BTN, opacity: loading ? 0.6 : 1, alignSelf: 'flex-start' }}
            >
              {loading ? '执行中…' : ACTION_LABELS[action]}
            </button>
            {result ? (
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: 10,
                  padding: '4px 8px',
                  borderRadius: 5,
                  background: result.ok
                    ? 'color-mix(in srgb, var(--success) 15%, transparent)'
                    : 'color-mix(in srgb, var(--danger) 15%, transparent)',
                  color: result.ok ? 'var(--success)' : 'var(--danger)',
                  border: `1px solid ${
                    result.ok
                      ? 'color-mix(in srgb, var(--success) 35%, transparent)'
                      : 'color-mix(in srgb, var(--danger) 35%, transparent)'
                  }`,
                }}
              >
                {result.msg}
              </pre>
            ) : null}
            {screenshotData ? (
              <img
                src={`data:image/png;base64,${screenshotData}`}
                alt="系统桌面截图"
                style={{
                  maxWidth: '100%',
                  borderRadius: 6,
                  border: '1px solid var(--border-default)',
                  marginTop: 4,
                }}
              />
            ) : null}
          </div>
        </div>
      ) : (
        <div
          style={{
            marginTop: 10,
            paddingTop: 10,
            borderTop: '1px solid var(--border-default)',
            fontSize: 10,
            color: 'var(--fg-muted)',
          }}
        >
          系统桌面控制当前不可用
        </div>
      )}
    </div>
  );
}
