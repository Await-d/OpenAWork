# 工具上下文深度优化

## 复杂度评估
跨消息投影、压缩、上游、SQLite、工具协议与遥测 +2；八项独立交付 +2；迁移与性能验证 +1；证据持久化 +1。总分 6，完整编排。

## 目标
在既有单条/累计工具输出治理基础上，完成动态预算和指标、索引化回读、统一上游门禁、附件结构化关联、集中策略、分页性能、模块拆分及结构化工具输出协议，并保持旧会话兼容。

## 任务
- [x] T1 失败用例：动态策略、上游终门禁、结构化附件、直接索引与结构化输出
- [x] T2 集中策略与动态模型预算、统一上游终门禁和结构化指标
- [x] T3 SQLite 工具结果索引与精确查询、兼容回填
- [x] T4 工具附件原子关联、分页单次扫描优化、结构化输出协议
- [x] T5 按职责拆分 schema 与文本分页模块并保持公共导出兼容
- [x] T6 全量门禁、真实会话重放、性能证据和回滚产物

## 当前证据
- 新旧专项 16 文件、86 测试通过。
- Gateway build、Gateway typecheck、shared typecheck、Prettier、ESLint、git diff --check 均通过。
- 指定会话重放保持：budgetedToolChars=37639、cleared=20。
- SQLite 真实查询计划使用 idx_part_v2_tool_call；旧行回填后精确读取成功。
- 回滚副本输出：ROLLBACK_OK、RESTORED_BASELINE_MATCH=YES。
- Memory sync: completed
