using System.Text.Json;
using System.Text.Json.Nodes;
using System.Globalization;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Messaging;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Contracts.Sessions;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Application.Features.Sessions;

public sealed record GetSessionsQuery(int Limit, int Offset) : IQuery<SessionsListResponse>;

public sealed record GetSessionQuery(string SessionId) : IQuery<SessionEnvelopeResponse>;

public sealed record CreateSessionCommand(JsonElement? Metadata, string? WorkingDirectory) : ICommand<CreateSessionResponse>;

public sealed record PatchSessionCommand(string SessionId, string? Title, JsonElement? Metadata) : ICommand<bool>;

public sealed record DeleteSessionCommand(string SessionId) : ICommand<DeleteSessionResponse>;

public sealed class GetSessionsQueryHandler(
    ICurrentUser currentUser,
    GatewayDbContext dbContext,
    IConfiguration configuration) : IRequestHandler<GetSessionsQuery, SessionsListResponse>
{
    public async Task<SessionsListResponse> Handle(GetSessionsQuery request, CancellationToken cancellationToken)
    {
        var userId = SessionRequestGuards.RequireUserId(currentUser);
        var workspaceRoot = configuration["WORKSPACE_ROOT"];

        var records = await dbContext.Sessions
            .AsNoTracking()
            .Where((session) => session.UserId == userId)
            .OrderByDescending((session) => session.UpdatedAtUtc)
            .Skip(request.Offset)
            .Take(request.Limit)
            .ToListAsync(cancellationToken);

        return new SessionsListResponse(records.Select((record) => SessionResponseSupport.MapSummary(record, workspaceRoot)).ToArray());
    }
}

public sealed class GetSessionQueryHandler(
    ICurrentUser currentUser,
    GatewayDbContext dbContext,
    IMessageV2Store messageV2Store,
    ISessionRunEventStore sessionRunEventStore,
    IConfiguration configuration) : IRequestHandler<GetSessionQuery, SessionEnvelopeResponse>
{
    public async Task<SessionEnvelopeResponse> Handle(GetSessionQuery request, CancellationToken cancellationToken)
    {
        var userId = SessionRequestGuards.RequireUserId(currentUser);
        var record = await dbContext.Sessions
            .AsNoTracking()
            .SingleOrDefaultAsync((session) => session.Id == request.SessionId && session.UserId == userId, cancellationToken);

        if (record is null)
        {
            throw new KeyNotFoundException("Session not found");
        }

        var transcript = await messageV2Store.ListMessagesWithPartsAsync(record.Id, userId, 100, cancellationToken);
        var runEvents = await sessionRunEventStore.ListForSessionAsync(record.Id, cancellationToken);
        return new SessionEnvelopeResponse(SessionResponseSupport.MapDetail(record, configuration["WORKSPACE_ROOT"], transcript, runEvents));
    }
}

public sealed class CreateSessionCommandHandler(
    ICurrentUser currentUser,
    GatewayDbContext dbContext,
    IConfiguration configuration) : IRequestHandler<CreateSessionCommand, CreateSessionResponse>
{
    public async Task<CreateSessionResponse> Handle(CreateSessionCommand request, CancellationToken cancellationToken)
    {
        var userId = SessionRequestGuards.RequireUserId(currentUser);
        var workspaceRoot = configuration["WORKSPACE_ROOT"];
        var metadata = request.Metadata is { } metadataElement
            ? SessionMetadataSupport.ParseAndValidateMetadataPatch(metadataElement, "Invalid metadata")
            : new JsonObject();
        var metadataJson = SessionMetadataSupport.NormalizeNewMetadata(metadata, request.WorkingDirectory, workspaceRoot);
        var normalizedMetadata = SessionMetadataSupport.ParsePersistedMetadata(metadataJson);

        await SessionMetadataSupport.ValidateParentSessionBindingAsync(
            dbContext,
            userId,
            SessionMetadataSupport.ExtractParentSessionId(normalizedMetadata),
            null,
            null,
            cancellationToken);

        var now = DateTimeOffset.UtcNow;
        var record = new SessionRecord
        {
            Id = Guid.NewGuid().ToString(),
            UserId = userId,
            MessagesJson = "[]",
            StateStatus = "idle",
            MetadataJson = metadataJson,
            Title = null,
            CreatedAtUtc = now,
            UpdatedAtUtc = now,
        };

        dbContext.Sessions.Add(record);
        await dbContext.SaveChangesAsync(cancellationToken);
        return new CreateSessionResponse(record.Id);
    }
}

