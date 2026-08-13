import React from 'react';
import { AssistantErrorContent } from './assistant-error-content-v2.js';
import '../message/chat-message-error.css';

/**
 * 错误展示演示页面
 * 用于预览各种错误场景的展示效果
 */
export function ErrorDisplayDemo() {
  const errorExamples = [
    {
      title: 'MODEL_ERROR - 模型服务错误',
      content:
        '[错误: MODEL_ERROR] Failed after 4 attempts. Last error: AI_APICallError: Service Unavailable',
      canRetry: true,
    },
    {
      title: '超时错误',
      content: '[错误: TIMEOUT] Request timeout after 30s',
      canRetry: true,
    },
    {
      title: '限流错误',
      content: '[错误: RATE_LIMIT] Too many requests, please try again later',
      canRetry: true,
    },
    {
      title: '认证错误',
      content: '[错误: AUTH_ERROR] Authentication failed - invalid token',
      canRetry: false,
    },
    {
      title: '上下文过长',
      content:
        '[错误: CONTEXT_LENGTH] Maximum context length exceeded. Please start a new conversation.',
      canRetry: false,
    },
    {
      title: '网络错误',
      content: '[错误: NETWORK_ERROR] Failed to connect to server',
      canRetry: true,
    },
  ];

  return (
    <div style={{ padding: 40, maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 32, fontSize: 24, fontWeight: 700 }}>错误展示优化 - 演示页面</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {errorExamples.map((example, index) => (
          <div key={index}>
            <h3 style={{ marginBottom: 12, fontSize: 14, color: 'var(--fg-muted)' }}>
              {example.title}
            </h3>
            <AssistantErrorContent
              content={example.content}
              onRetry={example.canRetry ? () => console.log('重试:', example.title) : undefined}
            />
          </div>
        ))}
      </div>

      <div
        style={{ marginTop: 48, padding: 24, background: 'var(--bg-overlay)', borderRadius: 10 }}
      >
        <h2 style={{ marginBottom: 16, fontSize: 18, fontWeight: 650 }}>优化要点</h2>
        <ul style={{ paddingLeft: 20, lineHeight: 1.8 }}>
          <li>✅ 将技术性错误转换为用户友好的描述</li>
          <li>✅ 增加视觉层次和错误图标</li>
          <li>✅ 提供具体的解决建议</li>
          <li>✅ 根据错误类型智能显示/隐藏重试按钮</li>
          <li>✅ 长文本支持展开/折叠</li>
          <li>✅ 改进动画和交互反馈</li>
          <li>✅ 增强无障碍支持</li>
        </ul>
      </div>
    </div>
  );
}
