import { createRoot } from 'react-dom/client';
import { ToolCallDisplay } from '../src/components/chat/tool-call/display/tool-call-display.js';
import { ToolOutputPreview } from '../src/components/chat/tool-call/io/tool-output-preview.js';
import { useDisplayPreferencesStore } from '../src/stores/settings/display-preferences.js';
import { cases } from './file-change-fixtures.js';
// 生产入口（main.tsx）先加载 layout-tokens 再加载 index.css；harness 必须一致，
// 否则 --spacing-* / --radius-* 全部未定义，间距类断言与视觉效果都会失真。
import '../src/styles/layout-tokens.css';
import '../src/index.css';
import '../src/components/chat/message/chat-message.css';

document.documentElement.dataset.theme = 'carbon';
document.documentElement.dataset.mode = new URLSearchParams(location.search).get('mode') ?? 'dark';
useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: false });

function Harness() {
  return (
    <main className="file-change-harness">
      <h1>文件变更结果 · 真实组件浏览器验收</h1>
      {cases.map((item) => (
        <section key={item.id} data-case={item.id}>
          <h2>{item.id}</h2>
          <div className="chat-message-content" data-role="assistant" data-surface="display">
            <ToolCallDisplay
              toolName={item.tool}
              input={{}}
              status="completed"
              output={item.output}
            />
          </div>
          <div className="chat-message-content" data-role="assistant" data-surface="preview">
            <ToolOutputPreview toolName={item.tool} output={item.output} />
          </div>
        </section>
      ))}
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('文件变更 harness 缺少 root');
createRoot(root).render(<Harness />);
