import { buildToolFailureView, TOOL_FAILURE_CATEGORY_LABEL } from '../shared/tool-failure-view.js';
import { LazyPreviewCopy } from './bounded-preview.js';
import './tool-failure-preview.css';

/**
 * 结构化失败卡：工具调用失败时替换「一坨无结构原文」的展开体。
 *
 * 三层信息，越往下越完整：
 * 1. 标题行：分类标签 + 一句话结论（折叠态 / 展开态都看得到）；
 * 2. 字段区：解析出来的「路径 / 原因 / 建议 / 工作区 / 错误码」；
 * 3. 底部：「复制错误详情」+「原始输出」——**任何没被解析到的部分都能在这里看到**，
 *    这条兜底是硬约束，不允许为了好看把原文裁掉。
 *
 * 认不出形态（`kind: 'plain'`）时只渲染标题行 + 原始输出，不硬凑字段。
 */

/** 这些字段的值是「精确值」，用等宽渲染更便于逐字核对（路径尤其容易看错字符）。 */
const MONO_FIELD_LABELS = new Set(['路径', '工作区', '错误码', '操作']);

export function ToolFailurePreview({
  output,
  isError = true,
}: {
  output: unknown;
  isError?: boolean;
}) {
  const view = buildToolFailureView(output, isError);
  if (!view) return null;

  // `structured` 一定有分类；`plain` 只有已知的 guard 形态才带分类。
  const category = view.category;
  const label = category ? TOOL_FAILURE_CATEGORY_LABEL[category] : null;
  const structured = view.kind === 'structured';

  return (
    <div
      className="tool-failure-card"
      data-failure-kind={view.kind}
      data-failure-category={category ?? 'unknown'}
    >
      <div className="tool-failure-head">
        <span className="tool-failure-badge" aria-hidden="true">
          ✗
        </span>
        {label && <span className="tool-failure-label">{label}</span>}
        <span className="tool-failure-headline">{view.headline}</span>
      </div>

      {structured && (view.fields.length > 0 || view.suggestion) && (
        <dl className="tool-failure-fields">
          {view.fields.map((field) => (
            <div className="tool-failure-field" key={field.label}>
              <dt>{field.label}</dt>
              <dd>
                {MONO_FIELD_LABELS.has(field.label) ? <code>{field.value}</code> : field.value}
              </dd>
            </div>
          ))}
          {view.suggestion && (
            <div className="tool-failure-field" data-field="suggestion">
              <dt>建议</dt>
              <dd>{view.suggestion}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="tool-failure-foot">
        {structured && <LazyPreviewCopy data={view.raw} />}
        <details className="tool-failure-raw">
          <summary>原始输出</summary>
          <pre className="tool-failure-raw-body">{view.raw}</pre>
        </details>
      </div>
    </div>
  );
}
