import React, { useState } from 'react';
import { useAuthStore } from '../stores/auth.js';

export default function PromptOptimizerPage() {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const [prompt, setPrompt] = useState('');
  const [context, setContext] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<null | {
    originalPrompt: string;
    candidates: Array<{ id: string; text: string; improvements: string[] }>;
    recommended: string;
    rationale: string;
  }>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleOptimize() {
    if (!prompt.trim() || !token) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const resp = await fetch(`${gatewayUrl}/workflows/optimize-prompt`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalPrompt: prompt.trim(),
          context: context.trim() || undefined,
        }),
      });
      if (!resp.ok) throw new Error(`Server error: ${resp.status}`);
      setResult(await resp.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-root">
      <div className="page-header">
        <span className="page-title">Prompt 优化器</span>
      </div>
      <div className="page-content" style={{ padding: '1.25rem 1.5rem', overflowY: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            placeholder="输入原始 Prompt…"
            style={{
              width: '100%',
              padding: 10,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: 12,
              resize: 'vertical',
            }}
          />
          <input
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="可选：上下文说明 / 背景"
            style={{
              padding: 8,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: 12,
            }}
          />
          <button
            type="button"
            disabled={loading || !prompt.trim()}
            onClick={() => void handleOptimize()}
            style={{
              alignSelf: 'flex-start',
              padding: '8px 18px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--accent-text)',
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? '优化中…' : '开始优化'}
          </button>
          {error && <p style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</p>}
          {result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
              <p style={{ fontSize: 12, color: 'var(--text-3)' }}>{result.rationale}</p>
              {result.candidates.map((c) => (
                <div
                  key={c.id}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 10,
                    border:
                      c.id === result.recommended
                        ? '2px solid var(--accent)'
                        : '1px solid var(--border)',
                    background: 'var(--surface)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {c.id === result.recommended && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>
                        推荐
                      </span>
                    )}
                    <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', flex: 1 }}>
                      {c.text}
                    </pre>
                  </div>
                  {c.improvements.length > 0 && (
                    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {c.improvements.map((improvement) => (
                        <span
                          key={improvement}
                          style={{
                            fontSize: 11,
                            padding: '2px 7px',
                            borderRadius: 999,
                            background: 'var(--bg-2)',
                            color: 'var(--text-3)',
                            border: '1px solid var(--border-subtle)',
                          }}
                        >
                          {improvement}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
