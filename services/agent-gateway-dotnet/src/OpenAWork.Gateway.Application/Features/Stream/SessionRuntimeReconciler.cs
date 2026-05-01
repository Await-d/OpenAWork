using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Application.Abstractions.Streaming;
using OpenAWork.Gateway.Application.Features.Sessions;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Application.Features.Stream;

public sealed class SessionRuntimeReconciler(
    GatewayDbContext dbContext,
    IMessageV2Store messageV2Store,
    IPermissionRequestStore permissionRequestStore,
    IQuestionRequestStore questionRequestStore,
    ISessionRuntimeThreadStore sessionRuntimeThreadStore,
    ISessionStreamRequestRegistry requestRegistry,
    ITaskParentAutoResumeContextStore taskParentAutoResumeContextStore,
    IServiceScopeFactory scopeFactory,
    ILogger<SessionRuntimeReconciler> logger) : ISessionRuntimeReconciler
{
    private const string ChildSessionDeadlineKey = "deadlineMs";
    private const string ChildSessionTerminalReasonKey = "terminalReason";
    private const string TaskParentAutoResumeRequestPrefix = "task-auto-resume:";

    public async Task<bool> HandleChildSessionTerminalAsync(TaskChildSessionTerminalInput input, CancellationToken cancellationToken)
    {
        var childSession = await dbContext.Sessions
            .AsNoTracking()
            .SingleOrDefaultAsync((session) => session.Id == input.SessionId && session.UserId == input.UserId, cancellationToken);
        if (childSession is null)
        {
            await taskParentAutoResumeContextStore.ClearAsync(input.SessionId, input.UserId, cancellationToken);
            return false;
        }

        var metadata = SessionMetadataSupport.ParsePersistedMetadata(childSession.MetadataJson);
        var parentSessionId = SessionMetadataSupport.ExtractParentSessionId(metadata);
        if (string.IsNullOrWhiteSpace(parentSessionId))
        {
            await taskParentAutoResumeContextStore.ClearAsync(input.SessionId, input.UserId, cancellationToken);
            return false;
        }

        if (input.PendingInteraction)
        {
            return false;
        }

        var effectiveReason = ResolveTerminalReason(ReadChildSessionTerminalReason(childSession.MetadataJson), input.StatusCode, input.TerminalReason);
        var effectiveStatusCode = effectiveReason == "timeout" ? StatusCodes.Status408RequestTimeout : input.StatusCode;
        if (effectiveReason is not null)
        {
            await WriteChildSessionTerminalReasonAsync(input.SessionId, input.UserId, effectiveReason, cancellationToken);
        }

        if (effectiveReason == "cancelled")
        {
            await taskParentAutoResumeContextStore.ClearAsync(input.SessionId, input.UserId, cancellationToken);
            return true;
        }

        var parentExists = await dbContext.Sessions.AnyAsync(
            (session) => session.Id == parentSessionId && session.UserId == input.UserId,
            cancellationToken);
        if (!parentExists)
        {
            await taskParentAutoResumeContextStore.ClearAsync(input.SessionId, input.UserId, cancellationToken);
            return false;
        }

        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (await IsSessionBusyAsync(parentSessionId, input.UserId, nowMs, cancellationToken))
        {
            return false;
        }

        var storedContext = await taskParentAutoResumeContextStore.ConsumeAsync(
            input.SessionId,
            parentSessionId,
            input.UserId,
            cancellationToken);
        if (storedContext is null)
        {
            return false;
        }

        var summary = await BuildChildSessionSummaryAsync(input.SessionId, input.UserId, effectiveStatusCode, effectiveReason, cancellationToken);
        if (!TryBuildAutoResumeRequest(parentSessionId, input.UserId, storedContext.RequestDataJson, summary, out var request))
        {
            logger.LogWarning(
                "failed to parse task parent auto-resume request data for child session {ChildSessionId} parent {ParentSessionId}",
                input.SessionId,
                parentSessionId);
            return false;
        }

        StartParentAutoResumeInBackground(request, storedContext, cancellationToken: CancellationToken.None);
        return true;
    }

    public async Task<SessionRuntimeReconciliationResult> ReconcileSessionRuntimeAsync(
        string sessionId,
        string userId,
        long? nowMs,
        CancellationToken cancellationToken)
    {
        var now = nowMs ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var session = await dbContext.Sessions.SingleOrDefaultAsync(
            (item) => item.Id == sessionId && item.UserId == userId,
            cancellationToken);
        if (session is null)
        {
            await taskParentAutoResumeContextStore.ClearAsync(sessionId, userId, cancellationToken);
            return new SessionRuntimeReconciliationResult(sessionId, "idle", "idle", false, false, false, false);
        }

        var previousStatus = session.StateStatus;
        var timestamp = FormatTimestamp(now);
        var expiredPermissions = await permissionRequestStore.ExpirePendingAsync(sessionId, now, timestamp, cancellationToken);
        var expiredQuestions = Array.Empty<QuestionRequestInfoRecord>();
        var pendingPermissions = await permissionRequestStore.ListPendingAsync(sessionId, cancellationToken);
        var pendingQuestions = await questionRequestStore.ListPendingAsync(sessionId, cancellationToken);
        var hasPendingInteraction = pendingPermissions.Count > 0 || pendingQuestions.Count > 0;
        var hasFreshRuntimeThread = await sessionRuntimeThreadStore.HasFreshAsync(sessionId, userId, now, cancellationToken);

        var nextStatus = session.StateStatus;
        if (hasPendingInteraction)
        {
            nextStatus = "paused";
        }
        else if (!hasFreshRuntimeThread)
        {
            nextStatus = "idle";
        }

        var wasReset = nextStatus == "idle" && previousStatus != "idle";
        if (nextStatus != session.StateStatus)
        {
            session.StateStatus = nextStatus;
            session.UpdatedAtUtc = DateTimeOffset.UtcNow;
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        var autoResumeScheduled = false;
        var pendingInteractionExpired = expiredPermissions.Count > 0 || expiredQuestions.Count > 0;
        if (pendingInteractionExpired)
        {
            await WriteChildSessionTerminalReasonAsync(sessionId, userId, "timeout", cancellationToken);
            var stoppedActiveRequest = await requestRegistry.StopAnyAsync(sessionId, userId, cancellationToken);
            if (dbContext.Entry(session).State != EntityState.Detached)
            {
                await dbContext.Entry(session).ReloadAsync(cancellationToken);
            }

            if (session.StateStatus != "idle")
            {
                session.StateStatus = "idle";
                session.UpdatedAtUtc = DateTimeOffset.UtcNow;
                await dbContext.SaveChangesAsync(cancellationToken);
                nextStatus = "idle";
                wasReset = previousStatus != "idle";
            }

            if (!stoppedActiveRequest)
            {
                autoResumeScheduled = await HandleChildSessionTerminalAsync(
                    new TaskChildSessionTerminalInput(sessionId, userId, StatusCodes.Status408RequestTimeout, false, "timeout"),
                    cancellationToken);
            }
            return new SessionRuntimeReconciliationResult(sessionId, nextStatus, previousStatus, wasReset, true, true, autoResumeScheduled);
        }

        if (wasReset)
        {
            var reconciledAsTimeout = await TryReconcileAsTimeoutAsync(session, now, cancellationToken);
            if (reconciledAsTimeout)
            {
                autoResumeScheduled = await HandleChildSessionTerminalAsync(
                    new TaskChildSessionTerminalInput(sessionId, userId, StatusCodes.Status408RequestTimeout, false, "timeout"),
                    cancellationToken);
                return new SessionRuntimeReconciliationResult(sessionId, nextStatus, previousStatus, true, true, false, autoResumeScheduled);
            }

            autoResumeScheduled = await HandleChildSessionTerminalAsync(
                new TaskChildSessionTerminalInput(sessionId, userId, StatusCodes.Status500InternalServerError, false, null),
                cancellationToken);
            return new SessionRuntimeReconciliationResult(sessionId, nextStatus, previousStatus, true, false, false, autoResumeScheduled);
        }

        if (nextStatus == "idle" && await HasStoredAutoResumeContextAsync(sessionId, userId, cancellationToken))
        {
            autoResumeScheduled = await HandleChildSessionTerminalAsync(
                new TaskChildSessionTerminalInput(sessionId, userId, await InferIdleChildStatusCodeAsync(sessionId, userId, cancellationToken), false, ReadChildSessionTerminalReason(session.MetadataJson)),
                cancellationToken);
        }

        return new SessionRuntimeReconciliationResult(sessionId, nextStatus, previousStatus, false, false, false, autoResumeScheduled);
    }

    public async Task<SessionRuntimeBatchReconciliationResult> ReconcileAllAsync(long? nowMs, CancellationToken cancellationToken)
    {
        var candidates = await dbContext.TaskParentAutoResumeContexts
            .AsNoTracking()
            .OrderBy((item) => item.CreatedAtUtc)
            .Select((item) => new { item.ChildSessionId, item.UserId })
            .ToListAsync(cancellationToken);

        var resetCount = 0;
        var pausedCount = 0;
        var failedSessionIds = new List<string>();
        foreach (var candidate in candidates)
        {
            try
            {
                var reconciliation = await ReconcileSessionRuntimeAsync(candidate.ChildSessionId, candidate.UserId, nowMs, cancellationToken);
                if (reconciliation.WasReset)
                {
                    resetCount += 1;
                }
                else if (reconciliation.Status == "paused" && reconciliation.PreviousStatus != "paused")
                {
                    pausedCount += 1;
                }
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "failed to reconcile child session {SessionId} for user {UserId}", candidate.ChildSessionId, candidate.UserId);
                failedSessionIds.Add(candidate.ChildSessionId);
            }
        }

        return new SessionRuntimeBatchReconciliationResult(candidates.Count, resetCount, pausedCount, failedSessionIds);
    }

    private async Task<bool> TryReconcileAsTimeoutAsync(SessionRecord session, long nowMs, CancellationToken cancellationToken)
    {
        var deadlineMs = ReadChildSessionDeadlineMs(session.MetadataJson);
        if (deadlineMs is null || deadlineMs.Value > nowMs)
        {
            return false;
        }

        await WriteChildSessionTerminalReasonAsync(session.Id, session.UserId, "timeout", cancellationToken);
        return true;
    }

    private async Task<bool> IsSessionBusyAsync(string sessionId, string userId, long nowMs, CancellationToken cancellationToken)
    {
        if (requestRegistry.GetAnyForSession(sessionId, userId) is not null)
        {
            return true;
        }

        if (await sessionRuntimeThreadStore.HasFreshAsync(sessionId, userId, nowMs, cancellationToken))
        {
            return true;
        }

        var session = await dbContext.Sessions
            .AsNoTracking()
            .SingleOrDefaultAsync((item) => item.Id == sessionId && item.UserId == userId, cancellationToken);
        return session is not null && (session.StateStatus == "running" || session.StateStatus == "paused");
    }

    private async Task<bool> HasStoredAutoResumeContextAsync(string childSessionId, string userId, CancellationToken cancellationToken)
        => await dbContext.TaskParentAutoResumeContexts
            .AsNoTracking()
            .AnyAsync((item) => item.ChildSessionId == childSessionId && item.UserId == userId, cancellationToken);

    private async Task<int> InferIdleChildStatusCodeAsync(string childSessionId, string userId, CancellationToken cancellationToken)
    {
        var session = await dbContext.Sessions
            .AsNoTracking()
            .SingleOrDefaultAsync((item) => item.Id == childSessionId && item.UserId == userId, cancellationToken);
        var reason = session is null ? null : ReadChildSessionTerminalReason(session.MetadataJson);
        if (reason == "timeout")
        {
            return StatusCodes.Status408RequestTimeout;
        }

        if (reason == "cancelled")
        {
            return 499;
        }

        var latestAssistantMessage = await dbContext.MessageV2
            .AsNoTracking()
            .Where((item) => item.SessionId == childSessionId && item.UserId == userId)
            .OrderByDescending((item) => item.TimeCreated)
            .ThenByDescending((item) => item.Id)
            .Select((item) => item.DataJson)
            .FirstOrDefaultAsync(cancellationToken);
        if (latestAssistantMessage is null)
        {
            return StatusCodes.Status200OK;
        }

        using var document = JsonDocument.Parse(latestAssistantMessage);
        var role = ReadString(document.RootElement, "role");
        var status = ReadString(document.RootElement, "status");
        return role == "assistant" && status == "error" ? StatusCodes.Status500InternalServerError : StatusCodes.Status200OK;
    }

    private async Task<string> BuildChildSessionSummaryAsync(string childSessionId, string userId, int statusCode, string? reason, CancellationToken cancellationToken)
    {
        var messages = await messageV2Store.ListMessagesWithPartsAsync(childSessionId, userId, 200, cancellationToken);
        for (var messageIndex = messages.Count - 1; messageIndex >= 0; messageIndex -= 1)
        {
            var message = messages[messageIndex];
            using var document = JsonDocument.Parse(message.Message.DataJson);
            if (ReadString(document.RootElement, "role") != "assistant")
            {
                continue;
            }

            for (var partIndex = message.Parts.Count - 1; partIndex >= 0; partIndex -= 1)
            {
                using var partDocument = JsonDocument.Parse(message.Parts[partIndex].DataJson);
                var partRoot = partDocument.RootElement;
                var partType = ReadString(partRoot, "type");
                if (partType == "text")
                {
                    var text = ReadString(partRoot, "text");
                    if (!string.IsNullOrWhiteSpace(text))
                    {
                        return text.Trim();
                    }
                }

                if (partType == "assistant_event"
                    && partRoot.TryGetProperty("payload", out var payload)
                    && payload.ValueKind == JsonValueKind.Object)
                {
                    var title = ReadString(payload, "title");
                    var body = ReadString(payload, "message");
                    var combined = string.Join('\n', new[] { title, body }.Where((item) => !string.IsNullOrWhiteSpace(item)));
                    if (!string.IsNullOrWhiteSpace(combined))
                    {
                        return combined.Trim();
                    }
                }
            }
        }

        var sessionTitle = await dbContext.Sessions
            .AsNoTracking()
            .Where((item) => item.Id == childSessionId && item.UserId == userId)
            .Select((item) => item.Title)
            .SingleOrDefaultAsync(cancellationToken);
        return statusCode switch
        {
            StatusCodes.Status408RequestTimeout => $"子会话 {(string.IsNullOrWhiteSpace(sessionTitle) ? childSessionId : sessionTitle)} 执行超时。",
            >= StatusCodes.Status400BadRequest => $"子会话 {(string.IsNullOrWhiteSpace(sessionTitle) ? childSessionId : sessionTitle)} 执行失败。",
            _ => $"子会话 {(string.IsNullOrWhiteSpace(sessionTitle) ? childSessionId : sessionTitle)} 已完成。",
        };
    }

    private static string BuildAutoResumeMessage(string childSessionId, string taskId, int statusCode, string? reason, string summary)
    {
        var status = reason == "timeout"
            ? "超时"
                : reason == "cancelled"
                    ? "已取消"
                    : statusCode >= StatusCodes.Status400BadRequest
                        ? "失败"
                        : "完成";
        return string.Join('\n',
        [
            "以下是后台子会话已结束后的自动回流结果，请继续当前主任务并直接回复用户。",
            $"- 子会话：{childSessionId}",
            $"- 任务：{taskId}",
            $"- 状态：{status}",
            "- 摘要：",
            summary,
        ]);
    }

    private static bool TryBuildAutoResumeRequest(
        string parentSessionId,
        string userId,
        string requestDataJson,
        string autoResumeMessage,
        out SessionStreamRuntimeRequest request)
    {
        request = null!;
        try
        {
            using var document = JsonDocument.Parse(requestDataJson);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return false;
            }

            request = new SessionStreamRuntimeRequest(
                parentSessionId,
                userId,
                $"{TaskParentAutoResumeRequestPrefix}{parentSessionId}:{Guid.NewGuid():N}",
                autoResumeMessage,
                null,
                ReadString(root, "agentId"),
                ReadString(root, "providerId"),
                ReadString(root, "model"),
                TryReadBoolean(root, "thinkingEnabled"),
                TryReadBoolean(root, "webSearchEnabled"),
                root.GetRawText(),
                root.TryGetProperty("observability", out var observability) && observability.ValueKind == JsonValueKind.Object ? observability.GetRawText() : null,
                null);
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private void StartParentAutoResumeInBackground(
        SessionStreamRuntimeRequest request,
        TaskParentAutoResumeContextInfoRecord storedContext,
        CancellationToken cancellationToken)
    {
        _ = Task.Run(async () =>
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var runtimeService = scope.ServiceProvider.GetRequiredService<ISessionStreamRuntimeService>();
            var autoResumeStore = scope.ServiceProvider.GetRequiredService<ITaskParentAutoResumeContextStore>();
            try
            {
                var statusCode = await runtimeService.HandleAsync(request, static _ => ValueTask.CompletedTask, cancellationToken);
                if (statusCode != StatusCodes.Status200OK)
                {
                    var now = FormatTimestamp(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                    await autoResumeStore.UpsertAsync(storedContext with { UpdatedAt = now }, CancellationToken.None);
                    logger.LogWarning(
                        "task parent auto-resume returned non-success status {StatusCode} for child {ChildSessionId} parent {ParentSessionId}",
                        statusCode,
                        storedContext.ChildSessionId,
                        storedContext.ParentSessionId);
                }
            }
            catch (Exception exception)
            {
                var now = FormatTimestamp(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                await autoResumeStore.UpsertAsync(storedContext with { UpdatedAt = now }, CancellationToken.None);
                logger.LogError(
                    exception,
                    "failed to auto-resume parent session {ParentSessionId} from child {ChildSessionId}",
                    storedContext.ParentSessionId,
                    storedContext.ChildSessionId);
            }
        }, CancellationToken.None);
    }

    private async Task WriteChildSessionTerminalReasonAsync(string childSessionId, string userId, string reason, CancellationToken cancellationToken)
    {
        var session = await dbContext.Sessions.SingleOrDefaultAsync(
            (item) => item.Id == childSessionId && item.UserId == userId,
            cancellationToken);
        if (session is null)
        {
            return;
        }

        var metadata = SessionMetadataSupport.ParsePersistedMetadata(session.MetadataJson);
        metadata[ChildSessionTerminalReasonKey] = reason;
        session.MetadataJson = metadata.ToJsonString();
        session.UpdatedAtUtc = DateTimeOffset.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private static long? ReadChildSessionDeadlineMs(string metadataJson)
    {
        var metadata = SessionMetadataSupport.ParsePersistedMetadata(metadataJson);
        return metadata[ChildSessionDeadlineKey] is JsonValue value && value.TryGetValue<long>(out var deadlineMs)
            ? deadlineMs
            : null;
    }

    private static string? ReadChildSessionTerminalReason(string metadataJson)
    {
        var metadata = SessionMetadataSupport.ParsePersistedMetadata(metadataJson);
        return metadata[ChildSessionTerminalReasonKey] is JsonValue value && value.TryGetValue<string>(out var reason)
            ? reason
            : null;
    }

    private static string? NormalizeTerminalReason(int statusCode, string? explicitReason)
        => explicitReason switch
        {
            "timeout" => "timeout",
            "cancelled" => "cancelled",
            _ when statusCode == StatusCodes.Status408RequestTimeout => "timeout",
            _ when statusCode == 499 => "cancelled",
            _ => null,
        };

    private static string? ResolveTerminalReason(string? existingReason, int statusCode, string? explicitReason)
    {
        var normalizedReason = NormalizeTerminalReason(statusCode, explicitReason);
        if (existingReason == "timeout" && normalizedReason == "cancelled")
        {
            return "timeout";
        }

        return normalizedReason ?? existingReason;
    }

    private static string FormatTimestamp(long epochMs)
        => DateTimeOffset.FromUnixTimeMilliseconds(epochMs).UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);

    private static string? ReadString(JsonElement element, string propertyName)
        => element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;

    private static bool? TryReadBoolean(JsonElement element, string propertyName)
        => element.TryGetProperty(propertyName, out var property) && property.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? property.GetBoolean()
            : null;
}
