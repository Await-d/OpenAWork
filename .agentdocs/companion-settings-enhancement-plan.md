# Buddy 伴侣设置（settings/companion）完整化方案

## 目的与边界

把 `apps/web/src/pages/settings/companion` 从"基础完成"提升到"产品可用"。

- 范围：仅 `settings/companion` 目录及其依赖的 `components/chat/companion/use-buddy-voice-preferences.ts` hook。
- 非范围：不改后端 schema、路由与持久化协议；不动 chat 页 companion shell 行为。
- 约束：所有能力依赖现有的 `getCompanion` / `putCompanion` / `putCompanionChat` 接口；前端只补 UI 与 hook setter。

---

## 一、现状盘点（关键不对称）

把后端 schema、hook 暴露面、UI 三层对齐，差距集中在「全局语音」「主题」「重置 / 重试」三块：

| 字段 | 后端 schema | hook setter | 全局 UI | Agent 绑定 UI |
|---|---|---|---|---|
| `enabled` | ✅ | ✅ | ✅ | — |
| `muted` | ✅ | ✅ | ✅ | — |
| `reducedMotion` | ✅ | ✅ | ✅ | — |
| `verbosity` | ✅ | ✅（折射为 quietMode） | ✅（toggle） | ✅ |
| `injectionMode` | ✅ | ✅ | ✅ | ✅ |
| **`themeVariant`** | ✅ | ❌ | ❌ | ✅ |
| `voiceOutputEnabled` | ✅ | ✅ | ✅ | — |
| **`voiceOutputMode`** | ✅ | ❌（仅 effective 只读） | ❌ | ✅ |
| **`voiceRate`** | ✅ | ❌（仅 effective 只读） | ❌ | ✅ |
| **`voiceVariant`** | ✅ | ❌（仅 effective 只读） | ❌ | ✅ |

补充观察：

- 后端 `companionPreferencesSchema` 不含 `species` / `displayName`，那是 `CompanionAgentBinding` 的字段。全局 Persona 由后端基于 `email + sub` 派生 `profile`，前端无法直接覆盖物种/名称，**只能覆盖 `themeVariant`**。
- `POST /settings/companion/chat` 已经在 `companion-stage.tsx` 使用，可以直接复用做"试聊 / 试听"。
- `syncStatus === 'error'` 当前只显示文案，没有重试入口。
- `companionFeatureMode === 'off'` 时所有 toggle 仍可点击但无效，缺禁用态与说明。

---

## 二、目标拆解

按用户视角分三条线：

**A. 全局偏好补齐**：让 Buddy 默认行为完全在设置里可调，不必先绑定 Agent。
**B. 体验增强**：feature off 引导、sync error 重试、试听、恢复默认偏好。
**C. 默认外观**：`themeVariant` 全局可改 + 物种/名称的跳转引导（指向 Agent 绑定）。

---

## 三、任务索引

| 任务 | 范围 | 批次 |
|---|---|---|
| 任务 1：hook 扩展 setter / retry / reset | `use-buddy-voice-preferences.ts` | 1 |
| 任务 2：tab-content 骨架拆分 | `companion-tab-content.tsx` + 6 个新 section | 1 |
| 任务 3.A：全局语音 section + 试听 | `companion-voice-section.tsx` | 2 |
| 任务 3.B：默认主题 section | `companion-default-persona-section.tsx` | 2 |
| 任务 3.C：feature banner + 重试 + 重置 | `companion-feature-banner.tsx` 等 | 3 |
| 任务 3.D：试聊预览 | `companion-preview-tester.tsx` | 4 |
| 任务 4：Agent 绑定面板实时校验 | `buddy-agent-binding-panel.tsx` | 3 |
| 任务 5：可访问性 / 国际化收口 | 全部 section | 4 |

每个任务详细设计在第四节展开。


---

## 四、详细设计

### 任务 1：hook 扩展（`use-buddy-voice-preferences.ts`）

