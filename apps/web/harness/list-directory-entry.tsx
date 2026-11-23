import { createRoot } from 'react-dom/client';
import { ToolCallDisplay } from '../src/components/chat/tool-call/display/tool-call-display.js';
import {
  rootPath,
  listingOutput,
  emptyOutput,
  malformedOutput,
  errorOutput,
} from './list-directory-fixtures.js';
import '../src/index.css';
import '../src/components/chat/message/chat-message.css';

document.documentElement.dataset.theme = 'carbon';
document.documentElement.dataset.mode = new URLSearchParams(location.search).get('mode') ?? 'dark';
const cases = [
  { id: 'listing', label: '目录 · JSON 字符串 · 长名称及空目录', output: listingOutput },
  { id: 'empty', label: '空目录列表', output: emptyOutput },
  { id: 'malformed', label: '残缺 JSON · 原始结果兜底', output: malformedOutput },
  { id: 'error', label: '失败 · 权限不足', output: errorOutput },
];
function ListDirectoryHarness() {
  return (
    <main className="list-harness">
      <h1>目录列表真实组件验收</h1>
      {cases.map((item) => (
        <section key={item.id} data-case={item.id} aria-label={item.label}>
          <h2>{item.label}</h2>
          <div className="chat-message-content" data-role="assistant">
            <ToolCallDisplay
              toolName="list"
              input={{ path: rootPath, depth: 3 }}
              output={item.output}
              status={item.id === 'error' ? 'error' : 'completed'}
              isError={item.id === 'error'}
            />
          </div>
        </section>
      ))}
    </main>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('目录列表 harness 缺少 root');
createRoot(root).render(<ListDirectoryHarness />);
