/**
 * FileContentPreview 宽度验收 harness（真实 Chromium）。
 *
 * 渲染**真实组件链路**：`InlineToolCall`（read 工具、默认展开）→
 * `.tool-call-inline-output` → `.tool-call-inline-section`（「输出」标签 + 预览），
 * 并挂上 `FileEditorContext`（聊天页可打开编辑器时的真实形态：路径 / 行号是可点按钮），
 * 覆盖 jsdom 覆盖不到的部分：
 *   - 输出区在 row flex + wrap 的 section 里是否被标签挤窄（代码块未铺满卡片）；
 *   - `white-space: pre` 的超长行在真实排版下的横向溢出归属（块内滚动 or 撑破）；
 *   - 横向滚动时行号栏是否仍在可视区内。
 *
 * 运行方式见同目录 `README.md`。
 */
import { createRoot } from 'react-dom/client';
import type { MutableRefObject } from 'react';
import { FileEditorContext, type OpenFileFn } from '../src/App.js';
import { InlineToolCall } from '../src/components/chat/tool-call/display/inline-tool-call.js';
import { useDisplayPreferencesStore } from '../src/stores/settings/display-preferences.js';
import {
  FILE_CONTENT_PANE_WIDTHS,
  FILE_CONTENT_WIDTH_CASES,
} from './file-content-preview-width-fixtures.js';
import '../src/index.css';
import '../src/components/chat/message/chat-message.css';

// 与默认设置一致：carbon 主题 + 暗色模式。
document.documentElement.dataset.theme = 'carbon';
document.documentElement.dataset.mode = 'dark';

// 让 read（fileRead 类别）默认展开，渲染真实输出面板。
useDisplayPreferencesStore.setState((state) => ({
  toolCallsExpandedByDefault: true,
  toolExpandedOverrides: { ...state.toolExpandedOverrides, fileRead: true },
}));

/** 聊天页的编辑器打开函数：这里只提供可用上下文（按钮形态），点击不产生副作用。 */
const openFileRef = { current: null } as MutableRefObject<OpenFileFn | null>;
openFileRef.current = () => undefined;

function WidthPane({ width }: { width: number }) {
  return (
    <section className="harness-pane" style={{ width }} data-pane={width}>
      <div className="harness-pane-label">{width}px 容器</div>
      <FileEditorContext value={openFileRef}>
        {FILE_CONTENT_WIDTH_CASES.map((testCase) => (
          <div className="chat-message-row" data-case={testCase.id} key={testCase.id}>
            <div className="chat-message-main">
              <div className="harness-case-title">{testCase.label}</div>
              <InlineToolCall
                toolName="read"
                kind="read"
                input={{
                  filePath: testCase.data.path,
                  ...(testCase.data.lineStart != null ? { offset: testCase.data.lineStart } : {}),
                }}
                output={{
                  path: testCase.data.path,
                  content: testCase.data.content,
                  ...(testCase.data.lineStart != null
                    ? { lineStart: testCase.data.lineStart }
                    : {}),
                  ...(testCase.data.lineEnd != null ? { lineEnd: testCase.data.lineEnd } : {}),
                  ...(testCase.data.totalLines != null
                    ? { totalLines: testCase.data.totalLines }
                    : {}),
                  ...(testCase.data.truncated ? { truncated: true } : {}),
                  ...(testCase.data.byteLimitReached ? { byteLimitReached: true } : {}),
                }}
                status="completed"
                durationMs={120}
              />
            </div>
          </div>
        ))}
      </FileEditorContext>
    </section>
  );
}

function HarnessApp() {
  return (
    <div className="harness-root">
      {FILE_CONTENT_PANE_WIDTHS.map((width) => (
        <WidthPane width={width} key={width} />
      ))}
    </div>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('harness 缺少 #root 挂载点');
}
createRoot(rootElement).render(<HarnessApp />);
