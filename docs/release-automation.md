# 自动版本调整与发布准备

## 目标

仓库当前的 desktop/mobile 发布链仍然复用既有的 GitHub Actions workflow：

- `release-desktop.yml`
- `release-mobile.yml`

本次新增的 `prepare-release.yml` 不直接替代它们，而是负责在发布前自动完成以下动作：

1. 自动推断下一个 semver（或按显式 bump 级别提升）
2. 同步 monorepo 内所有版本文件
3. 在真正 bump / tag 之前运行发布前质量门禁
4. 在 GitHub workflow 运行时临时生成当前版本的中文发布稿
5. 提交版本 bump 结果
6. 按目标触发现有 desktop/mobile 发布工作流

> 从现在开始，**不要再手工逐个修改 `package.json` / `app.json` / `Cargo.toml` 来发版**。标准入口是 GitHub Actions 的 `Prepare Release`，本地脚本仅用于预演或特殊场景。

> 从现在开始，**每次发布都必须填写中文更新总结**。`Prepare Release` 会在 workflow 运行时临时生成发布稿，并通过 annotated tag / workflow input 传给 desktop/mobile 发布流。

> 除了手填的中文摘要外，版本日志还会基于最近一段 git 提交历史自动提取“变更条目”，作为发布稿草案。

## 版本规则

版本 bump 脚本：`scripts/release-version.mjs`

支持两种模式：

- 显式设置版本：`node scripts/release-version.mjs 1.2.3`
- 自动/半自动 bump：`node scripts/release-version.mjs --bump auto|patch|minor|major`

`auto` 模式的推断规则：

- `BREAKING CHANGE` 或 `type(scope)!:` → `major`
- `feat:` / `feat(scope):` → `minor`
- 其他 conventional commits → `patch`

版本号采用“**9 进 1**”进位规则，而不是无限 patch 增长：

- `0.0.1 → 0.0.2`
- `0.0.9 → 0.1.0`
- `0.1.9 → 0.2.0`
- `0.9.9 → 1.0.0`

也就是说，当 patch 或 minor 组件达到 `10` 时，会自动进位到左侧组件。

## 同步范围

脚本会统一更新以下文件：

- 根 `package.json`
- `apps/**/package.json`
- `packages/**/package.json`
- `services/**/package.json`
- `apps/mobile/app.json`
- `apps/desktop/src-tauri/Cargo.toml`

> `apps/desktop/src-tauri/tauri.conf.json` 已直接读取根 `package.json`，无需单独写入。

## GitHub Actions 用法

手动运行 `Prepare Release` workflow 时，可选择以下目标：

- `desktop-preview`
- `desktop-stable`
- `mobile-preview`
- `mobile-production`
- `all-preview`
- `all-production`

发布前门禁（当前已接入 `Prepare Release`）：

- `pnpm format:check`
- `pnpm typecheck`
- `pnpm --filter @openAwork/web build`
- `pnpm --filter @openAwork/agent-gateway test:unit`
- `pnpm --filter @openAwork/mobile test`
- `scripts/release-notes.mjs` dry-run 校验（使用预计版本号生成发布稿草案）

### CI 与发布包的区别

- `CI` workflow 只负责质量检查、测试和常规构建验证，**不会自动发布桌面/移动端安装包**。
- 桌面安装包由 `release-desktop.yml` 在 tag / 手动触发时生成，并发布到 GitHub Release。
- `release-desktop.yml` 也会把安装包目录上传为 workflow artifacts，便于在 Actions 页面直接下载。
- 移动端安装包由 `release-mobile.yml` 触发 EAS 云构建，workflow 中保存的是构建结果 JSON 与产物链接，而不是仓库本地文件。

当前**暂不纳入**发布门禁的项目：

- `pnpm --filter @openAwork/desktop exec vite build`
- `pnpm --filter @openAwork/agent-gateway build:binary`

这两项目前属于已知开发中红项，待相关负责人收口后再提升为正式门禁。

并且必须提供：

- `release_notes`：中文更新总结；若需要多行内容，可在输入中使用 `\n` 转义

行为映射：

