using System.Text.Json;

namespace OpenAWork.Gateway.Persistence.EFCore.Stores;

internal static class DefaultUserSeedData
{
    private const string AgentdocsSourceId = "github:Await-d/agentdocs-orchestrator";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private static readonly IReadOnlyList<string> RequiredRoles = ["leader", "planner", "researcher", "executor", "reviewer"];

    private static readonly IReadOnlyDictionary<string, string> RoleLabelMap = new Dictionary<string, string>
    {
        ["leader"] = "团队领导",
        ["planner"] = "团队负责人",
        ["researcher"] = "研究员",
        ["executor"] = "执行者",
        ["reviewer"] = "批评者",
    };

    private static readonly IReadOnlyDictionary<string, string> ProviderLabelMap = new Dictionary<string, string>
    {
        ["anthropic"] = "Anthropic",
        ["openai"] = "OpenAI",
        ["gemini"] = "Gemini",
        ["deepseek"] = "DeepSeek",
        ["ollama"] = "Ollama",
        ["openrouter"] = "OpenRouter",
        ["qwen"] = "Qwen",
        ["moonshot"] = "Moonshot",
    };

    private static readonly IReadOnlyDictionary<string, WorkflowRoleBindingSeed> PureOpenAiBindings = new Dictionary<string, WorkflowRoleBindingSeed>
    {
        ["leader"] = new("zeus", "openai", "gpt-5.4", "xhigh"),
        ["planner"] = new("prometheus", "openai", "gpt-5.4", "xhigh"),
        ["researcher"] = new("librarian", "openai", "gpt-5.4", "medium"),
        ["executor"] = new("hephaestus", "openai", "gpt-5.4", "high"),
        ["reviewer"] = new("momus", "openai", "gpt-5.4", "medium"),
    };

    private static readonly IReadOnlyDictionary<string, WorkflowRoleBindingSeed> PureAnthropicBindings = new Dictionary<string, WorkflowRoleBindingSeed>
    {
        ["leader"] = new("zeus", "anthropic", "claude-opus-4-6", "xhigh"),
        ["planner"] = new("prometheus", "anthropic", "claude-opus-4-6", "xhigh"),
        ["researcher"] = new("librarian", "anthropic", "claude-haiku-4-5", "medium"),
        ["executor"] = new("hephaestus", "anthropic", "claude-sonnet-4-6", "high"),
        ["reviewer"] = new("momus", "anthropic", "claude-opus-4-6", "high"),
    };

    private static readonly IReadOnlyDictionary<string, WorkflowRoleBindingSeed> MixedBindings = new Dictionary<string, WorkflowRoleBindingSeed>
    {
        ["leader"] = new("zeus", "openai", "gpt-5.4", "high"),
        ["planner"] = new("prometheus", "anthropic", "claude-opus-4-6", "xhigh"),
        ["researcher"] = new("librarian", "anthropic", "claude-haiku-4-5", "medium"),
        ["executor"] = new("hephaestus", "openai", "gpt-5.4", "high"),
        ["reviewer"] = new("momus", "openai", "gpt-5.4", "medium"),
    };

    public static IReadOnlyList<InstalledSkillSeed> InstalledSkills { get; } =
    [
        new(
            AgentdocsSourceId,
            "github:Await-d/agentdocs-orchestrator/agentdocs-orchestrator",
            "agentdocs-orchestrator",
            "Agentdocs Orchestrator",
            "1.0.0",
            "Advanced task orchestration system integrated with agentdocs knowledge management. Decomposes complex requests into atomic tasks, auto-creates workflow planning documents, manages multi-agent parallel execution, and syncs task status.",
            "Await-d",
            ["orchestration", "planning", "documentation"]),
        new(
            AgentdocsSourceId,
            "github:Await-d/agentdocs-orchestrator/schema-architect",
            "schema-architect",
            "Schema Architect",
            "1.0.0",
            "Design database table schemas from any relationship description, including full index strategy analysis.",
            "Await-d",
            ["database", "schema-design", "analysis"]),
    ];

    public static IReadOnlyList<WorkflowTemplateSeed> WorkflowTemplates { get; } =
    [
        new(
            SeedKey: "dev-team-full",
            Name: "完整开发团队（OpenAI + Anthropic 混合）",
            Description: "适合复杂功能开发、方案设计、实现与严格评审的完整开发闭环。规划与调研用 Claude 深度思考，领导与执行用 GPT 快速推进。",
            DefaultProvider: "openai",
            DefaultBindings: MixedBindings,
            OptionalAgentIds: ["atlas", "metis", "sisyphus-junior"],
            RecommendedDefault: false,
            RecommendedFor: "复杂跨模块需求、需要完整交付闭环的开发任务",
            TemplateFocus: "全流程交付 · 混合供应商",
            TemplatePriority: 2,
            TemplateScale: "full"),
        new(
            SeedKey: "dev-team-large",
            Name: "大型开发团队（纯 Anthropic）",
            Description: "适合复杂需求拆解与多阶段交付，强调分析、执行与质量审阅。全部角色使用 Claude 系列。",
            DefaultProvider: "anthropic",
            DefaultBindings: PureAnthropicBindings,
            OptionalAgentIds: ["atlas", "metis"],
            RecommendedDefault: false,
            RecommendedFor: "复杂功能开发、多阶段交付推进与里程碑管理",
            TemplateFocus: "复杂交付推进 · 纯 Claude",
            TemplatePriority: 4,
            TemplateScale: "large"),
        new(
            SeedKey: "dev-team-medium",
            Name: "中型开发团队（纯 OpenAI）",
            Description: "适合常规功能开发、缺陷修复和中等范围重构。全部角色使用 GPT 系列。",
            DefaultProvider: "openai",
            DefaultBindings: PureOpenAiBindings,
            OptionalAgentIds: ["atlas"],
            RecommendedDefault: true,
            RecommendedFor: "常规功能开发、缺陷修复与中等范围重构",
            TemplateFocus: "日常功能开发 · 纯 GPT",
            TemplatePriority: 1,
            TemplateScale: "medium"),
        new(
            SeedKey: "dev-team-small",
            Name: "小型开发团队（OpenAI + Anthropic 混合）",
            Description: "适合小需求、明确任务和快速交付的轻量开发模板。规划用 Claude，执行用 GPT。",
            DefaultProvider: "anthropic",
            DefaultBindings: MixedBindings,
            OptionalAgentIds: [],
            RecommendedDefault: false,
            RecommendedFor: "小需求、快速迭代与明确任务的直接落地",
            TemplateFocus: "快速小步迭代 · 混合供应商",
            TemplatePriority: 3,
            TemplateScale: "small"),
    ];