**新增 state 字段**

`BuddyVoicePreferencesState` 增加 `themeVariant: CompanionThemeVariant`（默认 `'default'`）。
`DEFAULT_BUDDY_VOICE_PREFERENCES` 同步补 `themeVariant: 'default'`。

**新增 setter（全部走 `updatePreference` 以维持 dirty tracking）**

```ts
setVoiceOutputMode: Dispatch<SetStateAction<CompanionVoiceOutputMode>>;
setVoiceVariant: Dispatch<SetStateAction<CompanionVoiceVariant>>;
setVoiceRate: Dispatch<SetStateAction<number>>;        // 写入时 clamp 到 [0.5, 2]
setThemeVariant: Dispatch<SetStateAction<CompanionThemeVariant>>;
setVerbosity: Dispatch<SetStateAction<'minimal' | 'normal'>>;  // 替换 quietMode 二态以贴齐 schema
```

`quietMode` / `setQuietMode` 保留以避免破坏 `companion-tab-content`，但内部只是 `verbosity === 'minimal'` 的 alias。

**`serializeRemotePreferences` 补字段**

当前实现只序列化 6 个字段，导致 `voiceOutputMode/voiceRate/voiceVariant/themeVariant` 改动不会触发 PUT。修复为：

```ts
JSON.stringify({
  enabled: value.enabled,
  injectionMode: value.injectionMode,
  muted: value.muted,
  reducedMotion: value.reducedMotion,
  themeVariant: value.themeVariant,
  verbosity: value.quietMode ? 'minimal' : 'normal',
  voiceOutputEnabled: value.voiceOutputEnabled,
  voiceOutputMode: value.voiceOutputMode,
  voiceRate: value.voiceRate,
  voiceVariant: value.voiceVariant,
});
```

**新增工具方法**

```ts
resetPreferencesToDefault: () => void;        // setPreferences(DEFAULT_BUDDY_VOICE_PREFERENCES)
retrySync: () => Promise<void>;               // 抽出现有 GET effect 主体复用
```

抽出方式：把现有 `useEffect(() => { ...createSettingsClient(...).getCompanion(...) })` 主体提取为 `loadCompanionSettings(abortSignal?)`，effect 与 `retrySync` 共用。

**远端读取后的 hydrate 行为**

`getCompanion` 返回 payload 里 preferences 写入 state 时，要把 `themeVariant` 也读出来，hook 内部 `remotePreferences` 构造处增加：

```ts
themeVariant: data.preferences?.themeVariant ?? 'default',
```

`putCompanion` body 里 preferences 也补上对应四个字段。

**改动量预估**：~80 行新增，~10 行修改，集中在一个文件，单次 commit ≤ 200 行可行。

---

### 任务 2：tab-content 骨架拆分

把 `companion-tab-content.tsx`（当前 ~270 行）拆成「编排 + 6 个 section」。

**新建文件清单**（这一步 6 个文件全部留空骨架，仅迁移现有 JSX，不做新增逻辑）：

```
settings/companion/
├── companion-feature-banner.tsx          # feature off / sync error 引导
├── companion-status-hero.tsx             # 顶部 hero（标题 + 状态卡）
├── companion-main-controls-section.tsx   # 主控制 5 个 toggle + 重置
├── companion-injection-section.tsx       # 注入策略
├── companion-voice-section.tsx           # 全局语音偏好（任务 3.A 填充）
├── companion-default-persona-section.tsx # 默认 themeVariant + 预览
└── companion-preview-tester.tsx          # 试聊（任务 3.D 填充）
```

骨架阶段：仅迁移 `hero` / `主控制` / `注入策略` / `Persona 预览` 四块到对应文件，行为完全保持等价。`voice-section` / `feature-banner` / `preview-tester` 留空 stub（导出空函数返回 `null`），用于编排时占位。

