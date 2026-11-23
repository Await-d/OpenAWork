import { createRoot } from 'react-dom/client';
import { MessageRow } from '../src/components/chat/session/message-row.js';
import type { ChatMessage } from '../src/components/conversation-runtime/messages/support.js';
import { useDisplayPreferencesStore } from '../src/stores/settings/display-preferences.js';
// 生产入口（main.tsx）先加载 layout-tokens 再加载 index.css；harness 必须一致，
// 否则 --spacing-* / --radius-* 全部未定义，间距类断言与视觉效果都会失真。
import '../src/styles/layout-tokens.css';
import '../src/index.css';
import '../src/components/chat/message/chat-message.css';

document.documentElement.dataset.theme = 'carbon';
document.documentElement.dataset.mode = new URLSearchParams(location.search).get('mode') ?? 'dark';
// 历史消息口径：统计被抑制，只剩诊断项——正是「孤零零一个错误」的现场。
useDisplayPreferencesStore.setState({ metaLineScope: 'latest', showMetaLine: true });

function makeMessage(id: string, status: ChatMessage['status']): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: '这一步执行完了。',
    status,
    createdAt: Date.now(),
  } as ChatMessage;
}

const cases = [
  { id: 'error-only', label: '错误消息（历史口径，无统计）', message: makeMessage('m1', 'error') },
  {
    id: 'cancelled-only',
    label: '已停止消息（历史口径，无统计）',
    message: makeMessage('m2', 'cancelled'),
  },
  { id: 'completed', label: '正常消息（对照）', message: makeMessage('m3', 'completed') },
] as const;

function Harness() {
  return (
    <main className="meta-inline-harness">
      <h1>消息终态提示排版验证</h1>
      {cases.map((item) => (
        <section key={item.id} data-case={item.id}>
          <h2>{item.label}</h2>
          <div className="chat-message-group" data-role="assistant">
            <MessageRow
              message={item.message}
              providerId="anthropic"
              providerName="Anthropic"
              modelId="claude-sonnet-4"
              email="qa@example.com"
              renderContent={() => <p>这一步执行完了。</p>}
              sharedUiThemeVars={{}}
              isLatestMessage={false}
            />
          </div>
        </section>
      ))}
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('meta inline harness 缺少 root');
createRoot(root).render(<Harness />);
