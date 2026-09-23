/**
 * 后台任务面板（`BackgroundTaskPanel`）三视口验收 harness。
 *
 * 渲染的是**真实链路**：`useBackgroundTaskPanel`（子代理任务 / 终端行归一 + `now` 心跳）
 * + `BackgroundTaskPanel`（汇总条 / 两分区 / 三态），用固定 fixture 覆盖：
 *   - running 子代理 / pending 子代理（排队中）
 *   - running 后台命令 / failed 后台命令
 *   - loading / empty / error 三态
 *   - 操作进行中（停止中 / 终止中）
 *
 * 运行方式见同目录 `README.md`。Wave 1 只要求「能渲染」；三视口断言
 * （375 / 768 / 1280：行不溢出、`task_id` / `terminalId` 可复制按钮可达、
 * empty 态截图）由 `verify-background-task-panel.ts` 在 Wave 3 补齐。
 */
import { createRoot } from 'react-dom/client';
import type { SessionTask } from '@openAwork/web-client';
import type { SessionTerminalView } from '../src/components/conversation-runtime/terminals/terminals-api.js';
import { useBackgroundTaskPanel } from '../src/pages/chat-page/panels/use-background-task-panel.js';
import { BackgroundTaskPanel } from '../src/pages/chat-page/panels/background-task-panel.js';
import { BackgroundTaskQuickChip } from '../src/pages/chat-page/panels/background-task-quick-chip.js';

declare global {
  interface Window {
    /** 面板回调记录（供 Wave 3 断言点击 / 操作接线）。 */
    __backgroundTaskPanelHarness?: { calls: string[] };
  }
}
window.__backgroundTaskPanelHarness = { calls: [] };

function recordCall(call: string): void {
  window.__backgroundTaskPanelHarness?.calls.push(call);
}

const FIXTURE_SESSION_ID = 'session-harness-background';
const NOW_MS = Date.now();

function subagentTask(
  overrides: Partial<SessionTask> & Pick<SessionTask, 'id' | 'title' | 'status'>,
): SessionTask {
  return {
    blockedBy: [],
    completedSubtaskCount: 0,
    createdAt: NOW_MS - 120_000,
    depth: 0,
    priority: 'medium',
    readySubtaskCount: 0,
    subtaskCount: 0,
    tags: [],
    unmetDependencyCount: 0,
    updatedAt: NOW_MS - 1_000,
    ...overrides,
  };
}

function backgroundTerminal(
  overrides: Partial<SessionTerminalView> &
    Pick<SessionTerminalView, 'terminalId' | 'command' | 'status'>,
): SessionTerminalView {
  return {
    cwd: '/workspace/OpenAWork',
    kind: 'background',
    lastActivityMs: NOW_MS - 2_000,
    outputBytesTotal: 12_480,
    outputTail: '[harness] 后台命令输出片段\n',
    sessionId: FIXTURE_SESSION_ID,
    startedAtMs: NOW_MS - 45_000,
    toolName: 'run_bash_in_background',
    ...overrides,
  };
}

const RUNNING_SUBAGENT = subagentTask({
  assignedAgent: 'explore',
  createdAt: NOW_MS - 96_000,
  id: 'T-harness-running',
  sessionId: 'child-harness-running',
  startedAt: NOW_MS - 83_000,
  status: 'running',
  title: '审计会话唤醒原语并整理结论',
});

const PENDING_SUBAGENT = subagentTask({
  assignedAgent: 'general',
  blockedBy: ['T-harness-running'],
  createdAt: NOW_MS - 9_000,
  id: 'T-harness-pending',
  sessionId: 'child-harness-pending',
  status: 'pending',
  title: '补齐后台任务面板的验收断言',
});

const RUNNING_SHELL = backgroundTerminal({
  command: 'bun run --filter @openAwork/agent-gateway test --watch',
  outputBytesTotal: 18_432,
  startedAtMs: NOW_MS - 38_000,
  status: 'running',
  terminalId: 'term-harness-running',
});

