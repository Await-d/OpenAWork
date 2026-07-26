using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Application.Abstractions.Settings;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Host.Routes;

public static class CommandsRouteGroupExtensions
{
    private static readonly HashSet<string> ImplementedServerCommandActions = new(StringComparer.Ordinal)
    {
        "compact_session",
        "generate_handoff",
        "init_deep",
        "refactor_session",
    };

    private static readonly IReadOnlyList<string> InitDeepInstructionFileNames =
    [
        "AGENTS.md",
        "CRUSH.md",
        "CLAUDE.md",
        "GEMINI.md",
    ];

    private static readonly IReadOnlyList<CommandDescriptorView> CommandDescriptors =
    [
        new("slash-compact", "/compact", "Compact the current session — 压缩当前会话上下文（别名：/summarize）", null, ["composer"], "server", new("compact_session", null)),
        new("slash-summarize", "/summarize", "Summarize the current session — /compact 的别名", null, ["composer"], "server", new("compact_session", null)),
        new("slash-handoff", "/handoff", "Generate a text-only handoff summary — 生成最小文本交接摘要", null, ["composer"], "server", new("generate_handoff", null)),
        new("slash-buddy", "/buddy", "Open Buddy companion panel — 打开 Buddy 伴侣面板并显式唤起陪跑模式", null, ["composer"], "client", new("open_companion_panel", null)),
        new("nav-chat", "新建对话", "前往 Chat 页面", "C", ["palette"], "client", new("navigate", "/chat")),
        new("nav-sessions", "会话列表", "查看所有会话", "S", ["palette"], "client", new("navigate", "/sessions")),
        new("nav-settings", "设置", "设置", ",", ["palette"], "client", new("navigate", "/settings")),
        new("toggle-theme", "切换主题", "切换当前主题", null, ["palette"], "client", new("toggle_theme", null)),
        new("slash-init-deep", "/init-deep", "Inject deep AGENTS context — 递归汇总已有 AGENTS.md 到当前会话", null, ["composer"], "server", new("init_deep", null)),
        new("slash-ralph-loop", "/ralph-loop", "Start Ralph Loop — 启动自引用持续开发循环（默认上限 100 轮）", null, ["composer"], "server", new("start_ralph_loop", null)),
        new("slash-ulw-loop", "/ulw-loop", "Start ULW Loop — 启动需要验证收尾的 UltraWork 循环", null, ["composer"], "server", new("start_ulw_loop", null)),
        new("slash-ulw-verify", "/ulw-verify", "Verify ULW result — 用 --pass / --fail 提交 ULW 验证结果", null, ["composer"], "server", new("verify_ulw_loop", null)),
        new("slash-cancel-ralph", "/cancel-ralph", "Cancel active loop state — 取消当前活动中的 Ralph/ULW 循环", null, ["composer"], "server", new("cancel_ralph_loop", null)),
        new("slash-stop-continuation", "/stop-continuation", "Stop continuation systems — 停止当前 continuation / loop 状态", null, ["composer"], "server", new("stop_continuation", null)),
        new("slash-refactor", "/refactor", "Start refactor workflow — 启动带任务追踪与验证预期的重构流程", null, ["composer"], "server", new("refactor_session", null)),
        new("slash-start-work", "/start-work", "Resume work from plan/task state — 从计划或任务状态恢复执行", null, ["composer"], "server", new("start_work", null)),
    ];

    public static IEndpointRouteBuilder MapCommandsRoutes(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/commands", (ICurrentUser currentUser) =>
        {
            if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId))
            {
                return Results.Json(new { error = "Unauthorized" }, statusCode: StatusCodes.Status401Unauthorized);
            }

