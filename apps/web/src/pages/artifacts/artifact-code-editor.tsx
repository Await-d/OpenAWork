import React, { lazy, Suspense } from 'react';
import type { ArtifactContentType } from '@openAwork/artifacts';
import { tokens } from '@openAwork/shared-ui';
import { getArtifactEditorLanguage } from './artifact-workbench-utils.js';

const MonacoEditor = lazy(() =>
  import('@monaco-editor/react').then((module) => ({ default: module.default })),
);

interface ArtifactCodeEditorProps {
  content: string;
  type: ArtifactContentType;
  onChange: (value: string) => void;
}

export function ArtifactCodeEditor({ content, type, onChange }: ArtifactCodeEditorProps) {
  return (
    <Suspense
      fallback={
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 320,
            borderRadius: tokens.radius.lg,
            border: `1px solid ${tokens.color.borderSubtle}`,
            color: 'var(--text-3)',
            background: 'color-mix(in oklch, var(--surface) 90%, var(--bg) 10%)',
          }}
        >
          加载编辑器…
        </div>
      }
    >
      <div
        style={{
          minHeight: 320,
          borderRadius: tokens.radius.lg,
          border: `1px solid ${tokens.color.borderSubtle}`,
          overflow: 'hidden',
          background: 'var(--bg)',
        }}
      >
        <MonacoEditor
          height="420px"
          language={getArtifactEditorLanguage(type)}
          value={content}
          theme="vs-dark"
          onChange={(value) => {
            if (value !== undefined) {
              onChange(value);
            }
          }}
          options={{
            fontSize: 12,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            tabSize: 2,
            automaticLayout: true,
          }}
        />
      </div>
    </Suspense>
  );
}
