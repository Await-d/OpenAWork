using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Application.Abstractions.Streaming;
using OpenAWork.Gateway.Application.Abstractions.Settings;
using OpenAWork.Gateway.Persistence.EFCore;

namespace OpenAWork.Gateway.Application.Features.Stream;

public sealed class SessionStreamRuntimeService(
    GatewayDbContext dbContext,
    IMessageV2Store messageV2Store,
    ISessionRunEventStore sessionRunEventStore,
    ISessionRuntimeThreadStore sessionRuntimeThreadStore,
    ISessionRuntimeReconciler sessionRuntimeReconciler,
    ISessionStreamRequestRegistry requestRegistry,
    ISessionRunEventBroadcaster sessionRunEventBroadcaster,
    IWorkflowLlmClient workflowLlmClient,
    IConfiguration configuration,
    ILogger<SessionStreamRuntimeService> logger) : ISessionStreamRuntimeService
{
    private const string StreamRuntimeErrorCode = "WS_STREAM_ERROR";
    private const string StreamRuntimeErrorMessage = "Request processing failed.";

    public async Task<int> HandleAsync(SessionStreamRuntimeRequest request, Func<object, ValueTask> writeChunk, CancellationToken connectionCancellationToken)
    {
        var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(connectionCancellationToken);
        var registration = requestRegistry.RegisterOrGetConflict(request.SessionId, request.UserId, request.ClientRequestId, linkedCts);

        if (registration.State == SessionStreamRegistrationState.SameRequestInFlight && registration.ExistingRequest is not null)
        {
            await registration.ExistingRequest.Completion.Task.ConfigureAwait(false);
            if (await TryReplayPersistedAssistantAsync(request, writeChunk, connectionCancellationToken))
            {
                linkedCts.Dispose();
                return StatusCodes.Status200OK;
            }

            linkedCts.Dispose();
            await writeChunk(CreateErrorChunk("REQUEST_REPLAY_FAILED", "Request replay failed"));
            return StatusCodes.Status409Conflict;
        }

        if (registration.State == SessionStreamRegistrationState.OtherRequestInFlight)
        {
            linkedCts.Dispose();
            await writeChunk(CreateErrorChunk("SESSION_ALREADY_RUNNING", "Another request is already running for this session."));
            return StatusCodes.Status409Conflict;
        }

        try
        {
            var existingReplay = await TryReplayPersistedAssistantAsync(request, writeChunk, connectionCancellationToken);
            if (existingReplay)
            {
                return StatusCodes.Status200OK;
            }

            await ExecuteAsync(request, writeChunk, linkedCts.Token).ConfigureAwait(false);
            return StatusCodes.Status200OK;
        }
        finally
        {
            requestRegistry.Complete(request.SessionId, request.ClientRequestId);
            linkedCts.Dispose();
        }
    }

    private async Task ExecuteAsync(SessionStreamRuntimeRequest request, Func<object, ValueTask> writeChunk, CancellationToken cancellationToken)
    {
        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        await SetSessionStateAsync(request.SessionId, request.UserId, "running", cancellationToken);
        await sessionRuntimeThreadStore.UpsertAsync(new SessionRuntimeThreadInfoRecord(
            request.SessionId,
            request.UserId,
            request.ClientRequestId,
            nowMs,
            nowMs,
            FormatTimestamp(nowMs),
            FormatTimestamp(nowMs)), cancellationToken);

        using var heartbeatTimer = new PeriodicTimer(TimeSpan.FromMilliseconds(SessionRuntimeThreadStore.HeartbeatMs));
        var shouldHandleChildTerminal = false;
        var terminalStatusCode = StatusCodes.Status500InternalServerError;
        string? terminalReason = null;
        var heartbeatTask = Task.Run(async () =>
        {
            try
            {
                while (await heartbeatTimer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
                {
                    var heartbeatAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    await sessionRuntimeThreadStore.TouchAsync(request.SessionId, request.UserId, request.ClientRequestId, heartbeatAt, cancellationToken).ConfigureAwait(false);
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                // Expected during normal stop/completion.
            }
        }, cancellationToken);

        try
        {
            if (request.InitialToolResult is null)
            {
                await PersistUserMessageAsync(request, cancellationToken);
            }
            else
            {
                await PersistInitialToolResultAsync(request, cancellationToken);
                await EmitRunEventAsync(request, BuildToolResultRunEvent(request), writeChunk, cancellationToken);
            }

            var apiBaseUrl = configuration["AI_API_BASE_URL"] ?? "https://api.openai.com/v1";
            var apiKey = configuration["AI_API_KEY"] ?? string.Empty;
            var model = string.IsNullOrWhiteSpace(request.Model) ? (configuration["AI_DEFAULT_MODEL"] ?? "gpt-4o-mini") : request.Model;

            var completion = await workflowLlmClient.CompleteAsync(
                apiBaseUrl,
                apiKey,
                model,
                BuildPrompt(request),
                1.0,
                cancellationToken).ConfigureAwait(false);

            if (!string.IsNullOrWhiteSpace(completion))
            {
                await PersistAssistantMessageAsync(request, completion, "final", cancellationToken);
                await EmitRunEventAsync(request, new { type = "text_delta", delta = completion }, writeChunk, cancellationToken);
            }

            await EmitRunEventAsync(request, new { type = "done", stopReason = "end_turn" }, writeChunk, cancellationToken);
            shouldHandleChildTerminal = true;
            terminalStatusCode = StatusCodes.Status200OK;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            await EmitRunEventAsync(request, new { type = "done", stopReason = "cancelled" }, writeChunk, CancellationToken.None);
            shouldHandleChildTerminal = true;
            terminalStatusCode = 499;
            terminalReason = "cancelled";
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "session stream runtime failed for session {SessionId} request {ClientRequestId}", request.SessionId, request.ClientRequestId);
            await PersistAssistantMessageAsync(request, $"[错误: {StreamRuntimeErrorCode}] {StreamRuntimeErrorMessage}", "error", CancellationToken.None);
            await EmitRunEventAsync(request, CreateErrorChunk(StreamRuntimeErrorCode, StreamRuntimeErrorMessage), writeChunk, CancellationToken.None);
            shouldHandleChildTerminal = true;
            terminalStatusCode = StatusCodes.Status500InternalServerError;
        }
        finally
        {
            try
            {
                await heartbeatTask.ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                // Expected during normal stop/completion.
            }

            await sessionRuntimeThreadStore.ClearAsync(request.SessionId, request.UserId, request.ClientRequestId, CancellationToken.None);
            await SetSessionStateAsync(request.SessionId, request.UserId, "idle", CancellationToken.None);
            if (shouldHandleChildTerminal)
            {
                await sessionRuntimeReconciler.HandleChildSessionTerminalAsync(
                    new TaskChildSessionTerminalInput(request.SessionId, request.UserId, terminalStatusCode, false, terminalReason),
                    CancellationToken.None);
            }
        }
    }

    private async Task<bool> TryReplayPersistedAssistantAsync(SessionStreamRuntimeRequest request, Func<object, ValueTask> writeChunk, CancellationToken cancellationToken)
    {
        var durableRunEvents = await sessionRunEventStore.ListByRequestAsync(request.SessionId, request.ClientRequestId, cancellationToken);
        if (durableRunEvents.Count > 0)
        {
            var latestRunEvent = durableRunEvents[^1];
            using var latestDocument = JsonDocument.Parse(latestRunEvent.PayloadJson);
            var latestType = ReadString(latestDocument.RootElement, "type");
            if (latestType == "error")
            {
                await ClearRetryableArtifactsAsync(request, cancellationToken);
                return false;
            }

            if (latestType == "done")
            {
                var stopReason = ReadString(latestDocument.RootElement, "stopReason");
                if (stopReason == "cancelled")
                {
                    await ClearRetryableArtifactsAsync(request, cancellationToken);
                    return false;
                }

                foreach (var runEvent in durableRunEvents)
                {
                    using var eventDocument = JsonDocument.Parse(runEvent.PayloadJson);
                    await writeChunk(eventDocument.RootElement.Clone());
                }

                return true;
            }
        }

        var stored = await messageV2Store.GetMessageByRequestIdAsync(request.SessionId, request.UserId, request.ClientRequestId, "assistant", cancellationToken);
        if (stored is null)
        {
            return false;
        }

        if (stored.Status == "error")
        {
            await ClearRetryableArtifactsAsync(request, cancellationToken);
            return false;
        }

        var messages = await messageV2Store.ListMessagesByRequestScopeAsync(request.SessionId, request.UserId, request.ClientRequestId, cancellationToken);
        var toolNames = new Dictionary<string, string>(StringComparer.Ordinal);
        var assistantToolCallIds = new HashSet<string>(StringComparer.Ordinal);
        var authoritativeToolCallIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var candidate in messages)
        {
            using var messageDocument = JsonDocument.Parse(candidate.DataJson);
            var role = ReadString(messageDocument.RootElement, "role");
            if (role is not ("assistant" or "tool"))
            {
                continue;
            }

            var parts = await messageV2Store.ListPartsForMessageAsync(request.SessionId, candidate.Id, cancellationToken);
            foreach (var part in parts)
            {
                using var partDocument = JsonDocument.Parse(part.DataJson);
                if (ReadString(partDocument.RootElement, "type") == "tool"
                    && !string.IsNullOrWhiteSpace(ReadString(partDocument.RootElement, "callID"))
                    && !string.IsNullOrWhiteSpace(ReadString(partDocument.RootElement, "tool")))
                {
                    var callId = ReadString(partDocument.RootElement, "callID")!;
                    toolNames[callId] = ReadString(partDocument.RootElement, "tool")!;
                    if (role == "assistant")
                    {
                        assistantToolCallIds.Add(callId);
                    }

                    if (role == "tool")
                    {
                        authoritativeToolCallIds.Add(callId);
                    }
                }
            }
        }

        var emittedToolResultIds = new HashSet<string>(StringComparer.Ordinal);

        foreach (var message in messages)
        {
            using var document = JsonDocument.Parse(message.DataJson);
            var role = ReadString(document.RootElement, "role");
            if (role is not ("assistant" or "tool"))
            {
                continue;
            }

            var parts = await messageV2Store.ListPartsForMessageAsync(request.SessionId, message.Id, cancellationToken);
            foreach (var part in parts)
            {
                using var partDocument = JsonDocument.Parse(part.DataJson);
                var partType = ReadString(partDocument.RootElement, "type");
                if (partType == "text")
                {
                    var text = ReadString(partDocument.RootElement, "text");
                    if (!string.IsNullOrWhiteSpace(text))
                    {
                        await writeChunk(new { type = "text_delta", delta = text });
                    }

                    continue;
                }

                if (partType == "tool")
                {
                    var callId = ReadString(partDocument.RootElement, "callID");
                    var toolName = ReadString(partDocument.RootElement, "tool");
                    var state = partDocument.RootElement.TryGetProperty("state", out var stateElement) && stateElement.ValueKind == JsonValueKind.Object
                        ? stateElement
                        : default;
                    var input = state.ValueKind == JsonValueKind.Object && state.TryGetProperty("input", out var inputElement)
                        ? JsonSerializer.Deserialize<object>(inputElement.GetRawText())
                        : new Dictionary<string, object?>();
                    var rawArguments = state.ValueKind == JsonValueKind.Object ? ReadString(state, "raw") : null;
                    var hasAssistantToolCall = !string.IsNullOrWhiteSpace(callId) && assistantToolCallIds.Contains(callId);
                    var hasAuthoritativeToolResult = !string.IsNullOrWhiteSpace(callId) && authoritativeToolCallIds.Contains(callId);

                    if (role != "tool" || !hasAssistantToolCall)
                    {
                        await writeChunk(new
                        {
                            type = "tool_call_delta",
                            toolCallId = callId,
                            toolName,
                            inputDelta = rawArguments ?? JsonSerializer.Serialize(input),
                        });
                    }

                    var status = state.ValueKind == JsonValueKind.Object ? ReadString(state, "status") : null;
                    if (status == "completed")
                    {
                        if (role == "assistant" && hasAuthoritativeToolResult)
                        {
                            continue;
                        }

                        var toolResult = ReadStoredToolResultContent(state);
                        if (toolResult is not null && (string.IsNullOrWhiteSpace(callId) || emittedToolResultIds.Add(callId)))
                        {
                            await writeChunk(toolResult);
                        }
                    }
                    else if (status == "error")
                    {
                        if (role == "assistant" && hasAuthoritativeToolResult)
                        {
                            continue;
                        }

                        var toolResult = ReadStoredToolResultContent(state) ?? new
                        {
                            type = "tool_result",
                            toolCallId = callId,
                            toolName = toolName ?? (callId is not null && toolNames.TryGetValue(callId, out var resolvedToolName) ? resolvedToolName : "tool"),
                            output = ReadString(state, "error") ?? string.Empty,
                            isError = true,
                        };
                        if (string.IsNullOrWhiteSpace(callId) || emittedToolResultIds.Add(callId))
                        {
                            await writeChunk(toolResult);
                        }
                    }
                    else if (status == "pending")
                    {
                        if (role == "assistant" && hasAuthoritativeToolResult)
                        {
                            continue;
                        }

                        if (string.IsNullOrWhiteSpace(callId) || emittedToolResultIds.Add(callId))
                        {
                            await writeChunk(new
                            {
                                type = "tool_result",
                                toolCallId = callId,
                                toolName = toolName ?? (callId is not null && toolNames.TryGetValue(callId, out var resolvedToolName) ? resolvedToolName : "tool"),
                                output = $"Tool \"{toolName ?? "tool"}\" is waiting for approval.",
                                isError = false,
                                pendingPermissionRequestId = callId,
                            });
                        }
                    }

                    continue;
                }

                if (partType == "assistant_event")
                {
                    var payload = JsonSerializer.Deserialize<object>(part.DataJson);
                    if (payload is not null)
                    {
                        await writeChunk(payload);
                    }
                }
            }
        }

        await writeChunk(new { type = "done", stopReason = "end_turn" });
        return true;
    }

    private async Task ClearRetryableArtifactsAsync(SessionStreamRuntimeRequest request, CancellationToken cancellationToken)
    {
        await sessionRunEventStore.DeleteByRequestAsync(request.SessionId, request.ClientRequestId, cancellationToken);
        await messageV2Store.DeleteMessagesByRequestScopeAsync(request.SessionId, request.UserId, request.ClientRequestId, new[] { "assistant", "tool" }, cancellationToken);
    }

    private async Task PersistUserMessageAsync(SessionStreamRuntimeRequest request, CancellationToken cancellationToken)
    {
        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var createdAt = FormatTimestamp(nowMs);
        var messageId = $"message:{request.SessionId}:{request.ClientRequestId}:user";
        await messageV2Store.InsertMessageAsync(new MessageV2InfoRecord(
            messageId,
            request.SessionId,
            request.UserId,
            nowMs,
            JsonSerializer.Serialize(new
            {
                role = "user",
                clientRequestId = request.ClientRequestId,
                time = new { created = nowMs },
                status = "final",
            }),
            createdAt,
            createdAt), cancellationToken);
        await messageV2Store.InsertPartAsync(new PartV2InfoRecord(
            $"part:{messageId}:text",
            messageId,
            request.SessionId,
            request.UserId,
            nowMs,
            JsonSerializer.Serialize(new { type = "text", text = request.DisplayMessage ?? request.Message }),
            createdAt,
            createdAt), cancellationToken);
    }

    private async Task PersistAssistantMessageAsync(SessionStreamRuntimeRequest request, string text, string status, CancellationToken cancellationToken)
    {
        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var createdAt = FormatTimestamp(nowMs);
        var messageId = $"message:{request.SessionId}:{request.ClientRequestId}:assistant";
        await messageV2Store.InsertMessageAsync(new MessageV2InfoRecord(
            messageId,
            request.SessionId,
            request.UserId,
            nowMs,
            JsonSerializer.Serialize(new
            {
                role = "assistant",
                clientRequestId = request.ClientRequestId,
                time = new { created = nowMs },
                status,
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
            createdAt), cancellationToken);
        await messageV2Store.InsertPartAsync(new PartV2InfoRecord(
            $"part:{messageId}:text",
            messageId,
            request.SessionId,
            request.UserId,
            nowMs,
            JsonSerializer.Serialize(new { type = "text", text }),
            createdAt,
            createdAt), cancellationToken);
    }

    private async Task PersistInitialToolResultAsync(SessionStreamRuntimeRequest request, CancellationToken cancellationToken)
    {
        var initialToolResult = request.InitialToolResult!;
        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var createdAt = FormatTimestamp(nowMs);
        var scopedClientRequestId = BuildToolResultScopedClientRequestId(request.ClientRequestId, initialToolResult.ToolCallId);
        var messageId = $"message:{request.SessionId}:{scopedClientRequestId}:tool";
        var outputValue = DeserializeJsonValue(initialToolResult.OutputJson);
        var rawOutput = outputValue is string outputText ? outputText : JsonSerializer.Serialize(outputValue);
        await messageV2Store.InsertMessageAsync(new MessageV2InfoRecord(
            messageId,
            request.SessionId,
            request.UserId,
            nowMs,
            JsonSerializer.Serialize(new
            {
                role = "tool",
                clientRequestId = scopedClientRequestId,
                time = new { created = nowMs },
                status = "final",
            }),
            createdAt,
            createdAt), cancellationToken);
        await messageV2Store.InsertPartAsync(new PartV2InfoRecord(
            $"part:{messageId}:tool",
            messageId,
            request.SessionId,
            request.UserId,
            nowMs,
            JsonSerializer.Serialize(new
            {
                type = "tool",
                tool = initialToolResult.ToolName,
                callID = initialToolResult.ToolCallId,
                state = new Dictionary<string, object?>
                {
                    ["status"] = initialToolResult.IsError ? "error" : "completed",
                    ["input"] = DeserializeJsonValue(initialToolResult.RawInputJson),
                    ["raw"] = initialToolResult.RawInputJson,
                    [initialToolResult.IsError ? "error" : "output"] = rawOutput,
                    ["metadata"] = new Dictionary<string, object?>
                    {
                        ["toolResultContent"] = BuildToolResultContent(request, initialToolResult),
                    },
                },
            }),
            createdAt,
            createdAt), cancellationToken);
    }

    private async Task EmitRunEventAsync(SessionStreamRuntimeRequest request, object payload, Func<object, ValueTask> writeChunk, CancellationToken cancellationToken)
    {
        var payloadJson = JsonSerializer.Serialize(payload);
        using var document = JsonDocument.Parse(payloadJson);
        var type = ReadString(document.RootElement, "type") ?? "event";
        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        await sessionRunEventStore.PersistAsync(new SessionRunEventInfoRecord(
            0,
            request.SessionId,
            request.UserId,
            request.ClientRequestId,
            null,
            type,
            null,
            null,
            nowMs,
            payloadJson,
            FormatTimestamp(nowMs)), cancellationToken);

        var persistedSeq = await sessionRunEventStore.GetLatestSeqByRequestAsync(request.SessionId, request.ClientRequestId, CancellationToken.None);
        sessionRunEventBroadcaster.Publish(
            request.SessionId,
            document.RootElement,
            new SessionRunEventBroadcastRecord(request.ClientRequestId, persistedSeq));

        await writeChunk(payload);
    }

    private async Task SetSessionStateAsync(string sessionId, string userId, string status, CancellationToken cancellationToken)
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

    private static string? ReadString(JsonElement element, string propertyName)
        => element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;

    private static object? ReadStoredToolResultContent(JsonElement stateElement)
    {
        if (!stateElement.TryGetProperty("metadata", out var metadataElement)
            || metadataElement.ValueKind != JsonValueKind.Object
            || !metadataElement.TryGetProperty("toolResultContent", out var contentElement)
            || contentElement.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (!contentElement.TryGetProperty("type", out var typeElement)
            || typeElement.ValueKind != JsonValueKind.String
            || typeElement.GetString() != "tool_result")
        {
            return null;
        }

        using var cloned = JsonDocument.Parse(contentElement.GetRawText());
        return cloned.RootElement.Clone();
    }

    private static object BuildToolResultRunEvent(SessionStreamRuntimeRequest request)
        => BuildToolResultContent(request, request.InitialToolResult!);

    private static object CreateErrorChunk(string code, string message)
        => new { type = "error", code, message };

    private static Dictionary<string, object?> BuildToolResultContent(SessionStreamRuntimeRequest request, SessionStreamInitialToolResult initialToolResult)
    {
        var payload = new Dictionary<string, object?>
        {
            ["type"] = "tool_result",
            ["toolCallId"] = initialToolResult.ToolCallId,
            ["toolName"] = initialToolResult.ToolName,
            ["clientRequestId"] = request.ClientRequestId,
            ["output"] = DeserializeJsonValue(initialToolResult.OutputJson),
            ["isError"] = initialToolResult.IsError,
        };

        if (!string.IsNullOrWhiteSpace(initialToolResult.Reason))
        {
            payload["reason"] = initialToolResult.Reason;
        }

        if (initialToolResult.ResumedAfterApproval)
        {
            payload["resumedAfterApproval"] = true;
        }

        return payload;
    }

    private static string BuildPrompt(SessionStreamRuntimeRequest request)
    {
        if (request.InitialToolResult is null)
        {
            return request.Message;
        }

        var initialToolResult = request.InitialToolResult;
        var output = DeserializeJsonValue(initialToolResult.OutputJson);
        var outputText = output is string text ? text : JsonSerializer.Serialize(output);
        var intro = initialToolResult.IsError
            ? $"Tool call `{initialToolResult.ToolName}` ({initialToolResult.ToolCallId}) failed or was denied."
            : $"Tool call `{initialToolResult.ToolName}` ({initialToolResult.ToolCallId}) completed successfully.";
        var nextRound = initialToolResult.NextRound is int nextRoundValue ? $" Continue from round {nextRoundValue}." : string.Empty;
        return string.Join("\n\n", [
            request.Message,
            $"{intro}{nextRound}",
            $"Tool result:\n{outputText}",
        ]);
    }

    private static object? DeserializeJsonValue(string json)
        => JsonSerializer.Deserialize<object>(json);

    private static string BuildToolResultScopedClientRequestId(string clientRequestId, string toolCallId)
        => $"{clientRequestId}:{toolCallId}:tool_result";

    private static string FormatTimestamp(long epochMs)
        => DateTimeOffset.FromUnixTimeMilliseconds(epochMs).UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture);
}
