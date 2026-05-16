import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  createArtifactsClient,
  createSessionsClient,
  createWorkflowsClient,
} from '@openAwork/web-client';
import type { ArtifactRecord } from '@openAwork/artifacts';
import { useAuthStore } from '../stores/auth.js';
import { ChatImageGenerationControls } from '../components/chat/ChatImageGenerationControls.js';
import { useChatImageGeneration } from './chat-page/use-chat-image-generation.js';
import {
  toImageEditReferenceArtifacts,
  type ImageEditReferenceArtifact,
} from '../components/session-conversation/runtime/image-edit-reference-artifacts.js';
import { uploadChatAttachments } from '../components/session-conversation/runtime/attachment-upload.js';
import {
  loadSavedChatSessionDefaults,
  type ChatSettingsProvider,
} from '../utils/chat-session-defaults.js';
import { logger } from '../utils/logger.js';

interface SessionArtifactsResponse {
  contentArtifacts?: ArtifactRecord[];
}

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
  flex: 1,
  minHeight: 0,
  background: 'var(--bg)',
  color: 'var(--text)',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 24px',
  borderBottom: '1px solid var(--border-subtle)',
  gap: 12,
  flexWrap: 'wrap',
};

const bodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  flex: 1,
  minHeight: 0,
};

const sidebarStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: 320,
  minWidth: 320,
  borderRight: '1px solid var(--border-subtle)',
  background: 'var(--surface)',
  minHeight: 0,
};

const sidebarScrollStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  padding: '24px 20px',
};

const mainAreaStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  background: 'var(--bg)',
  position: 'relative',
};

const canvasContainerStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 32,
  overflow: 'hidden',
  position: 'relative',
  background: 'var(--bg)',
};

const historyStripStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '12px 24px',
  borderTop: '1px solid var(--border-subtle)',
  background: 'var(--surface)',
  zIndex: 10,
};

const promptAreaStyle: CSSProperties = {
  width: '100%',
  minHeight: 140,
  resize: 'vertical',
  borderRadius: 12,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface)',
  color: 'var(--text)',
  padding: '12px 14px',
  fontSize: 14,
  lineHeight: 1.6,
  fontFamily: 'inherit',
};

const primaryButtonStyle: CSSProperties = {
  border: 'none',
  borderRadius: 10,
  padding: '0.7rem 1.1rem',
  background: 'var(--accent)',
  color: 'var(--accent-text)',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
};

const secondaryButtonStyle: CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  padding: '0.5rem 0.9rem',
  background: 'transparent',
  color: 'var(--text)',
  cursor: 'pointer',
  fontWeight: 500,
  fontSize: 12,
};

const sectionLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-3)',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

interface LatestResult {
  artifactId: string;
  imageUrl: string;
  prompt: string;
  revisedPrompt: string | null;
  size: string;
  quality: string;
  outputFormat: string;
}

