import baseConfig from './playwright.config.ts';

export default {
  ...baseConfig,
  testIgnore: ['e2e/chat-stream-attach-live.spec.ts'],
};
