import { mergeConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import config from './vitest.config.js';

export default mergeConfig(config, {
  plugins: [react({ babel: { plugins: [['babel-plugin-react-compiler', { target: '19' }]] } })],
});
