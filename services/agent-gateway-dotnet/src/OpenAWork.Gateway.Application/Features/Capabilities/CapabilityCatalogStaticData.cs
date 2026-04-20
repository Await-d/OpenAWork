using System.Text.Json;
using OpenAWork.Gateway.Contracts.Capabilities;
using OpenAWork.Gateway.Contracts.Tools;

namespace OpenAWork.Gateway.Application.Features.Capabilities;

internal static class CapabilityCatalogStaticData
{
    internal static IReadOnlyList<(string CanonicalName, string PresentedName, string Description)> Tools { get; } =
    [
        ("websearch", "websearch", "Search the web for current information"),
        ("codesearch", "codesearch", "Search code examples and snippets"),
        ("webfetch", "webfetch", "Fetch content from a URL"),
        ("lsp_diagnostics", "lsp_diagnostics", "Run diagnostics for current code"),
        ("lsp_goto_definition", "lsp_goto_definition", "Go to definition"),
        ("lsp_goto_implementation", "lsp_goto_implementation", "Go to implementation"),
        ("lsp_find_references", "lsp_find_references", "Find references"),
        ("lsp_symbols", "lsp_symbols", "List code symbols"),
        ("lsp_prepare_rename", "lsp_prepare_rename", "Check rename availability"),
        ("lsp_rename", "lsp_rename", "Rename symbol"),
        ("lsp_hover", "lsp_hover", "Show hover information"),
        ("lsp_call_hierarchy", "lsp_call_hierarchy", "Inspect call hierarchy"),
        ("task_create", "task_create", "Create task item"),
        ("task_get", "task_get", "Get task item"),
        ("task_list", "task_list", "List task items"),
        ("task_update", "task_update", "Update task item"),
        ("list", "list", "List directory entries"),
        ("read", "read", "Read file contents"),
        ("glob", "glob", "Glob file search"),
        ("grep", "grep", "Search file contents"),
        ("edit", "edit", "Edit file contents"),
        ("multi_edit", "multi_edit", "Apply multi-file edits"),
        ("skill", "Skill", "Execute installed skill"),
        ("batch", "batch", "Run batched operations"),
        ("bash", "bash", "Run shell command"),
        ("apply_patch", "apply_patch", "Apply unified patch"),
        ("question", "AskUserQuestion", "Ask the user a structured question"),
        ("enter_plan_mode", "EnterPlanMode", "Enter plan mode"),
        ("exit_plan_mode", "ExitPlanMode", "Exit plan mode"),
        ("read_tool_output", "read_tool_output", "Read stored tool output"),
        ("task", "task", "Launch sub-task execution"),
        ("background_output", "background_output", "Read background task output"),
        ("background_cancel", "background_cancel", "Cancel background task"),
        ("session_list", "session_list", "List sessions"),
        ("session_read", "session_read", "Read session transcript"),
        ("session_search", "session_search", "Search sessions"),
        ("session_info", "session_info", "Get session metadata"),
        ("ast_grep_search", "ast_grep_search", "AST-aware code search"),
        ("ast_grep_replace", "ast_grep_replace", "AST-aware code replace"),
        ("interactive_bash", "interactive_bash", "Interactive bash shell"),
        ("call_omo_agent", "Agent", "Invoke OMO agent"),
        ("skill_mcp", "skill_mcp", "Invoke skill MCP"),
        ("look_at", "look_at", "Inspect media file"),
        ("desktop_automation", "desktop_automation", "Control desktop automation"),
        ("workspace_review_status", "workspace_review_status", "Workspace review status"),
        ("workspace_review_diff", "workspace_review_diff", "Workspace review diff"),
        ("write", "write", "Write file contents"),
        ("workspace_create_directory", "workspace_create_directory", "Create workspace directory"),
        ("workspace_review_revert", "workspace_review_revert", "Revert workspace review changes"),
        ("todo_write", "todo_write", "Write todo list"),
        ("todo_read", "todo_read", "Read todo list"),
        ("sub_todo_write", "sub_todo_write", "Write sub todo list"),
        ("sub_todo_read", "sub_todo_read", "Read sub todo list"),
        ("mcp_list_tools", "mcp_list_tools", "List MCP tools"),
        ("mcp_call", "mcp_call", "Call MCP tool"),
    ];

