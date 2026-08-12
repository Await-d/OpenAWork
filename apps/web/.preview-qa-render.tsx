import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PendingQuestionRequest } from '@openAwork/web-client';
import { InlineQuestionPanel } from './src/components/chat/misc/InlineQuestionPanel.js';
import QuestionPromptCard from './src/components/common/display/QuestionPromptCard.js';

const request = {
  requestId: 'preview-qa',
  sessionId: 'preview-session',
  toolName: 'AskUserQuestion',
  title: '选择实现方式',
  status: 'pending',
  createdAt: '2026-08-09T00:00:00.000Z',
  questions: [
    {
      header: '实现方案',
      question: '你希望采用哪种预览呈现方式？',
      multiple: false,
      options: [
        {
          label: '纯文本预览',
          description: '安全显示代码、图表或配置片段。',
          preview: 'const enabled = true;\n// Preview remains text, never executable HTML.',
        },
        {
          label: '仅文字说明',
          description: '保留紧凑的选项说明。',
        },
      ],
    },
  ],
} satisfies PendingQuestionRequest;

const baseDocument = (body: string): string => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Question preview visual QA</title>
    <style>
      :root {
        --bg-base: #080b12;
        --bg-overlay: #121721;
        --bg-surface: #171d29;
        --bg-hover: #232d40;
        --fg-strong: #f1f4f8;
        --fg-default: #c8d1e0;
        --fg-muted: #7b8a9e;
        --fg-on-accent: #052e22;
        --accent: #5cd4c0;
        --danger: #f06b7e;
        --border-subtle: hsla(215, 20%, 50%, 0.07);
        --border-default: hsla(215, 18%, 50%, 0.12);
        --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
        --shadow-lg: 0 24px 56px -16px rgba(0, 0, 0, 0.5);
        --font-mono: 'JetBrains Mono', Consolas, monospace;
      }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; background: var(--bg-base); color: var(--fg-default); font-family: Inter, system-ui, sans-serif; }
    </style>
  </head>
  <body>${body}</body>
</html>`;

const outputDirectory = resolve(import.meta.dirname, '../../.omo/evidence/tool-preview-qa');
const questionCard = renderToStaticMarkup(
  <QuestionPromptCard
    answers={[['纯文本预览']]}
    request={request}
    onDismiss={() => undefined}
    onSubmit={() => undefined}
    onToggleOption={() => undefined}
  />,
);
const inlinePanel = renderToStaticMarkup(
  <InlineQuestionPanel
    answers={[['纯文本预览']]}
    customInputs={['']}
    request={request}
    onDismiss={() => undefined}
    onSubmit={() => undefined}
    onToggleOption={() => undefined}
    onCustomInputChange={() => undefined}
  />,
);

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, 'question-prompt-card.html'), baseDocument(questionCard)),
  writeFile(resolve(outputDirectory, 'inline-question-panel.html'), baseDocument(inlinePanel)),
]);
