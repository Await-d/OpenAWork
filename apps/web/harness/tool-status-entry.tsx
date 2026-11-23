import { createRoot } from 'react-dom/client';
import { ToolCallDisplay } from '../src/components/chat/tool-call/display/tool-call-display.js';
import { useDisplayPreferencesStore } from '../src/stores/settings/display-preferences.js';
import { cases } from './tool-status-fixtures.js';
import '../src/index.css';
import '../src/components/chat/message/chat-message.css';

document.documentElement.dataset.theme = 'carbon';
document.documentElement.dataset.mode = new URLSearchParams(location.search).get('mode') ?? 'dark';
useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: false });

function Harness() {
  return (
    <main className="tool-status-harness">
      <h1>工具调用状态 · 真实组件验收</h1>
      {cases.map(({ id, props }) => (
        <section key={id} data-case={id} aria-label={id}>
          <h2>{id}</h2>
          <div className="chat-message-content" data-role="assistant">
            <ToolCallDisplay {...props} />
          </div>
        </section>
      ))}
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('工具状态 harness 缺少 root');
createRoot(root).render(<Harness />);