    internal static IReadOnlyList<CapabilityDescriptorResponse> ReferenceSkills { get; } =
    [
        new("playwright", "skill", "playwright", "Browser automation skill/provider entry", "reference", null, null, false, null, null),
        new("agent-browser", "skill", "agent-browser", "Alternative browser provider skill", "reference", null, null, false, null, null),
        new("playwright-cli", "skill", "playwright-cli", "CLI-backed playwright skill implementation", "reference", null, null, false, null, null),
        new("frontend-ui-ux", "skill", "frontend-ui-ux", "Frontend UI/UX skill", "reference", null, null, false, null, null),
        new("git-master", "skill", "git-master", "Git workflow skill", "reference", null, null, false, null, null),
        new("dev-browser", "skill", "dev-browser", "Developer browser workflow skill", "reference", null, null, false, null, null),
    ];

    internal static IReadOnlyList<CapabilityDescriptorResponse> BuiltinMcps { get; } =
    [
        new("websearch", "mcp", "websearch", "网页搜索 MCP server", "reference", ["websearch_web_search_exa"], null, false, null, null),
        new("context7", "mcp", "context7", "文档检索 MCP server", "reference", ["context7_resolve-library-id", "context7_query-docs"], null, false, null, null),
    ];

    internal static IReadOnlyList<CapabilityDescriptorResponse> BuiltinSkills { get; } =
    [
        new("com.openAwork.builtin.file-read", "skill", "File Read", "Read file contents from the local filesystem", "builtin", ["filesystem.read"], null, false, null, null),
        new("com.openAwork.builtin.clipboard-read", "skill", "Clipboard Read", "Read text content from the system clipboard", "builtin", ["clipboard.read"], null, false, null, null),
        new("com.openAwork.builtin.web-search", "skill", "Web Search", "Search the web for current information", "builtin", ["search.web", "information.real-time"], null, false, null, null),
        new("com.openAwork.builtin.agent-browser", "skill", "agent-browser", "Automates browser interactions for web testing, form filling, screenshots, and data extraction.", "builtin", ["browser.automation", "web.testing", "screenshot", "form.filling", "data.extraction"], null, false, null, null),
        new("com.openAwork.builtin.dev-browser", "skill", "dev-browser", "Browser automation with persistent page state. Use for navigating websites, filling forms, screenshots, extracting web data, testing web apps.", "builtin", ["browser.automation", "web.testing", "persistent.state", "aria.snapshot"], null, false, null, null),
        new("com.openAwork.builtin.frontend-ui-ux", "skill", "frontend-ui-ux", "Designer-turned-developer who crafts stunning UI/UX even without design mockups", "builtin", ["frontend.design", "ui.ux", "visual.design", "css.animation"], null, false, null, null),
        new("com.openAwork.builtin.git-master", "skill", "git-master", "MUST USE for ANY git operations. Atomic commits, rebase/squash, history search (blame, bisect, log -S).", "builtin", ["git.commit", "git.rebase", "git.history", "git.bisect", "git.blame"], null, false, null, null),
    ];

    internal static IReadOnlyList<CapabilityDescriptorResponse> BuiltinAgents { get; } =
    [
        new("build", "agent", "build", "默认主 agent", "builtin", null, true, false, new("general", "default", null, "high"), null),
        new("zeus", "agent", "zeus", "团队领导 — MECE 任务拆解、角色分派、依赖优先级、审查门控", "builtin", null, true, false, new("leader", "coordinator", null, "high"), ["leader", "team-leader", "coordinator", "/prompts:team-leader"]),
        new("plan", "agent", "plan", "规划 agent", "builtin", null, true, false, new("planner", "default", null, "high"), ["planner", "/prompts:planner", "/ccg:team-plan"]),
        new("general", "agent", "general", "通用 agent", "builtin", null, true, false, new("general", "default", null, "high"), ["default", "general-purpose"]),
        new("explore", "agent", "explore", "代码库搜索专家 — 意图分析、并行搜索、结构化结果", "builtin", null, true, false, new("researcher", "explore", null, "high"), ["explorer"]),
        new("sisyphus", "agent", "sisyphus", "AI 编排代理 — 规划、委派、验证、交付", "builtin", null, true, false, new("general", "default", null, "low"), ["sisyphus"]),
        new("hephaestus", "agent", "hephaestus", "自主深度工作者 — 深度探索、目标实施、强验证交付", "builtin", null, true, false, new("executor", "default", null, "high"), ["executor", "/prompts:executor", "/ccg:team-exec"]),
        new("prometheus", "agent", "prometheus", "战略规划顾问 — 只规划不实施，将实施请求解读为创建工作计划", "builtin", null, true, false, new("planner", "default", null, "high"), ["planner"]),
        new("oracle", "agent", "oracle", "只读战略顾问 — 架构决策、困难调试、自我审查", "builtin", null, true, false, new("researcher", "architect", null, "high"), ["architect", "debugger", "code-reviewer", "init-architect"]),
        new("librarian", "agent", "librarian", "代码库与文档检索专家 — 证据驱动、出处标注、请求分类检索", "builtin", null, true, false, new("researcher", "librarian", null, "high"), ["librarian"]),
        new("metis", "agent", "metis", "预规划顾问 — 意图分类、AI-slop 检测、澄清问题生成", "builtin", null, true, false, new("researcher", "analyst", null, "high"), ["analyst", "/prompts:analyst", "/ccg:team-research"]),
        new("momus", "agent", "momus", "计划审查专家 — 严苛审查、四维度检查、OKAY/REJECT 判定", "builtin", null, true, false, new("reviewer", "critic", null, "high"), ["critic", "/prompts:critic", "/ccg:team-review"]),
        new("atlas", "agent", "atlas", "编排验证专家 — 委派任务、验证一切、没有证据=未完成", "builtin", null, true, false, new("reviewer", "verifier", null, "low"), ["verifier", "/prompts:verifier"]),
        new("multimodal-looker", "agent", "multimodal-looker", "多模态分析专家 — PDF/图片/图表解读、信息提取", "builtin", null, true, false, new("researcher", null, ["multimodal"], "medium"), ["multimodal", "ui-ux-designer"]),
        new("sisyphus-junior", "agent", "sisyphus-junior", "聚焦执行者 — 绝不委派、待办纪律、原子化执行", "builtin", null, true, false, new("executor", "default", null, "high"), ["junior"]),
    ];

