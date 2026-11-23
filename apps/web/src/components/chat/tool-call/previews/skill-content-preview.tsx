import { useState } from 'react';
import { ExpandableOutput } from '../shared/expandable-output.js';
import { CopyBtn } from '../shared/copy-btn.js';
import { MarkdownTextPreview } from './markdown-text-preview.js';
import type { SkillContentView } from './skill-content-parser.js';
import './skill-content-preview.css';

export { extractSkillContent } from './skill-content-parser.js';
export type { SkillContentView } from './skill-content-parser.js';

export function SkillContentPreview({ data }: { data: SkillContentView }) {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const isLong = data.content.length > 6000;
  return (
    <div className="skill-content-preview">
      <div className="skill-content-header">
        <span className="skill-content-label">技能内容</span>
        {data.name && <span className="skill-content-name">{data.name}</span>}
        <CopyBtn text={data.content} title="复制技能正文" />
      </div>
      {data.content.length > 0 ? (
        <MarkdownTextPreview
          text={isLong && !expanded ? data.content.slice(0, 6000) : data.content}
        />
      ) : (
        <div className="skill-content-empty">（无内容）</div>
      )}
      {isLong && (
        <button
          type="button"
          className="tool-output-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起技能全文' : '展开技能全文'}
        </button>
      )}
      {data.files.length > 0 && (
        <section className="skill-resource-list" aria-label="技能资源">
          <div className="skill-content-label">资源 · {data.files.length}</div>
          <ul>
            {data.files.map((path, index) => (
              <li key={`${index}:${path}`}>
                <code>{path}</code>
                <CopyBtn text={path} title={`复制资源路径 ${path}`} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <button
        type="button"
        className="tool-output-toggle"
        aria-expanded={showRaw}
        onClick={() => setShowRaw((value) => !value)}
      >
        原始输出
      </button>
      {showRaw && <ExpandableOutput text={data.raw} />}
    </div>
  );
}
