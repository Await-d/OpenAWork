import { createRoot } from 'react-dom/client';
import { ToolCallDisplay } from '../src/components/chat/tool-call/display/tool-call-display.js';
import { patchText, richOutput, successOutput } from './patch-tool-fixtures.js';
import '../src/index.css';
import '../src/components/chat/message/chat-message.css';

document.documentElement.dataset.theme = 'carbon';
document.documentElement.dataset.mode = new URLSearchParams(location.search).get('mode') ?? 'dark';

const cases = [
  {
    id: 'completed',
    title: '已完成 · success/files JSON · 多文件',
    status: 'completed',
    output: successOutput,
  },
  {
    id: 'rich',
    title: '已完成 · fileDiffs · 重复文件 · 截断 · 长路径',
    status: 'completed',
    output: richOutput,
  },
  { id: 'running', title: '运行中 · 等待执行结果', status: 'running' },
  {
    id: 'failed',
    title: '失败 · 未应用变更',
    status: 'error',
    output: 'Patch failed: context mismatch in src/existing.ts',
    isError: true,
  },
] as const;

function PatchToolHarness() {
  return (
    <main className="patch-harness">
      <h1>补丁工具真实组件验收</h1>
      {cases.map((item) => (
        <section key={item.id} data-case={item.id} aria-label={item.title}>
          <h2>{item.title}</h2>
          <div className="chat-message-content" data-role="assistant">
            <ToolCallDisplay
              toolName="patch"
              input={{ patchText }}
              status={item.status}
              output={'output' in item ? item.output : undefined}
              isError={'isError' in item ? item.isError : undefined}
              durationMs={item.status === 'running' ? undefined : 140}
            />
          </div>
        </section>
      ))}
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('补丁 harness 缺少 root');
createRoot(root).render(<PatchToolHarness />);