**`companion-tab-content.tsx` 编排版伪代码**：

```tsx
export function CompanionTabContent() {
  const email = useAuthStore((state) => state.email) ?? 'guest';
  const binding = useBuddyAgentBindingManager();
  const buddy = useBuddyVoicePreferences(email, binding.selectedAgentId || undefined);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <CompanionFeatureBanner buddy={buddy} />
      <CompanionStatusHero buddy={buddy} />
      <CompanionMainControlsSection buddy={buddy} />
      <CompanionInjectionSection buddy={buddy} />
      <CompanionVoiceSection buddy={buddy} />
      <CompanionDefaultPersonaSection buddy={buddy} email={email} />
      <BuddyAgentBindingPanel
        agentError={binding.agentError}
        agentLoading={binding.agentLoading}
        agentOptions={binding.agentOptions}
        bindings={buddy.bindings}
        previewProfile={buddy.profile}
        selectedAgentId={binding.selectedAgentId}
        syncStatusLabel={buddy.syncStatusLabel}
        onRemoveBinding={buddy.removeAgentBinding}
        onSaveBinding={buddy.saveAgentBinding}
        onSelectAgentId={binding.setSelectedAgentId}
      />
      <CompanionPreviewTester buddy={buddy} />
    </div>
  );
}
```

每个 section 的 props 收敛为 `{ buddy: ReturnType<typeof useBuddyVoicePreferences> }`，避免一长串 prop drilling。

**改动量预估**：新建 6 个文件总计 ~450 行（其中 ~250 行是从 tab-content 搬过来的存量代码），编排文件从 270 行收敛到 ~50 行。
为遵守"单次 ≤ 200 行"约束，本任务再拆 3 步：

1. 步骤 2.1：新建 hero / main-controls / injection / default-persona 4 个 section（迁移现有 JSX，每文件 60–120 行）
2. 步骤 2.2：tab-content 改写为编排（删旧 JSX + 注入新 section，净改动 ~120 行）
3. 步骤 2.3：voice / feature-banner / preview-tester 占位 stub（每个 ~15 行）


---

### 任务 3.A：全局语音 section（`companion-voice-section.tsx`）

UI 结构：

```
section
├─ ST 标题：全局语音偏好
├─ 说明文案
├─ Grid（响应式 minmax(180px, 1fr)）
│  ├─ label「播报模式」select：off / buddy_only / important_only
│  ├─ label「语音变体」select：system / bright / calm
│  └─ label「语速」slider + 数字框
└─ 试听卡片
   ├─ 文本：「试听一段示例：『当前任务完成度 80%，先休息一下吧。』」
   └─ 按钮「试听」/「停止试听」
```

**语速控件**：

- `<input type="range" min="0.5" max="2" step="0.05">` 与 `<input type="number">` 双绑定。
- 数字输入即时 clamp（hook 的 `setVoiceRate` 内部也会 clamp，UI 仍要校验避免无效值。
- 两个 input 通过 `aria-controls` 与同一个 `<output>` 关联，朗读"当前语速 1.05x"。

**试听实现**：

- 使用 `window.speechSynthesis`，封装到模块内的 `playPreview(rate, variant)` 函数。
- 找声音逻辑：根据 `variant` 选偏好（`bright` 优先 zh-CN female、`calm` 优先 zh-CN male、`system` 取默认），找不到则 fallback 到 `getVoices()[0]`。
- 试听时按钮态切换为「停止试听」，点击调 `speechSynthesis.cancel()`。
- TTS 不可用（`typeof window.speechSynthesis === 'undefined'`）时按钮 disabled + 提示「当前环境不支持本地朗读」。

**禁用条件**：

- `voiceOutputEnabled === false` 时整组控件 `aria-disabled` + 50% 透明 + 顶部贴标「先开启『启用本地播报』」。
- `companionFeatureMode === 'off'` 时由 banner 在外层接管（见任务 3.C）。

