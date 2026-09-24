/**
 * 终端 tab 条验收 harness（真实 Chromium）。
 *
 * 渲染**真实组件**（`TerminalTabStrip` + 真实 CSS 链）在 375 / 768 / 1280 三视口下，
 * 覆盖 jsdom 覆盖不到的部分：
 *   - 长窗口标题在真实排版下不撑破宿主（tab 宽受 200px 上限、tab 条自己横向滚动、
 *     右侧动作区不被挤出 pane）—— 「row flex 缺 min-width: 0 被 nowrap 撑破」
 *     是这条链路的历史风险点（见 terminal-split.css 顶部注释）；
 *   - `terminalTabLabel` 的 JS 截断（> 24 → 22 + `…`）与 CSS 省略号叠加后不换行；
 *   - tab 条按传入顺序从左到右渲染（**顺序真相在 `QuickTerminalPanel.test.tsx`
 *     的面板级用例**：上游「最新在前」会在 panel 层重排为「旧 → 新」）。
 *
 * 右侧动作区用固定宽度占位代替真实 `TerminalTabActions`（若干 icon button，
 * 不可压缩）：它是「长标签是否把控件挤出 pane」这条断言的受力点，刻意不复刻图标。
 *
 * 运行方式见同目录 `README.md`。
 */
import { createRoot } from 'react-dom/client';
import { TerminalTabStrip } from '../src/components/chat/terminal/TerminalTabStrip.js';
import {
  HARNESS_ACTIVE_ID,
  HARNESS_TERMINAL_TITLES,
  makeHarnessTerminals,
} from './terminal-tab-label-fixtures.js';
import '../src/components/chat/terminal/terminal-panel.css';
import '../src/components/chat/terminal/terminal-split.css';

const noop = (): void => undefined;

const TERMINALS = makeHarnessTerminals();

function StripCase({ label, width }: { label: string; width: number }) {
  return (
    <div className="viewport" style={{ width }} data-viewport={width}>
      <div className="viewport-label">{label}</div>
      {/*
        真实布局链（每层都是真实 class）：
        .terminal-panel[inline]（提供 --terminal-panel-header-height）
          → .terminal-split > .terminal-split__child--grow > .terminal-pane
          → .terminal-panel__tab-strip.terminal-pane__strip
        （中间层的 min-width: 0 正是历史缺陷所在，不能省。）
      */}
      <div className="terminal-panel" data-presentation="inline">
        <div className="terminal-split" data-direction="row">
          <div className="terminal-split__child terminal-split__child--grow">
            <section className="terminal-pane" data-pane-id="p1" data-active="true">
              <div
                className="terminal-panel__tab-strip terminal-pane__strip"
                data-testid="harness-strip-row"
              >
                <TerminalTabStrip
                  paneId="p1"
                  terminals={TERMINALS}
                  activeId={HARNESS_ACTIVE_ID}
                  terminalTitles={HARNESS_TERMINAL_TITLES}
                  renamingId={null}
                  renameValue=""
                  onSelect={noop}
                  onStartRename={noop}
                  onRenameValueChange={noop}
                  onCommitRename={noop}
                  onCancelRename={noop}
                  onClose={noop}
                />
                <div className="harness-actions" data-testid="harness-actions">
                  ＋ ⊟ 🗑 ⋯
                </div>
              </div>
              <div className="terminal-pane__body" />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <>
    <StripCase label="375px" width={375} />
    <StripCase label="768px" width={768} />
    <StripCase label="1280px" width={1280} />
  </>,
);
