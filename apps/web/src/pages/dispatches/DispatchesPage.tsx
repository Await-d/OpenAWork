import type { DispatchDetail, DispatchList } from '@openAwork/shared';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuthStore } from '../../stores/auth/auth.js';
import { CreateDispatchForm, DispatchDraftEditor } from './dispatch-draft-forms.js';
import { DispatchItemThread } from './dispatch-item-thread.js';
import { modelDisclosure } from './dispatch-labels.js';
import { DispatchStatusBadge, dispatchProgressLabel } from './dispatch-status-badge.js';
import { useDispatches } from './use-dispatches.js';
import './dispatches-page.css';

function DispatchRecords({
  list,
  previous,
  next,
  pageLoading,
}: {
  list: DispatchList;
  previous?: () => void;
  next?: () => void;
  pageLoading: boolean;
}) {
  return (
    <section className="dispatch-stack dispatch-records-section">
      <div className="dispatch-section-head">
        <h2>派工记录</h2>
        {pageLoading && <span role="status">正在加载派工记录…</span>}
      </div>
      {list.entries.length === 0 ? (
        <p className="dispatch-empty">这一页暂无记录。生成草稿后会出现在这里。</p>
      ) : (
        <ul className="dispatch-records">
          {list.entries.map((entry) => (
            <li key={entry.id}>
              <Link className="dispatch-record" to={`/dispatches/${encodeURIComponent(entry.id)}`}>
                <span className="dispatch-record-main">
                  <strong>{entry.title}</strong>
                  <span className="dispatch-record-progress">
                    {dispatchProgressLabel(entry.status, entry.succeeded, entry.total)}
                  </span>
                </span>
                <DispatchStatusBadge status={entry.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {(previous || list.nextCursor) && (
        <div className="dispatch-actions">
          {previous && (
            <button type="button" onClick={previous}>
              回到最新记录
            </button>
          )}
          {list.nextCursor && (
            <button type="button" onClick={next} disabled={!next}>
              较早记录
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function DispatchContext({ detail }: { detail: DispatchDetail }) {
  return (
    <details className="dispatch-stack dispatch-inset dispatch-note">
      <summary>原始目标与文本</summary>
      <p className="dispatch-text">{detail.request}</p>
      {detail.excerpt && <p className="dispatch-text">{detail.excerpt}</p>}
    </details>
  );
}

function DispatchWorkspace({
  id,
  gatewayUrl,
  email,
}: {
  id: string | undefined;
  gatewayUrl: string;
  email: string | null;
}) {
  const navigate = useNavigate();
  const { list, detail, error, busy, mutate, cursor, setCursor, reload, nextCursor, pageLoading } =
    useDispatches(gatewayUrl, email, id);
  const enabled = list?.enabled === true;
  return (
    <div className="dispatch-page">
      <div className="dispatch-body dispatch-stack">
        <header className="dispatch-stack dispatch-header">
          {id && (
            <Link className="dispatch-back" to="/dispatches">
              返回派工记录
            </Link>
          )}
          <div className="dispatch-title-row">
            <h1>{detail?.title ?? '个人派工'}</h1>
            {detail && <DispatchStatusBadge status={detail.status} />}
          </div>
          {detail ? (
            <>
              <p className="dispatch-meta">
                <span>{dispatchProgressLabel(detail.status, detail.succeeded, detail.total)}</span>
                <span aria-hidden="true">·</span>
                <span>
                  模型 {detail.selection.providerId} / {detail.selection.modelId}
                </span>
              </p>
              <details className="dispatch-note dispatch-disclosure">
                <summary>提交的文本会发送到哪里</summary>
                <p>{modelDisclosure}</p>
              </details>
            </>
          ) : (
            !id && <p className="dispatch-lede">将粘贴的文本拆成只读事项，分别查看结果和追问。</p>
          )}
        </header>
        {list && !enabled && (
          <p role="status" className="dispatch-disclosure">
            当前网关未启用派工。已有记录仍可查看。
          </p>
        )}
        {error && (
          <div className="dispatch-stack">
            <p role="alert" className="dispatch-error">
              {error}
            </p>
            <div>
              <button type="button" onClick={reload} disabled={busy}>
                重新加载
              </button>
            </div>
          </div>
        )}
        {!error && (!list || (id && !detail)) && <p role="status">正在加载派工…</p>}
        {!id && list && (
          <div className="dispatch-overview">
            {enabled && (
              <CreateDispatchForm
                create={async (input) => {
                  await mutate(
                    (api, token) => api.createDraft(token, input),
                    (snapshot) => navigate(`/dispatches/${encodeURIComponent(snapshot.id)}`),
                  );
                }}
              />
            )}
            <DispatchRecords
              list={list}
              pageLoading={pageLoading}
              previous={cursor ? () => setCursor(undefined) : undefined}
              next={nextCursor ? () => setCursor(nextCursor) : undefined}
            />
          </div>
        )}
        {id && detail && <DispatchContext detail={detail} />}
        {id && detail?.status === 'draft' && (
          <DispatchDraftEditor
            detail={detail}
            enabled={enabled}
            busy={busy}
            save={(input) => mutate((api, token) => api.editDraft(token, id, input))}
            confirm={(revision) => mutate((api, token) => api.confirm(token, id, revision))}
          />
        )}
        {id && detail && detail.status !== 'draft' && (
          <section className="dispatch-stack">
            <div className="dispatch-section-head">
              <h2>事项线程</h2>
              <span>{detail.items.length} 个事项</span>
            </div>
            {detail.items.map((item) => (
              <DispatchItemThread
                key={item.id}
                item={item}
                locked={!enabled}
                busy={busy}
                act={(action) => mutate((api, token) => api.act(token, id, item.id, action))}
              />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

export default function DispatchesPage() {
  const { dispatchId } = useParams();
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const email = useAuthStore((state) => state.email);
  return (
    <DispatchWorkspace
      key={JSON.stringify([gatewayUrl, email, dispatchId])}
      gatewayUrl={gatewayUrl}
      email={email}
      id={dispatchId}
    />
  );
}
