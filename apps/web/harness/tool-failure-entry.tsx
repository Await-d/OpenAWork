import { createRoot } from 'react-dom/client';
import { ToolCallDisplay } from '../src/components/chat/tool-call/display/tool-call-display.js';
import { useDisplayPreferencesStore } from '../src/stores/settings/display-preferences.js';
import { TOOL_FAILURE_FIXTURES } from './tool-failure-fixtures.js';
// 生产入口（main.tsx）先加载 layout-tokens 再加载 index.css；harness 必须一致，
// 否则 --spacing-* / --radius-* 全部未定义，间距类断言与视觉效果都会失真。
import '../src/styles/layout-tokens.css';
import '../src/index.css';
import '../src/components/chat/message/chat-message.css';

document.documentElement.dataset.theme = 'carbon';
document.documentElement.dataset.mode = new URLSearchParams(location.search).get('mode') ?? 'dark';
// 默认折叠：验收要看的正是「折叠态只看标题行」这一条。
useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: false });

function Harness() {
  return (
    <main className="tool-failure-harness">
      <h1>工具失败态 · 结构化失败卡</h1>
      {TOOL_FAILURE_FIXTURES.map((fixture) => (
        <section key={fixture.id} data-case={fixture.id}>
          <h2>{fixture.id}</h2>
          <div className="chat-message-content" data-role="assistant" data-surface="display">
            <ToolCallDisplay
              toolName={fixture.toolName}
              input={fixture.input}
              status="failed"
              isError
              output={fixture.output}
            />
          </div>
        </section>
      ))}
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('失败卡 harness 缺少 root');
createRoot(root).render(<Harness />);
