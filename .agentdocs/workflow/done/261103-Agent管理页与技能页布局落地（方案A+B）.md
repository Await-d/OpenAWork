# 261103-Agent 管理页与技能页布局落地（方案 A + B）

> 状态：✅ **全部完成并归档**（2026-11-03 交付；真机走查同批完成）。门禁：`prettier --check` 全过 / `eslint`（React Compiler）**exit 0** / `tsc`（整个 `apps/web`）**0 错误** / **本次范围内定向 vitest 16 文件 157 用例全绿** / 网关侧 agent 相关 **11 文件 63 用例全绿**。真机走查：真实 Chromium（agent-browser 自带 Chrome 156）+ mock 网关渲染 `/agents` 与 `/skills`，**8 档视口 × 暗亮主题**逐项核对；期间**发现并修复 3 处实测问题**（含 1 处会影响可用性的断点错误）。
>
> **归属判定（差集口径）**：web 全量在最终状态下为 **685/692 文件、7033/7060 用例通过**，7 个失败文件 / 27 个失败用例（`chat/media/media-reference-card`、`chat/misc/BuiltInBrowser`、`layout/fusion/FusionSidebarPeek.integration`、`hooks/editor/useFileEditor`、`team/runtime/shell/sidebar/use-team-file-preview`、`stores/settings/display-preferences-sync`、`stores/ui/workspace-state-sync`）**均不在本次改动文件集内**，属并行工作流的在途改动（同一批文件在走查期间持续触发 Vite HMR 失败与 `#root` 空渲染瞬态）。**交付途中曾以全绿状态跑过全量（693 文件 7091 用例通过）**，之后他人继续改仓导致上表数字漂移；本任务文件以定向套件 + typecheck 为准。

## Task Overview

`/agents`（Agent 管理）与 `/skills`（技能）两个页面的布局重做。先产出 HTML 原型供选型，用户选定后按选定方案落点到 `apps/web`：

- **Agent 管理 → 方案 A「控制台三栏」**：`demo/layout-demos/agents-a-command-console.html`
- **技能 → 方案 B「三栏内联详情」**：`demo/layout-demos/skills-b-split-detail.html`
- 总览（六方案对比）：`demo/layout-demos/index.html`；共用样式 `_theme.css`（逐值照抄 `apps/web/src/index.css` 的 Nebula Dark token）

## Current Analysis

**Agent 管理页**（`apps/web/src/pages/misc/AgentsPage.tsx` 479 行 + `components/agents/AgentsPageSections.tsx` 1119 行）：渐变 Hero 卡 + 4 张统计卡 + 独立的「智能体目录」筛选卡，22px 大圆角层层套壳；列表与编辑两列，只读元信息（`InfoRow`）挤在表单上方，改配置要来回滚动。

**技能页**（`apps/web/src/pages/skills/SkillsPage.tsx` 876 行）：页头内联统计 + 分段 Tab + 小卡片网格；详情走 `SkillMarketHome` / `SkillDetailPage`（shared-ui）**整页替换**，返回成本高；注册源管理折叠在列表下方。

**组件归属**：`SkillMarketHome` / `SkillDetailPage` / `RegistrySourceManager` / `InstallProgressUI` 的消费方梳理后确认——前两者在 `apps/web` 内**仅本页使用**（harness / 设置页各走各的），故 web 侧停止引用并自建视图，`shared-ui` 的导出与实现**零改动**；`RegistrySourceManager` 与 `InstallProgressUI` 继续复用真实实现。

**数据契约不动**：`createAgentsClient`（`GET/POST/PUT/DELETE /agents*`）、`useSkillsApi`（`/skills/search|local/discover|registry-sources|:id`）、`useInstalledSkills`（`/skills/installed*`）全部原样复用，本次只改视图层。

## Solution Design

