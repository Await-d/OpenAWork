using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Application.Abstractions.Streaming;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Host.Routes;

public static class PermissionsRouteGroupExtensions
{
    private const int MaxApprovedBashOutputBytes = 50 * 1024;
    private const int MaxApprovedBashOutputLines = 2000;
    private static readonly Regex ApprovedBashEnvOverrideRegex = new(@"(^|\s)(export\s+)?(PATH|LD_[A-Z0-9_]+|DYLD_[A-Z0-9_]+)\s*=", RegexOptions.CultureInvariant);
    private static readonly Regex ApprovedBashSudoRegex = new(@"(^|\s)sudo(\s|$)", RegexOptions.CultureInvariant);

    public static IEndpointRouteBuilder MapPermissionsRoutes(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/sessions/{id}/permissions/pending", async Task<IResult> (
            string id,
            ICurrentUser currentUser,
            GatewayDbContext dbContext,
            IPermissionRequestStore permissionRequestStore,
            ISessionRunEventStore sessionRunEventStore,
            ISessionRunEventBroadcaster sessionRunEventBroadcaster,
            CancellationToken cancellationToken) =>
        {
            if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId))
            {
                return Results.Json(new { error = "Unauthorized" }, statusCode: StatusCodes.Status401Unauthorized);
            }

            if (!await OwnsSessionAsync(dbContext, id, currentUser.UserId, cancellationToken))
            {
                return Results.Json(new { error = "Session not found" }, statusCode: StatusCodes.Status404NotFound);
            }

            await ExpirePendingPermissionRequestsAsync(
                id,
                currentUser.UserId,
                permissionRequestStore,
                sessionRunEventStore,
                sessionRunEventBroadcaster,
                dbContext,
                cancellationToken);

            var requests = await permissionRequestStore.ListPendingAsync(id, cancellationToken);
            return Results.Ok(new { requests = requests.Select(MapPendingPermissionRequest).ToArray() });
        }).RequireAuthorization();

        endpoints.MapPost("/sessions/{id}/permissions/requests", async Task<IResult> (
            string id,
            JsonElement body,
            ICurrentUser currentUser,
            GatewayDbContext dbContext,
            IPermissionRequestStore permissionRequestStore,
            ISessionRunEventStore sessionRunEventStore,
            ISessionRunEventBroadcaster sessionRunEventBroadcaster,
            IConfiguration configuration,
            CancellationToken cancellationToken) =>
        {
            if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId))
            {
                return Results.Json(new { error = "Unauthorized" }, statusCode: StatusCodes.Status401Unauthorized);
            }

            if (!TryParseCreateRequest(body, out var requestBody, out var createError))
            {
                return Results.Json(createError!, statusCode: StatusCodes.Status400BadRequest);
            }

            if (!await OwnsSessionAsync(dbContext, id, currentUser.UserId, cancellationToken))
            {
                return Results.Json(new { error = "Session not found" }, statusCode: StatusCodes.Status404NotFound);
            }

            var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var requestId = Guid.NewGuid().ToString();
            var clientRequestId = requestBody!.ClientRequestId ?? $"permission:{requestId}";
            var createdAt = FormatTimestamp(nowMs);
            var expiresAtMs = ResolvePermissionRequestTimeoutMs(configuration) is long timeoutMs ? nowMs + timeoutMs : null;

            await permissionRequestStore.InsertAsync(new PermissionRequestInfoRecord(
                requestId,
                id,
                requestBody.ToolName,
                requestBody.Scope,
                requestBody.Reason,
                requestBody.RiskLevel,
                requestBody.PreviewAction,
                "pending",
                null,
                JsonSerializer.Serialize(new { clientRequestId }),
                expiresAtMs,
                JsonSerializer.Serialize(new[] { requestBody.Scope }),
                createdAt,
                createdAt),
                cancellationToken);

            await PublishSessionRunEventAsync(
                id,
                currentUser.UserId,
                clientRequestId,
                CreatePermissionAskedEventPayload(requestId, requestBody, nowMs),
                sessionRunEventStore,
                sessionRunEventBroadcaster,
                cancellationToken);

            await SetSessionStateAsync(dbContext, id, currentUser.UserId, "paused", cancellationToken);

            var createdRequest = await permissionRequestStore.GetAsync(id, requestId, cancellationToken);
            return Results.Json(
                new
                {
                    request = createdRequest is null
                        ? MapPendingPermissionRequest(new PermissionRequestInfoRecord(
                            requestId,
                            id,
                            requestBody.ToolName,
                            requestBody.Scope,
                            requestBody.Reason,
                            requestBody.RiskLevel,
                            requestBody.PreviewAction,
                            "pending",
                            null,
                            JsonSerializer.Serialize(new { clientRequestId }),
                            expiresAtMs,
                            JsonSerializer.Serialize(new[] { requestBody.Scope }),
                            createdAt,
                            createdAt))
                        : MapPendingPermissionRequest(createdRequest),
                },
                statusCode: StatusCodes.Status201Created);
        }).RequireAuthorization();

        endpoints.MapPost("/sessions/{id}/permissions/reply", async Task<IResult> (
            string id,
            JsonElement body,
            ICurrentUser currentUser,
            GatewayDbContext dbContext,
            IPermissionRequestStore permissionRequestStore,
            ISessionRunEventStore sessionRunEventStore,
            ISessionRunEventBroadcaster sessionRunEventBroadcaster,
            IServiceScopeFactory scopeFactory,
            ILoggerFactory loggerFactory,
            IConfiguration configuration,
            CancellationToken cancellationToken) =>
        {
            if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId))
            {
                return Results.Json(new { error = "Unauthorized" }, statusCode: StatusCodes.Status401Unauthorized);
            }

            if (!TryParseReplyRequest(body, out var replyBody, out var replyError))
            {
                return Results.Json(replyError!, statusCode: StatusCodes.Status400BadRequest);
            }

            if (!await OwnsSessionAsync(dbContext, id, currentUser.UserId, cancellationToken))
            {
                return Results.Json(new { error = "Session not found" }, statusCode: StatusCodes.Status404NotFound);
            }

            var permissionRequest = await permissionRequestStore.GetAsync(id, replyBody!.RequestId, cancellationToken);
            if (permissionRequest is null)
            {
                return Results.Json(new { error = "Permission request not found" }, statusCode: StatusCodes.Status404NotFound);
            }

            if (permissionRequest.Status == "pending"
                && permissionRequest.ExpiresAtMs is long expiresAtMs
                && expiresAtMs <= DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())
            {
                var expiredRequests = await ExpirePendingPermissionRequestsAsync(
                    id,
                    currentUser.UserId,
                    permissionRequestStore,
                    sessionRunEventStore,
                    sessionRunEventBroadcaster,
                    dbContext,
                    cancellationToken);
                if (expiredRequests.Any((record) => string.Equals(record.Id, replyBody.RequestId, StringComparison.Ordinal)))
                {
                    return Results.Json(new { error = "Permission request expired" }, statusCode: StatusCodes.Status409Conflict);
                }

                permissionRequest = await permissionRequestStore.GetAsync(id, replyBody.RequestId, cancellationToken);
                if (permissionRequest is null)
                {
                    return Results.Json(new { error = "Permission request not found" }, statusCode: StatusCodes.Status404NotFound);
                }
            }

            if (!string.Equals(permissionRequest.Status, "pending", StringComparison.Ordinal))
            {
                return Results.Json(new { error = "Permission request already resolved" }, statusCode: StatusCodes.Status409Conflict);
            }

            var updatedAt = FormatTimestamp(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            var isPermanentDecision = string.Equals(replyBody.Decision, "permanent", StringComparison.Ordinal);

            if (isPermanentDecision)
            {
                var claimed = await permissionRequestStore.BeginPermanentMaterializationAsync(
                    id,
                    replyBody.RequestId,
                    updatedAt,
                    cancellationToken);
                if (!claimed)
                {
                    return Results.Json(new { error = "Permission request already resolved" }, statusCode: StatusCodes.Status409Conflict);
                }
            }

            WorkspacePermissionMaterializationResult? permanentMaterialization = null;
            if (isPermanentDecision)
            {
                try
                {
                    permanentMaterialization = await PermissionsRouteWorkspacePermissionConfigWriter.PersistAsync(
                        dbContext,
                        configuration,
                        id,
                        permissionRequest.ToolName,
                        ResolveAlwaysPatterns(permissionRequest.AlwaysJson, permissionRequest.Scope),
                        cancellationToken);
                }
                catch
                {
                    await RollbackPermanentMaterializationAsync(
                        permissionRequestStore,
                        null,
                        id,
                        replyBody.RequestId,
                        updatedAt);
                    throw;
                }

                if (permanentMaterialization is null)
                {
                    await RollbackPermanentMaterializationAsync(
                        permissionRequestStore,
                        null,
                        id,
                        replyBody.RequestId,
                        updatedAt);
                    return Results.Json(new { error = "Workspace root unavailable for permanent permission" }, statusCode: StatusCodes.Status409Conflict);
                }
            }

            var resolvedStatus = string.Equals(replyBody.Decision, "reject", StringComparison.Ordinal) ? "rejected" : "approved";
            bool updated;
            if (isPermanentDecision)
            {
                try
                {
                    updated = await permissionRequestStore.CompletePermanentMaterializationAsync(
                        id,
                        replyBody.RequestId,
                        updatedAt,
                        cancellationToken);
                }
                catch
                {
                    await RollbackPermanentMaterializationAsync(
                        permissionRequestStore,
                        permanentMaterialization,
                        id,
                        replyBody.RequestId,
                        updatedAt);
                    throw;
                }
            }
            else
            {
                updated = await permissionRequestStore.UpdateResolutionAsync(
                    id,
                    replyBody.RequestId,
                    resolvedStatus,
                    replyBody.Decision,
                    updatedAt,
                    cancellationToken);
            }

            if (!updated)
            {
                if (isPermanentDecision)
                {
                    await RollbackPermanentMaterializationAsync(
                        permissionRequestStore,
                        permanentMaterialization,
                        id,
                        replyBody.RequestId,
                        updatedAt);
                }

                return Results.Json(new { error = "Permission request already resolved" }, statusCode: StatusCodes.Status409Conflict);
            }

            dbContext.PermissionDecisionLogs.Add(new PermissionDecisionLogRecord
            {
                RequestId = replyBody.RequestId,
                SessionId = id,
                ToolName = permissionRequest.ToolName,
                Scope = permissionRequest.Scope,
                Decision = replyBody.Decision,
                WorkspaceRoot = permanentMaterialization?.WorkspaceRoot,
                CreatedAtUtc = DateTimeOffset.UtcNow,
            });
            await dbContext.SaveChangesAsync(cancellationToken);

            if (string.Equals(replyBody.Decision, "reject", StringComparison.Ordinal))
            {
                var otherPendingRequests = await permissionRequestStore.ListPendingAsync(id, cancellationToken);
                foreach (var otherPendingRequest in otherPendingRequests.Where((record) => !string.Equals(record.Id, replyBody.RequestId, StringComparison.Ordinal)))
                {
                    if (!await permissionRequestStore.UpdateResolutionAsync(
                            id,
                            otherPendingRequest.Id,
                            "rejected",
                            "reject",
                            updatedAt,
                            cancellationToken))
                    {
                        continue;
                    }

                    await PublishSessionRunEventAsync(
                        id,
                        currentUser.UserId,
                        ParsePermissionRequestClientRequestId(otherPendingRequest.RequestPayloadJson),
                        CreatePermissionRepliedEventPayload(otherPendingRequest.Id, "reject", null, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()),
                        sessionRunEventStore,
                        sessionRunEventBroadcaster,
                        cancellationToken);
                }
            }

            await PublishSessionRunEventAsync(
                id,
                currentUser.UserId,
                ParsePermissionRequestClientRequestId(permissionRequest.RequestPayloadJson),
                CreatePermissionRepliedEventPayload(
                    replyBody.RequestId,
                    replyBody.Decision,
                    string.Equals(replyBody.Decision, "reject", StringComparison.Ordinal) ? replyBody.Feedback : null,
                    DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()),
                sessionRunEventStore,
                sessionRunEventBroadcaster,
                cancellationToken);

            var resumeContext = TryBuildResumeRequest(permissionRequest.RequestPayloadJson, id, currentUser.UserId);
            var continueOnDeny = string.Equals(replyBody.Decision, "reject", StringComparison.Ordinal)
                && resumeContext is not null
                && string.Equals(configuration["OPENAWORK_CONTINUE_ON_DENY"], "true", StringComparison.OrdinalIgnoreCase);
            var shouldResume = !string.Equals(replyBody.Decision, "reject", StringComparison.Ordinal) && resumeContext is not null;
            var nextState = string.Equals(replyBody.Decision, "reject", StringComparison.Ordinal) && !continueOnDeny
                ? "idle"
                : "running";
            await SetSessionStateAsync(dbContext, id, currentUser.UserId, nextState, cancellationToken);

            if (shouldResume || continueOnDeny)
            {
                var logger = loggerFactory.CreateLogger("PermissionsRouteGroupExtensions");
                var initialToolResult = string.Equals(replyBody.Decision, "reject", StringComparison.Ordinal)
                    ? BuildRejectedInitialToolResult(resumeContext!, permissionRequest.ToolName, replyBody.Feedback)
                    : await ExecuteApprovedToolAsync(resumeContext!, permissionRequest.ToolName, dbContext, configuration, logger, cancellationToken);
                var runtimeRequest = BuildRuntimeResumeRequest(resumeContext!, initialToolResult);
                StartResumeInBackground(
                    scopeFactory,
                    loggerFactory,
                    runtimeRequest,
                    id,
                    currentUser.UserId,
                    runtimeRequest.ClientRequestId);
            }

            return Results.Ok(new { ok = true });
        }).RequireAuthorization();

        return endpoints;
    }

    private static async Task<bool> OwnsSessionAsync(GatewayDbContext dbContext, string sessionId, string userId, CancellationToken cancellationToken)
        => await dbContext.Sessions.AnyAsync((session) => session.Id == sessionId && session.UserId == userId, cancellationToken);

    private static async Task<IReadOnlyList<PermissionRequestInfoRecord>> ExpirePendingPermissionRequestsAsync(
        string sessionId,
        string userId,
        IPermissionRequestStore permissionRequestStore,
        ISessionRunEventStore sessionRunEventStore,
        ISessionRunEventBroadcaster sessionRunEventBroadcaster,
        GatewayDbContext dbContext,
        CancellationToken cancellationToken)
    {
        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var expiredRequests = await permissionRequestStore.ExpirePendingAsync(sessionId, nowMs, FormatTimestamp(nowMs), cancellationToken);
        foreach (var expiredRequest in expiredRequests)
        {
            await PublishSessionRunEventAsync(
                sessionId,
                userId,
                ParsePermissionRequestClientRequestId(expiredRequest.RequestPayloadJson),
                CreatePermissionRepliedEventPayload(expiredRequest.Id, "reject", null, nowMs),
                sessionRunEventStore,
                sessionRunEventBroadcaster,
                cancellationToken);
        }

        if (expiredRequests.Count > 0)
        {
            var remainingPending = await permissionRequestStore.ListPendingAsync(sessionId, cancellationToken);
            await SetSessionStateAsync(dbContext, sessionId, userId, remainingPending.Count > 0 ? "paused" : "idle", cancellationToken);
        }

        return expiredRequests;
    }

    private static async Task PublishSessionRunEventAsync(
        string sessionId,
        string userId,
        string? clientRequestId,
        object payload,
        ISessionRunEventStore sessionRunEventStore,
        ISessionRunEventBroadcaster sessionRunEventBroadcaster,
        CancellationToken cancellationToken)
    {
        var payloadJson = JsonSerializer.Serialize(payload);
        using var document = JsonDocument.Parse(payloadJson);
        var root = document.RootElement.Clone();
        var occurredAt = root.TryGetProperty("occurredAt", out var occurredAtElement) && occurredAtElement.ValueKind == JsonValueKind.Number && occurredAtElement.TryGetInt64(out var occurredAtMs)
            ? occurredAtMs
            : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var eventType = root.TryGetProperty("type", out var typeElement) && typeElement.ValueKind == JsonValueKind.String
            ? typeElement.GetString() ?? "event"
            : "event";
        var eventId = root.TryGetProperty("eventId", out var eventIdElement) && eventIdElement.ValueKind == JsonValueKind.String
            ? eventIdElement.GetString()
            : null;
        var runId = root.TryGetProperty("runId", out var runIdElement) && runIdElement.ValueKind == JsonValueKind.String
            ? runIdElement.GetString()
            : null;

        await sessionRunEventStore.PersistAsync(new SessionRunEventInfoRecord(
            0,
            sessionId,
            userId,
            clientRequestId,
            null,
            eventType,
            eventId,
            runId,
            occurredAt,
            payloadJson,
            FormatTimestamp(occurredAt)),
            cancellationToken);

        if (!string.IsNullOrWhiteSpace(clientRequestId))
        {
            var seq = await sessionRunEventStore.GetLatestSeqByRequestAsync(sessionId, clientRequestId, cancellationToken);
            sessionRunEventBroadcaster.Publish(sessionId, root, new SessionRunEventBroadcastRecord(clientRequestId, seq));
        }
    }

    private static async Task SetSessionStateAsync(GatewayDbContext dbContext, string sessionId, string userId, string status, CancellationToken cancellationToken)
    {
        var session = await dbContext.Sessions.SingleOrDefaultAsync((item) => item.Id == sessionId && item.UserId == userId, cancellationToken);
        if (session is null)
        {
            return;
        }

        session.StateStatus = status;
        session.UpdatedAtUtc = DateTimeOffset.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private static async Task RollbackPermanentMaterializationAsync(
        IPermissionRequestStore permissionRequestStore,
        WorkspacePermissionMaterializationResult? permanentMaterialization,
        string sessionId,
        string requestId,
        string updatedAt)
    {
        List<Exception>? rollbackErrors = null;

        if (permanentMaterialization is not null)
        {
            try
            {
                await PermissionsRouteWorkspacePermissionConfigWriter.RollbackAsync(permanentMaterialization, CancellationToken.None);
            }
            catch (Exception ex)
            {
                rollbackErrors = [ex];
            }
        }

        try
        {
            var reverted = await permissionRequestStore.RevertPermanentMaterializationAsync(sessionId, requestId, updatedAt, CancellationToken.None);
            if (!reverted)
            {
                (rollbackErrors ??= []).Add(new InvalidOperationException("Failed to revert permanent materialization state."));
            }
        }
        catch (Exception ex)
        {
            (rollbackErrors ??= []).Add(ex);
        }

        if (rollbackErrors is null || rollbackErrors.Count == 0)
        {
            return;
        }

        if (rollbackErrors.Count == 1)
        {
            throw rollbackErrors[0];
        }

        throw new AggregateException("Failed to rollback permanent permission materialization.", rollbackErrors);
    }

    private static bool TryParseCreateRequest(JsonElement body, out CreatePermissionRequestBody? request, out object? error)
    {
        request = null;
        error = null;
        var issues = new List<object>();

        if (body.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue(Array.Empty<string>(), "object", DescribeJsonKind(body.ValueKind)));
            error = new { error = "Invalid input", issues };
            return false;
        }

        var toolName = ReadRequiredString(body, "toolName", 1, 255, issues);
        var scope = ReadRequiredString(body, "scope", 1, 4000, issues);
        var reason = ReadRequiredString(body, "reason", 1, 4000, issues);
        var riskLevel = ReadRequiredString(body, "riskLevel", 1, 20, issues);

        if (riskLevel is not null && riskLevel is not ("low" or "medium" or "high"))
        {
            issues.Add(new { code = "invalid_enum_value", path = new[] { "riskLevel" }, message = "Invalid riskLevel" });
        }

        var previewAction = ReadOptionalString(body, "previewAction", 4000, issues);
        var clientRequestId = ReadOptionalString(body, "clientRequestId", 128, issues);

        if (issues.Count > 0 || toolName is null || scope is null || reason is null || riskLevel is null)
        {
            error = new { error = "Invalid input", issues };
            return false;
        }

        request = new CreatePermissionRequestBody(toolName, scope, reason, riskLevel, previewAction, clientRequestId);
        return true;
    }

    private static bool TryParseReplyRequest(JsonElement body, out ReplyPermissionRequestBody? request, out object? error)
    {
        request = null;
        error = null;
        var issues = new List<object>();

        if (body.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue(Array.Empty<string>(), "object", DescribeJsonKind(body.ValueKind)));
            error = new { error = "Invalid input", issues };
            return false;
        }

        var requestId = ReadRequiredString(body, "requestId", 1, 128, issues);
        var decision = ReadRequiredString(body, "decision", 1, 20, issues);

        if (decision is not null && decision is not ("once" or "session" or "permanent" or "reject"))
        {
            issues.Add(new { code = "invalid_enum_value", path = new[] { "decision" }, message = "Invalid decision" });
        }

        var feedback = ReadOptionalString(body, "feedback", 2000, issues);
        if (issues.Count > 0 || requestId is null || decision is null)
        {
            error = new { error = "Invalid input", issues };
            return false;
        }

        request = new ReplyPermissionRequestBody(requestId, decision, feedback);
        return true;
    }

    private static string? ReadRequiredString(JsonElement body, string propertyName, int minLength, int maxLength, List<object> issues)
    {
        if (!body.TryGetProperty(propertyName, out var property))
        {
            issues.Add(CreateInvalidTypeIssue(new[] { propertyName }, "string", "undefined"));
            return null;
        }

        return ReadStringElement(property, propertyName, minLength, maxLength, issues);
    }

    private static string? ReadOptionalString(JsonElement body, string propertyName, int maxLength, List<object> issues)
    {
        if (!body.TryGetProperty(propertyName, out var property) || property.ValueKind == JsonValueKind.Undefined)
        {
            return null;
        }

        if (property.ValueKind == JsonValueKind.Null)
        {
            issues.Add(CreateInvalidTypeIssue(new[] { propertyName }, "string", "null"));
            return null;
        }

        return ReadStringElement(property, propertyName, 0, maxLength, issues);
    }

    private static string? ReadStringElement(JsonElement property, string propertyName, int minLength, int maxLength, List<object> issues)
    {
        if (property.ValueKind != JsonValueKind.String)
        {
            issues.Add(CreateInvalidTypeIssue(new[] { propertyName }, "string", DescribeJsonKind(property.ValueKind)));
            return null;
        }

        var trimmed = property.GetString()?.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            if (minLength > 0)
            {
                issues.Add(CreateTooSmallStringIssue(new[] { propertyName }, minLength));
            }

            return null;
        }

        if (trimmed.Length > maxLength)
        {
            issues.Add(CreateTooBigStringIssue(new[] { propertyName }, maxLength));
            return null;
        }

        return trimmed;
    }

    private static long? ResolvePermissionRequestTimeoutMs(IConfiguration configuration)
        => long.TryParse(configuration["OPENAWORK_PERMISSION_REQUEST_TIMEOUT_MS"], out var timeoutMs) && timeoutMs > 0
            ? timeoutMs
            : null;

    private static PermissionResumeContext? TryBuildResumeRequest(string? payloadJson, string sessionId, string userId)
    {
        if (string.IsNullOrWhiteSpace(payloadJson))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(payloadJson);
            var root = document.RootElement;
            if (!root.TryGetProperty("clientRequestId", out var requestIdElement) || requestIdElement.ValueKind != JsonValueKind.String)
            {
                return null;
            }

            if (!root.TryGetProperty("toolCallId", out var toolCallIdElement) || toolCallIdElement.ValueKind != JsonValueKind.String)
            {
                return null;
            }

            if (!root.TryGetProperty("rawInput", out var rawInputElement) || rawInputElement.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            var nextRound = root.TryGetProperty("nextRound", out var nextRoundElement) && nextRoundElement.TryGetInt32(out var parsedRound)
                ? parsedRound
                : (int?)null;

            if (!root.TryGetProperty("requestData", out var requestDataElement) || requestDataElement.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            if (!requestDataElement.TryGetProperty("message", out var messageElement) || messageElement.ValueKind != JsonValueKind.String)
            {
                return null;
            }

            var requestId = requestIdElement.GetString()?.Trim();
            var message = messageElement.GetString()?.Trim();
            var toolCallId = toolCallIdElement.GetString()?.Trim();
            if (string.IsNullOrWhiteSpace(requestId) || string.IsNullOrWhiteSpace(message))
            {
                return null;
            }

            var agentId = requestDataElement.TryGetProperty("agentId", out var agentIdElement) && agentIdElement.ValueKind == JsonValueKind.String
                ? agentIdElement.GetString()?.Trim()
                : null;
            var providerId = requestDataElement.TryGetProperty("providerId", out var providerIdElement) && providerIdElement.ValueKind == JsonValueKind.String
                ? providerIdElement.GetString()?.Trim()
                : null;
            var model = requestDataElement.TryGetProperty("model", out var modelElement) && modelElement.ValueKind == JsonValueKind.String
                ? modelElement.GetString()?.Trim()
                : null;
            if (requestId.Length > 128
                || string.IsNullOrWhiteSpace(toolCallId)
                || toolCallId.Length > 200
                || message.Length > 32768
                || (agentId is not null && agentId.Length > 120)
                || (providerId is not null && providerId.Length > 120)
                || (model is not null && model.Length > 200))
            {
                return null;
            }

            return new PermissionResumeContext(
                sessionId,
                userId,
                requestId,
                message,
                requestDataElement.TryGetProperty("displayMessage", out var displayMessage) && displayMessage.ValueKind == JsonValueKind.String ? displayMessage.GetString() : null,
                agentId,
                providerId,
                model,
                requestDataElement.TryGetProperty("thinkingEnabled", out var thinkingEnabled) && thinkingEnabled.ValueKind is JsonValueKind.True or JsonValueKind.False ? thinkingEnabled.GetBoolean() : null,
                requestDataElement.TryGetProperty("webSearchEnabled", out var webSearchEnabled) && webSearchEnabled.ValueKind is JsonValueKind.True or JsonValueKind.False ? webSearchEnabled.GetBoolean() : null,
                requestDataElement.GetRawText(),
                toolCallId,
                rawInputElement.GetRawText(),
                nextRound,
                root.TryGetProperty("observability", out var observabilityElement) && observabilityElement.ValueKind == JsonValueKind.Object ? observabilityElement.GetRawText() : null);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? ParsePermissionRequestClientRequestId(string? payloadJson)
    {
        if (string.IsNullOrWhiteSpace(payloadJson))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(payloadJson);
            return document.RootElement.TryGetProperty("clientRequestId", out var clientRequestId)
                && clientRequestId.ValueKind == JsonValueKind.String
                ? clientRequestId.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static SessionStreamRuntimeRequest BuildRuntimeResumeRequest(PermissionResumeContext context, SessionStreamInitialToolResult initialToolResult)
        => new(
            context.SessionId,
            context.UserId,
            context.ClientRequestId,
            context.Message,
            context.DisplayMessage,
            context.AgentId,
            context.ProviderId,
            context.Model,
            context.ThinkingEnabled,
            context.WebSearchEnabled,
            context.RequestDataJson,
            context.ObservabilityJson,
            initialToolResult);

    private static SessionStreamInitialToolResult BuildRejectedInitialToolResult(PermissionResumeContext context, string toolName, string? feedback)
    {
        var output = string.IsNullOrWhiteSpace(feedback)
            ? "权限已拒绝，工具未执行。请尝试其他方法。"
            : $"权限已拒绝。用户反馈: {feedback}。请尝试其他方法。";
        return new SessionStreamInitialToolResult(
            context.ToolCallId,
            toolName,
            context.RawInputJson,
            JsonSerializer.Serialize(output),
            true,
            false,
            context.NextRound,
            "permission_denied");
    }

    private static async Task<SessionStreamInitialToolResult> ExecuteApprovedToolAsync(
        PermissionResumeContext context,
        string toolName,
        GatewayDbContext dbContext,
        IConfiguration configuration,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        if (!string.Equals(toolName, "bash", StringComparison.Ordinal))
        {
            return new SessionStreamInitialToolResult(
                context.ToolCallId,
                toolName,
                context.RawInputJson,
                JsonSerializer.Serialize($"Tool \"{toolName}\" execution is not yet supported in .NET resume."),
                true,
                true,
                context.NextRound,
                "unsupported_tool");
        }

        using var rawInputDocument = JsonDocument.Parse(context.RawInputJson);
        var command = rawInputDocument.RootElement.TryGetProperty("command", out var commandElement) && commandElement.ValueKind == JsonValueKind.String
            ? commandElement.GetString()?.Trim()
            : null;
        if (string.IsNullOrWhiteSpace(command))
        {
            return new SessionStreamInitialToolResult(
                context.ToolCallId,
                toolName,
                context.RawInputJson,
                JsonSerializer.Serialize("Bash command is missing."),
                true,
                true,
                context.NextRound,
                "invalid_raw_input");
        }

        if (TryGetApprovedBashCommandRejectionReason(command, out var rejectionReason))
        {
            return new SessionStreamInitialToolResult(
                context.ToolCallId,
                toolName,
                context.RawInputJson,
                JsonSerializer.Serialize(rejectionReason),
                true,
                true,
                context.NextRound,
                "invalid_command");
        }

        var workdir = rawInputDocument.RootElement.TryGetProperty("workdir", out var workdirElement) && workdirElement.ValueKind == JsonValueKind.String
            ? workdirElement.GetString()?.Trim()
            : null;
        var timeoutMs = rawInputDocument.RootElement.TryGetProperty("timeout", out var timeoutElement) && timeoutElement.TryGetInt32(out var parsedTimeout)
            ? Math.Clamp(parsedTimeout, 1000, 120000)
            : 30000;

        var workdirResolution = await TryResolveApprovedBashWorkingDirectoryAsync(
            dbContext,
            configuration,
            context.SessionId,
            workdir,
            cancellationToken);
        if (!workdirResolution.Success)
        {
            return new SessionStreamInitialToolResult(
                context.ToolCallId,
                toolName,
                context.RawInputJson,
                JsonSerializer.Serialize(workdirResolution.Error),
                true,
                true,
                context.NextRound,
                "invalid_workdir");
        }

        try
        {
            using var process = new System.Diagnostics.Process
            {
                StartInfo = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "/bin/bash",
                    ArgumentList = { "-lc", command },
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    WorkingDirectory = workdirResolution.ResolvedWorkdir,
                },
            };

            process.Start();
            var outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
            var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);
            var waitForExitTask = process.WaitForExitAsync(cancellationToken);
            var timeoutTask = Task.Delay(timeoutMs, cancellationToken);
            if (await Task.WhenAny(waitForExitTask, timeoutTask) != waitForExitTask)
            {
                try
                {
                    process.Kill(entireProcessTree: true);
                }
                catch (Exception killException)
                {
                    logger.LogWarning(killException, "failed to kill timed out approved bash process for session {SessionId}", context.SessionId);
                }

                return new SessionStreamInitialToolResult(
                    context.ToolCallId,
                    toolName,
                    context.RawInputJson,
                    JsonSerializer.Serialize("Command timed out."),
                    true,
                    true,
                    context.NextRound,
                    "timeout");
            }

            await waitForExitTask;

            var stdout = await outputTask;
            var stderr = await errorTask;
            var succeeded = process.ExitCode == 0;
            var textOutput = succeeded ? stdout.TrimEnd() : string.IsNullOrWhiteSpace(stderr) ? stdout.TrimEnd() : stderr.TrimEnd();
            if (string.IsNullOrWhiteSpace(textOutput))
            {
                textOutput = succeeded ? "Command completed successfully." : $"Command failed with exit code {process.ExitCode}.";
            }

            textOutput = TruncateApprovedBashOutput(textOutput);

            return new SessionStreamInitialToolResult(
                context.ToolCallId,
                toolName,
                context.RawInputJson,
                JsonSerializer.Serialize(textOutput),
                !succeeded,
                true,
                context.NextRound,
                succeeded ? null : "command_failed");
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "approved bash execution failed for session {SessionId} tool call {ToolCallId}", context.SessionId, context.ToolCallId);
            return new SessionStreamInitialToolResult(
                context.ToolCallId,
                toolName,
                context.RawInputJson,
                JsonSerializer.Serialize("Command execution failed. Check server logs for details."),
                true,
                true,
                context.NextRound,
                "command_failed");
        }
    }

    private static bool TryGetApprovedBashCommandRejectionReason(string command, out string? reason)
    {
        reason = null;

        if (command.IndexOfAny(['\r', '\n']) >= 0)
        {
            reason = "Approved bash does not allow multiline commands.";
            return true;
        }

        if (command.Contains('`'))
        {
            reason = "Approved bash does not allow backticks.";
            return true;
        }

        if (command.Contains("$(", StringComparison.Ordinal))
        {
            reason = "Approved bash does not allow command substitution.";
            return true;
        }

        if (command.IndexOfAny([';', '&', '|', '>', '<']) >= 0)
        {
            reason = "Approved bash does not allow shell chaining, pipes, or redirection operators.";
            return true;
        }

        if (ApprovedBashEnvOverrideRegex.IsMatch(command))
        {
            reason = "Approved bash does not allow PATH or dynamic loader environment overrides.";
            return true;
        }

        if (ApprovedBashSudoRegex.IsMatch(command))
        {
            reason = "Approved bash does not allow sudo.";
            return true;
        }

        return false;
    }

    private static async Task<(bool Success, string ResolvedWorkdir, string? Error)> TryResolveApprovedBashWorkingDirectoryAsync(
        GatewayDbContext dbContext,
        IConfiguration configuration,
        string sessionId,
        string? requestedWorkdir,
        CancellationToken cancellationToken)
    {
        var configuredRoots = PermissionsRouteWorkspacePermissionConfigWriter.ResolveConfiguredWorkspaceRoots(configuration);
        if (configuredRoots.Count == 0)
        {
            return (false, string.Empty, "Approved bash requires a configured WORKSPACE_ROOT or WORKSPACE_ROOTS.");
        }

        var candidateWorkdir = string.IsNullOrWhiteSpace(requestedWorkdir)
            ? await PermissionsRouteWorkspacePermissionConfigWriter.ResolveSessionWorkspaceRootAsync(
                    dbContext,
                    configuration,
                    sessionId,
                    cancellationToken)
                ?? configuredRoots[0]
            : requestedWorkdir;
        if (!Path.IsPathRooted(candidateWorkdir))
        {
            return (false, string.Empty, "Approved bash workdir must be an absolute path under configured WORKSPACE_ROOT or WORKSPACE_ROOTS.");
        }

        var normalizedWorkdir = Path.GetFullPath(candidateWorkdir);
        if (!Directory.Exists(normalizedWorkdir))
        {
            return (false, string.Empty, "Approved bash workdir must point to an existing directory under configured WORKSPACE_ROOT or WORKSPACE_ROOTS.");
        }

        var matchedRoot = configuredRoots
            .FirstOrDefault((root) => IsPathUnderRoot(normalizedWorkdir, root));
        if (matchedRoot is null)
        {
            return (false, string.Empty, "Approved bash workdir must stay within configured WORKSPACE_ROOT or WORKSPACE_ROOTS.");
        }

        if (HasSymbolicLinkInDirectoryPath(normalizedWorkdir, matchedRoot))
        {
            return (false, string.Empty, "Approved bash workdir must not traverse symbolic links under configured WORKSPACE_ROOT or WORKSPACE_ROOTS.");
        }

        return (true, normalizedWorkdir, null);
    }

    internal static bool IsPathUnderRoot(string candidatePath, string rootPath)
    {
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        if (string.Equals(candidatePath, rootPath, comparison))
        {
            return true;
        }

        var normalizedRoot = rootPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        return candidatePath.StartsWith(normalizedRoot, comparison);
    }

    private static string[] ResolveAlwaysPatterns(string? raw, string scope)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return [scope];
        }

        try
        {
            using var document = JsonDocument.Parse(raw);
            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                return [scope];
            }

            var values = document.RootElement
                .EnumerateArray()
                .Where((item) => item.ValueKind == JsonValueKind.String)
                .Select((item) => item.GetString())
                .Where((item) => !string.IsNullOrWhiteSpace(item))
                .Select((item) => item!)
                .ToArray();
            return values.Length > 0 ? values : [scope];
        }
        catch (JsonException)
        {
            return [scope];
        }
    }

    internal static bool HasSymbolicLinkInDirectoryPath(string candidatePath, string rootPath)
    {
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        var currentPath = candidatePath;
        while (true)
        {
            var directoryInfo = new DirectoryInfo(currentPath);
            if (!string.IsNullOrWhiteSpace(directoryInfo.LinkTarget))
            {
                return true;
            }

            if (string.Equals(currentPath, rootPath, comparison))
            {
                return false;
            }

            var parent = directoryInfo.Parent;
            if (parent is null)
            {
                return false;
            }

            currentPath = parent.FullName;
        }
    }

    private static string TruncateApprovedBashOutput(string output)
    {
        using var reader = new StringReader(output);
        var builder = new StringBuilder();
        var lineCount = 0;
        var truncated = false;
        string? line;
        while ((line = reader.ReadLine()) is not null)
        {
            if (lineCount >= MaxApprovedBashOutputLines)
            {
                truncated = true;
                break;
            }

            var candidate = builder.Length == 0 ? line : $"\n{line}";
            if (Encoding.UTF8.GetByteCount(builder.ToString()) + Encoding.UTF8.GetByteCount(candidate) > MaxApprovedBashOutputBytes)
            {
                truncated = true;
                break;
            }

            builder.Append(candidate);
            lineCount += 1;
        }

        if (builder.Length == 0 && !string.IsNullOrEmpty(output))
        {
            var maxLength = Math.Min(output.Length, MaxApprovedBashOutputBytes);
            builder.Append(output[..maxLength]);
            truncated = output.Length > maxLength;
        }

        if (truncated)
        {
            if (builder.Length > 0)
            {
                builder.Append('\n');
            }

            builder.Append("...[truncated]");
        }

        return builder.ToString();
    }

    private static void StartResumeInBackground(
        IServiceScopeFactory scopeFactory,
        ILoggerFactory loggerFactory,
        SessionStreamRuntimeRequest request,
        string sessionId,
        string userId,
        string clientRequestId)
    {
        var logger = loggerFactory.CreateLogger("PermissionsRouteGroupExtensions");
        _ = Task.Run(async () =>
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var runtimeService = scope.ServiceProvider.GetRequiredService<ISessionStreamRuntimeService>();
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            try
            {
                var statusCode = await runtimeService.HandleAsync(request, static _ => ValueTask.CompletedTask, CancellationToken.None);
                if (statusCode != StatusCodes.Status200OK)
                {
                    await SetSessionStateAsync(dbContext, sessionId, userId, "idle", CancellationToken.None);
                    logger.LogWarning("permission resume returned non-success status {StatusCode} for session {SessionId} request {ClientRequestId}", statusCode, sessionId, clientRequestId);
                }
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "failed to auto-resume permission request for session {SessionId} request {ClientRequestId}", sessionId, clientRequestId);
                await SetSessionStateAsync(dbContext, sessionId, userId, "idle", CancellationToken.None);
            }
        });
    }

    private static object MapPendingPermissionRequest(PermissionRequestInfoRecord record)
    {
        var payload = new Dictionary<string, object?>
        {
            ["requestId"] = record.Id,
            ["sessionId"] = record.SessionId,
            ["toolName"] = record.ToolName,
            ["scope"] = record.Scope,
            ["reason"] = record.Reason,
            ["riskLevel"] = record.RiskLevel,
            ["status"] = record.Status,
            ["createdAt"] = record.CreatedAt,
        };

        if (!string.IsNullOrWhiteSpace(record.PreviewAction))
        {
            payload["previewAction"] = record.PreviewAction;
        }

        if (!string.IsNullOrWhiteSpace(record.Decision))
        {
            payload["decision"] = record.Decision;
        }

        return payload;
    }

    private static string FormatTimestamp(long epochMs)
        => DateTimeOffset.FromUnixTimeMilliseconds(epochMs).UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);

    private sealed record CreatePermissionRequestBody(
        string ToolName,
        string Scope,
        string Reason,
        string RiskLevel,
        string? PreviewAction,
        string? ClientRequestId);

    private sealed record ReplyPermissionRequestBody(
        string RequestId,
        string Decision,
        string? Feedback);

    private sealed record PermissionResumeContext(
        string SessionId,
        string UserId,
        string ClientRequestId,
        string Message,
        string? DisplayMessage,
        string? AgentId,
        string? ProviderId,
        string? Model,
        bool? ThinkingEnabled,
        bool? WebSearchEnabled,
        string RequestDataJson,
        string ToolCallId,
        string RawInputJson,
        int? NextRound,
        string? ObservabilityJson);

    private static Dictionary<string, object?> CreatePermissionAskedEventPayload(string requestId, CreatePermissionRequestBody requestBody, long occurredAt)
    {
        var payload = new Dictionary<string, object?>
        {
            ["type"] = "permission_asked",
            ["requestId"] = requestId,
            ["toolName"] = requestBody.ToolName,
            ["scope"] = requestBody.Scope,
            ["reason"] = requestBody.Reason,
            ["riskLevel"] = requestBody.RiskLevel,
            ["eventId"] = $"permission:{requestId}:asked",
            ["runId"] = $"permission:{requestId}",
            ["occurredAt"] = occurredAt,
        };

        if (!string.IsNullOrWhiteSpace(requestBody.PreviewAction))
        {
            payload["previewAction"] = requestBody.PreviewAction;
        }

        return payload;
    }

    private static Dictionary<string, object?> CreatePermissionRepliedEventPayload(string requestId, string decision, string? feedback, long occurredAt)
    {
        var payload = new Dictionary<string, object?>
        {
            ["type"] = "permission_replied",
            ["requestId"] = requestId,
            ["decision"] = decision,
            ["eventId"] = $"permission:{requestId}:replied",
            ["runId"] = $"permission:{requestId}",
            ["occurredAt"] = occurredAt,
        };

        if (!string.IsNullOrWhiteSpace(feedback))
        {
            payload["feedback"] = feedback;
        }

        return payload;
    }

    private static object CreateInvalidTypeIssue(string[] path, string expected, string received) => new
    {
        code = "invalid_type",
        expected,
        received,
        path,
        message = "Required",
    };

    private static object CreateTooSmallStringIssue(string[] path, int minimum) => new
    {
        code = "too_small",
        minimum,
        type = "string",
        inclusive = true,
        exact = false,
        path,
        message = $"String must contain at least {minimum} character(s)",
    };

    private static object CreateTooBigStringIssue(string[] path, int maximum) => new
    {
        code = "too_big",
        maximum,
        type = "string",
        inclusive = true,
        exact = false,
        path,
        message = $"String must contain at most {maximum} character(s)",
    };

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
}