public sealed class PatchSessionCommandHandler(
    ICurrentUser currentUser,
    GatewayDbContext dbContext,
    IConfiguration configuration) : IRequestHandler<PatchSessionCommand, bool>
{
    public async Task<bool> Handle(PatchSessionCommand request, CancellationToken cancellationToken)
    {
        var userId = SessionRequestGuards.RequireUserId(currentUser);
        var record = await dbContext.Sessions
            .SingleOrDefaultAsync((session) => session.Id == request.SessionId && session.UserId == userId, cancellationToken);

        if (record is null)
        {
            throw new KeyNotFoundException("Session not found");
        }

        var changed = false;

        if (request.Metadata is { } metadataElement)
        {
            var workspaceRoot = configuration["WORKSPACE_ROOT"];
            var metadataPatch = SessionMetadataSupport.ParseAndValidateMetadataPatch(metadataElement, "Invalid metadata");
            var currentMetadata = SessionMetadataSupport.ParsePersistedMetadata(record.MetadataJson);
            await SessionMetadataSupport.ValidateParentSessionBindingAsync(
                dbContext,
                userId,
                SessionMetadataSupport.ExtractParentSessionId(metadataPatch),
                record.Id,
                SessionMetadataSupport.ExtractParentSessionId(currentMetadata),
                cancellationToken);
            var nextMetadataJson = SessionMetadataSupport.MergeMetadataForUpdate(record.MetadataJson, metadataPatch, workspaceRoot);
            if (!string.Equals(record.MetadataJson, nextMetadataJson, StringComparison.Ordinal))
            {
                record.MetadataJson = nextMetadataJson;
                changed = true;
            }
        }

        if (request.Title is not null)
        {
            if (!string.Equals(record.Title, request.Title, StringComparison.Ordinal))
            {
                record.Title = request.Title;
                changed = true;
            }
        }

        if (!changed)
        {
            return true;
        }

        record.UpdatedAtUtc = DateTimeOffset.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }
}

public sealed class DeleteSessionCommandHandler(
    ICurrentUser currentUser,
    GatewayDbContext dbContext) : IRequestHandler<DeleteSessionCommand, DeleteSessionResponse>
{
    public async Task<DeleteSessionResponse> Handle(DeleteSessionCommand request, CancellationToken cancellationToken)
    {
        var userId = SessionRequestGuards.RequireUserId(currentUser);
        var rootSession = await dbContext.Sessions
            .AsNoTracking()
            .SingleOrDefaultAsync((session) => session.Id == request.SessionId && session.UserId == userId, cancellationToken);
        if (rootSession is null)
        {
            throw new KeyNotFoundException("Session not found");
        }

        var userSessions = await dbContext.Sessions
            .Where((session) => session.UserId == userId)
            .OrderByDescending((session) => session.UpdatedAtUtc)
            .ToListAsync(cancellationToken);
        var sessionsToDelete = BuildSessionDeletionRows(userSessions, request.SessionId);

        var blockingSession = sessionsToDelete.FirstOrDefault((session) => session.StateStatus != "idle");
        if (blockingSession is not null)
        {
            throw new SessionDeletionBlockedException(blockingSession.Id, blockingSession.StateStatus, "state");
        }

        dbContext.Sessions.RemoveRange(sessionsToDelete);
        await dbContext.SaveChangesAsync(cancellationToken);
        return new DeleteSessionResponse(true, sessionsToDelete.Select((session) => session.Id).ToArray());
    }

    private static IReadOnlyList<SessionRecord> BuildSessionDeletionRows(IReadOnlyList<SessionRecord> sessions, string rootSessionId)
    {
        var rowsById = sessions.ToDictionary((session) => session.Id);
        var childrenByParent = new Dictionary<string, List<string>>(StringComparer.Ordinal);

        foreach (var session in sessions)
        {
            var parentSessionId = SessionMetadataSupport.ExtractParentSessionId(SessionMetadataSupport.ParsePersistedMetadata(session.MetadataJson));
            if (parentSessionId is null)
            {
                continue;
            }

            if (!childrenByParent.TryGetValue(parentSessionId, out var children))
            {
                children = new List<string>();
                childrenByParent[parentSessionId] = children;
            }

            children.Add(session.Id);
        }

        var queue = new Queue<(string SessionId, int Depth)>();
        var visited = new HashSet<string>(StringComparer.Ordinal);
        var deletionRows = new List<(SessionRecord Record, int Depth)>();
        queue.Enqueue((rootSessionId, 0));

        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            if (!visited.Add(current.SessionId) || !rowsById.TryGetValue(current.SessionId, out var record))
            {
                continue;
            }

            deletionRows.Add((record, current.Depth));
            if (childrenByParent.TryGetValue(current.SessionId, out var children))
            {
                foreach (var child in children)
                {
                    queue.Enqueue((child, current.Depth + 1));
                }
            }
        }

        return deletionRows
            .OrderByDescending((item) => item.Depth)
            .Select((item) => item.Record)
            .ToArray();
    }
}

