import { useState } from 'react';
import { UnifiedCodeDiff } from '@openAwork/shared-ui';
import type { FileChangeResult, FileChangeResultEntry } from '../shared/file-change-result.js';
import { JsonPreview } from './json-preview.js';
import { useCompleteFileSnapshot } from './use-complete-file-snapshot.js';
import './file-change-result-preview.css';

function FileChangeRow({
  file,
  sessionId,
}: {
  file: FileChangeResultEntry;
  sessionId?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const loader = useCompleteFileSnapshot(sessionId);
  // 加载成功后一律以完整快照为准：`before` / `after` 换成全文，`+N/-M` 换成全量统计。
  const fullSnapshot = loader.status === 'loaded' ? loader.snapshot : null;
  const beforeText = fullSnapshot?.before ?? file.before;
  const afterText = fullSnapshot?.after ?? file.after;
  const additions = fullSnapshot?.additions ?? file.additions;
  const deletions = fullSnapshot?.deletions ?? file.deletions;
  // 两侧快照都在就能画差异——哪怕它们是被网关瘦身后的前缀。
  // `incomplete` 只影响「能不能声称这是完整对比」，不应该让用户彻底失去 diff。
  const canRenderDiff = beforeText !== undefined && afterText !== undefined;
  const complete = canRenderDiff && (fullSnapshot !== null || !file.incomplete);
  /*
   * 加载入口的判据是**「拿不到完整对比」本身**（`!complete`），不是 `file.incomplete`。
   *
   * 两者不等价：`edit` 这类工具的结果可能带着可信的全量计数（`+N/−M` 来自网关的
   *
   * `filediff`）却丢了一侧前后文本——此时 `incomplete === false` 而根本画不出 diff。
   * 若仍要求 `incomplete`，用户会卡在「徽标说快照不完整、却没有任何补救按钮」的死局。
   * 没有 `sessionId` 的调用点（team 侧、复制卡、batch 子行）仍保持不渲染。
   */
  const canLoadComplete = !complete && sessionId !== undefined;
  const loading = loader.status === 'loading';
  const loadFailed = loader.status === 'error';
  return (
    <details
      className="file-change-result-file"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>
          {file.moveTo
            ? '移动'
            : { update: '修改', add: '新增', delete: '删除', move: '移动' }[file.action]}
        </span>
        <span className="file-change-result-path">
          {file.path}
          {file.moveTo ? ` → ${file.moveTo}` : ''}
        </span>
        {additions !== undefined && <span className="file-change-result-add">+{additions}</span>}
        {deletions !== undefined && <span className="file-change-result-delete">−{deletions}</span>}
      </summary>
      {!canRenderDiff && !loading && !loadFailed && (
        <p>内容可能已截断或缺少一侧，无法展示完整文件对比。请查看原始结果。</p>
      )}
      {canRenderDiff && !complete && (
        <p className="file-change-result-partial">
          {/*
           * 这里只说**差异范围**，不再重复一句「快照不完整」——
           * 标题行曾经挂着一枚同名徽标，同一屏幕两遍、且没有任何可操作信息，已移除。
           */}
          {file.omittedChars
            ? `快照被截断 · 省略 ${file.omittedChars} 字符，以下仅对比已保留的前段内容`
            : '以下仅对比已保留的前段内容'}
        </p>
      )}
      {canLoadComplete && !complete && (
        <div className="file-change-result-load">
          {loadFailed ? (
            <>
              <span className="file-change-result-load-error" role="alert">
                {loader.error ?? '加载完整内容失败'}
              </span>
              <button
                type="button"
                className="file-change-result-load-btn"
                onClick={() => loader.load(file.path)}
              >
                重试
              </button>
            </>
          ) : (
            <button
              type="button"
              className="file-change-result-load-btn"
              disabled={loading}
              aria-busy={loading}
              onClick={() => loader.load(file.path)}
            >
              {loading
                ? '加载中…'
                : file.omittedChars
                  ? `加载完整内容（省略 ${file.omittedChars} 字符）`
                  : '加载完整内容'}
            </button>
          )}
        </div>
      )}
      {open && canRenderDiff && (
        <UnifiedCodeDiff
          beforeText={beforeText}
          afterText={afterText}
          filePath={file.moveTo ?? file.path}
          chrome="minimal"
          hideHeader
          maxHeight={320}
          viewMode="unified"
        />
      )}
    </details>
  );
}

export function FileChangeResultPreview({
  result,
  sessionId,
}: {
  result: FileChangeResult;
  /**
   * 当前消息所属会话 id。仅用于「按需加载完整文件快照」——
   * 缺省时该入口整体隐藏，其余渲染行为与不带此参数时完全一致。
   */
  sessionId?: string | undefined;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  return (
    <div className="file-change-result">
      <p data-result-success={result.success}>
        变更结果 · {result.files.length} 个文件 · {result.success ? '结果报告成功' : '结果报告失败'}
      </p>
      {result.files.length === 0 && <p>结果中没有文件变更。</p>}
      {result.files.map((file, index) => (
        <FileChangeRow key={`${file.path}:${index}`} file={file} sessionId={sessionId} />
      ))}
      <details
        className="file-change-result-raw"
        onToggle={(event) => setRawOpen(event.currentTarget.open)}
      >
        <summary>原始结果</summary>
        {rawOpen && <JsonPreview data={result.raw} />}
      </details>
    </div>
  );
}