1. **页面瘦身为装配层**：`AgentsPage.tsx` 479 → 398 行，`SkillsPage.tsx` 876 → 596 行；两个页面只保留「取数 hook + 筛选态 + 动作编排 + 三栏拼装」。
2. **跨页面控制台表面统一**：新增 `apps/web/src/styles/console-surfaces.css`（59 个 `console-*` 类）承载按钮 / 分段控件 / 输入框 / 徽章 / 开关 / 列容器 / 行外壳 / 元信息表 / 分组 / 提示条 / 空态。依据 `apps/web/AGENTS.md:118`「2 个及以上页面重复的 UI 片段必须提取共享」——落地前两页各写一套按钮与徽章（逐字重复）。
3. **纯计算下沉模块**：`agents-page-data.ts`（排序 / 统计 / 筛选 / 角色选项）、`agents-editor-state.ts`（表单状态 ↔ 记录、别名解析、角色与说明本地化）、`skills-page-model.ts`（三类条目 → 统一 `SkillRow`、展示详情合并、来源压缩、分页页码），全部纯函数 + 单测。
4. **样式走页面级 CSS**（对齐 `pages/resources/resources-page.css` 既有约定），间距/圆角一律 `--spacing-*` / `--radius-*`，替代旧版大量内联样式。
5. **React Compiler 约束显式化**：`try/catch/finally` 与 try 内的值块会让整页脱靶，故动作包装函数留在模块级（`runAgentActionOnce` / `runSkillsPageActionOnce` / `runSkillsActionOnce`），语义逐字照搬。

## Invariants（不变量，均有测试或注释背书）

1. **数据契约零改动**：不新增/修改网关接口，`shared` 与 `shared-ui` 的导出不变。
2. **功能面逐项保留**：Agent 页的新增 / 保存 / 放弃修改 / 启用切换 / 恢复默认 / 移除 / 全部恢复默认 / 内置 Agent 只读约束；技能页的市场搜索与分页 / 本地扫描 / 三轮安装进度与失败态 / 更新（`local-workspace` 与 `local-system` 两条分支）/ 启停 / 系统预装二次确认移除 / 检查更新 / 注册源增删改。
3. **检索范围不变**：Agent 搜索仍覆盖 id / 名称 / 说明（含内置中文说明）/ 别名 / 角色 / 模型 / variant / 回退链 / 提示词 / 备注。
4. **`systemPrompt` 语义是「当前生效值」**：内置 Agent 的覆盖状态一律读 `promptMetadata.hasPromptOverride`，不得按「非空即已自定义」或 `hasOverrides` 推断（后者含模型字段）。
5. **行容器外壳来自共享层**：页面行类必须与 `console-row` 同时挂载，否则丢失 hover / 选中竖条 / 内距。

## Implementation Plan（全部完成）

- [x] T-01 ✅ 共享控制台表面 `styles/console-surfaces.css`（59 类）
- [x] T-02 ✅ Agent 页方案 A：`agents-page-header` / `agents-toolbar` / `agents-catalog-panel` / `agents-editor-panel` / `agents-inspector-panel` / `agents-primitives` + 页面 CSS
- [x] T-03 ✅ Agent 页纯函数模块 `agents-page-data` / `agents-editor-state`（原 `AgentsPageSections.tsx` 已删除）
- [x] T-04 ✅ 技能页方案 B：`skills-catalog-list` / `skills-detail-panel` / `skills-meta-panel` / `skills-tab-bar` / `skills-page-header` + 页面 CSS
- [x] T-05 ✅ 技能页模型 `skills-page-model`（原 `skills-installed-section.tsx` 已删除）
- [x] T-06 ✅ 单测 5 个文件（`agents-page-data` 21 / `agents-editor-state` 16 / `agents-inspector-panel` 7 / `agents-catalog-panel` 8 RTL / `skills-page-model` 20）
- [x] T-07 ✅ 多轮复查（见下）与真机走查
- [x] T-08 ✅ 门禁全绿

## 实施记录

