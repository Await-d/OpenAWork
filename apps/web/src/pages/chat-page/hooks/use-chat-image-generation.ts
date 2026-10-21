import { useCallback, useEffect, useMemo, useState } from 'react';
import { createArtifactsClient, createSettingsClient } from '@openAwork/web-client';
import {
  DEFAULT_IMAGE_GENERATION_SIZE,
  IMAGE_GENERATION_COUNT_RANGE,
  validateImageGenerationSize,
} from '@openAwork/shared';
import type { ImageGenerationPartialImage } from '@openAwork/web-client';
import type {
  ChatSettingsProvider,
  SavedChatImageDefaults,
} from '../../../utils/chat/chat-session-defaults.js';

const DEFAULT_CHAT_IMAGE_DEFAULTS: SavedChatImageDefaults = {
  providerId: '',
  modelId: '',
  size: DEFAULT_IMAGE_GENERATION_SIZE,
  quality: 'medium',
  outputFormat: 'png',
  background: 'auto',
  moderation: 'auto',
  count: IMAGE_GENERATION_COUNT_RANGE.min,
  maskArtifactId: null,
};

interface GeneratedImageArtifact {
  id: string;
  title: string;
  type: 'image';
  metadata?: Record<string, unknown>;
}

export interface SessionImageGenerationResponse {
  /** 首张（兼容既有调用方）。 */
  artifact: GeneratedImageArtifact;
  /** `n > 1` 时的全量产物；旧版网关可能不返回该字段。 */
  artifacts?: GeneratedImageArtifact[];
  revisedPrompt: string | null;
  parameters: {
    background: SavedChatImageDefaults['background'];
    count?: number;
    modelId: string;
    outputFormat: SavedChatImageDefaults['outputFormat'];
    providerId: string;
    quality: SavedChatImageDefaults['quality'];
    size: SavedChatImageDefaults['size'];
  };
  messageSummary: string;
}

/**
 * 图片生成相关动作的统一包装：`run` 全流程留在 try 内，catch 交给 `onError`
 * （不传＝异常继续向上抛，不得静默吞掉），finally 跑清理。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句、也不支持
 * 「无 catch 的 try」与 try 内的值块（`?.`、三元、`...(cond ? … : {})`），本 hook 2 处
 * 这类 try 会让整个 hook 脱靶（实测）。语义逐字照搬。
 */
async function runImageGenerationActionOnce<T>(ctx: {
  onError?: (error: unknown) => void;
  onFinally?: () => void;
  run: () => Promise<T>;
}): Promise<T> {
  try {
    return await ctx.run();
  } catch (error) {
    if (!ctx.onError) {
      throw error;
    }
    ctx.onError(error);
    return undefined as T;
  } finally {
    ctx.onFinally?.();
  }
}

