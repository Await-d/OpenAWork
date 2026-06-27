# Team SOUL 提示词模板库

> 参考 GitHub Spec Kit 的模板存放模式，将五角色 SOUL 提示词从 `soul-defaults.ts` 中拆出为独立 Markdown 文件，方便后续维护更新。

## 目录结构

```
team-phase-a-content/
├── soul-defaults.ts              # 加载器：读取 souls/*.md 并导出 DEFAULT_SOULS
├── constitution-templates.ts     # 宪法预置模板（不变）
├── index.ts                      # 导出入口（不变）
└── templates/                    # ← 提示词模板库（参考 spec-kit/templates/）
    ├── README.md                 # 本文件
    ├── souls/                    # ← 五角色 SOUL 模板（参考 spec-kit/templates/commands/）
    │   ├── reception.md
    │   ├── pm1.md
    │   ├── pm2.md
    │   ├── executor.md
    │   └── reviewer.md
    └── shared/                   # ← 跨角色共享文档（参考 spec-kit/templates/constitution-template.md）
        └── quality-gates.md      # 团队质量门禁（所有角色共享附录）
```

## 设计原则（借鉴 spec-kit）

1. **模板即提示词**：每个 `.md` 文件本身就是注入给 LLM 的完整 SOUL，不是"需要加工的半成品"
2. **frontmatter + 正文**：frontmatter 携带结构化元数据（identity/tone/focus/boundaries/output_style/handoffs），正文是自然语言指令
3. **版本化**：`soul-defaults.ts` 中的 `DEFAULT_SOUL_VERSION` 每次实质性修改 +1，自动下发到未被用户自定义的默认副本
4. **可组合**：`shared/quality-gates.md` 是所有角色共享的附录，各角色 SOUL 引用它而非重复定义
5. **handoffs 声明**：每个角色 SOUL 的 frontmatter 中声明可 handoff 的目标角色和条件（借鉴 spec-kit 的 `handoffs` frontmatter）

## 修改流程

1. 编辑 `templates/souls/<role>.md` 或 `templates/shared/quality-gates.md`
2. 在 `soul-defaults.ts` 中将 `DEFAULT_SOUL_VERSION` +1
3. 运行 `pnpm --filter @openAwork/agent-gateway typecheck` 验证
4. 运行 `pnpm --filter @openAwork/agent-gateway test` 验证

## 来源标注

每个 SOUL 文件中融合了来自以下两个开源项目的提示词模式：

- **spec-kit**（GitHub Spec Kit）：多步精炼流程、Constitution Check 门禁、`[NEEDS CLARIFICATION]` 标记、checklist "Unit Tests for English"、Coverage 统计、Gap Type 分类
- **hermes-agent**（NousResearch）：TDD RED-GREEN-REFACTOR、systematic-debugging 4 阶段法、subagent-driven-development 两阶段 review、plan bite-sized task 格式、Footprint Ladder、Fresh subagent per task
