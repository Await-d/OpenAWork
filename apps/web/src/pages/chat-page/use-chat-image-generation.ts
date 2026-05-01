import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_IMAGE_GENERATION_SIZE, validateImageGenerationSize } from '@openAwork/shared';
import type {
  ChatSettingsProvider,
  SavedChatImageDefaults,
} from '../../utils/chat-session-defaults.js';

const DEFAULT_CHAT_IMAGE_DEFAULTS: SavedChatImageDefaults = {
  providerId: '',
  modelId: '',
  size: DEFAULT_IMAGE_GENERATION_SIZE,
  quality: 'medium',
  outputFormat: 'png',
  background: 'auto',
};

interface GeneratedImageArtifact {
  id: string;
  title: string;
  type: 'image';
  metadata?: Record<string, unknown>;
}

export interface SessionImageGenerationResponse {
  artifact: GeneratedImageArtifact;
  revisedPrompt: string | null;
  parameters: {
    background: SavedChatImageDefaults['background'];
    modelId: string;
    outputFormat: SavedChatImageDefaults['outputFormat'];
    providerId: string;
    quality: SavedChatImageDefaults['quality'];
    size: SavedChatImageDefaults['size'];
  };
  messageSummary: string;
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
      try {
        const res = await fetch(`${gatewayUrl}/settings/plugins`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { imageGeneration?: { enabled?: boolean } };
          setImagePluginEnabled(data.imageGeneration?.enabled === true);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setImagePluginLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gatewayUrl, token]);
  const [imageGenerationBusy, setImageGenerationBusy] = useState(false);
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

      setImageGenerationBusy(true);
      try {
        const response = await fetch(
          `${gatewayUrl}/sessions/${params.sessionId}/images/generations`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ...(params.inputArtifacts ? { inputArtifacts: params.inputArtifacts } : {}),
              prompt: params.prompt,
              size: imageGenerationDefaults.size,
              quality: imageGenerationDefaults.quality,
              outputFormat: imageGenerationDefaults.outputFormat,
              background: imageGenerationDefaults.background,
            }),
          },
        );

        const payload = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        } & Partial<SessionImageGenerationResponse>;
        if (!response.ok) {
          throw new Error(payload.error?.message ?? '图片生成失败，请稍后重试。');
        }

        return payload as SessionImageGenerationResponse;
      } finally {
        setImageGenerationBusy(false);
      }
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
    imageModelLabel,
    imagePluginEnabled,
    imagePluginLoaded,
    setImageGenerationMode,
    toggleImageGenerationMode,
    updateImageGenerationDefaults,
  };
}
