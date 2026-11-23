import { createRoot } from 'react-dom/client';
import { ToolCallDisplay } from '../src/components/chat/tool-call/display/tool-call-display.js';
import { useDisplayPreferencesStore } from '../src/stores/settings/display-preferences.js';
import '../src/index.css';
import '../src/components/chat/message/chat-message.css';

document.documentElement.dataset.theme = 'carbon';
document.documentElement.dataset.mode = new URLSearchParams(location.search).get('mode') ?? 'dark';
useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: true });

/** 模拟截图形态：before/after 各被瘦身到 8000 字符，带截断标记。 */
const bodyLines = Array.from({ length: 400 }, (_, i) => `const value${i + 1} = ${i + 1};`);
const beforeBody = bodyLines.join('\n');
const afterBody = bodyLines
  .map((line, index) => (index === 200 ? 'const value201 = CHANGED;' : line))
  .join('\n');

const TRUNCATED_OUTPUT = {
  before: `${beforeBody.slice(0, 8000)}\n…[truncated, 46076 chars omitted]`,
  after: `${afterBody.slice(0, 8000)}\n…[truncated, 24022 chars omitted]`,
  created: false,
  filediff: {
    file: '/home/await/project/OpenAWork/apps/web/src/components/chat/tool-call/display/block-tool-call.tsx',
    before: '',
    after: '',
    additions: 6,
    deletions: 6,
    status: 'modified',
  },
  success: true,
  path: '/home/await/project/OpenAWork/apps/web/src/components/chat/tool-call/display/block-tool-call.tsx',
  replacements: 1,
};

const EDIT_INPUT = {
  filePath:
    '/home/await/project/OpenAWork/apps/web/src/components/chat/tool-call/display/block-tool-call.tsx',
  oldString:
    'const hasFileChangeResult = useMemo(() => parseFileChangeResult(output) !== null, [output]);',
  newString: Array.from({ length: 21 }, (_, i) => `const newLine${i + 1} = ${i + 1};`).join('\n'),
};

function Harness() {
  return (
    <main className="layout-harness">
      <h1>截断编辑 · 参数区与思考块布局</h1>
      <section data-case="edit-truncated">
        <h2>edit（截断 + filediff），展开态</h2>
        <div className="chat-message-content" data-role="assistant">
          <ToolCallDisplay
            toolName="edit"
            input={EDIT_INPUT}
            status="completed"
            output={TRUNCATED_OUTPUT}
          />
        </div>
        {/* 模拟紧随其后的 reasoning 块与正文，检查布局是否被上方的宽内容影响 */}
        <div className="chat-message-content" data-role="assistant" data-case-part="reasoning">
          <div className="assistant-reasoning-block" data-streaming="false">
            <span className="assistant-reasoning-label">思考过程</span>
            <div className="assistant-reasoning-body">
              <div className="assistant-rich-content-body">
                我刚才插入的位置有问题：`outputRendersFileDiff` 依赖的 `hasDiff` 在后面才定义。
                先修正顺序并补 import。
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('layout harness 缺少 root');
createRoot(root).render(<Harness />);
