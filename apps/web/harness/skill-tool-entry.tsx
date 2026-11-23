import { createRoot } from 'react-dom/client';
import { ToolCallDisplay } from '../src/components/chat/tool-call/display/tool-call-display.js';
import { skillCases, listCases } from './skill-tool-fixtures.js';
import '../src/index.css';
import '../src/components/chat/message/chat-message.css';

document.documentElement.dataset.theme = 'carbon';
document.documentElement.dataset.mode = new URLSearchParams(location.search).get('mode') ?? 'dark';
function Harness() {
  return (
    <main className="skill-harness">
      <h1>技能与目录真实组件验收</h1>
      {skillCases.map(({ id, props }) => (
        <section key={id} data-case={id}>
          <h2>{id}</h2>
          <div className="chat-message-content" data-role="assistant">
            <ToolCallDisplay {...props} />
          </div>
        </section>
      ))}
      {listCases.map(({ id, nodes }) => (
        <section key={id} data-case={id}>
          <h2>{id}</h2>
          <div className="chat-message-content" data-role="assistant">
            <ToolCallDisplay
              toolName="list"
              input={{ path: '/workspace', depth: 3 }}
              status="completed"
              output={JSON.stringify({ path: '/workspace', nodes })}
            />
          </div>
        </section>
      ))}
    </main>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('技能 harness 缺少 root');
createRoot(root).render(<Harness />);
