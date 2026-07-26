using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Application.Abstractions.Streaming;
using OpenAWork.Gateway.Application.Abstractions.Settings;
using OpenAWork.Gateway.Application.Features.Sessions;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Application.Features.Stream;

public sealed class SessionStreamRuntimeService(
    GatewayDbContext dbContext,
    IMessageV2Store messageV2Store,
    IUserSettingsReader userSettingsReader,
    ISessionRunEventStore sessionRunEventStore,
    ISessionRuntimeThreadStore sessionRuntimeThreadStore,
    ISessionRuntimeReconciler sessionRuntimeReconciler,
    ISessionStreamRequestRegistry requestRegistry,
    ISessionRunEventBroadcaster sessionRunEventBroadcaster,
    IWorkflowLlmClient workflowLlmClient,
    IConfiguration configuration,
    ILogger<SessionStreamRuntimeService> logger) : ISessionStreamRuntimeService
{
    private const string CompactionSettingsKey = "compaction_policy_v1";
    private const string StreamRuntimeErrorCode = "WS_STREAM_ERROR";
    private const string StreamRuntimeErrorMessage = "Request processing failed.";
    private const int RuntimeContextMessageLimit = 200;
    private const int DefaultRecentMessagesKept = 6;
    private const int DefaultCompactionThresholdTokens = 12000;
    private const int MinimumCompactionThresholdTokens = 4000;
    private const int DefaultCompactionReservedTokens = 2000;

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
            var session = await dbContext.Sessions
                .SingleOrDefaultAsync((item) => item.Id == request.SessionId && item.UserId == request.UserId, cancellationToken)
                .ConfigureAwait(false);
            var transcript = await LoadSessionTranscriptAsync(request, cancellationToken).ConfigureAwait(false);
            var compactionSettings = await LoadCompactionSettingsAsync(request.UserId, cancellationToken).ConfigureAwait(false);
            var runtimeContext = await BuildRuntimeContextAsync(
                request,
                transcript,
                session,
                apiBaseUrl,
                apiKey,
                model,
                writeChunk,
                cancellationToken).ConfigureAwait(false);

            var completion = await workflowLlmClient.CompleteAsync(
                apiBaseUrl,
                apiKey,
                model,
                BuildPrompt(request, runtimeContext, compactionSettings),
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

    private async Task<RuntimeConversationContext> BuildRuntimeContextAsync(
        SessionStreamRuntimeRequest request,
        IReadOnlyList<RuntimeContextMessage> transcript,
        SessionRecord? session,
        string apiBaseUrl,
        string apiKey,
        string model,
        Func<object, ValueTask> writeChunk,
        CancellationToken cancellationToken)
    {
        var estimatedTokens = EstimateTokenCount(transcript, request);
        var compactionSettings = await LoadCompactionSettingsAsync(request.UserId, cancellationToken).ConfigureAwait(false);
        if (!ShouldCompact(transcript, estimatedTokens, compactionSettings))
        {
            return new RuntimeConversationContext(transcript, null, false, estimatedTokens);
        }

        var summaryCandidates = SelectMessagesForCompaction(transcript, compactionSettings.RecentMessagesKept, request);
        if (summaryCandidates.Count == 0)
        {
            return new RuntimeConversationContext(transcript, null, false, estimatedTokens);
        }

        var compactionStartedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        await EmitRunEventAsync(request, new
        {
            type = "compaction",
            summary = "正在压缩运行时上下文。",
            trigger = "auto",
            phase = "started",
            cause = "context_limit",
            strategy = "runtime_replace",
            compactedMessages = summaryCandidates.Count,
            representedMessages = transcript.Count,
            occurredAt = compactionStartedAt,
            eventId = $"{request.SessionId}:{request.ClientRequestId}:compaction:started",
            runId = $"stream:{request.SessionId}:{request.ClientRequestId}",
        }, writeChunk, cancellationToken).ConfigureAwait(false);

        try
        {
            var summary = await workflowLlmClient.CompleteAsync(
                apiBaseUrl,
                apiKey,
                model,
                BuildCompactionPrompt(summaryCandidates, transcript, compactionSettings.RecentMessagesKept, request),
                0.2,
                cancellationToken).ConfigureAwait(false);

            if (string.IsNullOrWhiteSpace(summary))
            {
                return new RuntimeConversationContext(transcript, null, false, estimatedTokens);
            }

            var normalizedSummary = summary.Trim();
            await PersistCompactionMetadataAsync(session, normalizedSummary, summaryCandidates, transcript, compactionSettings, cancellationToken).ConfigureAwait(false);

            var compactedTokens = EstimateTokenCount(transcript.Skip(summaryCandidates.Count).ToArray(), request) + EstimateTokenCount(normalizedSummary);
            await EmitRunEventAsync(request, new
            {
                type = "compaction",
                summary = normalizedSummary,
                trigger = "auto",
                phase = "completed",
                cause = "context_limit",
                strategy = "runtime_replace",
                compactedMessages = summaryCandidates.Count,
                representedMessages = transcript.Count,
                occurredAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                eventId = $"{request.SessionId}:{request.ClientRequestId}:compaction:completed",
                runId = $"stream:{request.SessionId}:{request.ClientRequestId}",
            }, writeChunk, cancellationToken).ConfigureAwait(false);

            return new RuntimeConversationContext(transcript, normalizedSummary, true, compactedTokens);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "runtime compaction failed for session {SessionId} request {ClientRequestId}", request.SessionId, request.ClientRequestId);
            await EmitRunEventAsync(request, new
            {
                type = "compaction",
                summary = "运行时压缩失败，已回退到原始上下文继续执行。",
                trigger = "auto",
                phase = "failed",
                cause = "context_limit",
                strategy = "runtime_replace",
                compactedMessages = summaryCandidates.Count,
                representedMessages = transcript.Count,
                occurredAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                eventId = $"{request.SessionId}:{request.ClientRequestId}:compaction:failed",
                runId = $"stream:{request.SessionId}:{request.ClientRequestId}",
            }, writeChunk, cancellationToken).ConfigureAwait(false);
            return new RuntimeConversationContext(transcript, null, false, estimatedTokens);
        }
    }

    private async Task<IReadOnlyList<RuntimeContextMessage>> LoadSessionTranscriptAsync(SessionStreamRuntimeRequest request, CancellationToken cancellationToken)
    {
        var storedMessages = await messageV2Store
            .ListMessagesWithPartsAsync(request.SessionId, request.UserId, RuntimeContextMessageLimit, cancellationToken)
            .ConfigureAwait(false);

        var transcript = new List<RuntimeContextMessage>(storedMessages.Count);
        foreach (var storedMessage in storedMessages.OrderBy((item) => item.Message.TimeCreated))
        {
            var normalized = NormalizeRuntimeContextMessage(storedMessage);
            if (normalized is null)
            {
                continue;
            }

            transcript.Add(normalized);
        }

        return transcript;
    }

    private RuntimeContextMessage? NormalizeRuntimeContextMessage(MessageWithPartsRecord storedMessage)
    {
        using var messageDocument = JsonDocument.Parse(storedMessage.Message.DataJson);
        var root = messageDocument.RootElement;
        var role = ReadString(root, "role");
        if (role is null)
        {
            return null;
        }

        var clientRequestId = ReadString(root, "clientRequestId");
        var lines = new List<string>();
        foreach (var part in storedMessage.Parts.OrderBy((item) => item.TimeCreated))
        {
            using var partDocument = JsonDocument.Parse(part.DataJson);
            var partRoot = partDocument.RootElement;
            var partType = ReadString(partRoot, "type");
            switch (partType)
            {
                case "text":
                {
                    var text = ReadString(partRoot, "text");
                    if (string.IsNullOrWhiteSpace(text) || IsInternalAssistantEvent(text))
                    {
                        continue;
                    }

                    lines.Add(text.Trim());
                    break;
                }
                case "tool":
                    lines.Add(FormatToolPart(partRoot));
                    break;
            }
        }

        var content = string.Join("\n\n", lines.Where((line) => !string.IsNullOrWhiteSpace(line))).Trim();
        if (string.IsNullOrWhiteSpace(content))
        {
            return null;
        }

        return new RuntimeContextMessage(storedMessage.Message.Id, role, content, storedMessage.Message.TimeCreated, clientRequestId);
    }

    private async Task<RuntimeCompactionSettings> LoadCompactionSettingsAsync(string userId, CancellationToken cancellationToken)
    {
        var raw = await userSettingsReader.GetValueAsync(userId, CompactionSettingsKey, cancellationToken).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new RuntimeCompactionSettings(true, true, DefaultRecentMessagesKept, null);
        }

        try
        {
            using var document = JsonDocument.Parse(raw);
            var root = document.RootElement;
            var auto = TryReadBoolean(root, "auto") ?? true;
            var prune = TryReadBoolean(root, "prune") ?? true;
            var recentMessagesKept = root.TryGetProperty("recentMessagesKept", out var recentElement) && recentElement.TryGetInt32(out var recent)
                ? Math.Max(recent, 0)
                : DefaultRecentMessagesKept;
            int? reserved = root.TryGetProperty("reserved", out var reservedElement) && reservedElement.TryGetInt32(out var reservedValue)
                ? Math.Max(reservedValue, 0)
                : null;

            return new RuntimeCompactionSettings(auto, prune, recentMessagesKept, reserved);
        }
        catch (JsonException)
        {
            return new RuntimeCompactionSettings(true, true, DefaultRecentMessagesKept, null);
        }
    }

    private static bool ShouldCompact(
        IReadOnlyList<RuntimeContextMessage> transcript,
        int estimatedTokens,
        RuntimeCompactionSettings settings)
    {
        if (!settings.Auto || transcript.Count <= Math.Max(settings.RecentMessagesKept, 1))
        {
            return false;
        }

        var threshold = Math.Max(
            MinimumCompactionThresholdTokens,
            DefaultCompactionThresholdTokens - (settings.Reserved ?? DefaultCompactionReservedTokens));
        return estimatedTokens >= threshold;
    }

    private static IReadOnlyList<RuntimeContextMessage> SelectMessagesForCompaction(
        IReadOnlyList<RuntimeContextMessage> transcript,
        int recentMessagesKept,
        SessionStreamRuntimeRequest request)
    {
        var retainedTailCount = request.InitialToolResult is null
            ? Math.Max(recentMessagesKept, 1)
            : Math.Max(recentMessagesKept, 0);
        if (transcript.Count <= retainedTailCount)
        {
            return Array.Empty<RuntimeContextMessage>();
        }

        return transcript.Take(transcript.Count - retainedTailCount).ToArray();
    }

    private static string BuildPrompt(
        SessionStreamRuntimeRequest request,
        RuntimeConversationContext context,
        RuntimeCompactionSettings settings)
    {
        var builder = new StringBuilder();
        builder.AppendLine("继续当前 OpenAWork 会话。以下内容按时间顺序提供，用于恢复运行时上下文。");
        builder.AppendLine();

        if (!string.IsNullOrWhiteSpace(context.CompactionSummary))
        {
            builder.AppendLine("压缩摘要：");
            builder.AppendLine(context.CompactionSummary);
            builder.AppendLine();
        }

        var recentMessages = context.WasCompacted && settings.Prune
            ? context.Transcript.Skip(Math.Max(0, context.Transcript.Count - Math.Max(settings.RecentMessagesKept, 0))).ToArray()
            : context.Transcript;

        if (recentMessages.Count > 0)
        {
            builder.AppendLine("最近会话片段：");
            foreach (var message in recentMessages)
            {
                builder.AppendLine($"[{FormatRoleLabel(message.Role)}] {message.Content}");
                builder.AppendLine();
            }
        }

        if (request.InitialToolResult is not null)
        {
            builder.AppendLine("当前继续指令：");
            builder.AppendLine(request.Message);
            builder.AppendLine();
        }

        builder.AppendLine("请基于以上上下文直接继续回答当前回合，不要重复转述压缩机制。");
        return builder.ToString().Trim();
    }

    private static string BuildCompactionPrompt(
        IReadOnlyList<RuntimeContextMessage> messagesToCompact,
        IReadOnlyList<RuntimeContextMessage> transcript,
        int recentMessagesKept,
        SessionStreamRuntimeRequest request)
    {
        var builder = new StringBuilder();
        builder.AppendLine("请把以下历史会话压缩成可继续执行的运行时记忆。输出必须简洁、信息密度高，并且可用于替换原始历史消息。");
        builder.AppendLine("保留内容：用户目标、已完成工作、关键约束、失败尝试、重要工具结果、待继续事项。不要输出寒暄。不要虚构未发生的信息。");
        builder.AppendLine();
        builder.AppendLine($"需要压缩的历史消息数：{messagesToCompact.Count}");
        builder.AppendLine($"最近保留消息数：{Math.Max(recentMessagesKept, 0)}");
        builder.AppendLine($"当前模式：{(request.InitialToolResult is null ? "普通用户回合" : "工具结果续跑回合")}");
        builder.AppendLine();
        builder.AppendLine("历史消息：");
        foreach (var message in messagesToCompact)
        {
            builder.AppendLine($"[{FormatRoleLabel(message.Role)}] {message.Content}");
            builder.AppendLine();
        }

        var recentMessages = transcript.Skip(Math.Max(0, transcript.Count - Math.Max(recentMessagesKept, 0))).ToArray();
        if (recentMessages.Length > 0)
        {
            builder.AppendLine("以下最近消息将原样保留，无需重复抄写，但可在摘要里引用必要依赖：");
            foreach (var message in recentMessages)
            {
                builder.AppendLine($"[{FormatRoleLabel(message.Role)}] {message.Content}");
                builder.AppendLine();
            }
        }

        if (request.InitialToolResult is not null)
        {
            builder.AppendLine("当前继续指令：");
            builder.AppendLine(request.Message);
        }

        return builder.ToString().Trim();
    }

    private async Task PersistCompactionMetadataAsync(
        SessionRecord? session,
        string summary,
        IReadOnlyList<RuntimeContextMessage> compactedMessages,
        IReadOnlyList<RuntimeContextMessage> transcript,
        RuntimeCompactionSettings settings,
        CancellationToken cancellationToken)
    {
        if (session is null)
        {
            return;
        }

        var metadata = SessionMetadataSupport.ParsePersistedMetadata(session.MetadataJson);
        metadata["lastCompactionSummary"] = summary;
        metadata["lastCompactionTrigger"] = "auto";
        metadata["compactionMemory"] = new JsonObject
        {
            ["schemaVersion"] = 2,
            ["strategy"] = "runtime_replace",
            ["coveredUntilMessageId"] = compactedMessages.LastOrDefault()?.Id,
            ["compactedMessages"] = compactedMessages.Count,
            ["representedMessages"] = transcript.Count,
            ["recentMessagesKept"] = settings.RecentMessagesKept,
        };

        session.MetadataJson = metadata.ToJsonString();
        session.UpdatedAtUtc = DateTimeOffset.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    private static int EstimateTokenCount(IReadOnlyList<RuntimeContextMessage> transcript, SessionStreamRuntimeRequest request)
    {
        var text = string.Join("\n", transcript.Select((item) => item.Content));
        if (request.InitialToolResult is not null && !string.IsNullOrWhiteSpace(request.Message))
        {
            text = string.Concat(text, "\n", request.Message);
        }

        return EstimateTokenCount(text);
    }

    private static int EstimateTokenCount(string text)
        => string.IsNullOrWhiteSpace(text) ? 0 : (int)Math.Ceiling(text.Length / 4d);

    private static bool? TryReadBoolean(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        return property.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    private static string FormatToolPart(JsonElement partRoot)
    {
        var toolName = ReadString(partRoot, "tool") ?? "tool";
        var callId = ReadString(partRoot, "callID") ?? "unknown";
        var state = partRoot.TryGetProperty("state", out var stateElement) && stateElement.ValueKind == JsonValueKind.Object
            ? stateElement
            : default;
        var status = state.ValueKind == JsonValueKind.Object ? ReadString(state, "status") ?? "completed" : "completed";
        var rawInput = state.ValueKind == JsonValueKind.Object ? ReadString(state, "raw") : null;
        var output = state.ValueKind == JsonValueKind.Object && state.TryGetProperty("output", out var outputElement)
            ? outputElement.GetRawText()
            : null;
        var error = state.ValueKind == JsonValueKind.Object ? ReadString(state, "error") : null;

        var builder = new StringBuilder();
        builder.AppendLine($"工具 {toolName} (call: {callId}) 状态: {status}");
        if (!string.IsNullOrWhiteSpace(rawInput))
        {
            builder.AppendLine($"输入: {rawInput}");
        }

        if (!string.IsNullOrWhiteSpace(output))
        {
            builder.AppendLine($"输出: {output}");
        }

        if (!string.IsNullOrWhiteSpace(error))
        {
            builder.AppendLine($"错误: {error}");
        }

        return builder.ToString().Trim();
    }

    private static bool IsInternalAssistantEvent(string text)
    {
        if (string.IsNullOrWhiteSpace(text) || text[0] != '{')
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(text);
            return ReadString(document.RootElement, "source") == "openawork_internal"
                && ReadString(document.RootElement, "type") == "assistant_event";
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static string FormatRoleLabel(string role)
        => role switch
        {
            "user" => "用户",
            "assistant" => "助手",
            "tool" => "工具",
            _ => role,
        };

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

    private static object? DeserializeJsonValue(string json)
        => JsonSerializer.Deserialize<object>(json);

    private static string BuildToolResultScopedClientRequestId(string clientRequestId, string toolCallId)
        => $"{clientRequestId}:{toolCallId}:tool_result";

    private static string FormatTimestamp(long epochMs)
        => DateTimeOffset.FromUnixTimeMilliseconds(epochMs).UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture);

    private sealed record RuntimeContextMessage(
        string Id,
        string Role,
        string Content,
        long CreatedAt,
        string? ClientRequestId);

    private sealed record RuntimeConversationContext(
        IReadOnlyList<RuntimeContextMessage> Transcript,
        string? CompactionSummary,
        bool WasCompacted,
        int EstimatedTokens);

    private sealed record RuntimeCompactionSettings(
        bool Auto,
        bool Prune,
        int RecentMessagesKept,
        int? Reserved);
}
