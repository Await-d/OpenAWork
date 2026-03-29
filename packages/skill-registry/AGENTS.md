# skill-registry — 知识库

## 概述

技能安装/生命周期/安全沙箱管理。负责发现、安装、验证和管理来自多个注册源的 Agent 技能。

## 目录结构

```
src/
├── index.ts          # 公开导出
├── types.ts          # 技能类型（SkillManifest、SkillStatus 等）
├── installer.ts      # 核心安装逻辑
├── lifecycle.ts      # 技能生命周期（激活、停用、卸载）
├── source.ts         # 注册源管理
├── client.ts         # 注册中心 HTTP 客户端
├── installers/       # 平台特定安装器
├── security/         # 沙箱与验证
└── cli/              # 技能管理 CLI 命令
```

## 查找指引

| 任务                      | 位置               |
| ------------------------- | ------------------ |
| 安装技能                  | `src/installer.ts` |
| 技能生命周期（激活/停用） | `src/lifecycle.ts` |
| 注册源管理（添加/列出）   | `src/source.ts`    |
| 安全验证                  | `src/security/`    |
| 技能类型定义              | `src/types.ts`     |
| CLI 命令                  | `src/cli/`         |

## 禁止事项

- 安装技能时禁止绕过 `src/security/` 验证——沙箱为强制要求。
- 禁止硬编码注册中心 URL——使用 `src/source.ts` 进行源管理。