**新增（`apps/web/src/components/agents/`）**：`agents-page.css` / `agents-primitives.tsx` / `agents-page-header.tsx` / `agents-toolbar.tsx` / `agents-catalog-panel.tsx`(+test) / `agents-editor-panel.tsx` / `agents-inspector-panel.tsx`(+test) / `agents-page-data.ts`(+test) / `agents-editor-state.ts`(+test)。
**新增（`apps/web/src/components/skills/`）**：`skills-page.css` / `skills-catalog-list.tsx` / `skills-detail-panel.tsx` / `skills-meta-panel.tsx` / `skills-tab-bar.tsx`（重写）/ `skills-page-header.tsx`（重写）/ `skills-page-model.ts`(+test)。
**新增（共享）**：`apps/web/src/styles/console-surfaces.css`。
**改写**：`pages/misc/AgentsPage.tsx`（479 → 398）、`pages/skills/SkillsPage.tsx`（876 → 596）。
**删除**：`components/agents/AgentsPageSections.tsx`（1119 行）、`components/skills/skills-installed-section.tsx`（全仓无残留引用，已核验）。

阶段行数：`agents-page.css` 784 → **154**、`skills-page.css` 675 → **288**（其余进入共享层 672 行），三档合计 **1114 行**（原 1459 行），且不再有两套平行控件。

## 复查修复（多轮，均在门禁前完成）

1. **筛选口径自相矛盾**：类型筛选比对 `source`（用户创建的 Agent 通常是 `configured`）而头部统计按 `origin` 计 → 会出现「统计自定义 2、筛选出 0 条」。统一按 `origin`（`AgentOriginFilter`），文案改「全部类型」。
2. **排序说明与实现相反**：目录头写「启用 → 自定义 → 名称」，实现是「内置先于自定义」→ 删掉误导文案、修正注释，并用测试固定真实契约（行为未改）。
3. **列表行丢失共享外壳**：重构中行类与 `console-row` 未同时挂载 → 丢失 hover / 选中竖条 / 内距（自查发现并修）。
4. **内联魔法数字**：8 处（4 个 textarea 的 `minHeight`、工具条下拉宽度、告警与注册源内缩、标签行）→ 收进 `console-textarea--sm/md/lg`、`console-alert--inset`、`console-tag-row`、`agents-toolbar__role/__status`、`skills-registry-slot`；整页仅剩 1 处必要内联（`background: agent.color` 动态值）。
5. **导出面收窄**：`AgentsStat` / `AgentStatusFilter` / `AgentOriginFilter` / `LocalSkillLike` 仅内部使用 → 收回模块私有。
6. **检视栏提示词判定**：原按 `systemPrompt` 非空判「已自定义」，与新增的内置提示词覆盖功能冲突 → 改用 `promptMetadata.hasPromptOverride`（`summarizeAgentPrompt` + 7 用例）。
7. **搜索框图标压住占位符**（技能页）→ 补 `padding-left`。
8. **安装来源选择会串到别的技能** → 按条目记忆 `{ rowId, sourceId }`，并在右列校验「来源不在启用清单时回落默认来源」。

## 真机走查记录（2026-11-03）

**环境与步骤**（全部命令已实测，可复现）：

1. `node demo/layout-demos/walkthrough/mock-gateway.mjs`（mock 网关，端口 **3101**；7 个 Agent + 26 条市场技能 + 5 条已安装 + 2 条本地 + 3 个注册源，覆盖全部状态分支；脚本已随本提交入库，改数据即可复用于其它页面族）
2. `cd apps/web && bunx vite --port 5199 --strictPort`
3. `agent-browser set viewport 1440 900` → `open http://127.0.0.1:5199/`
4. 注入登录态（**必须带 `email`，否则当前 store 水合后整树不渲染**）：
   `agent-browser eval "localStorage.setItem('onboarded','1'); localStorage.setItem('telemetry_consent_shown','1'); localStorage.setItem('auth-store', JSON.stringify({state:{accessToken:'tok',refreshToken:'ref',tokenExpiresAt:9999999999999,email:'dev@local',gatewayUrl:'http://127.0.0.1:3101',webPort:3000,webAccessEnabled:false,webExposeLan:false},version:0}));"`