const FAILED_SHELL = backgroundTerminal({
  command: 'bunx tsc --noEmit --project apps/web/tsconfig.json',
  endedAtMs: NOW_MS - 6_000,
  exitCode: 1,
  lastActivityMs: NOW_MS - 6_000,
  outputBytesTotal: 4_096,
  startedAtMs: NOW_MS - 21_000,
  status: 'exited',
  terminalId: 'term-harness-failed',
});

// 矮窗口用例专用：6 条活跃行（弹层内容高于矮窗口可用空间，用来验证 `45vh` 封顶生效）。
const SHORT_PANE_TASKS: SessionTask[] = [
  RUNNING_SUBAGENT,
  PENDING_SUBAGENT,
  subagentTask({
    assignedAgent: 'general',
    id: 'T-short-1',
    sessionId: 'child-short-1',
    status: 'running',
    title: '并发检索来源 A',
  }),
  subagentTask({
    assignedAgent: 'general',
    id: 'T-short-2',
    sessionId: 'child-short-2',
    status: 'running',
    title: '并发检索来源 B',
  }),
  subagentTask({
    assignedAgent: 'explore',
    id: 'T-short-3',
    sessionId: 'child-short-3',
    status: 'running',
    title: '代码库交叉核对',
  }),
];
const SHORT_PANE_TERMINALS: SessionTerminalView[] = [
  RUNNING_SHELL,
  backgroundTerminal({
    command: 'bun run --filter @openAwork/web typecheck --watch',
    outputBytesTotal: 2_048,
    startedAtMs: NOW_MS - 12_000,
    status: 'running',
    terminalId: 'term-harness-running-2',
  }),
];

const FIXTURE_TASKS: SessionTask[] = [RUNNING_SUBAGENT, PENDING_SUBAGENT];
const FIXTURE_TERMINALS: SessionTerminalView[] = [RUNNING_SHELL, FAILED_SHELL];

const EMPTY_IDS: ReadonlySet<string> = new Set<string>();
const STOPPING_IDS: ReadonlySet<string> = new Set(['child-harness-running']);
const PENDING_KILL_IDS: ReadonlySet<string> = new Set(['term-harness-running']);

interface HarnessCaseProps {
  caseId: string;
  label: string;
  tasks: SessionTask[];
  terminals: SessionTerminalView[];
  loading?: boolean;
  error?: string | null;
  lastSyncedAtMs?: number | null;
  stoppingSubAgentIds?: ReadonlySet<string>;
  pendingKillIds?: ReadonlySet<string>;
}

function HarnessCase(props: HarnessCaseProps) {
  const model = useBackgroundTaskPanel({ tasks: props.tasks, terminals: props.terminals });
  return (
    <div data-case={props.caseId}>
      <div className="case-label">{props.label}</div>
      <div data-component="background-task-panel">
        <BackgroundTaskPanel
          error={props.error ?? null}
          lastSyncedAtMs={
            props.lastSyncedAtMs === undefined ? NOW_MS - 3_000 : props.lastSyncedAtMs
          }
          loading={props.loading ?? false}
          model={model}
          onKillTerminal={(terminalId) => recordCall(`kill:${terminalId}`)}
          onOpenSession={(childSessionId) => recordCall(`open:${childSessionId}`)}
          onPreviewTerminal={(terminalId) => recordCall(`preview:${terminalId}`)}
          onReloadTerminals={() => recordCall('reload')}
          onStopAllSubagents={() => recordCall('stop-all')}
          onStopSubagent={(childSessionId) => recordCall(`stop:${childSessionId}`)}
          pendingKillIds={props.pendingKillIds ?? EMPTY_IDS}
          stoppingSubAgentIds={props.stoppingSubAgentIds ?? EMPTY_IDS}
        />
      </div>
    </div>
  );
}

/**
 * 常驻胶囊用例：模拟 `composerFooterSlot` 的左对齐行（relative 容器 + 一行 flex），
 * 真实渲染 `BackgroundTaskQuickChip`（真实 `useBackgroundTaskPanel` 归一）。
 */
