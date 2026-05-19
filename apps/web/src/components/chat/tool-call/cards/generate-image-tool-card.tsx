import { resolveToolVisualStatus, type ToolCallCardProps } from '@openAwork/shared-ui';
import { useMemo, useState } from 'react';
import { ImageLightbox } from '../../image/image-lightbox.js';
import { ToolIcon } from '../display/tool-icon.js';
import {
  GenerateImageFetchErrorCard,
  GenerateImageToolErrorCard,
} from '../generate-image/error-cards.js';
import { GenerateImageDisplay } from '../generate-image/image-display.js';
import { parseGenerateImageOutput, parseImageAspectRatio } from '../generate-image/parse.js';
import { GenerateImageResultMeta } from '../generate-image/result-meta.js';
import { GenerateImageRunningPlaceholder } from '../generate-image/running-placeholder.js';
import { useGenerateImageArtifact } from '../generate-image/use-artifact.js';
import { formatElapsed } from '../shared/format.js';

/* ── GenerateImageToolCard ──
 *
 * High-level orchestrator for the `generate_image` tool. Responsibilities:
 *   1. Parse the tool's stringified JSON output into a structured result.
 *   2. Drive the artifact fetch via `useGenerateImageArtifact`.
 *   3. Render the header (title + param pills + status hints) and switch
 *      between four body states: running placeholder, loading, image
 *      display, error.
 *
 * All sub-pieces (running placeholder, image card with hover bar, error
 * cards, result meta row) live as siblings under `./generate-image/` so
 * this top file stays focused on layout + state plumbing.
 */
export function GenerateImageToolCard({
  input,
  output,
  status,
  isError,
  durationMs,
}: {
  input: Record<string, unknown>;
  output?: unknown;
  status?: ToolCallCardProps['status'];
  isError?: boolean;
  durationMs?: number;
}) {
  const visualState = resolveToolVisualStatus({
    defaultStatus: 'running',
    isError,
    output,
    status,
  });
  const result = useMemo(() => parseGenerateImageOutput(output), [output]);
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const promptShort = prompt.length > 60 ? `${prompt.slice(0, 57)}…` : prompt;
  const aspectRatio = useMemo(() => parseImageAspectRatio(input.size), [input]);

  const { imageSrc, imageLoading, fetchError, fileName, retry } = useGenerateImageArtifact(
    result?.artifactId,
  );

  const [lightboxOpen, setLightboxOpen] = useState(false);

  return (
    <div
      className="tool-call-block"
      data-tool-status={visualState}
      style={{ overflow: 'hidden', paddingLeft: 0 }}
    >
      {/* Header */}
      <div className="tool-call-block-header" style={{ cursor: 'default', minHeight: 32 }}>
        <ToolIcon toolName="generate_image" status={visualState} size={14} />
        <span
          className="tool-call-block-title"
          style={{ flex: '0 1 auto', maxWidth: '55%' }}
          title={prompt}
        >
          {visualState === 'running'
            ? '正在生成图片…'
            : visualState === 'failed'
              ? '图片生成失败'
              : `生成图片 ${promptShort}`}
        </span>

        {/* Param pills */}
        {result && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              marginLeft: 'auto',
              flexShrink: 0,
            }}
          >
            <span style={paramPillStyle}>{result.modelId}</span>
            <span style={paramPillStyle}>{result.size}</span>
            <span style={paramPillStyle}>{result.outputFormat.toUpperCase()}</span>
          </div>
        )}
        {visualState === 'running' && (
          <span className="tool-call-block-running-hint" style={{ marginLeft: 'auto' }}>
            生成中…
          </span>
        )}
        {visualState !== 'running' && durationMs != null && durationMs > 0 && (
          <span className="tool-call-block-elapsed">{formatElapsed(durationMs)}</span>
        )}
      </div>

      {/* Running placeholder — occupies space and signals image is being generated */}
      {visualState === 'running' && (
        <GenerateImageRunningPlaceholder
          prompt={prompt}
          promptShort={promptShort}
          aspectRatio={aspectRatio}
        />
      )}

      {/* Body */}
      {visualState !== 'running' && (
        <div
          style={{
            padding: '6px 12px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {/* Loading placeholder */}
          {imageLoading && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 160,
                borderRadius: 12,
                border: '1px dashed var(--border-subtle)',
                background: 'var(--bg-overlay)',
                color: 'var(--fg-muted)',
                fontSize: 11,
              }}
            >
              加载图片中…
            </div>
          )}

          {/* Image */}
          {!imageLoading && imageSrc && (
            <GenerateImageDisplay
              imageSrc={imageSrc}
              alt={result?.title ?? '生成的图片'}
              fileName={fileName}
              onOpenLightbox={() => setLightboxOpen(true)}
            />
          )}

          {/* Lightbox */}
          {imageSrc && (
            <ImageLightbox
              src={imageSrc}
              open={lightboxOpen}
              onClose={() => setLightboxOpen(false)}
              alt={result?.title ?? '生成的图片'}
              {...(result?.title ? { caption: result.title } : {})}
              fileName={fileName}
            />
          )}

          {/* Artifact fetch error (tool itself succeeded, but /artifacts/:id failed) */}
          {!imageLoading && !imageSrc && fetchError && !isError && visualState !== 'failed' && (
            <GenerateImageFetchErrorCard message={fetchError} onRetry={retry} />
          )}

          {/* Tool error */}
          {!imageLoading && !imageSrc && (isError || visualState === 'failed') && (
            <GenerateImageToolErrorCard rawOutput={output} />
          )}

          {/* Meta */}
          {result && <GenerateImageResultMeta result={result} />}
        </div>
      )}
    </div>
  );
}

const paramPillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 18,
  padding: '0 6px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 600,
  lineHeight: 1,
  whiteSpace: 'nowrap',
  background: 'color-mix(in oklch, var(--fg-muted) 8%, transparent)',
  color: 'var(--fg-muted)',
};