5. `open http://127.0.0.1:5199/agents` 与 `/skills`；`eval` 读 DOM 指标 / `screenshot` / `console` / `errors`；`close --all` 收尾（编辑 `.tsx` 会触发 HMR 整页重载，截图前需重新导航）

**核对结果**（截图见 `evidence/screenshots/`）：

| 视图 | 1440（三栏） | 1280（两栏） | 980（单栏） |
| --- | --- | --- | --- |
| `/agents` | `272 / 495 / 264`px，7 行目录，9 行检视，整页无滚动 | `264 / 619`px，检视整行下移 | `595`px 单列 |
| `/skills` | `296 / 471 / 264`px，24 行市场 + 分页「1-24 / 26 · 1 2」 | `288 / 595`px | `595`px 单列 |

- **Agent 页**：标题行统计「全部 7 · 已启用 5 · 已禁用 2 · 自定义 4」；工具条（搜索 + 类型分段 + 角色/状态下拉 + 匹配 7/7）；目录行含状态点 / 名称 / 已修改 / 提示词覆盖 / 已禁用徽章 / 角色 / 模型；编辑器含内置只读提示、基础/角色/模型/提示词与备注/危险操作、粘底操作条；检视栏 9 行元信息 + 覆盖情况 + **当前提示词（用户覆盖）+ 系统默认提示词 + 恢复提示**（提示词覆盖功能的配套展示真机确认）。
- **技能页**：市场 24 行 + 已安装徽章 + 分页；**已安装** 5 行（系统预装 / `v1.2.0 → v1.3.0` / 可更新 / 已禁用 / 系统目录）+ 「已安装 5 · 可更新 2」+ 检查更新；**本地** 2 行 + 「工作区技能 2 个」+ 重新扫描；详情 tabs（概览 / README / 权限 / 更新日志）；动作按视图分派（安装 / 重新安装、启停开关、更新到 vX、移除）；右列元信息与权限清单 / 注册源管理（3 个来源，含只读标记与停用开关）。
- **主题**：暗色（1440 各视图）与亮色（`document.documentElement.classList.add('light')`）均核对通过，无对比度或层级异常。
- `agent-browser errors`：**空**（无未捕获异常）。

**走查发现并修复的 3 处问题**：

1. **1181–1400px 区间三栏把编辑器压到 203–443px（可用性缺陷）**。实测应用侧栏 + 页面内边距约占 **385px**，三栏同时展开时编辑器只剩「视口 − 945px」：1440 → 443px、1360 → 363px、1280 → **283px**、1200 → **203px**。修法：两侧固定列收窄（Agent `296/292 → 272/264`、技能 `316/282 → 296/264`），三栏阈值 `1180px → 1360px`；修后 1440 编辑器 **495 / 471px**，1280 与 1200 改走两栏（619 / 539px+），实测各档均无整页滚动。
2. **本地技能显示市场版本**（同 id 时 `repo-conventions` 列表 `v0.1.0`、元信息却 `v1.6.2`/`document`）。修法：新增纯函数 `mergeSkillDisplayDetail` —— 名称/版本/描述/分类/标签/安装量以**条目自身**为准（本地=本地清单、已安装=已装版本、市场=市场版本），市场详情只补充 README/权限/作者/许可/更新日志；顺带去掉「已装版本」与版本徽章的重复行（3 条新单测）。
3. **市场里已安装条目的按钮写着「已安装」**（状态词却承担动作）。改为「重新安装」——状态由旁边的「已安装 vX」徽章表达。

**环境噪声（非本次缺陷，登记备查）**：① mock 网关与临时 vite 被环境回收一次（`HTTP 000`），重启即恢复；② 走查期间他人并行编辑 `layout/**` 与 `ui-state/**` 等文件，Vite HMR 报 `Failed to reload ...`，并出现两次 `#root` 子树为空的瞬态（其文件停在半截状态所致，清空 localStorage 可确认应用本身正常）；③ 我的文件被并行写入**回退过 3 次**（列宽、详情面板 `detail` 传递、去重条件），均在发现后重新应用并 `grep` 逐条校验。

