// @vitest-environment jsdom
/**
 * Ctrl/⌘+Shift+5 —— 拆分当前激活 pane（T-13，TASK 1）的字面契约：
 *  - 在**面板容器**上接管（终端自己的隐藏 textarea 上按也算命中，这正是最该生效的场景）；
 *  - 方向复用既有的视口默认：<768px → column，否则 row（与 ⊟ 同一条判定，不复制第二份）；
 *  - 明确的 UI 输入控件（搜索条 / tab 重命名输入框）上放行；
 *  - pane 达上限时不执行，但给出可见提示（不静默）。
 *
 * 与 `QuickTerminalPanel.split-wiring.test.tsx` 同一套 mock 策略：hook 与网络层都换替身，
 * 这里断言的是**快捷键接线**，拆分本身的可达性由那份测试保证。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import type { TerminalLayout } from './layout/types.js';
import type { UseTerminalLayoutResult } from './layout/use-terminal-layout.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { makePane, makeSplit } from './layout/test-fixtures.js';

const api = vi.hoisted(() => ({
  createSessionTerminal: vi.fn(),
  closeTerminal: vi.fn(),
  writeTerminalStdin: vi.fn(),
  killSessionTerminal: vi.fn(),
}));

const hook = vi.hoisted(() => ({
  layout: null as TerminalLayout | null,
  splitPane: vi.fn(),
  insertTerminal: vi.fn(),
  moveTerminal: vi.fn(),
}));

const portsClient = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('../../conversation-runtime/terminals/terminals-api.js', () => ({
  createSessionTerminal: api.createSessionTerminal,
  closeTerminal: api.closeTerminal,
  writeTerminalStdin: api.writeTerminalStdin,
  killSessionTerminal: api.killSessionTerminal,
}));

/**
 * 终端视图替身：还原两个输入面 —— xterm 的隐藏 textarea（**不带** UI 输入标记）与
 * 搜索条输入框（**带** `data-terminal-ui-input`）。放行判据只认标记，不认「可编辑」，
 * 所以这两个替身正好把两条分支都钉住。
 */
vi.mock('./InteractiveTerminalView.js', () => ({
  InteractiveTerminalView: (props: { terminal: SessionTerminalView }) => (
    <div data-testid="terminal-view" data-terminal-id={props.terminal.terminalId}>
      <textarea className="xterm-helper-textarea" data-testid="terminal-hidden-input" />
      <input data-terminal-ui-input="" data-testid="terminal-search-input" readOnly />
    </div>
  ),
}));

vi.mock('./layout/use-terminal-layout.js', () => ({
  useTerminalLayout: (): UseTerminalLayoutResult => ({
    layout: hook.layout,
    sessionKey: '__default__',
    splitPane: hook.splitPane,
    removePane: vi.fn(),
    removeTerminal: vi.fn(),
    moveTerminal: hook.moveTerminal,
    insertTerminal: hook.insertTerminal,
    setActiveTerminal: vi.fn(),
    setRatio: vi.fn(),
    resetLayout: vi.fn(),
  }),
}));

vi.mock('@openAwork/web-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/web-client')>();
  return {
    ...actual,
    createListeningPortsClient: () => ({ list: portsClient.list }),
  };
});

const { QuickTerminalPanel } = await import('./QuickTerminalPanel.js');
const { TerminalSearchBar } = await import('./TerminalSearchBar.js');

const WORKSPACE = '/workspace';
const NARROW_VIEWPORT_QUERY = '(max-width: 767px)';
const originalMatchMedia = window.matchMedia;

