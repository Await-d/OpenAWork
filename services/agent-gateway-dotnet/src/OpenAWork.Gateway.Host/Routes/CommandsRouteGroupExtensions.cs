using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Host.Routes;

public static class CommandsRouteGroupExtensions
{
    private static readonly HashSet<string> ImplementedServerCommandActions = new(StringComparer.Ordinal)
    {
        "compact_session",
        "generate_handoff",
    };

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
            IMessageV2Store messageV2Store,
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
                result = await ExecuteCompactAsync(id, session, messages, dbContext, cancellationToken);
            }
            else if (string.Equals(command.Action.Kind, "generate_handoff", StringComparison.Ordinal))
            {
                result = ExecuteHandoff(id, messages);
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
        GatewayDbContext dbContext,
        CancellationToken cancellationToken)
    {
        var summary = BuildSummary(messages);
        var metadata = ParseMetadata(session.MetadataJson);
        metadata["lastCompactionSummary"] = summary;
        metadata["lastCompactionTrigger"] = "manual";
        metadata["compactionMemory"] = new JsonObject
        {
            ["schemaVersion"] = 1,
            ["coveredUntilMessageId"] = messages.LastOrDefault()?.Id,
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
        var runId = $"command:{sessionId}:slash-compact";
        return new CommandExecutionResultView(
            [
                new Dictionary<string, object?>
                {
                    ["type"] = "compaction",
                    ["summary"] = "正在压缩会话上下文。",
                    ["trigger"] = "manual",
                    ["phase"] = "started",
                    ["cause"] = "manual",
                    ["strategy"] = "summary_only",
                    ["runId"] = runId,
                    ["eventId"] = $"{sessionId}:slash-compact:started",
                    ["occurredAt"] = now,
                },
                new Dictionary<string, object?>
                {
                    ["type"] = "compaction",
                    ["summary"] = summary,
                    ["trigger"] = "manual",
                    ["phase"] = "completed",
                    ["cause"] = "manual",
                    ["strategy"] = "summary_only",
                    ["compactedMessages"] = messages.Count,
                    ["representedMessages"] = messages.Count,
                    ["runId"] = runId,
                    ["eventId"] = $"{sessionId}:slash-compact:completed",
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

    private static bool ShouldExposeCommand(CommandDescriptorView descriptor)
        => string.Equals(descriptor.Execution, "client", StringComparison.Ordinal)
            || (string.Equals(descriptor.Execution, "server", StringComparison.Ordinal)
                && ImplementedServerCommandActions.Contains(descriptor.Action.Kind));

    private static string BuildSummary(IReadOnlyList<CommandMessageSnapshot> messages)
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
        var messages = ReadMessages(body, issues);
        if (commandId is null || issues.Count > 0)
        {
            error = new { error = "Invalid input", issues };
            return false;
        }

        request = new ExecuteCommandBody(commandId, rawInput, messages);
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

    private sealed record ExecuteCommandBody(string CommandId, string? RawInput, IReadOnlyList<CommandMessageSnapshot>? Messages);

    private sealed record CommandMessageSnapshot(string Id, string Role, IReadOnlyList<CommandContentSnapshot> Content, long CreatedAt);

    private sealed record CommandContentSnapshot(string Type, string? Text);

    private sealed record CommandExecutionResultView(IReadOnlyList<object> Events, object? Card, string? SessionId);

}
