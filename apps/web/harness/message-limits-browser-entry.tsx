import { createRoot } from 'react-dom/client';
import { MessageLimitsSection } from '../src/pages/settings/connection/message-limits-section.js';
import { useAuthStore } from '../src/stores/auth/auth.js';
import '../src/index.css';

document.documentElement.dataset.mode = new URLSearchParams(location.search).get('mode') ?? 'dark';
await useAuthStore.persist.rehydrate();
useAuthStore.setState({
  gatewayUrl: location.origin,
  accessToken: 'message-limits-browser-fixture',
  email: 'browser-fixture@example.invalid',
});
const root = document.getElementById('root');
if (!root) throw new Error('消息上限 harness 缺少 root');
createRoot(root).render(
  <main>
    <MessageLimitsSection />
  </main>,
);