**改动量预估**：~180 行单文件，刚好在 200 行内。

---

### 任务 3.B：默认主题 section（`companion-default-persona-section.tsx`）

UI：

- 主题选择（与 Agent 绑定面板一致的 `THEME_OPTIONS`）：default / playful。
- 「想要专属物种或自定义名称？请在下方 Agent 绑定里设置」内嵌引导，附 anchor 跳到绑定面板。
- 当前 Persona 预览（保留原 `CompanionVisualShowcase`，使用 `buddy.profile`）。
- 当 `buddy.profile == null`：保留现状的占位文案。

**注意**：

- 物种 / 名称 字段在后端 preferences schema 不存在，前端**不要伪造**这两个全局字段。说明文字明确"全局物种与名称由账号派生"。
- 如果用户对此不满，引导去 Agent 绑定面板。

**改动量预估**：~110 行单文件。

---

### 任务 3.C：feature banner + 同步重试 + 重置

**`companion-feature-banner.tsx`**

- `companionFeatureMode === 'off'`：渲染顶部横幅「Buddy 伴侣功能当前处于关闭状态。设置仍可保存，但实时陪跑会停用，直到管理员重新启用。」（feature mode 是后端控制的全局开关，前端不能写。）
- `syncStatus === 'error'`：渲染同步失败横幅 + 「重试同步」按钮，调 `buddy.retrySync()`。按钮在重试中态显示加载圈。
- 两种状态可同时存在（off + error），分行渲染。
- 全部正常时返回 `null`，不占空间。

**`companion-main-controls-section.tsx` 加重置入口**

底部加按钮「恢复默认偏好」。点击弹原生 `confirm`：「确认要恢复 Buddy 偏好为默认值吗？已绑定 Agent 的专属配置不受影响。」用户确认后调 `buddy.resetPreferencesToDefault()`。
重置只清 preferences 不动 bindings，文案要明示。

**禁用透传**

`feature off` 时主控制、注入、语音、默认主题四个 section 整体加 `style={{ pointerEvents: 'none', opacity: 0.55 }}` + `aria-disabled`。在编排层做，子 section 不感知。

**改动量预估**：banner ~80 行；main-controls 重置部分 ~30 行；编排层禁用 ~10 行。合计 ~120 行。

---

### 任务 3.D：试聊预览（`companion-preview-tester.tsx`）

UI：

- 输入框（textarea，2 行，placeholder「比如：现在该不该提醒我休息？」）
- 「发送」按钮，调 `createSettingsClient(gatewayUrl).putCompanionChat(token, { message, agentId? })`
- 响应展示在卡片里：Persona 名 + 回复
- 启用语音时，自动调 `speechSynthesis.speak(...)` 朗读回复（用当前 voice 设置）
- 历史保留最近 5 条，可清空
- 按钮态：发送中 disabled；连续 3 次失败显示「服务不可用，稍后再试」并禁用 30 秒
- 不持久化历史（仅本次会话内存）

**和现有 `companion-stage` 区别**：

- companion-stage 的试聊是给 chat 页 buddy shell 用的，依赖 stage 上下文（pendingApprovals / runningTasks）。
- 这里只发纯 message，不带 context 字段，目的是让用户在保存设置前感受 persona 风格。

**改动量预估**：~150 行单文件。

---

### 任务 4：Agent 绑定面板实时校验

`buddy-agent-binding-panel.tsx` 现状：语速 input 校验只在点保存时跑，输入超界用户没反馈。

改动：

- `voiceRateInput` onChange 时计算 `voiceRateError`：超界或非数字时 set 错误文案。
- input 加 `aria-invalid={Boolean(voiceRateError)}` 与 `aria-describedby` 指向错误节点。
- 错误文案 `<div role="alert">` 在 input 下方显示。
- 保存按钮在有 error 时禁用。

**改动量预估**：~40 行。

---

### 任务 5：可访问性 / 国际化收口