            return Results.Ok(new { commands = CommandDescriptors.Where(ShouldExposeCommand).Select(MapCommandDescriptor).ToArray() });
        }).RequireAuthorization();

        endpoints.MapPost("/sessions/{id}/commands/execute", async Task<IResult> (
            string id,
            JsonElement body,
            ICurrentUser currentUser,
            GatewayDbContext dbContext,
            IConfiguration configuration,
            IMessageV2Store messageV2Store,
            IWorkflowLlmClient workflowLlmClient,
            CancellationToken cancellationToken) =>
        {
            if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId))
            {
                return Results.Json(new { error = "Unauthorized" }, statusCode: StatusCodes.Status401Unauthorized);
            }

            if (!TryParseExecuteBody(body, out var requestBody, out var parseError))
            {
                return Results.Json(parseError!, statusCode: StatusCodes.Status400BadRequest);
            }

            var session = await dbContext.Sessions.SingleOrDefaultAsync((item) => item.Id == id && item.UserId == currentUser.UserId, cancellationToken);
            if (session is null)
            {
                return Results.Json(new { error = "Session not found" }, statusCode: StatusCodes.Status404NotFound);
            }

            var command = CommandDescriptors.FirstOrDefault((item) => string.Equals(item.Id, requestBody!.CommandId, StringComparison.Ordinal));
            if (command is null
                || !string.Equals(command.Execution, "server", StringComparison.Ordinal)
                || !ShouldExposeCommand(command))
            {
                return Results.Json(new { error = "Unsupported command" }, statusCode: StatusCodes.Status400BadRequest);
            }

            var messages = await LoadCommandMessagesAsync(session, currentUser.UserId, requestBody.Messages, messageV2Store, cancellationToken);
            CommandExecutionResultView result;
            if (string.Equals(command.Action.Kind, "compact_session", StringComparison.Ordinal))
            {
                result = await ExecuteCompactAsync(id, session, messages, requestBody.ExecutionId, dbContext, configuration, workflowLlmClient, cancellationToken);
            }
            else if (string.Equals(command.Action.Kind, "generate_handoff", StringComparison.Ordinal))
            {
                result = ExecuteHandoff(id, messages);
            }
            else if (string.Equals(command.Action.Kind, "init_deep", StringComparison.Ordinal))
            {
                result = await ExecuteInitDeepAsync(id, requestBody.CommandId, session, dbContext, configuration, cancellationToken);
            }
            else if (string.Equals(command.Action.Kind, "refactor_session", StringComparison.Ordinal))
            {
                result = await ExecuteRefactorAsync(id, requestBody.CommandId, requestBody.RawInput, session, dbContext, cancellationToken);
            }
            else
            {
                return Results.Json(new { error = "Unsupported command" }, statusCode: StatusCodes.Status400BadRequest);
            }

            return Results.Ok(new { result = new { events = result.Events, card = result.Card, sessionId = result.SessionId } });
        }).RequireAuthorization();

        return endpoints;
    }

    private static async Task<IReadOnlyList<CommandMessageSnapshot>> LoadCommandMessagesAsync(
        SessionRecord session,
        string userId,
        IReadOnlyList<CommandMessageSnapshot>? requestMessages,
        IMessageV2Store messageV2Store,
        CancellationToken cancellationToken)
    {
        var storedMessages = await messageV2Store.ListMessagesWithPartsAsync(session.Id, userId, 200, cancellationToken);
        if (storedMessages.Count > 0)
        {
            return storedMessages.Select(MapStoredMessage).ToArray();
        }

        return requestMessages ?? Array.Empty<CommandMessageSnapshot>();
    }

    private static async Task<CommandExecutionResultView> ExecuteCompactAsync(
        string sessionId,
        SessionRecord session,
        IReadOnlyList<CommandMessageSnapshot> messages,
        string? requestExecutionId,
        IConfiguration configuration,
        IWorkflowLlmClient workflowLlmClient,
        GatewayDbContext dbContext,
        CancellationToken cancellationToken)
    {
        var apiBaseUrl = configuration["AI_API_BASE_URL"] ?? "https://api.openai.com/v1";
        var apiKey = configuration["AI_API_KEY"] ?? string.Empty;
        var model = configuration["AI_DEFAULT_MODEL"] ?? "gpt-4o-mini";
        var summary = await workflowLlmClient.CompleteAsync(
            apiBaseUrl,
            apiKey,
            model,
            BuildManualCompactionPrompt(messages),
            0.2,
            cancellationToken);
        summary = string.IsNullOrWhiteSpace(summary)
            ? BuildFallbackSummary(messages)
            : summary.Trim();

        var metadata = ParseMetadata(session.MetadataJson);
        metadata["lastCompactionSummary"] = summary;
        metadata["lastCompactionTrigger"] = "manual";
        metadata["compactionMemory"] = new JsonObject
        {
            ["schemaVersion"] = 2,
            ["strategy"] = "runtime_replace",
            ["coveredUntilMessageId"] = messages.LastOrDefault()?.Id,
            ["compactedMessages"] = messages.Count,
            ["representedMessages"] = messages.Count,
        };

        var storedMessages = JsonNode.Parse(session.MessagesJson) as JsonArray ?? [];
        storedMessages.Add(JsonValue.Create(JsonSerializer.Serialize(new
        {
            type = "compaction",
            title = "会话已压缩",
            summary,
            trigger = "manual",
        })));

        session.MetadataJson = metadata.ToJsonString();
        session.MessagesJson = storedMessages.ToJsonString();
        session.UpdatedAtUtc = DateTimeOffset.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);

        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var executionId = string.IsNullOrWhiteSpace(requestExecutionId)
            ? Guid.NewGuid().ToString("N")
            : requestExecutionId.Trim();
        var runId = $"command:{sessionId}:slash-compact:{executionId}";
        return new CommandExecutionResultView(
            [
                new Dictionary<string, object?>
                {
                    ["type"] = "compaction",
                    ["summary"] = "正在压缩会话上下文。",
                    ["trigger"] = "manual",
                    ["phase"] = "started",
                    ["cause"] = "manual",
                    ["strategy"] = "runtime_replace",
                    ["runId"] = runId,
                    ["eventId"] = $"{sessionId}:slash-compact:{executionId}:started",
                    ["occurredAt"] = now,
                },
                new Dictionary<string, object?>
                {
                    ["type"] = "compaction",
                    ["summary"] = summary,
                    ["trigger"] = "manual",
                    ["phase"] = "completed",
                    ["cause"] = "manual",
                    ["strategy"] = "runtime_replace",
                    ["compactedMessages"] = messages.Count,
                    ["representedMessages"] = messages.Count,
                    ["runId"] = runId,
                    ["eventId"] = $"{sessionId}:slash-compact:{executionId}:completed",
                    ["occurredAt"] = now,
                },
            ],
            new Dictionary<string, object?>
            {
                ["type"] = "compaction",
                ["title"] = "会话已压缩",
                ["summary"] = summary,
                ["trigger"] = "manual",
            },
            sessionId);
    }

    private static CommandExecutionResultView ExecuteHandoff(string sessionId, IReadOnlyList<CommandMessageSnapshot> messages)
    {
        if (messages.Count == 0 || messages.All((message) => message.Content.All((item) => string.IsNullOrWhiteSpace(item.Text))))
        {
            return new CommandExecutionResultView(
                Array.Empty<object>(),
                new Dictionary<string, object?>
                {
                    ["type"] = "status",
                    ["title"] = "Text handoff unavailable",
                    ["message"] = "当前会话没有足够的文本内容，暂时无法生成文本交接。",
                    ["tone"] = "warning",
                },
                sessionId);
        }

        var markdown = string.Join('\n',
        [
            "# TEXT HANDOFF（文本交接）",
            string.Empty,
            $"**Session ID**: {sessionId}",
            string.Empty,
            "## SUMMARY（文本摘要）",
            string.Empty,
            BuildSummary(messages),
            string.Empty,
            "## HOW TO CONTINUE（如何继续）",
            string.Empty,
            "1. 新开一个会话。",
            "2. 把这份 handoff 作为第一条消息贴进去。",
            "3. 补充你的下一步任务要求。",
        ]);

        return new CommandExecutionResultView(
            Array.Empty<object>(),
            new Dictionary<string, object?>
            {
                ["type"] = "status",
                ["title"] = "Text handoff ready（文本交接已生成）",
                ["message"] = markdown,
                ["tone"] = "info",
            },
            sessionId);
    }

    private static async Task<CommandExecutionResultView> ExecuteInitDeepAsync(
        string sessionId,
        string commandId,
        SessionRecord session,
        GatewayDbContext dbContext,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var workspaceRoot = await PermissionsRouteWorkspacePermissionConfigWriter.ResolveSessionWorkspaceRootAsync(
            dbContext,
            configuration,
            sessionId,
            cancellationToken);
        var entries = workspaceRoot is not null
            ? await CollectInitDeepEntriesAsync(workspaceRoot, workspaceRoot, cancellationToken)
            : [];
        var injectionBlock = BuildInitDeepInjectionBlock(entries);
        var fileCount = entries.Count;
        var summary = fileCount > 0
            ? $"已注入 {fileCount} 条 Instructions 上下文到会话。"
            : "未找到可注入的 Instructions 文件，会话上下文未更新。";
        var metadata = ParseMetadata(session.MetadataJson);
        metadata["initDeepContext"] = injectionBlock;
        metadata["initDeepFileCount"] = fileCount;
        metadata["initDeepAt"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var summarySnippet = injectionBlock[..Math.Min(300, injectionBlock.Length)];
        var card = new Dictionary<string, object?>
        {
            ["type"] = "status",
            ["title"] = "/init-deep 完成",
            ["message"] = $"{summary}\n\nInstructions 摘要（前 300 字符）：\n{summarySnippet}{(injectionBlock.Length > 300 ? "…" : string.Empty)}",
            ["tone"] = "info",
        };

        var storedMessages = JsonNode.Parse(session.MessagesJson) as JsonArray ?? [];
        storedMessages.Add(JsonValue.Create(JsonSerializer.Serialize(new
        {
            type = "status",
            payload = card,
        })));

        session.MetadataJson = metadata.ToJsonString();
        session.MessagesJson = storedMessages.ToJsonString();
        session.UpdatedAtUtc = DateTimeOffset.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);

        var occurredAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        return new CommandExecutionResultView(
            [
                new Dictionary<string, object?>
                {
                    ["type"] = "audit_ref",
                    ["auditLogId"] = $"{sessionId}:{commandId}:init-deep",
                    ["eventId"] = $"{sessionId}:{commandId}:init-deep",
                    ["runId"] = $"command:{sessionId}:{commandId}",
                    ["occurredAt"] = occurredAt,
                },
            ],
            card,
            sessionId);
    }

    private static async Task<CommandExecutionResultView> ExecuteRefactorAsync(
        string sessionId,
        string commandId,
        string? rawInput,
        SessionRecord session,
        GatewayDbContext dbContext,
        CancellationToken cancellationToken)
    {
        var (scope, strategy, target) = ParseRefactorInput(rawInput);
        var startedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var taskId = $"refactor:{sessionId}:{startedAt}";
        var metadata = ParseMetadata(session.MetadataJson);
        metadata["refactorStartedAt"] = startedAt;
        metadata["refactorStrategy"] = strategy;
        metadata["refactorScope"] = scope;
        metadata["refactorTarget"] = target;
        metadata["refactorTaskId"] = taskId;

        var card = new Dictionary<string, object?>
        {
            ["type"] = "status",
            ["title"] = "/refactor 已启动",
            ["message"] = $"重构工作流已创建。\n目标：{target}\n范围：{scope}\n策略：{strategy}\n下一步：分析目标 → 建立影响面 → 执行并验证。\n任务：LSP+重构\n任务 ID：{taskId}",
            ["tone"] = "info",
        };

        var storedMessages = JsonNode.Parse(session.MessagesJson) as JsonArray ?? [];
        storedMessages.Add(JsonValue.Create(JsonSerializer.Serialize(new
        {
            type = "status",
            payload = card,
        })));

        session.MetadataJson = metadata.ToJsonString();
        session.MessagesJson = storedMessages.ToJsonString();
        session.UpdatedAtUtc = DateTimeOffset.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);

        return new CommandExecutionResultView(
            [
                new Dictionary<string, object?>
                {
                    ["type"] = "task_update",
                    ["taskId"] = taskId,
                    ["label"] = "LSP+重构",
                    ["status"] = "in_progress",
                    ["sessionId"] = sessionId,
                    ["parentTaskId"] = null,
                    ["eventId"] = $"{sessionId}:{taskId}:task",
                    ["runId"] = $"command:{sessionId}:{commandId}",
                    ["occurredAt"] = startedAt,
                },
            ],
            card,
            sessionId);
    }

    private static (string Scope, string Strategy, string Target) ParseRefactorInput(string? rawInput)
    {
        if (string.IsNullOrWhiteSpace(rawInput))
        {
            return ("module", "safe", "当前会话上下文");
        }

        var tokens = ExtractCommandArgs(rawInput, "/refactor");
        var (named, positional) = ParseCommandArgs(tokens);
        var scope = named.TryGetValue("scope", out var rawScope) && rawScope is "file" or "module" or "project"
            ? rawScope
            : "module";
        var strategy = named.TryGetValue("strategy", out var rawStrategy) && rawStrategy is "safe" or "aggressive"
            ? rawStrategy
            : "safe";

        var target = positional.Count == 0 ? "当前会话上下文" : string.Join(' ', positional);
        return (scope, strategy, target);
    }

    private static (Dictionary<string, string> Named, List<string> Positional) ParseCommandArgs(IReadOnlyList<string> args)
    {
        var named = new Dictionary<string, string>(StringComparer.Ordinal);
        var positional = new List<string>();

        for (var index = 0; index < args.Count; index += 1)
        {
            var current = args[index];
            if (!current.StartsWith("--", StringComparison.Ordinal))
            {
                positional.Add(current);
                continue;
            }

            var option = current[2..];
            var separatorIndex = option.IndexOf('=');
            if (separatorIndex >= 0)
            {
                var key = option[..separatorIndex];
                var value = option[(separatorIndex + 1)..];
                if (!string.IsNullOrWhiteSpace(key))
                {
                    named[key] = value;
                }

                continue;
            }

            if (!string.IsNullOrWhiteSpace(option) && index + 1 < args.Count && !args[index + 1].StartsWith("--", StringComparison.Ordinal))
            {
                named[option] = args[index + 1];
                index += 1;
                continue;
            }
        }

        return (named, positional);
    }

    private static IReadOnlyList<string> ExtractCommandArgs(string rawInput, string label)
    {
        var tokens = TokenizeCommandInput(rawInput);
        if (tokens.Count == 0)
        {
            return [];
        }

        var first = tokens[0];
        if (first.StartsWith('/', StringComparison.Ordinal))
        {
            return string.Equals(first, label, StringComparison.Ordinal)
                ? tokens.Skip(1).ToArray()
                : [];
        }

        return tokens;
    }

    private static IReadOnlyList<string> TokenizeCommandInput(string rawInput)
    {
        var tokens = new List<string>();
        var current = new StringBuilder();
        char? quote = null;

        for (var index = 0; index < rawInput.Length; index += 1)
        {
            var currentChar = rawInput[index];

            if (quote is not null)
            {
                if (currentChar == quote)
                {
                    quote = null;
                    continue;
                }

                if (currentChar == '\\' && index + 1 < rawInput.Length)
                {
                    current.Append(rawInput[index + 1]);
                    index += 1;
                    continue;
                }

                current.Append(currentChar);
                continue;
            }

            if (currentChar is '\'' or '"')
            {
                quote = currentChar;
                continue;
            }

            if (char.IsWhiteSpace(currentChar))
            {
                if (current.Length > 0)
                {
                    tokens.Add(current.ToString());
                    current.Clear();
                }

                continue;
            }

            current.Append(currentChar);
        }

        if (current.Length > 0)
        {
            tokens.Add(current.ToString());
        }

        return tokens;
    }

    private static async Task<IReadOnlyList<InitDeepContextEntry>> CollectInitDeepEntriesAsync(
        string startDirectory,
        string stopDirectory,
        CancellationToken cancellationToken)
    {
        var entries = new List<InitDeepContextEntry>();
        var currentDirectory = Path.GetFullPath(startDirectory);
        var normalizedStopDirectory = Path.GetFullPath(stopDirectory);
        var depth = 0;

        while (true)
        {
            foreach (var fileName in InitDeepInstructionFileNames)
            {
                var candidate = Path.Combine(currentDirectory, fileName);
                if (!File.Exists(candidate))
                {
                    continue;
                }

                var content = await File.ReadAllTextAsync(candidate, cancellationToken);
                entries.Add(new InitDeepContextEntry(candidate, content, depth));
            }

            if (string.Equals(currentDirectory, normalizedStopDirectory, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
            {
                break;
            }

            var parent = Path.GetDirectoryName(currentDirectory);
            if (string.IsNullOrWhiteSpace(parent))
            {
                break;
            }

            currentDirectory = parent;
            depth += 1;
        }

        return entries.OrderBy((item) => item.Depth).ToArray();
    }

    private static string BuildInitDeepInjectionBlock(IReadOnlyList<InitDeepContextEntry> entries)
        => entries.Count == 0
            ? string.Empty
            : string.Join("\n\n", entries.Select((entry) => $"Instructions from: {entry.FilePath}\n{entry.Content}"));

    private static bool ShouldExposeCommand(CommandDescriptorView descriptor)
        => string.Equals(descriptor.Execution, "client", StringComparison.Ordinal)
            || (string.Equals(descriptor.Execution, "server", StringComparison.Ordinal)
                && ImplementedServerCommandActions.Contains(descriptor.Action.Kind));

    private static string BuildSummary(IReadOnlyList<CommandMessageSnapshot> messages)
        => BuildFallbackSummary(messages);

    private static string BuildFallbackSummary(IReadOnlyList<CommandMessageSnapshot> messages)
    {
        var snippets = messages
            .SelectMany((message) => message.Content)
            .Select((content) => content.Text?.Trim())
            .Where((text) => !string.IsNullOrWhiteSpace(text))
            .Take(6)
            .ToArray();

        return snippets.Length == 0
            ? "Durable session compaction memory: 当前没有足够文本可处理。"
            : $"Durable session compaction memory: {string.Join(" | ", snippets)}";
    }

    private static string BuildManualCompactionPrompt(IReadOnlyList<CommandMessageSnapshot> messages)
    {
        var builder = new StringBuilder();
        builder.AppendLine("请把以下 OpenAWork 会话压缩成可继续执行的运行时记忆。输出用于替换较早历史上下文，因此必须保留任务目标、关键约束、已完成工作、失败尝试、重要工具结果和下一步。不要寒暄，不要虚构。 ");
        builder.AppendLine();
        builder.AppendLine($"待压缩消息数：{messages.Count}");
        builder.AppendLine("历史消息：");

        foreach (var message in messages)
        {
            var content = string.Join("\n\n", message.Content
                .Select((item) => item.Text?.Trim())
                .Where((text) => !string.IsNullOrWhiteSpace(text)));
            if (string.IsNullOrWhiteSpace(content))
            {
                continue;
            }

            builder.AppendLine($"[{FormatCommandRole(message.Role)}] {content}");
            builder.AppendLine();
        }

        return builder.ToString().Trim();
    }

    private static string FormatCommandRole(string role)
        => role switch
        {
            "user" => "用户",
            "assistant" => "助手",
            "tool" => "工具",
            _ => role,
        };

    private static JsonObject ParseMetadata(string metadataJson)
    {
        try
        {
            return JsonNode.Parse(metadataJson)?.AsObject() ?? new JsonObject();
        }
        catch (JsonException)
        {
            return new JsonObject();
        }
    }

    private static CommandMessageSnapshot MapStoredMessage(MessageWithPartsRecord record)
    {
        using var messageJson = JsonDocument.Parse(record.Message.DataJson);
        var role = messageJson.RootElement.TryGetProperty("role", out var roleElement) && roleElement.ValueKind == JsonValueKind.String
            ? roleElement.GetString() ?? "assistant"
            : "assistant";
        return new CommandMessageSnapshot(record.Message.Id, role, record.Parts.Select(MapStoredPart).ToArray(), record.Message.TimeCreated);
    }

    private static CommandContentSnapshot MapStoredPart(PartV2InfoRecord part)
    {
        using var document = JsonDocument.Parse(part.DataJson);
        var root = document.RootElement;
        var type = root.TryGetProperty("type", out var typeElement) && typeElement.ValueKind == JsonValueKind.String
            ? typeElement.GetString() ?? "text"
            : "text";
        return type switch
        {
            "text" => new CommandContentSnapshot(type, root.TryGetProperty("text", out var textElement) && textElement.ValueKind == JsonValueKind.String ? textElement.GetString() : null),
            "tool" => new CommandContentSnapshot(type, root.TryGetProperty("tool", out var toolElement) && toolElement.ValueKind == JsonValueKind.String ? $"tool_call:{toolElement.GetString()}" : "tool_call"),
            _ => new CommandContentSnapshot(type, root.GetRawText()),
        };
    }

    private static bool TryParseExecuteBody(JsonElement body, out ExecuteCommandBody? request, out object? error)
    {
        request = null;
        error = null;
        var issues = new List<object>();
        if (body.ValueKind != JsonValueKind.Object)
        {
            issues.Add(new { code = "invalid_type", expected = "object", received = DescribeJsonKind(body.ValueKind), path = Array.Empty<string>(), message = "Required" });
            error = new { error = "Invalid input", issues };
            return false;
        }

        var commandId = ReadRequiredString(body, "commandId", 1, 120, issues, "commandId");
        var rawInput = ReadOptionalString(body, "rawInput", 4000, issues, "rawInput");
        var executionId = ReadOptionalString(body, "executionId", 128, issues, "executionId");
        var messages = ReadMessages(body, issues);
        if (commandId is null || issues.Count > 0)
        {
            error = new { error = "Invalid input", issues };
            return false;
        }

        request = new ExecuteCommandBody(commandId, rawInput, executionId, messages);
        return true;
    }

    private static IReadOnlyList<CommandMessageSnapshot>? ReadMessages(JsonElement body, List<object> issues)
    {
        if (!body.TryGetProperty("messages", out var messagesElement) || messagesElement.ValueKind == JsonValueKind.Undefined)
        {
            return null;
        }

        if (messagesElement.ValueKind != JsonValueKind.Array)
        {
            issues.Add(new { code = "invalid_type", expected = "array", received = DescribeJsonKind(messagesElement.ValueKind), path = new[] { "messages" }, message = "Required" });
            return null;
        }

        var messages = new List<CommandMessageSnapshot>();
        var messageIndex = 0;
        foreach (var messageElement in messagesElement.EnumerateArray())
        {
            if (messageElement.ValueKind != JsonValueKind.Object)
            {
                issues.Add(new { code = "invalid_type", expected = "object", received = DescribeJsonKind(messageElement.ValueKind), path = new object[] { "messages", messageIndex }, message = "Required" });
                messageIndex += 1;
                continue;
            }

            var id = ReadRequiredString(messageElement, "id", 1, 200, issues, "messages", messageIndex, "id");
            var role = ReadRequiredString(messageElement, "role", 1, 20, issues, "messages", messageIndex, "role");
            long createdAt = 0;
            if (!messageElement.TryGetProperty("createdAt", out var createdAtElement) || !createdAtElement.TryGetInt64(out createdAt))
            {
                issues.Add(new { code = "invalid_type", expected = "number", received = !messageElement.TryGetProperty("createdAt", out var candidate) ? "undefined" : DescribeJsonKind(candidate.ValueKind), path = new object[] { "messages", messageIndex, "createdAt" }, message = "Required" });
            }

            var content = new List<CommandContentSnapshot>();
            if (!messageElement.TryGetProperty("content", out var contentElement) || contentElement.ValueKind != JsonValueKind.Array)
            {
                issues.Add(new { code = "invalid_type", expected = "array", received = !messageElement.TryGetProperty("content", out var candidate) ? "undefined" : DescribeJsonKind(candidate.ValueKind), path = new object[] { "messages", messageIndex, "content" }, message = "Required" });
            }
            else
            {
                var contentIndex = 0;
                foreach (var item in contentElement.EnumerateArray())
                {
                    if (item.ValueKind != JsonValueKind.Object)
                    {
                        issues.Add(new { code = "invalid_type", expected = "object", received = DescribeJsonKind(item.ValueKind), path = new object[] { "messages", messageIndex, "content", contentIndex }, message = "Required" });
                        contentIndex += 1;
                        continue;
                    }

                    var type = ReadRequiredString(item, "type", 1, 40, issues, "messages", messageIndex, "content", contentIndex, "type");
                    if (type is not ("text" or "tool_call" or "tool_result"))
                    {
                        issues.Add(new { code = "invalid_enum_value", path = new object[] { "messages", messageIndex, "content", contentIndex, "type" }, message = "Invalid content type" });
                        contentIndex += 1;
                        continue;
                    }

                    string? text = type switch
                    {
                        "text" => ReadRequiredString(item, "text", 1, 32768, issues, "messages", messageIndex, "content", contentIndex, "text"),
                        "tool_call" => ReadRequiredString(item, "toolName", 1, 200, issues, "messages", messageIndex, "content", contentIndex, "toolName"),
                        "tool_result" => item.TryGetProperty("output", out var outputElement) ? outputElement.GetRawText() : null,
                        _ => null,
                    };
                    content.Add(new CommandContentSnapshot(type, text));
                    contentIndex += 1;
                }
            }

            if (id is not null && role is not null)
            {
                messages.Add(new CommandMessageSnapshot(id, role, content, createdAt));
            }

            messageIndex += 1;
        }

        return messages;
    }

    private static string? ReadRequiredString(JsonElement body, string propertyName, int minLength, int maxLength, List<object> issues, params object[] path)
    {
        if (!body.TryGetProperty(propertyName, out var property))
        {
            issues.Add(new { code = "invalid_type", expected = "string", received = "undefined", path, message = "Required" });
            return null;
        }

        return ReadString(property, minLength, maxLength, issues, path);
    }

    private static string? ReadOptionalString(JsonElement body, string propertyName, int maxLength, List<object> issues, params object[] path)
    {
        if (!body.TryGetProperty(propertyName, out var property) || property.ValueKind == JsonValueKind.Undefined)
        {
            return null;
        }

        if (property.ValueKind == JsonValueKind.Null)
        {
            issues.Add(new { code = "invalid_type", expected = "string", received = "null", path, message = "Required" });
            return null;
        }

        return ReadString(property, 0, maxLength, issues, path);
    }

    private static string? ReadString(JsonElement property, int minLength, int maxLength, List<object> issues, params object[] path)
    {
        if (property.ValueKind != JsonValueKind.String)
        {
            issues.Add(new { code = "invalid_type", expected = "string", received = DescribeJsonKind(property.ValueKind), path, message = "Required" });
            return null;
        }

        var trimmed = property.GetString()?.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            if (minLength > 0)
            {
                issues.Add(new { code = "too_small", minimum = minLength, type = "string", inclusive = true, exact = false, path, message = $"String must contain at least {minLength} character(s)" });
            }
            return null;
        }

        if (trimmed.Length > maxLength)
        {
            issues.Add(new { code = "too_big", maximum = maxLength, type = "string", inclusive = true, exact = false, path, message = $"String must contain at most {maxLength} character(s)" });
            return null;
        }

        return trimmed;
    }

    private static string DescribeJsonKind(JsonValueKind kind) => kind switch
    {
        JsonValueKind.String => "string",
        JsonValueKind.Number => "number",
        JsonValueKind.True or JsonValueKind.False => "boolean",
        JsonValueKind.Object => "object",
        JsonValueKind.Array => "array",
        JsonValueKind.Null => "null",
        JsonValueKind.Undefined => "undefined",
        _ => "unknown",
    };

    private static object MapCommandDescriptor(CommandDescriptorView descriptor)
    {
        var payload = new Dictionary<string, object?>
        {
            ["id"] = descriptor.Id,
            ["label"] = descriptor.Label,
            ["contexts"] = descriptor.Contexts,
            ["execution"] = descriptor.Execution,
            ["action"] = descriptor.Action.ToJsonObject(),
        };

        if (!string.IsNullOrWhiteSpace(descriptor.Description))
        {
            payload["description"] = descriptor.Description;
        }

        if (!string.IsNullOrWhiteSpace(descriptor.Shortcut))
        {
            payload["shortcut"] = descriptor.Shortcut;
        }

        return payload;
    }

    private sealed record CommandDescriptorView(
        string Id,
        string Label,
        string? Description,
        string? Shortcut,
        IReadOnlyList<string> Contexts,
        string Execution,
        CommandActionView Action);

    private sealed record CommandActionView(string Kind, string? To)
    {
        public object ToJsonObject()
        {
            var payload = new Dictionary<string, object?> { ["kind"] = Kind };
            if (!string.IsNullOrWhiteSpace(To)) payload["to"] = To;
            return payload;
        }
    }

    private sealed record ExecuteCommandBody(
        string CommandId,
        string? RawInput,
        string? ExecutionId,
        IReadOnlyList<CommandMessageSnapshot>? Messages);

    private sealed record CommandMessageSnapshot(string Id, string Role, IReadOnlyList<CommandContentSnapshot> Content, long CreatedAt);

    private sealed record CommandContentSnapshot(string Type, string? Text);

    private sealed record InitDeepContextEntry(string FilePath, string Content, int Depth);

    private sealed record CommandExecutionResultView(IReadOnlyList<object> Events, object? Card, string? SessionId);

}
