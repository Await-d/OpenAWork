import React, { useState } from 'react';
import { useAuthStore } from '../stores/auth.js';

export default function TranslationPage() {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const [text, setText] = useState('');
  const [targetLang, setTargetLang] = useState('Chinese');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Array<{ id: string; translatedContent: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleTranslate() {
    if (!text.trim() || !token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${gatewayUrl}/workflows/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tasks: [
            {
              id: 't1',
              content: text.trim(),
              fileName: 'input.txt',
              sourceLanguage: 'auto',
              targetLanguage: targetLang,
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as {
        results: Array<{ id: string; translatedContent: string }>;
      };
      setResults(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-root">
      <div className="page-header">
        <span className="page-title">翻译工作流</span>
      </div>
      <div className="page-content" style={{ padding: '1.25rem 1.5rem', overflowY: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 }}>
          <textarea
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="输入要翻译的内容…"
            style={{
              padding: 10,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: 12,
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label htmlFor="target-lang" style={{ fontSize: 12, color: 'var(--text-3)' }}>
              目标语言
            </label>
            <input
              id="target-lang"
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              placeholder="如 Chinese"
              style={{
                padding: 6,
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: 12,
                width: 140,
              }}
            />
            <button
              type="button"
              disabled={loading || !text.trim()}
              onClick={() => void handleTranslate()}
              style={{
                padding: '7px 18px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--accent)',
                color: 'var(--accent-text)',
                fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? '翻译中…' : '开始翻译'}
            </button>
          </div>
          {error && <p style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</p>}
          {results.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {results.map((r) => (
                <div
                  key={r.id}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                  }}
                >
                  <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
                    {r.translatedContent}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