export function useChatImageGeneration(input: {
  gatewayUrl: string;
  providers: ChatSettingsProvider[];
  token: string | null;
}) {
  const { gatewayUrl, providers, token } = input;
  const [imagePluginEnabled, setImagePluginEnabled] = useState(false);
  const [imagePluginLoaded, setImagePluginLoaded] = useState(false);
  const [imageGenerationMode, setImageGenerationMode] = useState(false);

  // Fetch plugin enabled state from settings
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      // try/catch/finally 下沉到模块级 `runImageGenerationActionOnce`（见其注释）；
      // `?.` / `=== true` 这些值块随 run 回调一起离开 try 作用域。
      await runImageGenerationActionOnce<void>({
        onError: () => {
          /* ignore */
        },
        onFinally: () => {
          if (!cancelled) setImagePluginLoaded(true);
        },
        run: async () => {
          const data = (await createSettingsClient(gatewayUrl).getPlugins(token)) as {
            imageGeneration?: { enabled?: boolean };
          };
          if (!cancelled) {
            setImagePluginEnabled(data.imageGeneration?.enabled === true);
          }
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [gatewayUrl, token]);
  const [imageGenerationBusy, setImageGenerationBusy] = useState(false);
  /** 流式生图的中间稿（官方 `image_generation.partial_image`），仅用于实时预览。 */
  const [imageGenerationPreview, setImageGenerationPreview] =
    useState<ImageGenerationPartialImage | null>(null);
  const [imageGenerationDefaults, setImageGenerationDefaults] = useState<SavedChatImageDefaults>(
    DEFAULT_CHAT_IMAGE_DEFAULTS,
  );

  const imageProvider = useMemo(
    () => providers.find((provider) => provider.id === imageGenerationDefaults.providerId),
    [providers, imageGenerationDefaults.providerId],
  );
  const imageModel = useMemo(
    () =>
      imageProvider?.defaultModels.find(
        (model) =>
          model.id === imageGenerationDefaults.modelId && model.supportsImageGeneration === true,
      ),
    [imageProvider, imageGenerationDefaults.modelId],
  );
  const imageModelLabel = useMemo(() => {
    if (!imageModel) {
      return '';
    }

    return imageProvider ? `${imageModel.label} · ${imageProvider.name}` : imageModel.label;
  }, [imageModel, imageProvider]);
  const hasConfiguredImageModel = Boolean(imageProvider && imageModel);

  const applySavedImageDefaults = useCallback((next: SavedChatImageDefaults) => {
    setImageGenerationDefaults(next);
  }, []);

  const updateImageGenerationDefaults = useCallback((updates: Partial<SavedChatImageDefaults>) => {
    setImageGenerationDefaults((prev) => ({ ...prev, ...updates }));
  }, []);

  const toggleImageGenerationMode = useCallback(() => {
    if (!imagePluginEnabled) return;
    setImageGenerationMode((prev) => !prev);
  }, [imagePluginEnabled]);

  const generateImageForSession = useCallback(
    async (params: {
      inputArtifacts?: Array<{ artifactId: string; fileName?: string; mimeType?: string }>;
      /** 局部编辑遮罩（仅在有参考图时有意义）。 */
      maskArtifact?: { artifactId: string; fileName?: string; mimeType?: string };
      prompt: string;
      sessionId: string;
    }): Promise<SessionImageGenerationResponse> => {
      if (!token) {
        throw new Error('当前未登录，无法生成图片。');
      }

      const sizeValidation = validateImageGenerationSize(imageGenerationDefaults.size);
      if (!sizeValidation.valid) {
        throw new Error(sizeValidation.message ?? '请输入合法的图片尺寸。');
      }

      if (imageGenerationDefaults.maskArtifactId && !params.inputArtifacts?.length) {
        throw new Error('局部编辑需要先选择参考图——遮罩必须作用在一张待编辑的图上。');
      }

      // 显式传入的遮罩优先（供非 UI 调用方），否则用控件里选中的会话产物。
      const maskArtifact =
        params.maskArtifact ??
        (imageGenerationDefaults.maskArtifactId
          ? { artifactId: imageGenerationDefaults.maskArtifactId }
          : undefined);

      const request = {
        ...(params.inputArtifacts ? { inputArtifacts: params.inputArtifacts } : {}),
        ...(maskArtifact ? { maskArtifact } : {}),
        prompt: params.prompt,
        size: imageGenerationDefaults.size,
        quality: imageGenerationDefaults.quality,
        outputFormat: imageGenerationDefaults.outputFormat,
        background: imageGenerationDefaults.background,
        moderation: imageGenerationDefaults.moderation,
        count: imageGenerationDefaults.count,
        ...(imageGenerationDefaults.outputCompression === undefined
          ? {}
          : { outputCompression: imageGenerationDefaults.outputCompression }),
      };

      // 单张走流式端点（官方 `stream` + `partial_images`）以便实时预览；
      // 多张（`n > 1`）中间稿与「第几张结果」的对应关系官方未定义，走非流式。
      const useStreaming = imageGenerationDefaults.count <= IMAGE_GENERATION_COUNT_RANGE.min;

      setImageGenerationBusy(true);
      setImageGenerationPreview(null);
      // try/finally 下沉到模块级 `runImageGenerationActionOnce`（见其注释）；
      // 原代码此处**没有 catch**（异常向上抛），故不传 onError。
      return await runImageGenerationActionOnce<SessionImageGenerationResponse>({
        onFinally: () => {
          setImageGenerationBusy(false);
        },
        run: async () => {
          if (!useStreaming) {
            return (await createArtifactsClient(gatewayUrl).generateImage(
              token,
              params.sessionId,
              request,
            )) as SessionImageGenerationResponse;
          }

          return await new Promise<SessionImageGenerationResponse>((resolve, reject) => {
            void createArtifactsClient(gatewayUrl)
              .generateImageStream(token, params.sessionId, request, {
                onPartial: (partial) => setImageGenerationPreview(partial),
                onDone: (payload) => {
                  setImageGenerationPreview(null);
                  resolve(payload as SessionImageGenerationResponse);
                },
                onError: (error) => {
                  setImageGenerationPreview(null);
                  reject(new Error(error.message));
                },
              })
              .catch((error: unknown) => {
                setImageGenerationPreview(null);
                reject(error instanceof Error ? error : new Error('图片生成失败，请稍后重试。'));
              });
          });
        },
      });
    },
    [gatewayUrl, imageGenerationDefaults, token],
  );

  return {
    applySavedImageDefaults,
    generateImageForSession,
    hasConfiguredImageModel,
    imageGenerationBusy,
    imageGenerationDefaults,
    imageGenerationMode,
    imageGenerationPreview,
    imageModelLabel,
    imagePluginEnabled,
    imagePluginLoaded,
    setImageGenerationMode,
    toggleImageGenerationMode,
    updateImageGenerationDefaults,
  };
}
