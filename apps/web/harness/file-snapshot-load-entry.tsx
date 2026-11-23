import { createRoot } from 'react-dom/client';
import { FileChangeResultPreview } from '../src/components/chat/tool-call/previews/file-change-result-preview.js';
import { useAuthStore } from '../src/stores/auth/auth.js';
import {
  completeProjection,
  completeResult,
  RELATIVE_PATH,
  truncatedResult,
} from './file-snapshot-load-fixtures.js';
import '../src/index.css';
import '../src/components/chat/message/chat-message.css';

/**
 * 真实组件 + 假网关。
 *
 * harness 连不上真实 gateway，所以把**网络层**（`window.fetch`）挡住：
 * `GET /sessions/:id/file-changes` 返回完整 `fileDiffs[]`，其余请求原样放行。
 * 被测组件、hook、`createSessionsClient`、`matchFileDiff` 全部是生产代码，
 * 只有数据源是假的——这样断言才有意义。
 *
 * 刻意不在组件层注入 loader：`useCompleteFileSnapshot` 内部直接调
 * `createSessionsClient`，绕开它等于测了个替身。
 */

const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.theme = 'carbon';
document.documentElement.dataset.mode = mode;

const SESSION_OK = 'harness-session-ok';
const SESSION_FAIL = 'harness-session-fail';

useAuthStore.setState({
  accessToken: 'harness-token',
  gatewayUrl: window.location.origin,
});

interface HarnessState {
  requests: string[];
}
const harnessState: HarnessState = { requests: [] };
(window as unknown as { __fileSnapshotHarness: HarnessState }).__fileSnapshotHarness = harnessState;

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;
  if (!url.includes('/file-changes')) {
    return originalFetch(input, init);
  }
  harnessState.requests.push(url);
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  // 刻意延迟 120ms：真实网关读磁盘备份文件也不是零延迟，而 runner 需要一个
  // 稳定窗口去观察「加载中…」这个中间态（否则 loading 一帧即过，断言只能靠猜）。
  await new Promise((resolve) => setTimeout(resolve, 120));
  if (url.includes(SESSION_FAIL)) {
    return json({ error: '模拟网关故障：读取文件变更失败' }, 500);
  }
  return json({ fileChanges: completeProjection }, 200);
};

function Harness() {
  return (
    <main className="file-snapshot-harness">
      <h1>文件快照 · 按需加载完整内容</h1>
      <section data-case="truncated-with-session">
        <h2>截断条目 + 有会话上下文（应出现「加载完整内容」按钮，且不自动请求）</h2>
        <div className="chat-message-content" data-role="assistant" data-surface="preview">
          <FileChangeResultPreview result={truncatedResult} sessionId={SESSION_OK} />
        </div>
      </section>
      <section data-case="truncated-no-session">
        <h2>截断条目 + 无会话上下文（不应出现任何加载入口，保持既有提示）</h2>
        <div className="chat-message-content" data-role="assistant" data-surface="preview">
          <FileChangeResultPreview result={truncatedResult} />
        </div>
      </section>
      <section data-case="complete">
        <h2>完整条目（不应出现加载入口，也不应有截断提示）</h2>
        <div className="chat-message-content" data-role="assistant" data-surface="preview">
          <FileChangeResultPreview result={completeResult} sessionId={SESSION_OK} />
        </div>
      </section>
      <section data-case="truncated-load-fails">
        <h2>截断条目 + 网关失败（点击后应给出错误文案与「重试」，按钮不得一直转圈）</h2>
        <div className="chat-message-content" data-role="assistant" data-surface="preview">
          <FileChangeResultPreview result={truncatedResult} sessionId={SESSION_FAIL} />
        </div>
      </section>
      <p data-role="harness-meta" data-path={RELATIVE_PATH} hidden />
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('文件快照 harness 缺少 root');
createRoot(root).render(<Harness />);
