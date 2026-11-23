import { createRoot } from 'react-dom/client';
import { ToolCallDisplay } from '../src/components/chat/tool-call/display/tool-call-display.js';
import { useDisplayPreferencesStore } from '../src/stores/settings/display-preferences.js';
import { cases } from './params-leak-fixtures.js';
// 生产入口（main.tsx）先加载 layout-tokens 再加载 index.css；harness 必须一致，
// 否则 --spacing-* / --radius-* 全部未定义，间距类断言与视觉效果都会失真。
import '../src/styles/layout-tokens.css';
import '../src/index.css';
import '../src/components/chat/message/chat-message.css';

document.documentElement.dataset.theme = 'carbon';
document.documentElement.dataset.mode = new URLSearchParams(location.search).get('mode') ?? 'dark';
// 展开态：截图里的问题就出在展开后。
useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: true });

function Harness() {
  return (
    <main className="params-leak-harness">
      <h1>截断大文件 · 参数区 / 截断提示去重验收</h1>
      {cases.map((item) => (
        <section key={item.id} data-case={item.id} data-tool={item.tool}>
          <h2>
            {item.id} · {item.tool}
          </h2>
          <div className="chat-message-content" data-role="assistant">
            <ToolCallDisplay
              toolName={item.tool}
              input={item.input}
              status="completed"
              output={item.output}
            />
          </div>
        </section>
      ))}
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('params leak harness 缺少 root');
createRoot(root).render(<Harness />);
