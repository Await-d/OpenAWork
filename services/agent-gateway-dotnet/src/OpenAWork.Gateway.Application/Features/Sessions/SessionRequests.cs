using System.Text.Json;
using System.Text.Json.Nodes;
using System.Globalization;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Messaging;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Application.Abstractions.Streaming;
using OpenAWork.Gateway.Contracts.Sessions;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Application.Features.Sessions;

public sealed record GetSessionsQuery(int Limit, int Offset) : IQuery<SessionsListResponse>;

public sealed record GetSessionQuery(string SessionId) : IQuery<SessionEnvelopeResponse>;

public sealed record GetSessionChildrenQuery(string SessionId, int Limit, int Offset) : IQuery<SessionChildrenResponse>;

public sealed record GetSessionTasksQuery(string SessionId) : IQuery<SessionTasksResponse>;

public sealed record TruncateSessionMessagesCommand(string SessionId, string MessageId, bool Inclusive, string? MessageText) : ICommand<SessionMessagesResponse>;

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
        var workspaceRoots = SessionWorkspaceRootSupport.ResolveConfiguredWorkspaceRoots(configuration);

        var records = await dbContext.Sessions
            .AsNoTracking()
            .Where((session) => session.UserId == userId)
            .OrderByDescending((session) => session.UpdatedAtUtc)
            .Skip(request.Offset)
            .Take(request.Limit)
            .ToListAsync(cancellationToken);

        return new SessionsListResponse(records.Select((record) => SessionResponseSupport.MapSummary(record, workspaceRoots)).ToArray());
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
        var workspaceRoots = SessionWorkspaceRootSupport.ResolveConfiguredWorkspaceRoots(configuration);
        return new SessionEnvelopeResponse(SessionResponseSupport.MapDetail(record, workspaceRoots, transcript, runEvents));
    }
}

public sealed class GetSessionChildrenQueryHandler(
    ICurrentUser currentUser,
    GatewayDbContext dbContext,
    IMessageV2Store messageV2Store,
    ISessionRuntimeReconciler sessionRuntimeReconciler,
    IConfiguration configuration) : IRequestHandler<GetSessionChildrenQuery, SessionChildrenResponse>
{
    public async Task<SessionChildrenResponse> Handle(GetSessionChildrenQuery request, CancellationToken cancellationToken)
    {
        var userId = SessionRequestGuards.RequireUserId(currentUser);
        var rootSession = await dbContext.Sessions
            .AsNoTracking()
            .SingleOrDefaultAsync((session) => session.Id == request.SessionId && session.UserId == userId, cancellationToken);
        if (rootSession is null)
        {
            throw new KeyNotFoundException("Session not found");
        }

        var allSessions = await dbContext.Sessions
            .AsNoTracking()
            .Where((session) => session.UserId == userId)
            .OrderByDescending((session) => session.UpdatedAtUtc)
            .ToListAsync(cancellationToken);
        var descendantIds = SessionLineageReadModelSupport
            .CollectDescendantSessionIds(allSessions, request.SessionId)
            .Where((sessionId) => sessionId != request.SessionId)
            .Skip(request.Offset)
            .Take(request.Limit)
            .ToArray();
        var selectedChildren = descendantIds
            .Select((sessionId) => allSessions.FirstOrDefault((session) => session.Id == sessionId))
            .Where((session) => session is not null)
            .Select((session) => session!)
            .ToArray();
        var reconciledChildren = await SessionLineageReadModelSupport.ReconcileSessionRowsAsync(
            selectedChildren,
            userId,
            dbContext,
            sessionRuntimeReconciler,
            cancellationToken);
        var workspaceRoots = SessionWorkspaceRootSupport.ResolveConfiguredWorkspaceRoots(configuration);

        var responses = new List<SessionChildResponse>(reconciledChildren.Count);
        foreach (var session in reconciledChildren)
        {
            var transcript = await messageV2Store.ListMessagesWithPartsAsync(session.Id, userId, 100, cancellationToken);
            responses.Add(SessionResponseSupport.MapChild(session, workspaceRoots, transcript));
        }

        return new SessionChildrenResponse(responses);
    }
}

