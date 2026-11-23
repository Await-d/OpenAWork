import { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatComposerToolbar } from '../src/components/chat/composer/ChatComposerToolbar.js';
import '../src/index.css';
import '../src/components/chat/composer/ChatComposer.css';

const action = () => console.info('布局验收操作');
const root = document.getElementById('root');
if (!root) throw new Error('字符计数验收缺少挂载点');
createRoot(root).render(
  <main style={{ padding: 'var(--spacing-2)' }}>
    {[false, true].map((overLimit) => (
      <section key={String(overLimit)} style={{ marginBottom: 'var(--spacing-4)' }}>
        <ChatComposerToolbar
          activeProviderId="fixture"
          activeModelLabel="示例模型"
          activeModelSupportsThinking={true}
          thinkingEnabled={true}
          modelPickerRef={createRef()}
          modelSettingsRef={createRef()}
          showModelPicker={false}
          showModelSettings={false}
          showModelPickerButton={true}
          showModelSettingsButton={true}
          showWebSearchButton={true}
          showImageGenerationButton={false}
          showVoiceButton={true}
          showAttachmentButton={true}
          streaming={false}
          imageGenerationBusy={false}
          canSubmit={!overLimit}
          webSearchEnabled={false}
          showVoice={false}
          imageGenerationMode={false}
          hasConfiguredImageModel={false}
          imageGenerationDefaults={{
            providerId: '',
            modelId: '',
            size: '1024x1024',
            quality: 'auto',
            outputFormat: 'png',
            background: 'auto',
            moderation: 'auto',
            count: 1,
          }}
          imageModelLabel=""
          imagePluginEnabled={false}
          input="示例输入"
          stoppingStream={false}
          submitPending={false}
          sessionBusyState={null}
          effectiveStopCapability="none"
          showStopAction={false}
          showQueueAction={false}
          queuedMessageCount={0}
          characterCountControl={
            <span
              className={`composer-character-count${overLimit ? ' composer-character-count--over-limit' : ''}`}
            >
              {overLimit ? '200,001 / 200,000 字符（超限）' : '32,768 / 200,000 字符'}
            </span>
          }
          optimizeError={null}
          optimizeLoading={false}
          optimizeResult={null}
          onClearOptimizeResult={action}
          onClearOptimizeError={action}
          onSend={action}
          onStop={action}
          onToggleModelPicker={action}
          onToggleModelSettings={action}
          onToggleWebSearch={action}
          onToggleVoice={action}
          onRequestFiles={action}
          onToggleImageGenerationMode={action}
          onUpdateImageGenerationDefaults={action}
        />
      </section>
    ))}
  </main>,
);
