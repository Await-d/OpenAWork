using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Stores;

public sealed class SessionRunEventStore(
    GatewayDbContext dbContext,
    IMessageV2Store messageV2Store,
    ICommandTransactionRunner transactionRunner) : ISessionRunEventStore
{
    public async Task PersistAsync(SessionRunEventInfoRecord record, CancellationToken cancellationToken)
    {
        var persisted = await transactionRunner.ExecuteAsync(async (ct) =>
        {
            var effectiveSeq = record.Seq;
            if (effectiveSeq is null && !string.IsNullOrWhiteSpace(record.ClientRequestId))
            {
                effectiveSeq = (await dbContext.SessionRunEvents
                        .Where((item) => item.SessionId == record.SessionId && item.ClientRequestId == record.ClientRequestId)
                        .MaxAsync((item) => (long?)item.Seq, ct) ?? 0)
                    + 1;
            }

            dbContext.SessionRunEvents.Add(new SessionRunEventRecord
            {
                SessionId = record.SessionId,
                UserId = record.UserId,
                ClientRequestId = record.ClientRequestId,
                Seq = effectiveSeq,
                EventType = record.EventType,
                EventId = record.EventId,
                RunId = record.RunId,
                OccurredAtMs = record.OccurredAtMs,
                PayloadJson = record.PayloadJson,
                CreatedAtUtc = ParseTimestamp(record.CreatedAt),
            });

            return record with { Seq = effectiveSeq };
        }, cancellationToken);

        await MirrorDisplayableRunEventAsMessageAsync(persisted, cancellationToken);
    }

    public async Task<IReadOnlyList<SessionRunEventInfoRecord>> ListForSessionAsync(string sessionId, CancellationToken cancellationToken)
    {
        return await dbContext.SessionRunEvents
            .AsNoTracking()
            .Where((record) => record.SessionId == sessionId)
            .OrderBy((record) => record.Seq ?? int.MaxValue)
            .ThenBy((record) => record.OccurredAtMs ?? long.MaxValue)
            .ThenBy((record) => record.Id)
            .Select(Map)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<SessionRunEventInfoRecord>> ListByRequestAsync(string sessionId, string clientRequestId, CancellationToken cancellationToken)
    {
        return await dbContext.SessionRunEvents
            .AsNoTracking()
            .Where((record) => record.SessionId == sessionId && record.ClientRequestId == clientRequestId)
            .OrderBy((record) => record.Seq ?? int.MaxValue)
            .ThenBy((record) => record.OccurredAtMs ?? long.MaxValue)
            .ThenBy((record) => record.Id)
            .Select(Map)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<PersistedSessionRunEventInfoRecord>> ListByRequestAfterSeqAsync(string sessionId, string clientRequestId, long afterSeq, CancellationToken cancellationToken)
    {
        var rows = await dbContext.SessionRunEvents
            .AsNoTracking()
            .Where((record) => record.SessionId == sessionId && record.ClientRequestId == clientRequestId && (record.Seq ?? 0) > afterSeq)
            .OrderBy((record) => record.Seq ?? int.MaxValue)
            .ThenBy((record) => record.OccurredAtMs ?? long.MaxValue)
            .ThenBy((record) => record.Id)
            .Where((record) => record.Seq != null)
            .ToListAsync(cancellationToken);

        return rows.Select((record) => new PersistedSessionRunEventInfoRecord(
            record.Seq!.Value,
            JsonDocument.Parse(record.PayloadJson).RootElement.Clone())).ToArray();
    }

    public async Task<long> GetLatestSeqByRequestAsync(string sessionId, string clientRequestId, CancellationToken cancellationToken)
    {
        return await dbContext.SessionRunEvents
            .AsNoTracking()
            .Where((record) => record.SessionId == sessionId && record.ClientRequestId == clientRequestId)
            .MaxAsync((record) => (long?)record.Seq, cancellationToken) ?? 0;
    }

    public Task DeleteByRequestAsync(string sessionId, string clientRequestId, CancellationToken cancellationToken)
    {
        return dbContext.SessionRunEvents
            .Where((record) => record.SessionId == sessionId && record.ClientRequestId == clientRequestId)
            .ExecuteDeleteAsync(cancellationToken);
    }

    private static SessionRunEventInfoRecord Map(SessionRunEventRecord record)
        => new(
            record.Id,
            record.SessionId,
            record.UserId,
            record.ClientRequestId,
            record.Seq,
            record.EventType,
            record.EventId,
            record.RunId,
            record.OccurredAtMs,
            record.PayloadJson,
            record.CreatedAtUtc.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture));

    private async Task MirrorDisplayableRunEventAsMessageAsync(SessionRunEventInfoRecord record, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(record.UserId))
        {
            return;
        }

        var contentText = AssistantEventMessageSupport.BuildAssistantEventText(record.PayloadJson);
        if (contentText is null)
        {
            return;
        }

        var clientRequestId = AssistantEventMessageSupport.BuildMirroredClientRequestId(
            payloadJson: record.PayloadJson,
            clientRequestId: record.ClientRequestId,
            seq: record.Seq,
            occurredAtMs: record.OccurredAtMs);

        var messageId = $"message:{record.SessionId}:{clientRequestId}";
        var partId = $"part:{messageId}:text";
        var createdAtMs = record.OccurredAtMs ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var createdAt = FormatTimestamp(createdAtMs);

        await messageV2Store.InsertMessageAsync(new MessageV2InfoRecord(
            messageId,
            record.SessionId,
            record.UserId,
            createdAtMs,
            JsonSerializer.Serialize(new
            {
                role = "assistant",
                clientRequestId,
                time = new { created = createdAtMs },
                cost = 0,
                tokens = new
                {
                    input = 0,
                    output = 0,
                    reasoning = 0,
                    cache = new { read = 0, write = 0 },
                },
            }),
            createdAt,
            createdAt),
            cancellationToken);

        await messageV2Store.InsertPartAsync(new PartV2InfoRecord(
            partId,
            messageId,
            record.SessionId,
            record.UserId,
            createdAtMs,
            JsonSerializer.Serialize(new
            {
                type = "text",
                text = contentText,
            }),
            createdAt,
            createdAt),
            cancellationToken);
    }

    private static DateTimeOffset ParseTimestamp(string value)
        => DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);

    private static string FormatTimestamp(long epochMs)
        => DateTimeOffset.FromUnixTimeMilliseconds(epochMs).UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
}