- 所有 section 顶层 `aria-labelledby` 指向自己的 `ST` 标题节点。
- `companionFeatureMode === 'off'` banner 用 `role="status" aria-live="polite"`。
- 试听 / 试聊状态变化 `aria-live="polite"`。
- 复用现有 `BP / IS / SS / ST / UV` 样式常量，保持视觉一致；不引入新颜色 token。
- 文案统一：使用「Buddy 伴侣 / 陪跑 / 注入 / 试听 / 试聊」一组词，避免与「companion / persona」混用。
- 现阶段所有文案中文硬编码（与项目其他设置 tab 一致），不接 i18n。

**改动量预估**：分散在已有文件中 ~50 行 patch。

---

## 五、改动文件清单与新增 / 修改

**新建（6 个 `.tsx`）**

```
apps/web/src/pages/settings/companion/companion-feature-banner.tsx
apps/web/src/pages/settings/companion/companion-status-hero.tsx
apps/web/src/pages/settings/companion/companion-main-controls-section.tsx
apps/web/src/pages/settings/companion/companion-injection-section.tsx
apps/web/src/pages/settings/companion/companion-voice-section.tsx
apps/web/src/pages/settings/companion/companion-default-persona-section.tsx
apps/web/src/pages/settings/companion/companion-preview-tester.tsx
```

（实际 7 个，初次方案口述说 6 个时把 hero 和 main-controls 合并了；拆开后更清晰。）

**修改（3 个）**

```
apps/web/src/components/chat/companion/use-buddy-voice-preferences.ts
apps/web/src/pages/settings/companion/companion-tab-content.tsx
apps/web/src/pages/settings/companion/buddy-agent-binding-panel.tsx
```

**不改**

- 后端 `services/agent-gateway/src/companion-settings.ts` / `routes/settings.ts`
- `packages/shared/src/index.ts` 类型
- `packages/web-client/src/settings.ts` API
- chat 页 companion shell 与 stage


---

## 六、分批落地计划

为保证每次改动可独立审阅、可回滚，按 4 个批次落地。每批次内再按"≤200 行 / 次"切分小步。

### 批次 1：基础架构（hook 扩展 + tab 骨架拆分）

行为完全等价，纯结构调整。

| 步骤 | 改动 | 估算行数 |
|---|---|---|
| 1.1 | hook 增加 `themeVariant` state 字段 + 序列化补字段 | ~50 行 |
| 1.2 | hook 增加 `setVoiceOutputMode/setVoiceVariant/setVoiceRate/setThemeVariant/setVerbosity` 五个 setter | ~70 行 |
| 1.3 | hook 增加 `resetPreferencesToDefault` + `retrySync`（抽出 GET effect 主体） | ~80 行 |
| 1.4 | 新建 `companion-status-hero.tsx` + `companion-main-controls-section.tsx`（迁移现有 JSX） | ~180 行 |
| 1.5 | 新建 `companion-injection-section.tsx` + `companion-default-persona-section.tsx` 骨架（迁移 + 仅保留主题字段） | ~120 行 |
| 1.6 | tab-content 改为编排 + 占位 stub 三个新组件（feature-banner / voice-section / preview-tester 都先返回 null） | ~150 行 |

**验收**：

- `pnpm exec tsc --noEmit` 通过
- 设置页打开 Buddy tab，行为与改动前一致（toggle / 注入策略 / Agent 绑定 / Persona 预览）
- `getDiagnostics` 在 settings/companion 路径下 0 错误

### 批次 2：全局语音 + 默认主题

| 步骤 | 改动 | 估算行数 |
|---|---|---|
| 2.1 | `companion-voice-section.tsx` 控件部分（select + slider） | ~120 行 |
| 2.2 | `companion-voice-section.tsx` 试听卡片 + speechSynthesis 封装 | ~80 行 |
| 2.3 | `companion-default-persona-section.tsx` 主题选择 + 引导文案 | ~110 行 |

