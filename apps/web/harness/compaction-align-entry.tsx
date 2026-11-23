import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { MessageRow } from '../src/components/chat/session/message-row.js';
import type { ChatMessage } from '../src/components/conversation-runtime/messages/support.js';
import { createCompactionCardContent } from '../src/components/conversation-runtime/messages/card-codec.js';
import { groupChatRenderEntries } from '../src/components/conversation-runtime/messages/group-render-entries.js';
import type { ChatRenderEntry } from '../src/components/chat/message/chat-message-group-list.js';
import { useDisplayPreferencesStore } from '../src/stores/settings/display-preferences.js';
import { GenerativeUIRenderer } from '@openAwork/shared-ui';
import type { GenerativeUIMessage } from '@openAwork/shared-ui';
import '../src/index.css';
import '../src/components/chat/message/chat-message.css';

document.documentElement.dataset.theme = 'carbon';
document.documentElement.dataset.mode = new URLSearchParams(location.search).get('mode') ?? 'dark';
useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: false });

const compactionCard = JSON.parse(
  createCompactionCardContent({
    phase: 'completed',
    summary: '压缩了 275 条消息',
    title: 'compact',
    trigger: 'automatic',
  }),
) as GenerativeUIMessage;

function makeCompactionMessage(id: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: JSON.stringify(compactionCard),
    status: 'completed',
    createdAt: Date.now(),
  } as ChatMessage;
}

function makeNormalMessage(id: string, text: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: text,
    status: 'completed',
    createdAt: Date.now(),
  } as ChatMessage;
}

function renderMessage(message: ChatMessage, withCard = false): ReactNode {
  return withCard ? <GenerativeUIRenderer message={compactionCard} /> : <p>{message.content}</p>;
}

function toEntry(message: ChatMessage, withCard = false): ChatRenderEntry {
  return {
    message,
    renderContent: (target) => renderMessage(target, withCard),
  };
}

/**
 * 用**真实分组函数**还原聊天列表结构。
 *
 * 压缩提示与相邻助手消息同为 `assistant`，若分组只按 role 判定就会并进同一组：
 * 压缩行带 `is-grouped` 负 margin 贴住上一条，而它后面那条回复因「上一条是压缩
 * 提示」被判成续行，头像与消息头整块消失。harness 必须走真实分组，否则
 * `groupedWithPrevious` 由手写常量替代，这类缺陷测不出来。
 */
function buildSequenceEntries(): ChatRenderEntry[] {
  return [
    toEntry(makeNormalMessage('seq-before', '压缩之前的回复。')),
    toEntry(makeCompactionMessage('seq-compaction'), true),
    toEntry(makeNormalMessage('seq-after', '压缩之后的回复。')),
  ];
}

function renderGroups(entries: ChatRenderEntry[]) {
  const groups = groupChatRenderEntries(entries);
  return groups.map((group) => (
    <div
      className="chat-message-group"
      data-chat-group-root="true"
      data-group-key={group.key}
      data-role={group.role}
    >
      {group.entries.map((entry, index) => (
        <MessageRow
          key={entry.message.id}
          message={entry.message}
          providerId="anthropic"
          providerName="Anthropic"
          modelId="claude-sonnet-4"
          email="qa@example.com"
          renderContent={entry.renderContent}
          groupedWithPrevious={index > 0}
          sharedUiThemeVars={{}}
          isLatestMessage={false}
        />
      ))}
    </div>
  ));
}

function Harness() {
  return (
    <main className="compaction-align-harness">
      <h1>压缩胶囊对齐测量</h1>

      <section data-case="compaction">
        <h2>压缩消息（应通栏居中）</h2>
        <div className="chat-message-group" data-role="assistant">
          <MessageRow
            message={makeCompactionMessage('m-compaction')}
            providerId="anthropic"
            providerName="Anthropic"
            modelId="claude-sonnet-4"
            email="qa@example.com"
            renderContent={() => <GenerativeUIRenderer message={compactionCard} />}
            sharedUiThemeVars={{}}
            isLatestMessage={false}
          />
        </div>
      </section>

      <section data-case="normal">
        <h2>普通消息（对照组）</h2>
        <div className="chat-message-group" data-role="assistant">
          <MessageRow
            message={makeNormalMessage('m-normal', '这是一条普通消息，用来对照内容区宽度。')}
            providerId="anthropic"
            providerName="Anthropic"
            modelId="claude-sonnet-4"
            email="qa@example.com"
            renderContent={(message) => <p>{message.content}</p>}
            sharedUiThemeVars={{}}
            isLatestMessage={false}
          />
        </div>
      </section>

      <section data-case="sequence">
        <h2>真实分组：上一条回复 → 压缩提示 → 下一条回复</h2>
        {renderGroups(buildSequenceEntries())}
      </section>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('compaction align harness 缺少 root');
createRoot(root).render(<Harness />);
