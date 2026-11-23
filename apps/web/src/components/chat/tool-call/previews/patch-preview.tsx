import { useState } from 'react';
import type { PatchFileView } from '../shared/patch-view.js';
import { hasTruncatedPatchSnapshot } from '../shared/patch-view.js';
import './patch-preview.css';

function PatchFile({ file, fileDiffs }: { file: PatchFileView; fileDiffs?: unknown }) {
  const [open, setOpen] = useState(false);
  const snapshotTruncated = hasTruncatedPatchSnapshot(file, fileDiffs);
  return (
    <details className="patch-preview-file" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span>
          {file.moveTo ? '移动' : { update: '修改', add: '新增', delete: '删除' }[file.action]}
        </span>
        <span className="patch-preview-path">
          {file.path}
          {file.moveTo ? ` → ${file.moveTo}` : ''}
        </span>
        <span className="patch-preview-added">+{file.added}</span>
        <span className="patch-preview-removed">−{file.removed}</span>
      </summary>
      {open && <PatchHunks file={file} />}
      {file.truncated && <p>补丁输入未完整接收，以下仅为可见部分。</p>}
      {snapshotTruncated && <p>结果快照已截断；此处展示请求中的补丁，非完整文件对比。</p>}
    </details>
  );
}

/** 保留原始补丁顺序与上下文锚点，不从片段推算源文件行号。 */
function PatchHunks({ file }: { file: PatchFileView }) {
  const hunks: { anchor: string; lines: string[] }[] = [];
  for (const line of file.lines) {
    if (line.startsWith('@@') || hunks.length === 0) {
      hunks.push({ anchor: line.startsWith('@@') ? line : '', lines: [] });
    }
    if (!line.startsWith('@@')) hunks[hunks.length - 1]!.lines.push(line);
  }
  if (!hunks.length)
    return <p>未提供行级变更{file.action === 'delete' ? '；删除整个文件' : ''}。</p>;
  return hunks.map((hunk, index) => (
    <div key={index} className="patch-preview-hunk">
      <pre>{hunk.anchor || '变更片段'}</pre>
      <pre className="patch-preview-lines" aria-label="补丁变更内容">
        {hunk.lines.map((line, lineIndex) => (
          <span
            key={lineIndex}
            data-kind={
              line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : 'context'
            }
          >
            {line}
            {'\n'}
          </span>
        ))}
      </pre>
    </div>
  ));
}

export function PatchPreview({
  files,
  label,
  fileDiffs,
}: {
  files: PatchFileView[];
  label: string;
  fileDiffs?: unknown;
}) {
  return (
    <div className="patch-preview">
      <p>
        {label} · {files.length} 个文件 · 请求行数{' '}
        <span className="patch-preview-added">
          +{files.reduce((sum, file) => sum + file.added, 0)}
        </span>{' '}
        /{' '}
        <span className="patch-preview-removed">
          −{files.reduce((sum, file) => sum + file.removed, 0)}
        </span>
      </p>
      {files.map((file, index) => (
        <PatchFile key={`${file.path}:${index}`} file={file} fileDiffs={fileDiffs} />
      ))}
    </div>
  );
}
