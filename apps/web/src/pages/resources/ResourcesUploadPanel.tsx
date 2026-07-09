import { UPLOAD_RESOURCE_AREAS } from './resource-center-utils.js';
import type { UploadFormState } from './resources-page-form.js';

interface ResourcesUploadPanelProps {
  readonly formAction: (formData: FormData) => void;
  readonly formState: UploadFormState;
  readonly isBusy: boolean;
}

export function ResourcesUploadPanel({ formAction, formState, isBusy }: ResourcesUploadPanelProps) {
  return (
    <aside className="resources-upload-panel resources-panel" aria-label="上传资源">
      <div className="resources-panel-heading">
        <span>追加上传</span>
        <h2>保存为用户资源</h2>
        <p>上传后立即刷新识别；选择通道人设或模板时会进入功能专用区。</p>
      </div>
      <form action={formAction} className="resources-form">
        <label>
          类型
          <select name="area" defaultValue="prompts">
            {UPLOAD_RESOURCE_AREAS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          名称
          <input name="name" required maxLength={120} placeholder="daily-summary" />
        </label>
        <label>
          标题
          <input name="title" required maxLength={160} placeholder="每日总结" />
        </label>
        <label>
          描述
          <input name="description" maxLength={400} placeholder="用于会话上下文的参考模板" />
        </label>
        <label>
          内容
          <textarea name="content" required maxLength={20000} rows={10} />
        </label>
        <button type="submit" className="resources-primary-button" disabled={isBusy}>
          {isBusy ? '上传中' : '上传并识别'}
        </button>
        {formState.message ? (
          <p
            className={
              formState.status === 'saved'
                ? 'resources-form-message saved'
                : 'resources-form-message'
            }
          >
            {formState.message}
          </p>
        ) : null}
      </form>
    </aside>
  );
}