**验收**：

- 改播报模式 / 变体 / 语速，0.5 秒后看到同步状态从 `saving` → `synced`
- 后端 GET /settings/companion 返回的 preferences 已包含新字段
- 试听按钮工作；不支持 TTS 的环境按钮 disabled 且有提示
- 改主题在 Agent 绑定面板 / 预览中可见反映

### 批次 3：体验增强（banner / 重试 / 重置 / 校验）

| 步骤 | 改动 | 估算行数 |
|---|---|---|
| 3.1 | `companion-feature-banner.tsx`（off 提示 + sync error 重试） | ~80 行 |
| 3.2 | tab-content 编排层加 feature-off 全局禁用透传 | ~20 行 |
| 3.3 | `companion-main-controls-section.tsx` 加恢复默认按钮 | ~40 行 |
| 3.4 | `buddy-agent-binding-panel.tsx` voice rate 实时校验 | ~40 行 |

**验收**：

- 模拟 sync error（断网或 mock 503）能看到重试横幅，点击后恢复
- feature off 状态下控件视觉禁用且无法点击
- 恢复默认按钮 confirm 后将 preferences 重置，不影响 bindings
- Agent 绑定语速输入超界即时显示错误，保存按钮禁用

### 批次 4：试聊 + a11y 收口

| 步骤 | 改动 | 估算行数 |
|---|---|---|
| 4.1 | `companion-preview-tester.tsx` 输入 + 发送 + 历史展示 | ~120 行 |
| 4.2 | 试聊与试听联动（启用语音时朗读回复） | ~40 行 |
| 4.3 | 全 section a11y 属性补齐（aria-labelledby / live region / role） | ~50 行 |

**验收**：

- 试聊能正常发送并展示回复
- 启用本地播报 + 试聊后能听到 Persona 朗读回复
- 通过 axe DevTools 扫描，settings/companion 页 0 严重违规

---

## 七、风险与回退策略

| 风险 | 缓解 |
|---|---|
| hook 序列化字段补全后，旧客户端发出的 PUT 不带新字段，可能导致后端 `companionPreferencesSchema.partial()` 把缺省字段 reset | 服务端用 `partial()` 解析，未带的字段保持原值。已确认 `routes/settings.ts` 走 partial merge。 |
| `speechSynthesis` 在 Tauri webview 行为差异 | 试听做能力探测，不可用即禁用按钮；不影响其他设置项。 |
| 试聊 `putCompanionChat` 调用失败 | 失败计数 ≥3 后禁用 30 秒，文案明示；不影响其它 section。 |
| feature off 时控件禁用透传遗漏某个 section | 在编排层 `<div style={...}>` 包一层，子组件无感；新加 section 自动继承。 |
| 重置默认按钮误触 | 加 `window.confirm` 二次确认，文案说明 bindings 不受影响。 |
| themeVariant 字段从 `'default' \| 'playful'` 之外的旧值进来 | hook hydrate 时加 fallback：`data.preferences?.themeVariant === 'playful' ? 'playful' : 'default'`。 |

回退策略：每批次单独 commit，必要时按批次粒度 revert；hook 改动与 UI 改动分批，hook 单独可回滚不会影响 UI。

---

## 八、不在本方案范围内的事

记录下来防止后续再讨论：

- 不引入 i18n 框架；所有文案仍中文硬编码。
- 不重构 `companion-stage` / chat 页 buddy shell。
- 不增加新的后端字段（如想全局自定义物种 / 名称需要先扩 schema，单独立项）。
- 不引入新的 UI 组件库；继续用现有 `SS / ST / IS / BP / UV` 内联样式约定。
- 不为试聊持久化历史（只内存保留 5 条）。
- 不增加测试文件；现有 `skills-plugin-panel.test.tsx` 是孤例，本方案不效仿。如后续要补，单独立项。