function stubNarrowViewport(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({
      matches: true,
      media: NARROW_VIEWPORT_QUERY,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function makeTerminal(overrides: Partial<SessionTerminalView> = {}): SessionTerminalView {
  return {
    terminalId: 't1',
    sessionId: 'session-1',
    toolName: 'quick_terminal',
    kind: 'foreground',
    command: 'bash',
    cwd: WORKSPACE,
    status: 'running',
    startedAtMs: 1_700_000_000_000,
    lastActivityMs: 1_700_000_000_500,
    outputBytesTotal: 0,
    outputTail: '',
    ...overrides,
  };
}

function renderPanel(terminals: SessionTerminalView[]) {
  return render(
    <QuickTerminalPanel
      open
      onRequestClose={vi.fn()}
      workspacePath={WORKSPACE}
      gatewayUrl="https://gateway.test"
      token="token-1"
      sessionId="session-1"
      terminals={terminals}
      loading={false}
      onReload={vi.fn()}
      onRenameTerminal={vi.fn(async () => undefined)}
      onDismissTerminal={vi.fn()}
    />,
  );
}

/** 与实现同源的组合键（`code` 是物理键位，`key` 是布局产物）。 */
function pressSplitShortcut(target: Element, init: Record<string, unknown> = {}): void {
  fireEvent.keyDown(target, {
    key: '5',
    code: 'Digit5',
    ctrlKey: true,
    shiftKey: true,
    ...init,
  });
}

function visiblePaneBody(paneId: string): HTMLElement {
  return within(screen.getByTestId(`terminal-pane-${paneId}`)).getByTestId('terminal-hidden-input');
}

beforeEach(() => {
  vi.clearAllMocks();
  hook.layout = null;
  api.createSessionTerminal.mockResolvedValue({ terminal: makeTerminal({ terminalId: 't-new' }) });
  portsClient.list.mockResolvedValue({
    ports: [],
    strategy: 'procfs',
    collectedAtMs: 1_700_000_000_000,
  });
  Object.defineProperty(Element.prototype, 'setPointerCapture', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  Object.defineProperty(Element.prototype, 'releasePointerCapture', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  useUIStateStore.setState({
    lastChatPath: null,
    terminalLayoutBySession: {},
    quickTerminalActiveIdByWorkspace: {},
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
  useUIStateStore.setState({
    lastChatPath: null,
    terminalLayoutBySession: {},
    quickTerminalActiveIdByWorkspace: {},
  });
});

describe('Ctrl/⌘+Shift+5 拆分当前激活 pane', () => {
  it('终端获得焦点（xterm 隐藏 textarea）时触发拆分，走 POST → splitPane 既有路径', async () => {
    hook.layout = makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]);
    renderPanel([makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't2' })]);

    pressSplitShortcut(visiblePaneBody('p1'));

    await waitFor(() => {
      expect(api.createSessionTerminal).toHaveBeenCalledTimes(1);
      expect(hook.splitPane).toHaveBeenCalledWith('p1', 'row', 'pane-t-new', 't-new');
    });
    // 焦点 pane 由 TerminalPane 的 focus/mousedown 捕获；键盘路径下就是当前激活 pane。
    expect(hook.splitPane).toHaveBeenCalledTimes(1);
  });

  it('<768px：方向复用视口默认（column），与 ⊟ 同一处判定', async () => {
    stubNarrowViewport();
    hook.layout = makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]);
    renderPanel([makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't2' })]);

    pressSplitShortcut(visiblePaneBody('p1'));

    await waitFor(() => {
      expect(hook.splitPane).toHaveBeenCalledWith('p1', 'column', 'pane-t-new', 't-new');
    });
  });

  it('⌘+Shift+5（macOS）同样生效；合成事件只带 key="%"（无 code）也识别', async () => {
    hook.layout = makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]);
    renderPanel([makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't2' })]);

    pressSplitShortcut(visiblePaneBody('p1'), { ctrlKey: false, metaKey: true });

    await waitFor(() => {
      expect(hook.splitPane).toHaveBeenCalledWith('p1', 'row', 'pane-t-new', 't-new');
    });

    pressSplitShortcut(visiblePaneBody('p1'), { key: '%', code: '' });

    await waitFor(() => {
      expect(hook.splitPane).toHaveBeenCalledTimes(2);
    });
  });

  it('pane 达上限（4）时不执行，但给出可见提示（复用 ⊟ 的禁用文案）', () => {
    hook.layout = makeSplit('s-root', 'row', [
      makePane('p1', ['t1']),
      makeSplit('s-right', 'row', [
        makeSplit('s-right-top', 'column', [makePane('p2', ['t2']), makePane('p3', ['t3'])]),
        makePane('p4', ['t4']),
      ]),
    ]);
    renderPanel([
      makeTerminal({ terminalId: 't1' }),
      makeTerminal({ terminalId: 't2' }),
      makeTerminal({ terminalId: 't3' }),
      makeTerminal({ terminalId: 't4' }),
    ]);

    pressSplitShortcut(visiblePaneBody('p1'));

    expect(api.createSessionTerminal).not.toHaveBeenCalled();
    expect(hook.splitPane).not.toHaveBeenCalled();
    expect(screen.getByTestId('terminal-panel-hint').textContent).toBe('分屏已达上限（4 个组）');
  });

  it('搜索条输入框（data-terminal-ui-input）上放行，不抢输入', () => {
    hook.layout = makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]);
    renderPanel([makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't2' })]);

    // 每个可见 pane 都会渲染一份终端视图，这里取 p1 组内的搜索条输入框。
    pressSplitShortcut(
      within(screen.getByTestId('terminal-pane-p1')).getByTestId('terminal-search-input'),
    );

    expect(api.createSessionTerminal).not.toHaveBeenCalled();
    expect(hook.splitPane).not.toHaveBeenCalled();
  });

  it('tab 行内重命名输入框（真实组件）上放行', () => {
    hook.layout = makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]);
    renderPanel([makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't2' })]);

    fireEvent.doubleClick(screen.getByTestId('terminal-tab-t1'));
    const renameInput = screen.getByRole('textbox', { name: '重命名终端' });

    pressSplitShortcut(renameInput);

    expect(api.createSessionTerminal).not.toHaveBeenCalled();
    expect(hook.splitPane).not.toHaveBeenCalled();
  });

  it('真实搜索条输入框带 data-terminal-ui-input 标记（放行判据的唯一依据）', () => {
    render(
      <TerminalSearchBar
        open
        onClose={vi.fn()}
        onFindNext={() => true}
        onFindPrevious={() => true}
      />,
    );

    expect(screen.getByTestId('terminal-search-input').hasAttribute('data-terminal-ui-input')).toBe(
      true,
    );
  });

  it('端口页签不接管（没有可见 pane 可拆）；Ctrl+F / 无 Shift / 长按重复都不触发', () => {
    hook.layout = makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]);
    renderPanel([makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't2' })]);
    const panel = screen.getByRole('region', { name: '快捷终端面板' });

    fireEvent.click(screen.getByRole('tab', { name: '端口' }));
    pressSplitShortcut(panel);
    expect(hook.splitPane).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: '终端' }));
    const body = visiblePaneBody('p1');
    fireEvent.keyDown(body, { key: 'f', code: 'KeyF', ctrlKey: true });
    pressSplitShortcut(body, { shiftKey: false });
    pressSplitShortcut(body, { key: '4', code: 'Digit4' });
    pressSplitShortcut(body, { repeat: true });

    expect(api.createSessionTerminal).not.toHaveBeenCalled();
    expect(hook.splitPane).not.toHaveBeenCalled();
  });
});