export default function ImagesPage() {
  const navigate = useNavigate();
  const params = useParams<{ sessionId?: string }>();
  const routeSessionId = params.sessionId ?? null;
  const { gatewayUrl, accessToken } = useAuthStore();

  const [providers, setProviders] = useState<ChatSettingsProvider[]>([]);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [sessionArtifacts, setSessionArtifacts] = useState<ImageEditReferenceArtifact[]>([]);
  const [selectedReferenceId, setSelectedReferenceId] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingFilePreview, setPendingFilePreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [latestResult, setLatestResult] = useState<LatestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const [artifactsRefreshKey, setArtifactsRefreshKey] = useState(0);
  const [optimizing, setOptimizing] = useState(false);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasAppliedSavedImageDefaultsRef = useRef(false);
  const sessionCreationInFlightRef = useRef(false);
  // Track in-flight optimize via ref so the callback identity stays
  // stable across renders (avoids re-running effects that depend on
  // handleOptimizePrompt every time the boolean flips).
  const optimizingRef = useRef(false);

  const {
    applySavedImageDefaults,
    generateImageForSession,
    hasConfiguredImageModel,
    imageGenerationBusy,
    imageGenerationDefaults,
    imageModelLabel,
    imagePluginEnabled,
    imagePluginLoaded,
    updateImageGenerationDefaults,
  } = useChatImageGeneration({
    gatewayUrl,
    providers,
    token: accessToken,
  });

  // 一次性载入设置页保存的 providers 与图片默认值。
  // 切会话时不再重复 apply，避免覆盖用户在本页面调好的参数。
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    void loadSavedChatSessionDefaults(gatewayUrl, accessToken)
      .then(({ providers: loadedProviders, imageDefaults }) => {
        if (cancelled) return;
        setProviders(loadedProviders);
        if (!hasAppliedSavedImageDefaultsRef.current) {
          applySavedImageDefaults(imageDefaults);
          hasAppliedSavedImageDefaultsRef.current = true;
        }
      })
      .catch((err) => {
        if (!cancelled) {
          logger.error('Failed to load image workbench defaults', err);
        }
      })
      .finally(() => {
        if (!cancelled) setProvidersLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, applySavedImageDefaults, gatewayUrl]);

  // 没有 sessionId 时为图片工作台创建一个独立 session 并跳转，
  // 用 metadata.imageWorkbench=true 标记，使会话列表/分析侧能识别。
  useEffect(() => {
    if (routeSessionId || !accessToken || !providersLoaded) return;
    if (sessionCreationInFlightRef.current) return;
    sessionCreationInFlightRef.current = true;
    setCreatingSession(true);
    void (async () => {
      try {
        const session = await createSessionsClient(gatewayUrl).create(accessToken, {
          title: '图片工作台',
          metadata: { imageWorkbench: true },
        });
        navigate(`/images/${session.id}`, { replace: true });
      } catch (err) {
        logger.error('Failed to create image workbench session', err);
        setError(err instanceof Error ? err.message : '无法创建图片工作台会话');
        sessionCreationInFlightRef.current = false;
      } finally {
        setCreatingSession(false);
      }
    })();
  }, [accessToken, gatewayUrl, navigate, providersLoaded, routeSessionId]);

  // 拉取所有「图片工作台」session 下生成/上传的图片产物，跨会话聚合作为
  // 历史画廊与「作为参考继续编辑」素材；普通 chat session 的产物不会出现在这里。
  useEffect(() => {
    if (!accessToken) {
      setSessionArtifacts([]);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    void createArtifactsClient(gatewayUrl)
      .listImageWorkbench(accessToken, {
        type: 'image',
        limit: 200,
        signal: controller.signal,
      })
      .then((rawPayload) => {
        if (cancelled) return;
        const payload = rawPayload as SessionArtifactsResponse;
        setSessionArtifacts(toImageEditReferenceArtifacts(payload.contentArtifacts ?? []));
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setSessionArtifacts([]);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accessToken, artifactsRefreshKey, gatewayUrl]);

  // 上传文件预览的 object URL 生命周期管理。
  useEffect(() => {
    if (!pendingFile) {
      setPendingFilePreview(null);
      return;
    }
    const url = URL.createObjectURL(pendingFile);
    setPendingFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  const selectedReferenceArtifact = useMemo(
    () => sessionArtifacts.find((artifact) => artifact.artifactId === selectedReferenceId) ?? null,
    [sessionArtifacts, selectedReferenceId],
  );

  const submitDisabled =
    imageGenerationBusy ||
    creatingSession ||
    !routeSessionId ||
    !accessToken ||
    !hasConfiguredImageModel ||
    prompt.trim().length === 0;

  const handlePickFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (file && !file.type.startsWith('image/')) {
      setError('参考图必须是图片文件。');
      event.target.value = '';
      return;
    }
    setError(null);
    setPendingFile(file);
    if (file) {
      // 选了新上传图片就清掉历史中的选中项，避免一次给两张参考。
      setSelectedReferenceId(null);
    }
    event.target.value = '';
  }, []);

  const handleClearReference = useCallback(() => {
    setSelectedReferenceId(null);
    setPendingFile(null);
  }, []);

  const handleSelectHistoryReference = useCallback((artifactId: string | null) => {
    setSelectedReferenceId(artifactId);
    if (artifactId) {
      // 选了历史图，就清掉本地暂存的文件。
      setPendingFile(null);
    }
  }, []);

  const handleNewWorkbench = useCallback(() => {
    sessionCreationInFlightRef.current = false;
    setSelectedReferenceId(null);
    setPendingFile(null);
    setPrompt('');
    setLatestResult(null);
    setError(null);
    setPromptHistory([]);
    navigate('/images');
  }, [navigate]);

  const handleOptimizePrompt = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || optimizingRef.current || !accessToken) return;
    optimizingRef.current = true;
    setOptimizing(true);
    setError(null);
    try {
      const client = createWorkflowsClient(gatewayUrl);
      const result = await client.optimizePrompt(accessToken, {
        originalPrompt: trimmed,
        // 给优化器一个图像生成场景的上下文，让它优先补充视觉细节
        // 而非套用「角色/技能/输出格式」那套对话型 LangGPT 模板。
        context:
          '用于 AI 图像生成的视觉描述提示词。请补充构图、镜头、光影、风格、媒介、色彩、情绪等可视化细节；保持原意；不要使用「角色/技能/输出格式」等结构化对话模板；输出与原文同语言。',
        candidateCount: 3,
      });
      if (!result.candidates || result.candidates.length === 0) {
        throw new Error('优化器没有返回任何候选项');
      }
      const recommended =
        result.candidates.find((candidate) => candidate.id === result.recommended) ??
        result.candidates[0];
      if (!recommended || !recommended.text) {
        throw new Error('优化器返回的候选项内容为空');
      }
      // Multi-level history: each optimize call pushes the current
      // prompt onto the stack so consecutive optimizes can be undone
      // step by step. Manual edits clear the stack to avoid reverting
      // to a stale baseline.
      setPromptHistory((prev) => [...prev, trimmed]);
      setPrompt(recommended.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : '优化提示词失败，请稍后重试。');
    } finally {
      optimizingRef.current = false;
      setOptimizing(false);
    }
  }, [accessToken, gatewayUrl, prompt]);

  const handleRevertOptimize = useCallback(() => {
    setPromptHistory((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      const restored = prev[prev.length - 1]!;
      setPrompt(restored);
      return next;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submitDisabled || !routeSessionId || !accessToken) return;
    setError(null);

    try {
      let inputArtifacts:
        | Array<{ artifactId: string; fileName?: string; mimeType?: string }>
        | undefined;

      if (selectedReferenceArtifact) {
        inputArtifacts = [
          {
            artifactId: selectedReferenceArtifact.artifactId,
            ...(selectedReferenceArtifact.fileName
              ? { fileName: selectedReferenceArtifact.fileName }
              : {}),
            ...(selectedReferenceArtifact.mimeType
              ? { mimeType: selectedReferenceArtifact.mimeType }
              : {}),
          },
        ];
      } else if (pendingFile) {
        const uploaded = await uploadChatAttachments({
          files: [pendingFile],
          gatewayUrl,
          sessionId: routeSessionId,
          token: accessToken,
        });
        inputArtifacts = uploaded
          .filter((attachment) => attachment.type === 'image')
          .map((attachment) => ({
            artifactId: attachment.artifactId,
            ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
            ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
          }));
        if (inputArtifacts.length === 0) {
          throw new Error('参考图上传失败，请稍后重试。');
        }
      }

      const payload = await generateImageForSession({
        ...(inputArtifacts && inputArtifacts.length > 0 ? { inputArtifacts } : {}),
        prompt: prompt.trim(),
        sessionId: routeSessionId,
      });

      // 拉一遍最新的 artifact 拿 dataUrl 作为预览（接口返回里只有 id+title）。
      setArtifactsRefreshKey((value) => value + 1);
      setLatestResult({
        artifactId: payload.artifact.id,
        imageUrl: '',
        prompt: prompt.trim(),
        revisedPrompt: payload.revisedPrompt,
        size: payload.parameters.size,
        quality: payload.parameters.quality,
        outputFormat: payload.parameters.outputFormat,
      });
      setPendingFile(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : '图片生成失败，请稍后重试。';
      setError(message);
    }
  }, [
    accessToken,
    gatewayUrl,
    generateImageForSession,
    pendingFile,
    prompt,
    routeSessionId,
    selectedReferenceArtifact,
    submitDisabled,
  ]);

  // latestResult 创建后，从拉到的 artifacts 里补上 dataUrl 用作预览。
  useEffect(() => {
    if (!latestResult || latestResult.imageUrl) return;
    const matched = sessionArtifacts.find(
      (artifact) => artifact.artifactId === latestResult.artifactId,
    );
    if (matched?.imageUrl) {
      setLatestResult((prev) => (prev ? { ...prev, imageUrl: matched.imageUrl ?? '' } : prev));
    }
  }, [latestResult, sessionArtifacts]);

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: 'var(--text)' }}>
            图片工作台
          </h1>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {imagePluginLoaded && !imagePluginEnabled
              ? '图片生成插件未启用，请前往 设置 → 插件 中开启。'
              : hasConfiguredImageModel
                ? `当前模型：${imageModelLabel || '未命名'}`
                : '未配置可用图片模型，请在 设置 → 提供商 中启用支持图片生成的模型。'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" style={secondaryButtonStyle} onClick={handleNewWorkbench}>
            新建工作台
          </button>
        </div>
      </header>

      <div style={bodyStyle}>
        <aside style={sidebarStyle}>
          <div style={sidebarScrollStyle}>
            <ChatImageGenerationControls
              busy={imageGenerationBusy}
              disabled={!hasConfiguredImageModel || creatingSession}
              hasConfiguredModel={hasConfiguredImageModel}
              imageDefaults={imageGenerationDefaults}
              imageMode={true}
              imageModelLabel={imageModelLabel}
              imagePluginEnabled={imagePluginEnabled}
              referenceArtifacts={sessionArtifacts.map((artifact) => ({
                artifactId: artifact.artifactId,
                ...(artifact.fileName ? { fileName: artifact.fileName } : {}),
                title: artifact.title,
              }))}
              selectedReferenceArtifactId={selectedReferenceId}
              onSelectReferenceArtifactId={handleSelectHistoryReference}
              onToggleImageMode={() => undefined}
              onUpdateImageDefaults={updateImageGenerationDefaults}
              variant="panel"
            />

            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span style={sectionLabelStyle}>提示词</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {promptHistory.length > 0 && !optimizing && (
                    <button
                      type="button"
                      onClick={handleRevertOptimize}
                      title={
                        promptHistory.length > 1
                          ? `恢复上一次优化前的版本（剩余 ${promptHistory.length} 步）`
                          : '恢复优化前的版本'
                      }
                      style={{
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 6,
                        padding: '2px 8px',
                        background: 'transparent',
                        color: 'var(--text-3)',
                        cursor: 'pointer',
                        fontSize: 11,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3 7v6h6" />
                        <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
                      </svg>
                      撤销
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleOptimizePrompt()}
                    disabled={optimizing || prompt.trim().length === 0 || !accessToken}
                    title="使用 LLM 补充视觉细节、风格、光影等描述"
                    style={{
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 6,
                      padding: '2px 8px',
                      background: optimizing
                        ? 'transparent'
                        : 'color-mix(in oklch, var(--accent) 12%, transparent)',
                      color: optimizing
                        ? 'var(--text-3)'
                        : 'color-mix(in oklch, var(--accent) 80%, white 20%)',
                      cursor: optimizing || prompt.trim().length === 0 ? 'not-allowed' : 'pointer',
                      fontSize: 11,
                      fontWeight: 500,
                      opacity: prompt.trim().length === 0 ? 0.5 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    {optimizing ? (
                      <>
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            border: '1.5px solid currentColor',
                            borderTopColor: 'transparent',
                            animation: 'spin 0.8s linear infinite',
                            display: 'inline-block',
                          }}
                        />
                        优化中…
                      </>
                    ) : (
                      <>
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
                        </svg>
                        优化提示词
                      </>
                    )}
                  </button>
                </div>
              </div>
              <textarea
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  // 手动编辑则丢掉优化史：倒退到一个已被人工覆盖过的版本会让用户迷惑。
                  if (promptHistory.length > 0) setPromptHistory([]);
                }}
                placeholder="描述你想要生成或编辑的图片..."
                style={promptAreaStyle}
                disabled={imageGenerationBusy || optimizing}
              />
            </section>

            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={sectionLabelStyle}>参考图（可选）</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div
                  style={{
                    width: '100%',
                    height: 120,
                    borderRadius: 10,
                    border: '1px dashed var(--border-subtle)',
                    background: 'var(--bg)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    color: 'var(--text-3)',
                    fontSize: 11,
                    textAlign: 'center',
                    position: 'relative',
                  }}
                >
                  {selectedReferenceArtifact?.imageUrl ? (
                    <img
                      src={selectedReferenceArtifact.imageUrl}
                      alt={selectedReferenceArtifact.title}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  ) : pendingFilePreview ? (
                    <img
                      src={pendingFilePreview}
                      alt={pendingFile?.name ?? '上传的参考图'}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  ) : (
                    <span>未选参考图</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                  <button
                    type="button"
                    style={{ ...secondaryButtonStyle, flex: 1 }}
                    onClick={handlePickFile}
                  >
                    上传参考图
                  </button>
                  {(selectedReferenceArtifact || pendingFile) && (
                    <button
                      type="button"
                      style={{ ...secondaryButtonStyle, flex: 1 }}
                      onClick={handleClearReference}
                    >
                      清除参考图
                    </button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={handleFileChange}
                  />
                </div>
              </div>
            </section>

            {error && (
              <div
                role="alert"
                style={{
                  padding: '0.6rem 0.8rem',
                  borderRadius: 8,
                  background: 'var(--danger-muted, oklch(0.95 0.04 25))',
                  color: 'var(--danger)',
                  fontSize: 12,
                }}
              >
                {error}
              </div>
            )}
          </div>

          <div
            style={{
              padding: '16px 20px',
              borderTop: '1px solid var(--border-subtle)',
              background: 'var(--surface)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitDisabled}
              style={{
                ...primaryButtonStyle,
                width: '100%',
                padding: '0.8rem 1rem',
                fontSize: 14,
                opacity: submitDisabled ? 0.55 : 1,
                cursor: submitDisabled ? 'not-allowed' : 'pointer',
                boxShadow: submitDisabled ? 'none' : '0 2px 8px oklch(0.5 0.15 260 / 0.25)',
              }}
            >
              {imageGenerationBusy
                ? '生成中…'
                : selectedReferenceArtifact || pendingFile
                  ? '基于参考图生成'
                  : '生成图片'}
            </button>
            {creatingSession && (
              <span style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
                正在初始化工作台会话…
              </span>
            )}
          </div>
        </aside>

        <main style={mainAreaStyle}>
          <div style={canvasContainerStyle}>
            {latestResult ? (
              latestResult.imageUrl ? (
                <>
                  <img
                    src={latestResult.imageUrl}
                    alt={latestResult.prompt}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain',
                      borderRadius: 4,
                      boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 24,
                      left: 24,
                      right: 24,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      padding: 16,
                      background: 'var(--surface)',
                      borderRadius: 12,
                      border: '1px solid var(--border-subtle)',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                      maxWidth: 600,
                      margin: '0 auto',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>
                        {`${latestResult.size} · ${latestResult.quality.toUpperCase()} · ${latestResult.outputFormat.toUpperCase()}`}
                      </span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          style={{
                            ...secondaryButtonStyle,
                            padding: '0.3rem 0.6rem',
                            fontSize: 11,
                          }}
                          onClick={() => handleSelectHistoryReference(latestResult.artifactId)}
                        >
                          作为参考
                        </button>
                        <button
                          type="button"
                          style={{
                            ...secondaryButtonStyle,
                            padding: '0.3rem 0.6rem',
                            fontSize: 11,
                          }}
                          onClick={() => navigate('/artifacts')}
                        >
                          在产物中心查看
                        </button>
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: 'var(--text)',
                        lineHeight: 1.5,
                        maxHeight: 60,
                        overflowY: 'auto',
                      }}
                    >
                      {latestResult.prompt}
                    </div>
                    {latestResult.revisedPrompt &&
                      latestResult.revisedPrompt.trim() !== latestResult.prompt.trim() && (
                        <div
                          style={{
                            fontSize: 12,
                            color: 'var(--text-3)',
                            lineHeight: 1.4,
                            borderTop: '1px dashed var(--border-subtle)',
                            paddingTop: 8,
                          }}
                        >
                          <strong>上游改写：</strong> {latestResult.revisedPrompt}
                        </div>
                      )}
                  </div>
                </>
              ) : (
                <span
                  style={{
                    fontSize: 14,
                    color: 'var(--text-3)',
                    background: 'var(--surface)',
                    padding: '8px 16px',
                    borderRadius: 20,
                  }}
                >
                  结果加载中…
                </span>
              )
            ) : imageGenerationBusy ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 12,
                  color: 'var(--text-3)',
                  fontSize: 14,
                  background: 'var(--surface)',
                  padding: '24px 32px',
                  borderRadius: 16,
                  boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    border: '3px solid var(--border-subtle)',
                    borderTopColor: 'var(--accent)',
                    animation: 'spin 1s linear infinite',
                  }}
                />
                正在生成图片…
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 12,
                  color: 'var(--text-3)',
                  textAlign: 'center',
                  maxWidth: 320,
                  opacity: 0.6,
                }}
              >
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <circle cx="8.5" cy="10" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
                <strong style={{ fontSize: 15, color: 'var(--text-2)', fontWeight: 500 }}>
                  在左侧填写提示词开始生成
                </strong>
                <span style={{ fontSize: 13, lineHeight: 1.6 }}>
                  生成结果将在此处展示。也可以从下方选择参考图。
                </span>
              </div>
            )}
          </div>

          <section style={historyStripStyle}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
              }}
            >
              <span style={sectionLabelStyle}>
                会话历史{sessionArtifacts.length > 0 ? ` · ${sessionArtifacts.length}` : ''}
              </span>
              <button
                type="button"
                style={{ ...secondaryButtonStyle, padding: '0.3rem 0.7rem' }}
                onClick={() => setArtifactsRefreshKey((value) => value + 1)}
              >
                刷新
              </button>
            </div>
            {sessionArtifacts.length === 0 ? (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-3)',
                  lineHeight: 1.6,
                  padding: '8px 0 2px',
                  width: '100%',
                }}
              >
                当前工作台还没有图片，生成或上传后会显示在这里。
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  overflowX: 'auto',
                  paddingBottom: 6,
                }}
              >
                {sessionArtifacts.map((artifact) => {
                  const isSelected = artifact.artifactId === selectedReferenceId;
                  return (
                    <button
                      key={artifact.artifactId}
                      type="button"
                      onClick={() => handleSelectHistoryReference(artifact.artifactId)}
                      title={artifact.title}
                      style={{
                        flex: '0 0 auto',
                        width: 108,
                        border: isSelected
                          ? '2px solid var(--accent)'
                          : '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        padding: 0,
                        background: 'var(--bg)',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: '100%',
                          aspectRatio: '1 / 1',
                          background: 'var(--surface)',
                        }}
                      >
                        {artifact.imageUrl && (
                          <img
                            src={artifact.imageUrl}
                            alt={artifact.title}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        )}
                      </div>
                      <div
                        style={{
                          padding: '6px 8px',
                          fontSize: 11,
                          color: 'var(--text-2)',
                          textAlign: 'left',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {artifact.title}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
