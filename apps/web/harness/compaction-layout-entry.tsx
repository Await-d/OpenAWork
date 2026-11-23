import { createRoot } from 'react-dom/client';
import { MessageRow } from '../src/components/chat/session/message-row.js';
import type { ChatMessage } from '../src/components/conversation-runtime/messages/support.js';
import { useDisplayPreferencesStore } from '../src/stores/settings/display-preferences.js';
import '../src/index.css';
import '../src/components/chat/message/chat-message.css';

document.documentElement.dataset.theme = 'carbon';
document.documentElement.dataset.mode = new URLSearchParams(location.search).get('mode') ?? 'dark';
useDisplayPreferencesStore.setState({ metaLineScope: 'latest', showMetaLine: true });

/** 压缩标记消息（recovery 里的 compaction_marker 形态）。 */
function makeCompactionMessage(): ChatMessage {
  return {
    id: 'compaction-1',
    role: 'assistant',
    content: JSON.stringify({
      source: 'openAwork',
      type: 'compaction_marker',
      payload: { summary: '已自动压缩上下文\n\n- 保留最近 6 条消息\n- 摘要 275 条历史' },
    }),
    status: 'completed',
    createdAt: Date.now(),
  } as ChatMessage;
}

function makeMessage(id: string, role: 'user' | 'assistant', text: string): ChatMessage {
  return { id, role, content: text, status: 'completed', createdAt: Date.now() } as ChatMessage;
}

const cases = [
  { id: 'before', message: makeMessage('u1', 'user', '帮我看一下这个文件') },
  { id: 'compaction', message: makeCompactionMessage() },
  { id: 'after', message: makeMessage('a1', 'assistant', '好的，这个文件里主要包含…') },
  { id: 'after2', message: makeMessage('u2', 'user', '继续') },
] as const;

function Harness() {
  return (
    <main className="compaction-harness">
      <h1>压缩提示在消息流中的位置</h1>
      <div className="chat-message-group" data-role="assistant">
        {cases.map((item) => (
          <div key={item.id} data-case={item.id}>
            <MessageRow
              message={item.message}
              providerId="anthropic"
              providerName="Anthropic"
              modelId="claude-sonnet-4"
              email="qa@example.com"
              renderContent={() => <p>渲染内容</p>}
              sharedUiThemeVars={{}}
              isLatestMessage={false}
            />
          </div>
        ))}
      </div>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('compaction harness 缺少 root');
createRoot(root).render(<Harness />);