    internal static IReadOnlyList<CapabilityDescriptorResponse> Commands { get; } =
    [
        Command("slash-compact", "/compact", "Compact the current session — 压缩当前会话上下文（别名：/summarize）", ["composer"]),
        Command("slash-summarize", "/summarize", "Summarize the current session — /compact 的别名", ["composer"]),
        Command("slash-handoff", "/handoff", "Generate continuation-ready handoff context — 生成可续跑的结构化交接摘要", ["composer"]),
        Command("slash-buddy", "/buddy", "Open Buddy companion panel — 打开 Buddy 伴侣面板并显式唤起陪跑模式", ["composer"]),
        Command("nav-chat", "新建对话", "前往 Chat 页面", ["palette"]),
        Command("nav-sessions", "会话列表", "查看所有会话", ["palette"]),
        Command("nav-settings", "设置", "设置", ["palette"]),
        Command("toggle-theme", "切换主题", "切换当前主题", ["palette"]),
        Command("slash-init-deep", "/init-deep", "Inject deep AGENTS context — 递归汇总已有 AGENTS.md 到当前会话", ["composer"]),
        Command("slash-ralph-loop", "/ralph-loop", "Start Ralph Loop — 启动自引用持续开发循环（默认上限 100 轮）", ["composer"]),
        Command("slash-ulw-loop", "/ulw-loop", "Start ULW Loop — 启动需要验证收尾的 UltraWork 循环", ["composer"]),
        Command("slash-ulw-verify", "/ulw-verify", "Verify ULW result — 用 --pass / --fail 提交 ULW 验证结果", ["composer"]),
        Command("slash-cancel-ralph", "/cancel-ralph", "Cancel active loop state — 取消当前活动中的 Ralph/ULW 循环", ["composer"]),
        Command("slash-stop-continuation", "/stop-continuation", "Stop continuation systems — 停止当前 continuation / loop 状态", ["composer"]),
        Command("slash-refactor", "/refactor", "Start refactor workflow — 启动带任务追踪与验证预期的重构流程", ["composer"]),
        Command("slash-start-work", "/start-work", "Resume work from plan/task state — 从计划或任务状态恢复执行", ["composer"]),
    ];

    internal static IReadOnlyList<ToolDefinitionItemResponse> BuildToolDefinitions(bool presentedNames)
    {
        return Tools.Select((tool) => new ToolDefinitionItemResponse(
            presentedNames ? tool.PresentedName : tool.CanonicalName,
            tool.Description)).ToArray();
    }

    internal static IReadOnlyList<CapabilityDescriptorResponse> BuildToolCapabilities(bool presentedNames)
    {
        return Tools.Select((tool) => new CapabilityDescriptorResponse(
            presentedNames ? tool.PresentedName : tool.CanonicalName,
            "tool",
            presentedNames ? tool.PresentedName : tool.CanonicalName,
            tool.Description,
            "runtime",
            null,
            null,
            true,
            null,
            null)).ToArray();
    }

    private static CapabilityDescriptorResponse Command(string id, string label, string description, IReadOnlyList<string> contexts)
        => new(id, "command", label, description, "builtin", contexts, null, true, null, null);
}
