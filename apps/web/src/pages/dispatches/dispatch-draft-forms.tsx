import type {
  DispatchDetail,
  DispatchDraftEdit,
  DispatchDraftInput,
  DispatchItemDraft,
} from '@openAwork/shared';
import { createRandomUuid } from '@openAwork/web-client';
import { useActionState, useId, useState } from 'react';
import { modelDisclosure, roleLabels } from './dispatch-labels.js';
import { dispatchError } from './use-dispatches.js';

export function CreateDispatchForm({
  create,
}: {
  create: (input: DispatchDraftInput) => Promise<void>;
}) {
  const disclosureId = useId();
  const [request, setRequest] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [error, submit, pending] = useActionState(async () => {
    if (!request.trim()) return '请输入派工目标。';
    try {
      await create({ request: request.trim(), excerpt: excerpt.trim() });
      setRequest('');
      setExcerpt('');
      return '';
    } catch (cause) {
      return dispatchError(cause, '无法生成草稿。请先检查派工记录，再重试。');
    }
  }, '');
  return (
    <form action={submit} className="dispatch-stack dispatch-inset" aria-describedby={disclosureId}>
      <h2>新建派工</h2>
      <p id={disclosureId} className="dispatch-disclosure">
        {modelDisclosure}
      </p>
      <label>
        派工目标
        <textarea
          required
          maxLength={3000}
          rows={3}
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          disabled={pending}
        />
      </label>
      <label>
        粘贴文本（选填）
        <textarea
          maxLength={16000}
          rows={6}
          value={excerpt}
          onChange={(event) => setExcerpt(event.target.value)}
          disabled={pending}
        />
      </label>
      <p>仅处理你提交的纯文本。生成草稿后可以调整事项，确认后才会排队。</p>
      {error && (
        <p className="dispatch-error" role="alert">
          {error}
        </p>
      )}
      <div>
        <button className="dispatch-primary" disabled={pending}>
          {pending ? '正在生成草稿…' : '生成草稿'}
        </button>
      </div>
    </form>
  );
}

interface EditableDraft {
  revision: number;
  title: string;
  rows: { key: string; item: DispatchItemDraft }[];
}

function editable(detail: DispatchDetail): EditableDraft {
  return {
    revision: detail.revision,
    title: detail.title,
    rows: detail.draftItems.map((item, index) => ({ key: String(index), item })),
  };
}