internal static class SessionRequestGuards
{
    internal static string RequireUserId(ICurrentUser currentUser)
    {
        if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId))
        {
            throw new UnauthorizedAccessException("Authenticated user is required.");
        }

        return currentUser.UserId;
    }
}

internal static class SessionResponseSupport
{
    internal static SessionSummaryResponse MapSummary(SessionRecord record, string? workspaceRoot)
    {
        return new SessionSummaryResponse(
            Id: record.Id,
            StateStatus: record.StateStatus,
            MetadataJson: SessionMetadataSupport.SanitizePersistedMetadataJson(record.MetadataJson, workspaceRoot),
            Title: record.Title,
            CreatedAt: FormatTimestamp(record.CreatedAtUtc),
            UpdatedAt: FormatTimestamp(record.UpdatedAtUtc),
            FileChangesSummary: EmptyFileChangesSummary());
    }

    internal static SessionDetailResponse MapDetail(
        SessionRecord record,
        string? workspaceRoot,
        IReadOnlyList<MessageWithPartsRecord> transcript,
        IReadOnlyList<SessionRunEventInfoRecord> runEvents)
    {
        var assistantToolCallIds = CollectToolCallIdsByRole(transcript, "assistant");
        var authoritativeToolCallIds = CollectToolCallIdsByRole(transcript, "tool");
        return new SessionDetailResponse(
            Id: record.Id,
            StateStatus: record.StateStatus,
            MetadataJson: SessionMetadataSupport.SanitizePersistedMetadataJson(record.MetadataJson, workspaceRoot),
            Title: record.Title,
            CreatedAt: FormatTimestamp(record.CreatedAtUtc),
            UpdatedAt: FormatTimestamp(record.UpdatedAtUtc),
            Messages: transcript
                .Select((message) => MapMessage(message, assistantToolCallIds, authoritativeToolCallIds))
                .Where((message) => ((IReadOnlyList<object>)message["content"]!).Count > 0)
                .Cast<object>()
                .ToArray(),
            RunEvents: runEvents.Select(MapRunEvent).ToArray(),
            Todos: Array.Empty<object>(),
            FileChangesSummary: EmptyFileChangesSummary());
    }

    private static object MapRunEvent(SessionRunEventInfoRecord runEvent)
    {
        try
        {
            using var document = JsonDocument.Parse(runEvent.PayloadJson);
            return document.RootElement.Clone();
        }
        catch (JsonException)
        {
            return new Dictionary<string, object?>
            {
                ["type"] = runEvent.EventType,
                ["error"] = "Invalid run event payload",
            };
        }
    }

    private static Dictionary<string, object?> MapMessage(
        MessageWithPartsRecord withParts,
        IReadOnlySet<string> assistantToolCallIds,
        IReadOnlySet<string> authoritativeToolCallIds)
    {
        using var messageDocument = JsonDocument.Parse(withParts.Message.DataJson);
        var root = messageDocument.RootElement;
        var role = ReadString(root, "role") ?? "assistant";
        var content = new List<object>();

        foreach (var part in withParts.Parts)
        {
            using var partDocument = JsonDocument.Parse(part.DataJson);
            var partRoot = partDocument.RootElement;
            var type = ReadString(partRoot, "type");

            switch (type)
            {
                case "text":
                    content.Add(new Dictionary<string, object?>
                    {
                        ["type"] = "text",
                        ["text"] = ReadString(partRoot, "text") ?? string.Empty,
                    });
                    break;
                case "reasoning":
                {
                    var item = new Dictionary<string, object?>
                    {
                        ["type"] = "reasoning",
                        ["text"] = ReadString(partRoot, "text") ?? string.Empty,
                    };
                    if (TryGetMetadataString(partRoot, "encryptedContent", out var encryptedContent))
                    {
                        item["encryptedContent"] = encryptedContent;
                    }

                    if (TryGetMetadataString(partRoot, "summary", out var summary))
                    {
                        item["summary"] = summary;
                    }

                    content.Add(item);
                    break;
                }
                case "tool":
                {
                    var callId = ReadString(partRoot, "callID") ?? string.Empty;
                    var toolName = ReadString(partRoot, "tool") ?? string.Empty;
                    var state = partRoot.TryGetProperty("state", out var stateElement) && stateElement.ValueKind == JsonValueKind.Object
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
                        content.Add(new Dictionary<string, object?>
                        {
                            ["type"] = "tool_call",
                            ["toolCallId"] = callId,
                            ["toolName"] = toolName,
                            ["input"] = input,
                            ["rawArguments"] = rawArguments,
                        });
                    }

                    if (state.ValueKind == JsonValueKind.Object)
                    {
                        var status = ReadString(state, "status");
                        var storedToolResult = ReadStoredToolResultContent(state);
                        if (status == "completed")
                        {
                            if (role != "assistant" || !hasAuthoritativeToolResult)
                            {
                                content.Add(storedToolResult ?? new Dictionary<string, object?>
                                {
                                    ["type"] = "tool_result",
                                    ["toolCallId"] = callId,
                                    ["toolName"] = toolName,
                                    ["output"] = ReadString(state, "output") ?? string.Empty,
                                    ["isError"] = false,
                                    ["fileDiffs"] = Array.Empty<object>(),
                                });
                            }
                        }
                        else if (status == "error")
                        {
                            if (role != "assistant" || !hasAuthoritativeToolResult)
                            {
                                content.Add(storedToolResult ?? new Dictionary<string, object?>
                                {
                                    ["type"] = "tool_result",
                                    ["toolCallId"] = callId,
                                    ["toolName"] = toolName,
                                    ["output"] = ReadString(state, "error") ?? string.Empty,
                                    ["isError"] = true,
                                });
                            }
                        }
                        else if (status == "pending")
                        {
                            if (role != "assistant" || !hasAuthoritativeToolResult)
                            {
                                content.Add(new Dictionary<string, object?>
                                {
                                    ["type"] = "tool_result",
                                    ["toolCallId"] = callId,
                                    ["toolName"] = toolName,
                                    ["output"] = $"Tool \"{toolName}\" is waiting for approval.",
                                    ["isError"] = false,
                                    ["pendingPermissionRequestId"] = callId,
                                });
                            }
                        }
                    }

                    break;
                }
                case "modified_files_summary":
                    content.Add(new Dictionary<string, object?>
                    {
                        ["type"] = "modified_files_summary",
                        ["title"] = ReadString(partRoot, "title") ?? string.Empty,
                        ["summary"] = ReadString(partRoot, "summary") ?? string.Empty,
                        ["files"] = partRoot.TryGetProperty("files", out var filesElement)
                            ? JsonSerializer.Deserialize<object>(filesElement.GetRawText())
                            : Array.Empty<object>(),
                    });
                    break;
            }
        }

