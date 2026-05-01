using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Application.Abstractions.Streaming;
using OpenAWork.Gateway.Persistence.EFCore;

namespace OpenAWork.Gateway.Host.Routes;

public static class QuestionsRouteGroupExtensions
{
    public static IEndpointRouteBuilder MapQuestionsRoutes(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/sessions/{id}/questions/pending", async Task<IResult> (
            string id,
            ICurrentUser currentUser,
            GatewayDbContext dbContext,
            IQuestionRequestStore questionRequestStore,
            CancellationToken cancellationToken) =>
        {
            var userId = RequireUserId(currentUser);
            if (!await OwnsSessionAsync(dbContext, id, userId, cancellationToken))
            {
                return Results.Json(new { error = "Session not found" }, statusCode: StatusCodes.Status404NotFound);
            }

            var requests = await questionRequestStore.ListPendingAsync(id, cancellationToken);
            return Results.Ok(new
            {
                requests = requests.Select(MapPendingQuestionRequest).ToArray(),
            });
        }).RequireAuthorization();

        endpoints.MapPost("/sessions/{id}/questions/reply", async Task<IResult> (
            string id,
            JsonElement body,
            ICurrentUser currentUser,
            GatewayDbContext dbContext,
            IQuestionRequestStore questionRequestStore,
            ISessionRunEventStore sessionRunEventStore,
            ISessionRunEventBroadcaster sessionRunEventBroadcaster,
            IServiceScopeFactory scopeFactory,
            ILoggerFactory loggerFactory,
            CancellationToken cancellationToken) =>
        {
            var userId = RequireUserId(currentUser);
            if (!TryParseReplyRequest(body, out var reply, out var issues))
            {
                return Results.Json(new { error = "Invalid input", issues }, statusCode: StatusCodes.Status400BadRequest);
            }

            if (!await OwnsSessionAsync(dbContext, id, userId, cancellationToken))
            {
                return Results.Json(new { error = "Session not found" }, statusCode: StatusCodes.Status404NotFound);
            }

            var questionRequest = await questionRequestStore.GetAsync(id, reply!.RequestId, cancellationToken);
            if (questionRequest is null)
            {
                return Results.Json(new { error = "Question request not found" }, statusCode: StatusCodes.Status404NotFound);
            }

            if (!string.Equals(questionRequest.Status, "pending", StringComparison.Ordinal))
            {
                return Results.Json(new { error = "Question request already resolved" }, statusCode: StatusCodes.Status409Conflict);
            }

            var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var answerJson = string.Equals(reply.Status, "answered", StringComparison.Ordinal)
                ? JsonSerializer.Serialize(reply.Answers)
                : null;
            var updatedAt = FormatTimestamp(nowMs);
            var updated = await questionRequestStore.UpdateResolutionAsync(
                id,
                reply.RequestId,
                reply.Status,
                answerJson,
                updatedAt,
                cancellationToken);
            if (!updated)
            {
                return Results.Json(new { error = "Question request already resolved" }, statusCode: StatusCodes.Status409Conflict);
            }

            var requestClientRequestId = ParseQuestionRequestClientRequestId(questionRequest.RequestPayloadJson);
            await PublishSessionRunEventAsync(
                id,
                userId,
                requestClientRequestId,
                CreateQuestionRepliedEventPayload(reply.RequestId, reply.Status, nowMs),
                sessionRunEventStore,
                sessionRunEventBroadcaster,
                cancellationToken);

            if (string.Equals(reply.Status, "answered", StringComparison.Ordinal))
            {
                if (string.Equals(questionRequest.ToolName, "ExitPlanMode", StringComparison.Ordinal))
                {
                    await UpdateSessionPlanModeForExitDecisionAsync(dbContext, id, reply.Answers, cancellationToken);
                }

                var resumeContext = TryBuildResumeRequest(questionRequest.RequestPayloadJson, id, userId, questionRequest.ToolName);
                if (resumeContext is not null)
                {
                    var answerOutput = FormatAnsweredQuestionOutput(questionRequest.QuestionsJson, reply.Answers);
                    var initialToolResult = new SessionStreamInitialToolResult(
                        resumeContext.ToolCallId,
                        questionRequest.ToolName,
                        resumeContext.RawInputJson,
                        JsonSerializer.Serialize(answerOutput),
                        false,
                        false,
                        resumeContext.NextRound,
                        null);
                    var runtimeRequest = BuildRuntimeResumeRequest(resumeContext, initialToolResult);
                    StartResumeInBackground(
                        runtimeRequest,
                        scopeFactory,
                        loggerFactory.CreateLogger("QuestionResume"));
                    return Results.Ok(new { ok = true });
                }
            }

            return Results.Ok(new { ok = true });
        }).RequireAuthorization();

        return endpoints;
    }

    private static bool TryParseReplyRequest(JsonElement body, out QuestionReplyRequest? request, out List<object> issues)
    {
        request = null;
        issues = [];
        if (body.ValueKind != JsonValueKind.Object)
        {
            issues.Add(new { code = "invalid_type", path = Array.Empty<string>(), expected = "object", received = DescribeJsonKind(body.ValueKind), message = "Expected object" });
            return false;
        }

        if (!body.TryGetProperty("requestId", out var requestIdElement) || requestIdElement.ValueKind != JsonValueKind.String)
        {
            issues.Add(new { code = "invalid_type", path = new[] { "requestId" }, expected = "string", received = body.TryGetProperty("requestId", out var received) ? DescribeJsonKind(received.ValueKind) : "undefined", message = "Expected string" });
        }

        if (!body.TryGetProperty("status", out var statusElement) || statusElement.ValueKind != JsonValueKind.String)
        {
            issues.Add(new { code = "invalid_type", path = new[] { "status" }, expected = "string", received = body.TryGetProperty("status", out var received) ? DescribeJsonKind(received.ValueKind) : "undefined", message = "Expected string" });
        }
        else if (statusElement.GetString() is not ("answered" or "dismissed"))
        {
            issues.Add(new { code = "invalid_enum_value", path = new[] { "status" }, message = "Invalid enum value" });
        }

        var answers = new List<string[]>();
        if (body.TryGetProperty("answers", out var answersElement))
        {
            if (answersElement.ValueKind != JsonValueKind.Array)
            {
                issues.Add(new { code = "invalid_type", path = new[] { "answers" }, expected = "array", received = DescribeJsonKind(answersElement.ValueKind), message = "Expected array" });
            }
            else
            {
                var outerIndex = 0;
                foreach (var outerItem in answersElement.EnumerateArray())
                {
                    if (outerItem.ValueKind != JsonValueKind.Array)
                    {
                        issues.Add(new { code = "invalid_type", path = new[] { "answers", outerIndex.ToString(CultureInfo.InvariantCulture) }, expected = "array", received = DescribeJsonKind(outerItem.ValueKind), message = "Expected array" });
                        outerIndex += 1;
                        continue;
                    }

                    var innerAnswers = new List<string>();
                    var innerIndex = 0;
                    foreach (var innerItem in outerItem.EnumerateArray())
                    {
                        if (innerItem.ValueKind != JsonValueKind.String)
                        {
                            issues.Add(new { code = "invalid_type", path = new[] { "answers", outerIndex.ToString(CultureInfo.InvariantCulture), innerIndex.ToString(CultureInfo.InvariantCulture) }, expected = "string", received = DescribeJsonKind(innerItem.ValueKind), message = "Expected string" });
                        }
                        else
                        {
                            innerAnswers.Add(innerItem.GetString() ?? string.Empty);
                        }

                        innerIndex += 1;
                    }

                    answers.Add(innerAnswers.ToArray());
                    outerIndex += 1;
                }
            }
        }

        if (issues.Count > 0)
        {
            return false;
        }

        request = new QuestionReplyRequest(
            requestIdElement.GetString()!,
            statusElement.GetString()!,
            answers.ToArray());
        return true;
    }

    private static async Task<bool> OwnsSessionAsync(GatewayDbContext dbContext, string sessionId, string userId, CancellationToken cancellationToken)
        => await dbContext.Sessions.AnyAsync((session) => session.Id == sessionId && session.UserId == userId, cancellationToken);

    private static string RequireUserId(ICurrentUser currentUser)
    {
        if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId))
        {
            throw new UnauthorizedAccessException("Authenticated user is required.");
        }

        return currentUser.UserId;
    }

    private static object MapPendingQuestionRequest(QuestionRequestInfoRecord request)
    {
        var questions = JsonSerializer.Deserialize<object>(request.QuestionsJson) ?? Array.Empty<object>();
        return new
        {
            requestId = request.Id,
            sessionId = request.SessionId,
            toolName = request.ToolName,
            title = request.Title,
            questions,
            status = request.Status,
            createdAt = request.CreatedAt,
        };
    }

    private static QuestionResumeContext? TryBuildResumeRequest(string? payloadJson, string sessionId, string userId, string toolName)
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

            if (!root.TryGetProperty("requestData", out var requestDataElement) || requestDataElement.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            if (!requestDataElement.TryGetProperty("message", out var messageElement) || messageElement.ValueKind != JsonValueKind.String)
            {
                return null;
            }

            var clientRequestId = requestIdElement.GetString()?.Trim();
            var toolCallId = toolCallIdElement.GetString()?.Trim();
            var message = messageElement.GetString()?.Trim();
            if (string.IsNullOrWhiteSpace(clientRequestId) || string.IsNullOrWhiteSpace(toolCallId) || string.IsNullOrWhiteSpace(message))
            {
                return null;
            }

            if (!root.TryGetProperty("nextRound", out var nextRoundElement) || !nextRoundElement.TryGetInt32(out var nextRound))
            {
                return null;
            }

            return new QuestionResumeContext(
                sessionId,
                userId,
                clientRequestId,
                message,
                requestDataElement.TryGetProperty("displayMessage", out var displayMessage) && displayMessage.ValueKind == JsonValueKind.String ? displayMessage.GetString() : null,
                requestDataElement.TryGetProperty("agentId", out var agentId) && agentId.ValueKind == JsonValueKind.String ? agentId.GetString() : null,
                requestDataElement.TryGetProperty("providerId", out var providerId) && providerId.ValueKind == JsonValueKind.String ? providerId.GetString() : null,
                requestDataElement.TryGetProperty("model", out var model) && model.ValueKind == JsonValueKind.String ? model.GetString() : null,
                requestDataElement.TryGetProperty("thinkingEnabled", out var thinkingEnabled) && thinkingEnabled.ValueKind is JsonValueKind.True or JsonValueKind.False ? thinkingEnabled.GetBoolean() : null,
                requestDataElement.TryGetProperty("webSearchEnabled", out var webSearchEnabled) && webSearchEnabled.ValueKind is JsonValueKind.True or JsonValueKind.False ? webSearchEnabled.GetBoolean() : null,
                requestDataElement.GetRawText(),
                toolCallId,
                rawInputElement.GetRawText(),
                nextRound,
                root.TryGetProperty("observability", out var observability) && observability.ValueKind == JsonValueKind.Object
                    ? NormalizeObservabilityJson(observability)
                    : null,
                toolName);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static SessionStreamRuntimeRequest BuildRuntimeResumeRequest(QuestionResumeContext context, SessionStreamInitialToolResult initialToolResult)
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

    private static string? ParseQuestionRequestClientRequestId(string? payloadJson)
    {
        if (string.IsNullOrWhiteSpace(payloadJson))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(payloadJson);
            return document.RootElement.TryGetProperty("clientRequestId", out var clientRequestId) && clientRequestId.ValueKind == JsonValueKind.String
                ? clientRequestId.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static Dictionary<string, object?> CreateQuestionRepliedEventPayload(string requestId, string status, long occurredAt)
        => new()
        {
            ["type"] = "question_replied",
            ["requestId"] = requestId,
            ["status"] = status,
            ["eventId"] = $"question:{requestId}:replied",
            ["runId"] = $"question:{requestId}",
            ["occurredAt"] = occurredAt,
        };

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
        var eventType = document.RootElement.TryGetProperty("type", out var typeElement) && typeElement.ValueKind == JsonValueKind.String
            ? typeElement.GetString() ?? "message"
            : "message";
        var eventId = document.RootElement.TryGetProperty("eventId", out var eventIdElement) && eventIdElement.ValueKind == JsonValueKind.String
            ? eventIdElement.GetString()
            : null;
        var runId = document.RootElement.TryGetProperty("runId", out var runIdElement) && runIdElement.ValueKind == JsonValueKind.String
            ? runIdElement.GetString()
            : null;
        var occurredAtMs = document.RootElement.TryGetProperty("occurredAt", out var occurredAtElement) && occurredAtElement.TryGetInt64(out var occurredAt)
            ? occurredAt
            : (long?)null;
        var createdAt = FormatTimestamp(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        await sessionRunEventStore.PersistAsync(
            new SessionRunEventInfoRecord(0, sessionId, userId, clientRequestId, null, eventType, eventId, runId, occurredAtMs, payloadJson, createdAt),
            cancellationToken);
        if (!string.IsNullOrWhiteSpace(clientRequestId))
        {
            var seq = await sessionRunEventStore.GetLatestSeqByRequestAsync(sessionId, clientRequestId, cancellationToken);
            sessionRunEventBroadcaster.Publish(sessionId, document.RootElement.Clone(), new SessionRunEventBroadcastRecord(clientRequestId, seq));
        }
    }

    private static async Task UpdateSessionPlanModeForExitDecisionAsync(
        GatewayDbContext dbContext,
        string sessionId,
        IReadOnlyList<string[]> answers,
        CancellationToken cancellationToken)
    {
        var session = await dbContext.Sessions.SingleOrDefaultAsync((item) => item.Id == sessionId, cancellationToken);
        if (session is null)
        {
            return;
        }

        var metadata = string.IsNullOrWhiteSpace(session.MetadataJson)
            ? new JsonObject()
            : JsonNode.Parse(session.MetadataJson) as JsonObject ?? new JsonObject();
        metadata["planMode"] = !ShouldExitPlanModeFromAnswers(answers);
        session.MetadataJson = metadata.ToJsonString();
        session.UpdatedAtUtc = DateTimeOffset.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private static bool ShouldExitPlanModeFromAnswers(IReadOnlyList<string[]> answers)
        => answers.Any((entry) => entry.Contains("Start implementation", StringComparer.Ordinal));

    private static string FormatAnsweredQuestionOutput(string questionsJson, IReadOnlyList<string[]> answers)
    {
        using var document = JsonDocument.Parse(questionsJson);
        if (document.RootElement.ValueKind != JsonValueKind.Array)
        {
            return string.Empty;
        }

        var lines = new List<string>();
        var questionIndex = 0;
        foreach (var question in document.RootElement.EnumerateArray())
        {
            var questionText = question.TryGetProperty("question", out var questionElement) && questionElement.ValueKind == JsonValueKind.String
                ? questionElement.GetString() ?? string.Empty
                : string.Empty;
            var answerValues = questionIndex < answers.Count ? answers[questionIndex] : Array.Empty<string>();
            lines.Add($"{questionText}=\"{string.Join(", ", answerValues)}\"");
            questionIndex += 1;
        }

        return string.Join('\n', lines);
    }

    private static void StartResumeInBackground(
        SessionStreamRuntimeRequest request,
        IServiceScopeFactory scopeFactory,
        ILogger logger)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var runtimeService = scope.ServiceProvider.GetRequiredService<ISessionStreamRuntimeService>();
                var sessionRuntimeReconciler = scope.ServiceProvider.GetRequiredService<ISessionRuntimeReconciler>();
                var statusCode = await runtimeService.HandleAsync(request, static _ => ValueTask.CompletedTask, CancellationToken.None);
                if (statusCode != StatusCodes.Status200OK)
                {
                    logger.LogWarning("question reply resume returned non-success status {StatusCode} for session {SessionId}", statusCode, request.SessionId);
                    await sessionRuntimeReconciler.ReconcileSessionRuntimeAsync(
                        request.SessionId,
                        request.UserId,
                        DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                        CancellationToken.None);
                }
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "failed to auto-resume answered question request for session {SessionId}", request.SessionId);
                try
                {
                    await using var recoveryScope = scopeFactory.CreateAsyncScope();
                    var sessionRuntimeReconciler = recoveryScope.ServiceProvider.GetRequiredService<ISessionRuntimeReconciler>();
                    await sessionRuntimeReconciler.ReconcileSessionRuntimeAsync(
                        request.SessionId,
                        request.UserId,
                        DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                        CancellationToken.None);
                }
                catch (Exception recoveryException)
                {
                    logger.LogError(recoveryException, "failed to reconcile session state after question resume failure for session {SessionId}", request.SessionId);
                }
            }
        }, CancellationToken.None);
    }

    private static string DescribeJsonKind(JsonValueKind valueKind)
        => valueKind switch
        {
            JsonValueKind.Object => "object",
            JsonValueKind.Array => "array",
            JsonValueKind.String => "string",
            JsonValueKind.Number => "number",
            JsonValueKind.True or JsonValueKind.False => "boolean",
            JsonValueKind.Null => "null",
            JsonValueKind.Undefined => "undefined",
            _ => valueKind.ToString(),
        };

    private static string FormatTimestamp(long epochMs)
        => DateTimeOffset.FromUnixTimeMilliseconds(epochMs).UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);

    private static string NormalizeObservabilityJson(JsonElement observability)
    {
        var normalized = new JsonObject
        {
            ["presentedToolName"] = observability.TryGetProperty("presentedToolName", out var presentedToolName) && presentedToolName.ValueKind == JsonValueKind.String
                ? presentedToolName.GetString()
                : "unknown",
            ["canonicalToolName"] = observability.TryGetProperty("canonicalToolName", out var canonicalToolName) && canonicalToolName.ValueKind == JsonValueKind.String
                ? canonicalToolName.GetString()
                : "unknown",
            ["adapterVersion"] = observability.TryGetProperty("adapterVersion", out var adapterVersion) && adapterVersion.ValueKind == JsonValueKind.String
                ? adapterVersion.GetString()
                : "1.0.0",
        };
        return normalized.ToJsonString();
    }

    private sealed record QuestionReplyRequest(string RequestId, string Status, IReadOnlyList<string[]> Answers);

    private sealed record QuestionResumeContext(
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
        string? ObservabilityJson,
        string ToolName);
}