public sealed class GetSessionTasksQueryHandler(
    ICurrentUser currentUser,
    GatewayDbContext dbContext,
    IMessageV2Store messageV2Store,
    ISessionRuntimeReconciler sessionRuntimeReconciler) : IRequestHandler<GetSessionTasksQuery, SessionTasksResponse>
{
    public async Task<SessionTasksResponse> Handle(GetSessionTasksQuery request, CancellationToken cancellationToken)
    {
        var userId = SessionRequestGuards.RequireUserId(currentUser);
        var rootSession = await dbContext.Sessions
            .AsNoTracking()
            .SingleOrDefaultAsync((session) => session.Id == request.SessionId && session.UserId == userId, cancellationToken);
        if (rootSession is null)
        {
            throw new KeyNotFoundException("Session not found");
        }

        var allSessions = await dbContext.Sessions
            .AsNoTracking()
            .Where((session) => session.UserId == userId)
            .OrderByDescending((session) => session.UpdatedAtUtc)
            .ToListAsync(cancellationToken);
        var sessionsById = allSessions.ToDictionary((session) => session.Id);
        var visibleSessionIds = new HashSet<string>(
            SessionLineageReadModelSupport.CollectAncestorSessionIds(sessionsById, request.SessionId),
            StringComparer.Ordinal);
        foreach (var sessionId in SessionLineageReadModelSupport.CollectDescendantSessionIds(allSessions, request.SessionId))
        {
            visibleSessionIds.Add(sessionId);
        }

        var visibleSessions = allSessions.Where((session) => visibleSessionIds.Contains(session.Id)).ToArray();
        var reconciledSessions = await SessionLineageReadModelSupport.ReconcileSessionRowsAsync(
            visibleSessions,
            userId,
            dbContext,
            sessionRuntimeReconciler,
            cancellationToken);

        var autoResumeContexts = await dbContext.TaskParentAutoResumeContexts
            .AsNoTracking()
            .Where((context) => context.UserId == userId && visibleSessionIds.Contains(context.ChildSessionId))
            .ToListAsync(cancellationToken);
        var contextByChildId = autoResumeContexts.ToDictionary((context) => context.ChildSessionId, StringComparer.Ordinal);

        var childTaskFacts = new List<ChildSessionTaskFact>();
        foreach (var session in reconciledSessions)
        {
            var metadata = SessionMetadataSupport.ParsePersistedMetadata(session.MetadataJson);
            var parentSessionId = SessionMetadataSupport.ExtractParentSessionId(metadata);
            if (string.IsNullOrWhiteSpace(parentSessionId))
            {
                continue;
            }

            contextByChildId.TryGetValue(session.Id, out var activeContext);
            var summary = await SessionLineageReadModelSupport.BuildLatestAssistantSummaryAsync(messageV2Store, session.Id, userId, cancellationToken);
            childTaskFacts.Add(SessionLineageReadModelSupport.BuildChildTaskFact(
                session,
                metadata,
                parentSessionId,
                activeContext,
                summary));
        }

        var tasks = SessionLineageReadModelSupport.ProjectChildSessionTasks(childTaskFacts, request.SessionId);
        var updatedAt = tasks.Count == 0 ? 0 : tasks.Max((task) => task.UpdatedAt);
        return new SessionTasksResponse(tasks, updatedAt);
    }
}