internal static class AssistantEventMessageSupport
{
    private const string InternalAssistantEventSource = "openawork_internal";

    internal static string? BuildAssistantEventText(string payloadJson)
    {
        using var document = JsonDocument.Parse(payloadJson);
        var root = document.RootElement;
        var type = ReadString(root, "type");
        return type switch
        {
            "compaction" => BuildCompactionText(root),
            "task_update" => BuildTaskUpdateText(root),
            "session_child" => BuildSimpleCard(
                kind: ClassifyKind(ReadString(root, "title") ?? ReadString(root, "sessionId") ?? string.Empty),
                title: "已创建子会话",
                message: string.Join('\n', new[] { ReadString(root, "title"), ReadString(root, "sessionId") }.Where((item) => !string.IsNullOrWhiteSpace(item))),
                status: "success"),
            "audit_ref" => BuildSimpleCard(
                kind: !string.IsNullOrWhiteSpace(ReadString(root, "toolName")) ? ClassifyKind(ReadString(root, "toolName")!) : "audit",
                title: "已记录审计引用",
                message: string.Join('\n', new[]
                {
                    !string.IsNullOrWhiteSpace(ReadString(root, "toolName")) ? $"工具：{ReadString(root, "toolName")}" : null,
                    !string.IsNullOrWhiteSpace(ReadString(root, "auditLogId")) ? $"审计 ID：{ReadString(root, "auditLogId")}" : null,
                }.Where((item) => !string.IsNullOrWhiteSpace(item))),
                status: "success"),
            "permission_asked" or "permission_replied" or "question_asked" or "question_replied" => null,
            _ => null,
        };
    }

    internal static string BuildMirroredClientRequestId(string payloadJson, string? clientRequestId, long? seq, long? occurredAtMs)
    {
        using var document = JsonDocument.Parse(payloadJson);
        var root = document.RootElement;
        var eventId = ReadString(root, "eventId");
        if (!string.IsNullOrWhiteSpace(eventId))
        {
            return $"assistant_event:{eventId}";
        }

        var runId = ReadString(root, "runId");
        var eventType = ReadString(root, "type") ?? "event";
        if (!string.IsNullOrWhiteSpace(clientRequestId))
        {
            var suffix = seq is long eventSeq
                ? $"seq:{eventSeq}"
                : !string.IsNullOrWhiteSpace(runId)
                    ? $"run:{runId}"
                    : $"at:{occurredAtMs ?? 0}";
            return $"assistant_event:{clientRequestId}:{suffix}:{eventType}";
        }

        if (!string.IsNullOrWhiteSpace(runId))
        {
            return $"assistant_event:{runId}:{eventType}:{occurredAtMs ?? 0}";
        }

        return $"assistant_event:{eventType}:{occurredAtMs ?? 0}";
    }