## 跨层修复（提示词覆盖：等于默认值不得固化）

真机/复查中发现同族缺陷跨客户端与网关两层，已一并修掉（详细证据在 `workflow/done/261102-模式与内置角色提示词用户级覆盖.md` 的 V-12）：

- **客户端** `apps/web/src/pages/misc/agents-builtin-update-input.ts`：提交文本等于 `promptMetadata.defaultText` 时按 `null` 提交（「无覆盖」语义），避免「恢复默认」把默认值写成覆盖。
- **网关** `services/agent-gateway/src/agent/agent-catalog.ts`：覆盖记录**只存与默认不同的字段**（`systemPrompt` / `model` / `variant` / `fallbackModels` 逐字段归一）。原先只靠 `sameAsDefault`（要求四字段全等于默认才删整条记录），「改了模型 + 提示词等于默认」这类组合会被漏掉，等上游升级后把该 Agent 静默钉在旧配置上。网关用例 13 → **15**，并做**两次变异校验**（分别禁用提示词归一、禁用三字段归一）确认新用例会红。

## 遗留（均为「非本任务范围」，无阻塞项）

1. **.NET 网关功能不对等**：`services/agent-gateway-dotnet/.../ManagedAgentCatalog.cs:133` 把 `SystemPrompt` 列入内置 Agent 的禁止更新字段（会抛异常），`StoredBuiltinOverride` 无该字段 → 提示词覆盖在 .NET 侧不可用；无脚本/文档会启动该网关，判断为迁移中的实现，本次未动。
2. **`useInstalledSkills.dismissError` 仍未接线**：与旧页面行为一致（旧版也无关闭入口），不擅自新增交互。
3. **字号仍为裸 px**：仓库未定义字号 token（`DESIGN-TOKENS` 只有间距/圆角/颜色），既有代码同样如此，未擅自发明。
4. **1/2/3px 级微间距保持裸值**：低于 4px 阶梯，强行对齐会破坏徽章与图标的紧致感。
5. **demo 保留**：`demo/layout-demos/` 六套原型（含未选中的 4 套）留在磁盘作为对照，未删除。

## Risks

- **R-01 三栏阈值依赖应用侧栏宽度**：实测 chrome ≈ 385px（classic 布局 + 侧栏）。若侧栏宽度或页面内边距再变，1360px 这个阈值需要重算（公式：编辑器宽度 = 视口 − 945px）。fusion 布局 chrome 不同，未单独走查。
- **R-02 `shared-ui` 组件不再被 web 消费**：`SkillMarketHome` / `SkillDetailPage` 在 web 侧已无引用（移动端与 harness 仍可能复用），本任务按「不动包契约」处理；确认无消费方后应单独立项清理。
- **R-03 并行编辑**：本次多处文件在走查期间被并行写入回退，新增视图文件属于热点（尤其 `agents-editor-panel.tsx`）。改前同步、改后 `grep` 复核是必要步骤。
- **R-04 体积**：`agents-page.css` 154 行 + `skills-page.css` 288 行 + 共享 672 行；新增组件均在 400 行以内，未逼近 1500 行上限。

## Notes

- 真机走查的可复用脚本：`demo/layout-demos/walkthrough/mock-gateway.mjs`（**已入库**，改数据即可用于其它页面族）。截图与临时服务日志属本地产物：`.agentdocs/runtime/.../evidence/screenshots/*.png`（8 张），按 `.gitignore:56` 不入库。
- 视觉验证的**唯一未覆盖项**：无 axe 专项审计（当前 agent-browser 版本无 `a11y` 子命令，axe-core 未注入）。结构层面的替代证据是类名一致性脚本（两页 `className` 零未定义、本页 CSS 无未使用规则）与 a11y 快照走查；应用级无障碍此前已由 `261103-应用级无障碍专项` 统一清零。
- 本次未提交任何 git commit（工作区改动 + 新增文件）。