        var message = new Dictionary<string, object?>
        {
            ["id"] = withParts.Message.Id,
            ["role"] = ReadString(root, "role") ?? "assistant",
            ["createdAt"] = ReadCreatedAt(root),
            ["content"] = content,
        };

        var clientRequestId = ReadString(root, "clientRequestId");
        if (!string.IsNullOrWhiteSpace(clientRequestId))
        {
            message["clientRequestId"] = clientRequestId;
        }

        return message;
    }

    private static IReadOnlySet<string> CollectToolCallIdsByRole(IReadOnlyList<MessageWithPartsRecord> transcript, string role)
    {
        var toolCallIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var withParts in transcript)
        {
            using var messageDocument = JsonDocument.Parse(withParts.Message.DataJson);
            var root = messageDocument.RootElement;
            if (ReadString(root, "role") != role)
            {
                continue;
            }

            foreach (var part in withParts.Parts)
            {
                using var partDocument = JsonDocument.Parse(part.DataJson);
                var partRoot = partDocument.RootElement;
                var callId = ReadString(partRoot, "callID");
                if (ReadString(partRoot, "type") == "tool" && !string.IsNullOrWhiteSpace(callId))
                {
                    toolCallIds.Add(callId);
                }
            }
        }

        return toolCallIds;
    }

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

    private static bool TryGetMetadataString(JsonElement partRoot, string propertyName, out string? value)
    {
        value = null;
        if (!partRoot.TryGetProperty("metadata", out var metadataElement)
            || metadataElement.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        value = ReadString(metadataElement, propertyName);
        return !string.IsNullOrWhiteSpace(value);
    }

    private static string? ReadString(JsonElement element, string propertyName)
        => element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;

    private static long ReadCreatedAt(JsonElement messageInfo)
    {
        if (messageInfo.TryGetProperty("time", out var timeElement)
            && timeElement.ValueKind == JsonValueKind.Object
            && timeElement.TryGetProperty("created", out var createdElement)
            && createdElement.TryGetInt64(out var createdAt))
        {
            return createdAt;
        }

        return 0;
    }

    private static SessionFileChangesSummaryResponse EmptyFileChangesSummary()
        => new(0, Array.Empty<string>(), 0, 0, 0, null, null, null, null);

    private static string FormatTimestamp(DateTimeOffset value)
        => value.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
}

public sealed class SessionDeletionBlockedException : Exception
{
    public SessionDeletionBlockedException(string sessionId, string stateStatus, string blockReason)
        : base("Session can only be deleted when every related session is idle")
    {
        SessionId = sessionId;
        StateStatus = stateStatus;
        BlockReason = blockReason;
    }

    public string SessionId { get; }

    public string StateStatus { get; }

    public string BlockReason { get; }
}