    private static string? BuildCompactionText(JsonElement root)
    {
        var phase = ReadString(root, "phase");
        var title = phase switch
        {
            "started" => "正在压缩会话",
            "failed" => "会话压缩失败",
            "completed" or null => "会话已压缩",
            _ => "会话压缩",
        };

        var detailParts = new List<string>();
        var summary = ReadString(root, "summary");
        if (!string.IsNullOrWhiteSpace(summary))
        {
            detailParts.Add(summary);
        }

        if (TryGetInt64(root, "compactedMessages", out var compactedMessages))
        {
            detailParts.Add($"新增压缩：{compactedMessages} 条");
        }

        if (TryGetInt64(root, "representedMessages", out var representedMessages))
        {
            detailParts.Add($"累计覆盖：{representedMessages} 条");
        }

        var strategy = ReadString(root, "strategy");
        if (strategy == "replay")
        {
            detailParts.Add("恢复策略：保留当前用户请求重放");
        }
        else if (strategy == "synthetic_continue")
        {
            detailParts.Add("恢复策略：注入继续执行提示");
        }

        var status = phase switch
        {
            "started" => "running",
            "failed" => "error",
            _ => "success",
        };

        return BuildSimpleCard("compaction", title, string.Join('\n', detailParts.Where((part) => part.Trim().Length > 0)), status);
    }

    private static string? BuildTaskUpdateText(JsonElement root)
    {
        var label = ReadString(root, "label") ?? string.Empty;
        var assignedAgent = ReadString(root, "assignedAgent");
        var messageParts = new List<string>();
        if (!string.IsNullOrWhiteSpace(assignedAgent))
        {
            messageParts.Add($"代理：{assignedAgent}");
        }

        var errorMessage = ReadString(root, "errorMessage");
        var result = ReadString(root, "result");
        if (!string.IsNullOrWhiteSpace(errorMessage))
        {
            messageParts.Add($"错误：{errorMessage}");
        }
        else if (!string.IsNullOrWhiteSpace(result))
        {
            messageParts.Add($"结果：{result}");
        }

        var reason = ReadString(root, "reason");
        if (!string.IsNullOrWhiteSpace(reason))
        {
            messageParts.Add($"原因：{FormatTaskTerminalReason(reason)}");
        }

        var parentTaskId = ReadString(root, "parentTaskId");
        if (!string.IsNullOrWhiteSpace(parentTaskId))
        {
            messageParts.Add($"父任务：{parentTaskId}");
        }

        var parentSessionId = ReadString(root, "parentSessionId");
        if (!string.IsNullOrWhiteSpace(parentSessionId))
        {
            messageParts.Add($"父会话：{parentSessionId}");
        }

        var sessionId = ReadString(root, "sessionId");
        if (!string.IsNullOrWhiteSpace(sessionId))
        {
            messageParts.Add($"会话：{sessionId}");
        }

        var status = ReadString(root, "status") ?? "pending";
        var assistantEventStatus = status switch
        {
            "failed" => "error",
            "cancelled" => "paused",
            "pending" => "paused",
            "done" => "success",
            _ => "running",
        };
        var title = $"任务{FormatTaskStatusLabel(status)}{(reason == "timeout" ? "（超时）" : string.Empty)} · {label}";

        return BuildSimpleCard(
            ClassifyKind(!string.IsNullOrWhiteSpace(assignedAgent) ? $"{label} {assignedAgent}" : label),
            title,
            string.Join('\n', messageParts),
            assistantEventStatus);
    }

    private static string BuildSimpleCard(string kind, string title, string message, string status)
    {
        return JsonSerializer.Serialize(new
        {
            source = InternalAssistantEventSource,
            type = "assistant_event",
            payload = new
            {
                kind,
                title,
                message,
                status,
            },
        });
    }

    private static string ClassifyKind(string text)
    {
        var normalized = text.Trim().ToLowerInvariant();
        if (normalized.Contains("mcp") || normalized.Contains("context7")) return "mcp";
        if (normalized.Contains("skill") || normalized.Contains("技能")) return "skill";
        if (normalized.Contains("agent") || normalized.Contains("代理") || normalized.Contains("subagent") || normalized.Contains("oracle")) return "agent";
        if (normalized.Contains("audit") || normalized.Contains("审计")) return "audit";
        if (normalized.Contains("压缩") || normalized.Contains("compact")) return "compaction";
        if (normalized.Contains("任务") || normalized.Contains("task")) return "task";
        return "tool";
    }

    private static string FormatTaskStatusLabel(string status)
        => status switch
        {
            "in_progress" => "进行中",
            "done" => "已完成",
            "failed" => "失败",
            "cancelled" => "已取消",
            _ => "待开始",
        };

    private static string FormatTaskTerminalReason(string reason)
        => reason switch
        {
            "timeout" => "执行超时",
            "cancelled" => "用户取消",
            _ => reason,
        };

    private static string? ReadString(JsonElement element, string propertyName)
        => element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;

    private static bool TryGetInt64(JsonElement element, string propertyName, out long value)
    {
        value = 0;
        return element.TryGetProperty(propertyName, out var property)
            && property.ValueKind == JsonValueKind.Number
            && property.TryGetInt64(out value);
    }
}
