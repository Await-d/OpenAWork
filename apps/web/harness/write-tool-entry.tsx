import { createRoot } from 'react-dom/client';
import { ToolCallDisplay } from '../src/components/chat/tool-call/display/tool-call-display.js';
import { ToolOutputPreview } from '../src/components/chat/tool-call/io/tool-output-preview.js';
import { useDisplayPreferencesStore } from '../src/stores/settings/display-preferences.js';
import { writeToolOutput, writeToolOutputAsString } from './write-tool-fixtures.js';
import { truncatedWriteOutput } from './write-tool-truncated-fixture.js';
// 生产入口（main.tsx）先加载 layout-tokens 再加载 index.css；harness 必须一致，
// 否则 --spacing-* / --radius-* 全部未定义，间距类断言与视觉效果都会失真。
import '../src/styles/layout-tokens.css';
import '../src/index.css';
import '../src/components/chat/message/chat-message.css';

document.documentElement.dataset.theme = 'carbon';
document.documentElement.dataset.mode = new URLSearchParams(location.search).get('mode') ?? 'dark';
useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: true });

const cases = [
  { id: 'write-object', label: 'write · output 为对象', output: writeToolOutput },
  { id: 'write-string', label: 'write · output 为 JSON 字符串', output: writeToolOutputAsString },
  {
    id: 'write-truncated',
    label: 'write · 网关瘦身后（省略 1062 字符）',
    output: truncatedWriteOutput,
  },
] as const;

function Harness() {
  return (
    <main className="write-tool-harness">
      <h1>write 工具结果 · 真实组件渲染</h1>
      {cases.map((item) => (
        <section key={item.id} data-case={item.id}>
          <h2>{item.label}</h2>
          <div className="chat-message-content" data-role="assistant" data-surface="display">
            <ToolCallDisplay
              toolName="write"
              input={{ filePath: '/tmp/dl15.js', content: 'x' }}
              status="completed"
              output={item.output}
            />
          </div>
          <div className="chat-message-content" data-role="assistant" data-surface="preview">
            <ToolOutputPreview toolName="write" output={item.output} />
          </div>
        </section>
      ))}
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('write 工具 harness 缺少 root');
createRoot(root).render(<Harness />);
