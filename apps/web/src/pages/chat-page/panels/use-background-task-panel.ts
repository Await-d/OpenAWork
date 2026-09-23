/**
 * 「后台任务」面板的数据 hook：归一后台对象 + 1s 心跳 `now`。
 *
 * 心跳只在存在活跃行（`pending` / `running`）时运行：没有活跃行时既不启动定时器，
 * 也会在最后一条活跃行结算时自动清理，避免面板空转重渲染。
 */

import { useEffect, useMemo, useState } from 'react';
import type { SessionTask } from '@openAwork/web-client';
import type { SessionTerminalView } from '../../../components/conversation-runtime/terminals/terminals-api.js';
import {
  buildBackgroundTaskRows,
  buildBackgroundTaskSummary,
  type BackgroundTaskRow,
  type BackgroundTaskSummary,
} from './background-task-model.js';

/** 心跳间隔：面板上的「已运行 / 排队」秒数需要每秒推进。 */
const HEARTBEAT_INTERVAL_MS = 1000;

export interface BackgroundTaskPanelModel {
  rows: BackgroundTaskRow[];
  summary: BackgroundTaskSummary;
  /** 1s 心跳，仅存在活跃行时推进 */
  now: number;
}

export function useBackgroundTaskPanel(input: {
  tasks: readonly SessionTask[];
  terminals: readonly SessionTerminalView[];
}): BackgroundTaskPanelModel {
  const [now, setNow] = useState(() => Date.now());

  // rows 依赖 now：pending 行的 queuedMs 需要随心跳保持新鲜。
  const rows = useMemo(
    () => buildBackgroundTaskRows({ tasks: input.tasks, terminals: input.terminals, now }),
    [input.tasks, input.terminals, now],
  );
  const summary = useMemo(() => buildBackgroundTaskSummary(rows), [rows]);
  const hasActiveRows = rows.some((row) => row.state === 'pending' || row.state === 'running');

  useEffect(() => {
    if (!hasActiveRows) {
      return undefined;
    }

    // 活跃行出现时先对齐一次，避免首帧沿用过期的 now（例如面板先空置、任务随后才派发）。
    setNow(Date.now());
    const timerId = window.setInterval(() => {
      setNow(Date.now());
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [hasActiveRows]);

  return { rows, summary, now };
}