function ChipCase(props: {
  caseId: string;
  label: string;
  tasks: SessionTask[];
  terminals: SessionTerminalView[];
  /**
   * 传入时用「面板高度(vh) + overflow:hidden + 底部锚定」包裹胶囊，模拟真实祖先链
   * （对话面板裁切 + composer 贴底）。用于矮窗口下验证弹层不会被裁掉——
   * `maxHeight` 的 `45vh` 是相对**浏览器窗口**的，所以该用例必须在矮窗口里跑。
   */
  paneHeightVh?: number;
}) {
  const model = useBackgroundTaskPanel({ tasks: props.tasks, terminals: props.terminals });
  const chip = (
    <BackgroundTaskQuickChip
      model={model}
      onKillTerminal={(terminalId) => recordCall(`chip-kill:${terminalId}`)}
      onOpenPanel={() => recordCall('chip-open-panel')}
      onOpenSession={(childSessionId) => recordCall(`chip-open:${childSessionId}`)}
      onPreviewTerminal={(terminalId) => recordCall(`chip-preview:${terminalId}`)}
      onStopAllSubagents={() => recordCall('chip-stop-all')}
      onStopSubagent={(childSessionId) => recordCall(`chip-stop:${childSessionId}`)}
      pendingKillIds={EMPTY_IDS}
      stoppingSubAgentIds={EMPTY_IDS}
    />
  );

  if (props.paneHeightVh === undefined) {
    return (
      <div data-case={props.caseId}>
        <div className="case-label">{props.label}</div>
        <div
          style={{ position: 'relative', display: 'flex', gap: 8, minHeight: 44, paddingTop: 4 }}
        >
          {chip}
        </div>
      </div>
    );
  }

  return (
    <div data-case={props.caseId}>
      <div className="case-label">{props.label}</div>
      <div
        data-testid="chip-short-pane"
        style={{
          height: `${props.paneHeightVh}vh`,
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          padding: 8,
          border: '1px dashed rgba(255, 255, 255, 0.14)',
        }}
      >
        <div style={{ position: 'relative', display: 'flex', gap: 8 }}>{chip}</div>
      </div>
    </div>
  );
}

function Viewport(props: { label: string; width: number }) {
  return (
    <div className="viewport" data-width={props.width} style={{ width: props.width }}>
      <div className="viewport-label">{props.label}</div>
      <HarnessCase
        caseId="fixtures"
        label="固定 fixture：2 个子代理 + 2 个后台命令"
        tasks={FIXTURE_TASKS}
        terminals={FIXTURE_TERMINALS}
      />
      <HarnessCase
        caseId="in-flight"
        label="操作进行中：子代理停止中 / 后台命令终止中"
        tasks={FIXTURE_TASKS}
        terminals={FIXTURE_TERMINALS}
        stoppingSubAgentIds={STOPPING_IDS}
        pendingKillIds={PENDING_KILL_IDS}
      />
      <HarnessCase caseId="loading" label="loading 骨架" tasks={[]} terminals={[]} loading />
      <HarnessCase caseId="empty" label="empty 空态" tasks={[]} terminals={[]} />
      <HarnessCase
        caseId="error"
        label="error 态 + 重试"
        tasks={[]}
        terminals={[]}
        error="无法连接网关：fetch failed"
      />
      <ChipCase
        caseId="chip"
        label="常驻胶囊：1 个子代理 + 1 个后台命令进行中"
        tasks={[RUNNING_SUBAGENT, PENDING_SUBAGENT]}
        terminals={[RUNNING_SHELL]}
      />
      <ChipCase
        caseId="chip-short"
        label="矮窗口：面板裁切 + composer 贴底时弹层不被裁掉"
        paneHeightVh={62}
        tasks={SHORT_PANE_TASKS}
        terminals={SHORT_PANE_TERMINALS}
      />
      <ChipCase
        caseId="chip-idle"
        label="常驻胶囊空态：没有活跃任务时不渲染"
        tasks={[
          subagentTask({
            id: 'T-done',
            sessionId: 'child-done',
            status: 'completed',
            title: '已完成的任务',
          }),
        ]}
        terminals={[backgroundTerminal({ status: 'exited', terminalId: 'term-done' })]}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <>
    <Viewport label="375px" width={375} />
    <Viewport label="768px" width={768} />
    <Viewport label="1280px" width={1280} />
  </>,
);
