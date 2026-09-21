import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  DEFAULT_MOBILE_IMAGE_GENERATION_DEFAULTS,
  loadImageGenerationDefaults,
  type ExpoPersistenceAdapter,
  type MobileImageGenerationDefaults,
} from '../../store/providerPersistence';

export interface MobileImageGenerationSettings {
  hasConfiguredImageModel: boolean;
  imageDefaults: MobileImageGenerationDefaults;
  imageModelLabel: string;
  setImageDefaults: Dispatch<SetStateAction<MobileImageGenerationDefaults>>;
}

interface UseMobileImageGenerationSettingsInput {
  persistence: ExpoPersistenceAdapter;
  sessionId: string;
}

/**
 * 生图设置：默认尺寸/质量/格式/背景 + 当前配置的图片模型标签。
 *
 * 默认值只在首次挂载时从存储回填——每次 sessionId 变化都回填会静默覆盖
 * 用户刚在图片面板里调整过的选项。
 */
export function useMobileImageGenerationSettings({
  persistence,
  sessionId,
}: UseMobileImageGenerationSettingsInput): MobileImageGenerationSettings {
  const [imageDefaults, setImageDefaults] = useState<MobileImageGenerationDefaults>(
    DEFAULT_MOBILE_IMAGE_GENERATION_DEFAULTS,
  );
  const [hasConfiguredImageModel, setHasConfiguredImageModel] = useState(false);
  const [imageModelLabel, setImageModelLabel] = useState('GPT Image 2 · OpenAI');
  const hasAppliedStoredImageDefaultsRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const loadMobileImageSettings = async () => {
      const [config, storedImageDefaults] = await Promise.all([
        persistence.loadProviderConfig(),
        loadImageGenerationDefaults(),
      ]);

      if (cancelled) {
        return;
      }

      // Only seed image defaults from storage on first load. Re-applying on
      // every sessionId change would silently revert any size/quality/format/
      // background the user just adjusted in the image panel.
      if (!hasAppliedStoredImageDefaultsRef.current) {
        setImageDefaults(storedImageDefaults);
        hasAppliedStoredImageDefaultsRef.current = true;
      }
      const activeImage = config?.active.image;
      const provider = activeImage
        ? config?.providers.find((item) => item.id === activeImage.providerId)
        : undefined;
      const model = provider?.defaultModels.find((item) => item.id === activeImage?.modelId);
      const imageApiKey = activeImage ? await persistence.loadApiKey(activeImage.providerId) : null;
      setHasConfiguredImageModel(Boolean(provider && model && imageApiKey?.trim()));
      if (provider && model) {
        setImageModelLabel(`${model.label} · ${provider.name}`);
      }
    };

    void loadMobileImageSettings();

    return () => {
      cancelled = true;
    };
  }, [persistence, sessionId]);

  return { hasConfiguredImageModel, imageDefaults, imageModelLabel, setImageDefaults };
}