function DraftItemFields({
  item,
  index,
  update,
  remove,
  canRemove,
}: {
  item: DispatchItemDraft;
  index: number;
  update: (patch: Partial<DispatchItemDraft>) => void;
  remove: () => void;
  canRemove: boolean;
}) {
  return (
    <fieldset className="dispatch-stack dispatch-draft-item">
      <legend>
        <span className="dispatch-draft-index">事项 {index + 1}</span>
        <span className="dispatch-draft-name">{item.title.trim() || '未命名事项'}</span>
      </legend>
      <label>
        标题
        <input
          required
          maxLength={120}
          value={item.title}
          onChange={(event) => update({ title: event.target.value })}
        />
      </label>
      <label>
        角色
        <select
          value={item.role}
          onChange={(event) => {
            const role = event.target.value;
            if (role === 'summarize' || role === 'extract' || role === 'review') update({ role });
          }}
        >
          {Object.entries(roleLabels).map(([role, label]) => (
            <option key={role} value={role}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        目标
        <textarea
          required
          rows={2}
          maxLength={1200}
          value={item.objective}
          onChange={(event) => update({ objective: event.target.value })}
        />
      </label>
      <label>
        验收条件
        <textarea
          required
          rows={2}
          maxLength={600}
          value={item.acceptance}
          onChange={(event) => update({ acceptance: event.target.value })}
        />
      </label>
      <div className="dispatch-actions dispatch-draft-item-foot">
        <button type="button" className="dispatch-danger" onClick={remove} disabled={!canRemove}>
          移除事项 {index + 1}
        </button>
      </div>
    </fieldset>
  );
}

export function DispatchDraftEditor({
  detail,
  busy,
  enabled,
  save,
  confirm,
}: {
  detail: DispatchDetail;
  busy: boolean;
  enabled: boolean;
  save: (input: DispatchDraftEdit) => Promise<DispatchDetail>;
  confirm: (revision: number) => Promise<DispatchDetail>;
}) {
  const [changes, setChanges] = useState<EditableDraft | null>(null);
  const draft = changes ?? editable(detail);
  const stale = draft.revision !== detail.revision;
  const [saveError, saveAction, saving] = useActionState(async () => {
    const title = draft.title.trim();
    const items = draft.rows.map(({ item }) => ({
      ...item,
      title: item.title.trim(),
      objective: item.objective.trim(),
      acceptance: item.acceptance.trim(),
    }));
    if (!title || items.some((item) => !item.title || !item.objective || !item.acceptance))
      return '标题、目标和验收条件不能为空。';
    try {
      await save({ revision: draft.revision, title, items });
      setChanges(null);
      return '';
    } catch (cause) {
      return dispatchError(cause, '无法保存草稿，请核对最新版本后重试。');
    }
  }, '');
  const [confirmError, confirmAction, confirming] = useActionState(async () => {
    if (changes || !enabled) return '请先保存草稿。';
    try {
      await confirm(detail.revision);
      return '';
    } catch (cause) {
      return dispatchError(cause, '无法确认派工，请核对最新状态后再试。');
    }
  }, '');
  const locked = busy || saving || confirming || !enabled;

  return (
    <div className="dispatch-stack dispatch-editor">
      <form action={saveAction} className="dispatch-stack">
        <fieldset disabled={locked} className="dispatch-stack dispatch-fields">
          <legend>编辑草稿</legend>
          <label>
            派工标题
            <input
              required
              maxLength={120}
              value={draft.title}
              onChange={(event) => setChanges({ ...draft, title: event.target.value })}
            />
          </label>
          {draft.rows.map(({ key, item }, index) => (
            <DraftItemFields
              key={key}
              item={item}
              index={index}
              canRemove={draft.rows.length > 1}
              update={(patch) =>
                setChanges({
                  ...draft,
                  rows: draft.rows.map((row) =>
                    row.key === key ? { ...row, item: { ...row.item, ...patch } } : row,
                  ),
                })
              }
              remove={() =>
                setChanges({ ...draft, rows: draft.rows.filter((row) => row.key !== key) })
              }
            />
          ))}
          <div className="dispatch-actions">
            <button
              type="button"
              disabled={draft.rows.length >= 5}
              onClick={() =>
                setChanges({
                  ...draft,
                  rows: [
                    ...draft.rows,
                    {
                      key: createRandomUuid(),
                      item: { title: '', objective: '', acceptance: '', role: 'summarize' },
                    },
                  ],
                })
              }
            >
              添加事项
            </button>
            <button disabled={!changes || stale}>{saving ? '正在保存…' : '保存草稿'}</button>
            {changes && (
              <button type="button" onClick={() => setChanges(null)}>
                放弃未保存修改
              </button>
            )}
          </div>
        </fieldset>
        {stale && (
          <p role="alert" className="dispatch-error">
            草稿已在别处更新。请先保存所需的本地文本，再放弃未保存修改以载入最新版本。
          </p>
        )}
        {saveError && (
          <p role="alert" className="dispatch-error">
            {saveError}
          </p>
        )}
      </form>
      <form action={confirmAction} className="dispatch-stack dispatch-inset dispatch-confirm">
        <div className="dispatch-confirm-text">
          <strong>确认并进入队列</strong>
          <p>
            {detail.draftItems.length} 个事项将并行执行，可在详情里逐项追问、重试或取消。
            {changes && '请先保存或放弃修改。'}
          </p>
        </div>
        {confirmError && (
          <p role="alert" className="dispatch-error">
            {confirmError}
          </p>
        )}
        <div>
          <button className="dispatch-primary" disabled={locked || changes !== null}>
            {confirming ? '正在确认…' : '确认并派工'}
          </button>
        </div>
      </form>
    </div>
  );
}