- `desktop-preview`：自动 bump → 提交 → 创建 `desktop-vX.Y.Z-preview` tag
- `desktop-stable`：自动 bump → 提交 → 创建 `desktop-vX.Y.Z` tag
- `mobile-preview`：自动 bump → 提交 → dispatch `release-mobile.yml`（`profile=preview`）
- `mobile-production`：自动 bump → 提交 → 创建 `mobile-vX.Y.Z` tag
- `all-preview`：desktop preview tag + mobile preview dispatch
- `all-production`：desktop stable tag + mobile production tag

发布日志行为：

- `Prepare Release` 会在 workflow 临时文件 `release-notes.md` 中生成发布稿，并自动提取最近一段 git 提交标题，写入“自动提取变更”段落
- 发布稿会额外生成一段更面向终端用户的“本次更新”摘要，把最近的有效提交整理成简洁变更说明
- tag 驱动的 desktop/mobile 发布会从 annotated tag 读取完整发布稿；mobile preview dispatch 则通过 `release_notes_body` input 透传完整发布稿
- `release-desktop.yml` 会把这份发布稿写入 GitHub Release body
- `release-desktop.yml` 在桌面多平台安装包构建完成后，还会把实际下载链接自动追加到 GitHub Release body
- 若直接手动触发 `release-desktop.yml`，workflow 会基于当前仓库版本与所选 channel 自动计算 `desktop-vX.Y.Z` / `desktop-vX.Y.Z-preview`，并继续生成发布摘要与 GitHub Release body
- 若直接手动触发 `release-desktop.yml` / `release-mobile.yml`，workflow 会先基于 `## 更新总结` 自动补全“本次更新”和“自动提取变更”段落，再进入后续发布流程
- `release-mobile.yml` 会读取同一份发布稿，把首行中文总结用作 OTA message，并把完整内容输出到 workflow summary
- 若 EAS 构建失败或未生成 `eas-build-results` artifact，`release-mobile.yml` 仍会输出兜底版 `mobile-release-summary`，避免发布说明链路被构建失败一并中断
- 若 `EXPO_TOKEN` 未配置，移动端 workflow 会明确跳过 EAS Build / OTA / Submit，并在发布摘要中标记为“已跳过”，避免把凭证缺失误写成构建异常
- `release-desktop.yml` / `release-mobile.yml` 现在都通过 `scripts/release-result-summary.mjs` 生成统一的“发布结果”摘要模板
- 桌面端会输出 `desktop-release-summary` artifact，并将安装包链接同时写入 GitHub Release body 和 workflow summary
- 移动端会输出 `mobile-release-summary` artifact，并将 EAS 构建产物链接追加到 workflow summary
- `scripts/release-aggregate-summary.mjs` 会把 desktop / mobile 的结果进一步聚合成单一“总发布摘要”页面
- `release-desktop.yml` 会先生成仅含桌面结果的总发布摘要；若后续 `release-mobile.yml` 检测到同版本 desktop Release 已存在，则会把移动端结果合并回同一桌面 Release body，并输出 `release-aggregate-summary` artifact

## 本地命令

```bash
pnpm version:bump -- --bump auto
pnpm version:bump -- --bump minor
pnpm version:bump:dry-run
pnpm build:desktop
pnpm package:desktop
```

### 本地桌面安装包

- `pnpm build:desktop` / `pnpm package:desktop` 会执行桌面端 Tauri 打包。
- 构建成功后，脚本会直接打印识别到的安装包路径。
- 默认安装包目录为：`apps/desktop/src-tauri/target/release/bundle/`
- Linux 本地打包前需先安装：`pkg-config libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`

## 注意事项

- `mobile-v*` tag 仍然表示正式 mobile release，不要用它承载 preview 流。
- mobile preview 通过 `workflow_dispatch` 触发，OTA message 可由 `prepare-release.yml` 自动传入。
- Desktop Rust crate 版本已经纳入同步范围，避免桌面打包元数据与 JS 侧版本脱节。
- 发布稿不再落库存储；如果 annotated tag 或 workflow input 没有携带有效中文发布稿，desktop/mobile 发布 workflow 会直接失败。