    public static string SerializeManifest(InstalledSkillSeed seed)
    {
        return JsonSerializer.Serialize(new
        {
            apiVersion = "agent-skill/v1",
            id = seed.SkillId,
            name = seed.Name,
            displayName = seed.DisplayName,
            version = seed.Version,
            description = seed.Description,
            author = seed.Author,
            capabilities = seed.Capabilities,
            permissions = Array.Empty<object>(),
        }, JsonOptions);
    }

    public static string SerializeWorkflowMetadata(WorkflowTemplateSeed seed)
    {
        return JsonSerializer.Serialize(new
        {
            origin = "seed",
            seedKey = seed.SeedKey,
            templateKind = "default-dev",
            teamTemplate = new
            {
                defaultProvider = seed.DefaultProvider,
                defaultBindings = seed.DefaultBindings.ToDictionary(
                    (entry) => entry.Key,
                    (entry) => new
                    {
                        agentId = entry.Value.AgentId,
                        providerId = entry.Value.ProviderId,
                        modelId = entry.Value.ModelId,
                        variant = entry.Value.Variant,
                    }),
                optionalAgentIds = seed.OptionalAgentIds,
                recommendedDefault = seed.RecommendedDefault,
                requiredRoles = RequiredRoles,
                recommendedFor = seed.RecommendedFor,
                templateFocus = seed.TemplateFocus,
                templatePriority = seed.TemplatePriority,
                templateScale = seed.TemplateScale,
            },
        }, JsonOptions);
    }

    public static string SerializeWorkflowNodes(WorkflowTemplateSeed seed)
    {
        var nodes = new List<object>
        {
            new { id = "node-start", label = "开始", type = "start", x = 40, y = 120 },
        };

        for (var index = 0; index < RequiredRoles.Count; index++)
        {
            var role = RequiredRoles[index];
            var binding = seed.DefaultBindings[role];
            var roleLabel = RoleLabelMap[role];
            var providerLabel = binding.ProviderId is not null && ProviderLabelMap.TryGetValue(binding.ProviderId, out var display)
                ? display
                : binding.ProviderId;
            var modelSuffix = providerLabel is null ? string.Empty : $" · {providerLabel}";

            nodes.Add(new
            {
                id = $"node-role-{index + 1}",
                label = $"{roleLabel}{modelSuffix}",
                type = "subagent",
                x = 220 + index * 180,
                y = 120 + (index % 2 == 0 ? 0 : 96),
            });
        }

        nodes.Add(new
        {
            id = "node-end",
            label = "结束",
            type = "end",
            x = 220 + RequiredRoles.Count * 180,
            y = 120,
        });

        return JsonSerializer.Serialize(nodes, JsonOptions);
    }

    public static string SerializeWorkflowEdges()
    {
        var nodeIds = new List<string> { "node-start" };
        nodeIds.AddRange(Enumerable.Range(1, RequiredRoles.Count).Select((index) => $"node-role-{index}"));
        nodeIds.Add("node-end");

        var edges = nodeIds
            .Zip(nodeIds.Skip(1), (source, target) => new
            {
                id = $"edge-{source}-{target}",
                source,
                target,
            })
            .ToArray();

        return JsonSerializer.Serialize(edges, JsonOptions);
    }

    public static string? ParseSeedKey(string metadataJson)
    {
        try
        {
            using var document = JsonDocument.Parse(metadataJson);
            return document.RootElement.TryGetProperty("seedKey", out var seedKeyElement) && seedKeyElement.ValueKind == JsonValueKind.String
                ? seedKeyElement.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

internal sealed record InstalledSkillSeed(
    string SourceId,
    string SkillId,
    string Name,
    string DisplayName,
    string Version,
    string Description,
    string? Author,
    IReadOnlyList<string> Capabilities);

internal sealed record WorkflowTemplateSeed(
    string SeedKey,
    string Name,
    string Description,
    string DefaultProvider,
    IReadOnlyDictionary<string, WorkflowRoleBindingSeed> DefaultBindings,
    IReadOnlyList<string> OptionalAgentIds,
    bool RecommendedDefault,
    string RecommendedFor,
    string TemplateFocus,
    int TemplatePriority,
    string TemplateScale)
{
    public string Category => "team-playbook";
}

internal sealed record WorkflowRoleBindingSeed(
    string AgentId,
    string ProviderId,
    string ModelId,
    string Variant);