public sealed class TruncateSessionMessagesCommandHandler(
    ICurrentUser currentUser,
    GatewayDbContext dbContext,
    IMessageV2Store messageV2Store) : IRequestHandler<TruncateSessionMessagesCommand, SessionMessagesResponse>
{
    public async Task<SessionMessagesResponse> Handle(TruncateSessionMessagesCommand request, CancellationToken cancellationToken)
    {
        var userId = SessionRequestGuards.RequireUserId(currentUser);
        var session = await dbContext.Sessions
            .AsNoTracking()
            .SingleOrDefaultAsync((item) => item.Id == request.SessionId && item.UserId == userId, cancellationToken);
        if (session is null)
        {
            throw new KeyNotFoundException("Session not found");
        }

        var messageRows = await dbContext.MessageV2
            .AsNoTracking()
            .Where((item) => item.SessionId == request.SessionId && item.UserId == userId)
            .OrderBy((item) => item.TimeCreated)
            .ThenBy((item) => item.Id)
            .Select((item) => new { item.Id, item.TimeCreated, item.DataJson })
            .ToListAsync(cancellationToken);

        var targetIndex = messageRows.FindIndex((row) => row.Id == request.MessageId);
        if (targetIndex == -1 && !string.IsNullOrWhiteSpace(request.MessageText))
        {
            var transcript = await messageV2Store.ListMessagesWithPartsAsync(request.SessionId, userId, Math.Max(messageRows.Count, 1), cancellationToken);
            for (var index = transcript.Count - 1; index >= 0; index -= 1)
            {
                var message = transcript[index];
                using var messageDocument = JsonDocument.Parse(message.Message.DataJson);
                if (SessionResponseSupport.ReadString(messageDocument.RootElement, "role") != "user")
                {
                    continue;
                }

                if (message.Parts.Any((part) => PartContainsExactText(part.DataJson, request.MessageText!)))
                {
                    targetIndex = messageRows.FindIndex((row) => row.Id == message.Message.Id);
                    break;
                }
            }
        }

        if (targetIndex != -1)
        {
            var cutoffIndex = request.Inclusive ? targetIndex : targetIndex + 1;
            var deleteIds = messageRows.Skip(cutoffIndex).Select((row) => row.Id).ToArray();
            if (deleteIds.Length > 0)
            {
                await dbContext.PartV2
                    .Where((item) => item.SessionId == request.SessionId && deleteIds.Contains(item.MessageId))
                    .ExecuteDeleteAsync(cancellationToken);
                await dbContext.MessageV2
                    .Where((item) => item.SessionId == request.SessionId && item.UserId == userId && deleteIds.Contains(item.Id))
                    .ExecuteDeleteAsync(cancellationToken);
            }
        }

        var remaining = await messageV2Store.ListMessagesWithPartsAsync(request.SessionId, userId, Math.Max(messageRows.Count, 1), cancellationToken);
        return new SessionMessagesResponse(SessionResponseSupport.MapTranscriptMessages(remaining));
    }

    private static bool PartContainsExactText(string partDataJson, string messageText)
    {
        try
        {
            using var document = JsonDocument.Parse(partDataJson);
            return SessionResponseSupport.ReadString(document.RootElement, "type") == "text"
                && SessionResponseSupport.ReadString(document.RootElement, "text") == messageText;
        }
        catch (JsonException)
        {
            return false;
        }
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
        var workspaceRoots = SessionWorkspaceRootSupport.ResolveConfiguredWorkspaceRoots(configuration);
        var metadata = request.Metadata is { } metadataElement
            ? SessionMetadataSupport.ParseAndValidateMetadataPatch(metadataElement, "Invalid metadata")
            : new JsonObject();
        var metadataJson = SessionMetadataSupport.NormalizeNewMetadata(metadata, request.WorkingDirectory, workspaceRoots);
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
            var workspaceRoots = SessionWorkspaceRootSupport.ResolveConfiguredWorkspaceRoots(configuration);
            var metadataPatch = SessionMetadataSupport.ParseAndValidateMetadataPatch(metadataElement, "Invalid metadata");
            var currentMetadata = SessionMetadataSupport.ParsePersistedMetadata(record.MetadataJson);
            await SessionMetadataSupport.ValidateParentSessionBindingAsync(
                dbContext,
                userId,
                SessionMetadataSupport.ExtractParentSessionId(metadataPatch),
                record.Id,
                SessionMetadataSupport.ExtractParentSessionId(currentMetadata),
                cancellationToken);
            var nextMetadataJson = SessionMetadataSupport.MergeMetadataForUpdate(record.MetadataJson, metadataPatch, workspaceRoots);
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

internal sealed record ChildSessionTaskFact(
    string Id,
    string SessionId,
    string ParentSessionId,
    string Title,
    string Subject,
    string Status,
    string? AssignedAgent,
    string? Result,
    string? ErrorMessage,
    long CreatedAt,
    long UpdatedAt,
    string? TerminalReason,
    long? EffectiveDeadline);

internal sealed record ChildSessionAssistantSummary(string? Status, string? Summary);

internal static class SessionLineageReadModelSupport
{
    internal static IReadOnlyList<string> CollectDescendantSessionIds(IReadOnlyList<SessionRecord> sessions, string rootSessionId)
    {
        var childrenByParent = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var session in sessions)
        {
            var metadata = SessionMetadataSupport.ParsePersistedMetadata(session.MetadataJson);
            var parentSessionId = SessionMetadataSupport.ExtractParentSessionId(metadata);
            if (string.IsNullOrWhiteSpace(parentSessionId))
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

        var includedSessionIds = new HashSet<string>(StringComparer.Ordinal) { rootSessionId };
        var ordered = new List<string> { rootSessionId };
        var queue = new Queue<string>();
        queue.Enqueue(rootSessionId);
        while (queue.Count > 0)
        {
            var currentSessionId = queue.Dequeue();
            if (!childrenByParent.TryGetValue(currentSessionId, out var children))
            {
                continue;
            }

            foreach (var childSessionId in children)
            {
                if (!includedSessionIds.Add(childSessionId))
                {
                    continue;
                }

                ordered.Add(childSessionId);
                queue.Enqueue(childSessionId);
            }
        }

        return ordered;
    }

    internal static IReadOnlyList<string> CollectAncestorSessionIds(
        IReadOnlyDictionary<string, SessionRecord> sessionsById,
        string sessionId)
    {
        var collectedSessionIds = new List<string>();
        var visited = new HashSet<string>(StringComparer.Ordinal);
        string? currentSessionId = sessionId;
        while (!string.IsNullOrWhiteSpace(currentSessionId) && visited.Add(currentSessionId))
        {
            collectedSessionIds.Add(currentSessionId);
            if (!sessionsById.TryGetValue(currentSessionId, out var currentSession))
            {
                break;
            }

            currentSessionId = SessionMetadataSupport.ExtractParentSessionId(
                SessionMetadataSupport.ParsePersistedMetadata(currentSession.MetadataJson));
        }

        return collectedSessionIds;
    }

    internal static async Task<IReadOnlyList<SessionRecord>> ReconcileSessionRowsAsync(
        IReadOnlyList<SessionRecord> sessions,
        string userId,
        GatewayDbContext dbContext,
        ISessionRuntimeReconciler sessionRuntimeReconciler,
        CancellationToken cancellationToken)
    {
        var reconciled = new List<SessionRecord>(sessions.Count);
        foreach (var session in sessions)
        {
            var result = await sessionRuntimeReconciler.ReconcileSessionRuntimeAsync(session.Id, userId, null, cancellationToken);
            if (result.Status == session.StateStatus)
            {
                reconciled.Add(session);
                continue;
            }

            var refreshed = await dbContext.Sessions
                .AsNoTracking()
                .SingleOrDefaultAsync((candidate) => candidate.Id == session.Id && candidate.UserId == userId, cancellationToken);
            if (refreshed is not null)
            {
                reconciled.Add(refreshed);
            }
            else
            {
                reconciled.Add(new SessionRecord
                {
                    Id = session.Id,
                    UserId = session.UserId,
                    MessagesJson = session.MessagesJson,
                    StateStatus = result.Status,
                    MetadataJson = session.MetadataJson,
                    Title = session.Title,
                    CreatedAtUtc = session.CreatedAtUtc,
                    UpdatedAtUtc = session.UpdatedAtUtc,
                });
            }
        }

        return reconciled;
    }

    internal static async Task<ChildSessionAssistantSummary> BuildLatestAssistantSummaryAsync(
        IMessageV2Store messageV2Store,
        string sessionId,
        string userId,
        CancellationToken cancellationToken)
    {
        var transcript = await messageV2Store.ListMessagesWithPartsAsync(sessionId, userId, 50, cancellationToken);
        for (var messageIndex = transcript.Count - 1; messageIndex >= 0; messageIndex -= 1)
        {
            var withParts = transcript[messageIndex];
            using var messageDocument = JsonDocument.Parse(withParts.Message.DataJson);
            var messageStatus = ReadString(messageDocument.RootElement, "status");
            if (ReadString(messageDocument.RootElement, "role") != "assistant")
            {
                continue;
            }

            for (var partIndex = withParts.Parts.Count - 1; partIndex >= 0; partIndex -= 1)
            {
                using var partDocument = JsonDocument.Parse(withParts.Parts[partIndex].DataJson);
                var root = partDocument.RootElement;
                var type = ReadString(root, "type");
                if (type == "text")
                {
                    var text = ReadString(root, "text");
                    if (!string.IsNullOrWhiteSpace(text))
                    {
                        return new ChildSessionAssistantSummary(messageStatus, text);
                    }
                }

                if (type == "assistant_event" && root.TryGetProperty("payload", out var payload) && payload.ValueKind == JsonValueKind.Object)
                {
                    var title = ReadString(payload, "title");
                    var message = ReadString(payload, "message");
                    var combined = string.Join('\n', new[] { title, message }.Where((item) => !string.IsNullOrWhiteSpace(item)));
                    if (!string.IsNullOrWhiteSpace(combined))
                    {
                        return new ChildSessionAssistantSummary(messageStatus, combined);
                    }
                }
            }
        }

        return new ChildSessionAssistantSummary(null, null);
    }

    internal static ChildSessionTaskFact BuildChildTaskFact(
        SessionRecord session,
        JsonObject metadata,
        string parentSessionId,
        TaskParentAutoResumeContextRecord? activeContext,
        ChildSessionAssistantSummary assistantSummary)
    {
        var taskId = activeContext?.TaskId
            ?? ReadString(metadata, "taskId")
            ?? $"child-session:{session.Id}";
        var title = session.Title ?? $"子会话 {session.Id}";
        var subject = title;
        var terminalReason = ReadString(metadata, "terminalReason");
        var effectiveDeadline = ReadInt64(metadata, "deadlineMs");
        var assignedAgent = ReadAgentId(activeContext?.RequestDataJson)
            ?? ReadString(metadata, "assignedAgent")
            ?? ReadString(metadata, "agentId");
        var status = ResolveTaskStatus(session.StateStatus, terminalReason, activeContext is not null, assistantSummary.Status);
        var result = status == "completed" || status == "running" || status == "pending"
            ? assistantSummary.Summary
            : null;
        var errorMessage = status is "failed" or "cancelled" ? assistantSummary.Summary : null;

        return new ChildSessionTaskFact(
            taskId,
            session.Id,
            parentSessionId,
            title,
            subject,
            status,
            assignedAgent,
            result,
            errorMessage,
            ToUnixMilliseconds(session.CreatedAtUtc),
            ToUnixMilliseconds(session.UpdatedAtUtc),
            terminalReason,
            effectiveDeadline);
    }

    internal static IReadOnlyList<SessionTaskResponse> ProjectChildSessionTasks(
        IReadOnlyList<ChildSessionTaskFact> taskFacts,
        string rootSessionId)
    {
        var factBySessionId = taskFacts.ToDictionary((fact) => fact.SessionId, StringComparer.Ordinal);
        var childrenByParentSessionId = new Dictionary<string, List<ChildSessionTaskFact>>(StringComparer.Ordinal);
        foreach (var fact in taskFacts)
        {
            if (!childrenByParentSessionId.TryGetValue(fact.ParentSessionId, out var children))
            {
                children = new List<ChildSessionTaskFact>();
                childrenByParentSessionId[fact.ParentSessionId] = children;
            }

            children.Add(fact);
        }

        var depthBySessionId = new Dictionary<string, int>(StringComparer.Ordinal);
        int ResolveDepth(ChildSessionTaskFact fact)
        {
            if (depthBySessionId.TryGetValue(fact.SessionId, out var cached))
            {
                return cached;
            }

            if (fact.ParentSessionId == rootSessionId || !factBySessionId.TryGetValue(fact.ParentSessionId, out var parentFact))
            {
                depthBySessionId[fact.SessionId] = 0;
                return 0;
            }

            var depth = ResolveDepth(parentFact) + 1;
            depthBySessionId[fact.SessionId] = depth;
            return depth;
        }

        var taskIdBySessionId = taskFacts.ToDictionary((fact) => fact.SessionId, (fact) => fact.Id, StringComparer.Ordinal);
        return taskFacts
            .OrderBy((fact) => fact.CreatedAt)
            .ThenBy((fact) => ResolveDepth(fact))
            .ThenBy((fact) => fact.UpdatedAt)
            .Select((fact) =>
            {
                var children = childrenByParentSessionId.TryGetValue(fact.SessionId, out var directChildren)
                    ? directChildren
                    : [];
                return new SessionTaskResponse(
                    Id: fact.Id,
                    Kind: "task",
                    Title: fact.Title,
                    Subject: fact.Subject,
                    Status: fact.Status,
                    BlockedBy: Array.Empty<string>(),
                    Blocks: Array.Empty<string>(),
                    ParentTaskId: taskIdBySessionId.TryGetValue(fact.ParentSessionId, out var parentTaskId) ? parentTaskId : null,
                    SessionId: fact.SessionId,
                    AssignedAgent: fact.AssignedAgent,
                    Priority: "medium",
                    Tags: ["child-session"],
                    Result: fact.Result,
                    ErrorMessage: fact.ErrorMessage,
                    CreatedAt: fact.CreatedAt,
                    UpdatedAt: fact.UpdatedAt,
                    CompletedSubtaskCount: children.Count((child) => child.Status == "completed"),
                    Depth: ResolveDepth(fact),
                    EffectiveDeadline: fact.EffectiveDeadline,
                    ReadySubtaskCount: children.Count((child) => child.Status == "pending"),
                    SubtaskCount: children.Count,
                    TerminalReason: fact.TerminalReason,
                    UnmetDependencyCount: 0);
            })
            .ToArray();
    }

    private static string ResolveTaskStatus(string stateStatus, string? terminalReason, bool hasActiveContext, string? assistantStatus)
        => stateStatus switch
        {
            "running" => "running",
            "paused" => "blocked",
            "idle" when terminalReason == "timeout" => "failed",
            "idle" when terminalReason == "cancelled" => "cancelled",
            "idle" when assistantStatus == "error" => "failed",
            "idle" when hasActiveContext => "pending",
            _ => "completed",
        };

    private static string? ReadAgentId(string? requestDataJson)
    {
        if (string.IsNullOrWhiteSpace(requestDataJson))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(requestDataJson);
            return ReadString(document.RootElement, "agentId");
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? ReadString(JsonObject metadata, string propertyName)
        => metadata[propertyName] is JsonValue value && value.TryGetValue<string>(out var stringValue)
            ? stringValue
            : null;

    private static long? ReadInt64(JsonObject metadata, string propertyName)
        => metadata[propertyName] is JsonValue value && value.TryGetValue<long>(out var longValue)
            ? longValue
            : null;

    private static string? ReadString(JsonElement element, string propertyName)
        => element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;

    private static long ToUnixMilliseconds(DateTimeOffset value) => value.ToUnixTimeMilliseconds();
}

internal static class SessionResponseSupport
{
    internal static SessionSummaryResponse MapSummary(SessionRecord record, IReadOnlyList<string> workspaceRoots)
    {
        return new SessionSummaryResponse(
            Id: record.Id,
            StateStatus: record.StateStatus,
            MetadataJson: SessionMetadataSupport.SanitizePersistedMetadataJson(record.MetadataJson, workspaceRoots),
            Title: record.Title,
            CreatedAt: FormatTimestamp(record.CreatedAtUtc),
            UpdatedAt: FormatTimestamp(record.UpdatedAtUtc),
            FileChangesSummary: EmptyFileChangesSummary());
    }

    internal static SessionDetailResponse MapDetail(
        SessionRecord record,
        IReadOnlyList<string> workspaceRoots,
        IReadOnlyList<MessageWithPartsRecord> transcript,
        IReadOnlyList<SessionRunEventInfoRecord> runEvents)
    {
        return new SessionDetailResponse(
            Id: record.Id,
            StateStatus: record.StateStatus,
            MetadataJson: SessionMetadataSupport.SanitizePersistedMetadataJson(record.MetadataJson, workspaceRoots),
            Title: record.Title,
            CreatedAt: FormatTimestamp(record.CreatedAtUtc),
            UpdatedAt: FormatTimestamp(record.UpdatedAtUtc),
            Messages: MapTranscriptMessages(transcript),
            RunEvents: runEvents.Select(MapRunEvent).ToArray(),
            Todos: Array.Empty<object>(),
            FileChangesSummary: EmptyFileChangesSummary());
    }

    internal static SessionChildResponse MapChild(
        SessionRecord record,
        IReadOnlyList<string> workspaceRoots,
        IReadOnlyList<MessageWithPartsRecord> transcript)
    {
        return new SessionChildResponse(
            Id: record.Id,
            StateStatus: record.StateStatus,
            MetadataJson: SessionMetadataSupport.SanitizePersistedMetadataJson(record.MetadataJson, workspaceRoots),
            Title: record.Title,
            CreatedAt: FormatTimestamp(record.CreatedAtUtc),
            UpdatedAt: FormatTimestamp(record.UpdatedAtUtc),
            Messages: MapTranscriptMessages(transcript),
            RunEvents: Array.Empty<object>(),
            Todos: Array.Empty<object>());
    }

    internal static IReadOnlyList<object> MapTranscriptMessages(IReadOnlyList<MessageWithPartsRecord> transcript)
    {
        var assistantToolCallIds = CollectToolCallIdsByRole(transcript, "assistant");
        var authoritativeToolCallIds = CollectToolCallIdsByRole(transcript, "tool");
        return transcript
            .Select((message) => MapMessage(message, assistantToolCallIds, authoritativeToolCallIds))
            .Where((message) => ((IReadOnlyList<object>)message["content"]!).Count > 0)
            .Cast<object>()
            .ToArray();
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

    internal static string? ReadString(JsonElement element, string propertyName)
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
