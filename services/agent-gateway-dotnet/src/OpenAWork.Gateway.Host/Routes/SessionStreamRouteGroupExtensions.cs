using System.IdentityModel.Tokens.Jwt;
using System.Net.WebSockets;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Application.Abstractions.Streaming;
using OpenAWork.Gateway.Application.Features.Stream;
using OpenAWork.Gateway.Infrastructure.Auth;
using OpenAWork.Gateway.Persistence.EFCore;

namespace OpenAWork.Gateway.Host.Routes;

public static class SessionStreamRouteGroupExtensions
{
    public static IEndpointRouteBuilder MapSessionStreamRoutes(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/sessions/{id}/stream/active", async Task<IResult> (
            string id,
            ICurrentUser currentUser,
            GatewayDbContext dbContext,
            ISessionRuntimeThreadStore sessionRuntimeThreadStore,
            ISessionRunEventStore sessionRunEventStore,
            CancellationToken cancellationToken) =>
        {
            if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId))
            {
                return Results.Json(new { error = "Unauthorized" }, statusCode: StatusCodes.Status401Unauthorized);
            }

            var exists = await dbContext.Sessions.AnyAsync((session) => session.Id == id && session.UserId == currentUser.UserId, cancellationToken);
            if (!exists)
            {
                return Results.Json(new { error = "Session not found" }, statusCode: StatusCodes.Status404NotFound);
            }

            var activeThread = await sessionRuntimeThreadStore.GetFreshAsync(
                id,
                currentUser.UserId,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                cancellationToken);
            if (activeThread is null)
            {
                return Results.Ok(new { active = (object?)null });
            }

            var lastSeq = await sessionRunEventStore.GetLatestSeqByRequestAsync(id, activeThread.ClientRequestId, cancellationToken);
            return Results.Ok(new
            {
                active = new
                {
                    clientRequestId = activeThread.ClientRequestId,
                    heartbeatAtMs = activeThread.HeartbeatAtMs,
                    lastSeq,
                    sessionId = activeThread.SessionId,
                    startedAtMs = activeThread.StartedAtMs,
                },
            });
        }).RequireAuthorization();

        endpoints.MapPost("/sessions/{id}/stream/stop", async Task<IResult> (
            string id,
            JsonElement body,
            ICurrentUser currentUser,
            GatewayDbContext dbContext,
            ISessionStreamRequestRegistry registry,
            CancellationToken cancellationToken) =>
        {
            if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId))
            {
                return Results.Json(new { error = "Unauthorized" }, statusCode: StatusCodes.Status401Unauthorized);
            }

            if (!body.TryGetProperty("clientRequestId", out var requestIdElement) || requestIdElement.ValueKind != JsonValueKind.String)
            {
                return Results.Json(new { error = "Invalid input" }, statusCode: StatusCodes.Status400BadRequest);
            }

            var requestId = requestIdElement.GetString()?.Trim();
            if (string.IsNullOrWhiteSpace(requestId) || requestId.Length > 128)
            {
                return Results.Json(new { error = "Invalid input" }, statusCode: StatusCodes.Status400BadRequest);
            }

            var exists = await dbContext.Sessions.AnyAsync((session) => session.Id == id && session.UserId == currentUser.UserId, cancellationToken);
            if (!exists)
            {
                return Results.Json(new { error = "Session not found" }, statusCode: StatusCodes.Status404NotFound);
            }

            var stopped = await registry.StopAsync(id, currentUser.UserId, requestId, cancellationToken);
            return Results.Ok(new { stopped });
        }).RequireAuthorization();

        endpoints.MapPost("/sessions/{id}/stream/stop-active", async Task<IResult> (
            string id,
            ICurrentUser currentUser,
            GatewayDbContext dbContext,
            ISessionStreamRequestRegistry registry,
            CancellationToken cancellationToken) =>
        {
            if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId))
            {
                return Results.Json(new { error = "Unauthorized" }, statusCode: StatusCodes.Status401Unauthorized);
            }

            var exists = await dbContext.Sessions.AnyAsync((session) => session.Id == id && session.UserId == currentUser.UserId, cancellationToken);
            if (!exists)
            {
                return Results.Json(new { error = "Session not found" }, statusCode: StatusCodes.Status404NotFound);
            }

            var stopped = await registry.StopAnyAsync(id, currentUser.UserId, cancellationToken);
            return Results.Ok(new { stopped });
        }).RequireAuthorization();

        endpoints.MapGet("/sessions/{id}/stream/attach", async (
            HttpContext context,
            string id,
            GatewayDbContext dbContext,
            ISessionRunEventStore sessionRunEventStore,
            ISessionRuntimeThreadStore sessionRuntimeThreadStore,
            ISessionRunEventBroadcaster sessionRunEventBroadcaster,
            IConfiguration configuration) =>
        {
            var query = TryParseAttachQuery(context.Request.Query, out var attachQuery, out var queryError);
            if (!query)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsJsonAsync(new { error = queryError ?? "Invalid query" }, context.RequestAborted);
                return;
            }

            var principal = ValidateQueryToken(attachQuery!.Token, configuration);
            if (principal is null)
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                await context.Response.WriteAsJsonAsync(new { error = "Unauthorized" }, context.RequestAborted);
                return;
            }

            var userId = principal.FindFirst("sub")?.Value ?? principal.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrWhiteSpace(userId))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                await context.Response.WriteAsJsonAsync(new { error = "Unauthorized" }, context.RequestAborted);
                return;
            }

            var exists = await dbContext.Sessions.AnyAsync((session) => session.Id == id && session.UserId == userId, context.RequestAborted);
            if (!exists)
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                await context.Response.WriteAsJsonAsync(new { error = "Session not found" }, context.RequestAborted);
                return;
            }

            var currentActiveThread = await sessionRuntimeThreadStore.GetFreshAsync(
                id,
                userId,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                context.RequestAborted);
            var requestedEvents = await sessionRunEventStore.ListByRequestAsync(id, attachQuery.ClientRequestId, context.RequestAborted);
            var latestRequestedBookend = requestedEvents.Count == 0
                ? null
                : ReadBookend(requestedEvents[^1].PayloadJson);
            var isRequestedRequestActive = string.Equals(currentActiveThread?.ClientRequestId, attachQuery.ClientRequestId, StringComparison.Ordinal);
            var canReplayRequestedRequestToTerminal = latestRequestedBookend?.Terminal == true;

            if (!isRequestedRequestActive && !canReplayRequestedRequestToTerminal)
            {
                context.Response.StatusCode = StatusCodes.Status409Conflict;
                await context.Response.WriteAsJsonAsync(new
                {
                    activeClientRequestId = currentActiveThread?.ClientRequestId,
                    error = "Requested stream is no longer active",
                }, context.RequestAborted);
                return;
            }

            var afterSeq = ParseSseCursorFromLastEventId(context.Request.Headers["Last-Event-ID"].ToString(), attachQuery.ClientRequestId) ?? attachQuery.AfterSeq;
            PrepareSseResponse(context.Response, context.Request.Headers["Origin"].ToString());
            await context.Response.WriteAsync("retry: 1000\n\n", context.RequestAborted);
            await context.Response.Body.FlushAsync(context.RequestAborted);

            if (!isRequestedRequestActive)
            {
                var replayEvents = await sessionRunEventStore.ListByRequestAfterSeqAsync(id, attachQuery.ClientRequestId, afterSeq, context.RequestAborted);
                foreach (var replayEvent in replayEvents)
                {
                    await WriteSseRunEnvelopeAsync(
                        context.Response,
                        attachQuery.ClientRequestId,
                        replayEvent.Event,
                        replayEvent.Seq,
                        context.RequestAborted);
                }

                return;
            }

            using var attachLifetime = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
            var stateLock = new object();
            var pendingEvents = new List<BufferedAttachEvent>();
            var availableEvents = CreateEventSignal();
            var lastDeliveredSeq = afterSeq;

            var unsubscribe = sessionRunEventBroadcaster.Subscribe(id, (eventPayload, meta) =>
            {
                if (!string.Equals(meta.ClientRequestId, attachQuery.ClientRequestId, StringComparison.Ordinal))
                {
                    return;
                }

                lock (stateLock)
                {
                    if (attachLifetime.IsCancellationRequested || meta.Seq <= lastDeliveredSeq)
                    {
                        return;
                    }

                    pendingEvents.Add(new BufferedAttachEvent(meta.Seq, eventPayload.Clone()));
                    availableEvents.TrySetResult(true);
                }
            });

            using var keepaliveTimer = new PeriodicTimer(TimeSpan.FromSeconds(10));
            var keepaliveTask = Task.Run(async () =>
            {
                try
                {
                    while (await keepaliveTimer.WaitForNextTickAsync(attachLifetime.Token).ConfigureAwait(false))
                    {
                        await context.Response.WriteAsync(": keepalive\n\n", attachLifetime.Token);
                        await context.Response.Body.FlushAsync(attachLifetime.Token);
                    }
                }
                catch (OperationCanceledException) when (attachLifetime.IsCancellationRequested)
                {
                    // Expected during normal attach shutdown.
                }
            }, attachLifetime.Token);

            try
            {
                var replayEvents = await sessionRunEventStore.ListByRequestAfterSeqAsync(id, attachQuery.ClientRequestId, afterSeq, context.RequestAborted);
                lock (stateLock)
                {
                    foreach (var replayEvent in replayEvents)
                    {
                        if (replayEvent.Seq > lastDeliveredSeq)
                        {
                            pendingEvents.Add(new BufferedAttachEvent(replayEvent.Seq, replayEvent.Event.Clone()));
                        }
                    }

                    availableEvents.TrySetResult(true);
                }

                while (!attachLifetime.IsCancellationRequested)
                {
                    var nextEvent = await WaitForNextAttachEventAsync(stateLock, pendingEvents, attachLifetime.Token, (nextSignal) => availableEvents = nextSignal, lastDeliveredSeq);
                    if (nextEvent is null)
                    {
                        break;
                    }

                    lock (stateLock)
                    {
                        lastDeliveredSeq = nextEvent.Seq;
                    }

                    await WriteSseRunEnvelopeAsync(
                        context.Response,
                        attachQuery.ClientRequestId,
                        nextEvent.Event,
                        nextEvent.Seq,
                        attachLifetime.Token);

                    if (SessionRunEventEnvelopeSupport.DeriveBookend(nextEvent.Event)?.Terminal == true)
                    {
                        attachLifetime.Cancel();
                        break;
                    }
                }
            }
            catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
            {
                // Client disconnected; nothing else to do.
            }
            finally
            {
                attachLifetime.Cancel();
                unsubscribe();

                lock (stateLock)
                {
                    availableEvents.TrySetResult(false);
                }

                try
                {
                    await keepaliveTask.ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (attachLifetime.IsCancellationRequested)
                {
                    // Expected during normal attach shutdown.
                }
            }
        });

        endpoints.MapGet("/sessions/{id}/stream", async (HttpContext context, string id, GatewayDbContext dbContext, IServiceScopeFactory scopeFactory, IConfiguration configuration) =>
        {
            if (!context.WebSockets.IsWebSocketRequest)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsync("WebSocket upgrade required.", context.RequestAborted);
                return;
            }

            var token = context.Request.Query["token"].ToString();
            var principal = ValidateQueryToken(token, configuration);
            if (principal is null)
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }

            var userId = principal.FindFirst("sub")?.Value ?? principal.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrWhiteSpace(userId))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }

            var exists = await dbContext.Sessions.AnyAsync((session) => session.Id == id && session.UserId == userId, context.RequestAborted);
            if (!exists)
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }

            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            var sendLock = new SemaphoreSlim(1, 1);
            var backgroundTasks = new List<Task>();
            while (!context.RequestAborted.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                var raw = await ReceiveTextMessageAsync(socket, context.RequestAborted);
                if (raw is null)
                {
                    break;
                }

                if (!TryParseRequest(raw, id, userId, out var request, out var errorPayload))
                {
                    await SendJsonAsync(socket, errorPayload!, sendLock, context.RequestAborted);
                    continue;
                }

                backgroundTasks.Add(Task.Run(async () =>
                {
                    await using var scope = scopeFactory.CreateAsyncScope();
                    var runtimeService = scope.ServiceProvider.GetRequiredService<ISessionStreamRuntimeService>();
                    await runtimeService.HandleAsync(
                        request!,
                        (payload) => SendJsonAsync(socket, payload, sendLock, context.RequestAborted),
                        context.RequestAborted);
                }, context.RequestAborted));
            }

            if (backgroundTasks.Count > 0)
            {
                await Task.WhenAll(backgroundTasks);
            }

            if (socket.State == WebSocketState.Open)
            {
                await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "stream-complete", context.RequestAborted);
            }
        });

        return endpoints;
    }

    private static ClaimsPrincipal? ValidateQueryToken(string? token, IConfiguration configuration)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return null;
        }

        var parameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtConfiguration.ResolveJwtSecret(configuration))),
            ValidIssuer = JwtConfiguration.ResolveJwtIssuer(configuration),
            ValidAudience = JwtConfiguration.ResolveJwtAudience(configuration),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.Zero,
        };

        try
        {
            return new JwtSecurityTokenHandler().ValidateToken(token, parameters, out _);
        }
        catch
        {
            return null;
        }
    }

    private static async Task<string?> ReceiveTextMessageAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = new byte[16 * 1024];
        using var stream = new MemoryStream();

        while (true)
        {
            var result = await socket.ReceiveAsync(buffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                return null;
            }

            stream.Write(buffer, 0, result.Count);
            if (result.EndOfMessage)
            {
                break;
            }
        }

        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static bool TryParseRequest(string raw, string sessionId, string userId, out SessionStreamRuntimeRequest? request, out object? errorPayload)
    {
        request = null;
        errorPayload = null;

        try
        {
            using var document = JsonDocument.Parse(raw);
            var root = document.RootElement;
            if (!root.TryGetProperty("message", out var messageElement) || messageElement.ValueKind != JsonValueKind.String)
            {
                errorPayload = new { type = "error", code = "INVALID_REQUEST", message = "Invalid request" };
                return false;
            }

            if (!root.TryGetProperty("clientRequestId", out var requestIdElement) || requestIdElement.ValueKind != JsonValueKind.String)
            {
                errorPayload = new { type = "error", code = "INVALID_REQUEST", message = "Invalid request" };
                return false;
            }

            var message = messageElement.GetString();
            var clientRequestId = requestIdElement.GetString();
            var trimmedDisplayMessage = root.TryGetProperty("displayMessage", out var displayMessage)
                && displayMessage.ValueKind == JsonValueKind.String
                ? displayMessage.GetString()
                : null;
            var trimmedAgentId = root.TryGetProperty("agentId", out var agentId)
                && agentId.ValueKind == JsonValueKind.String
                ? agentId.GetString()?.Trim()
                : null;
            var trimmedProviderId = root.TryGetProperty("providerId", out var providerId)
                && providerId.ValueKind == JsonValueKind.String
                ? providerId.GetString()?.Trim()
                : null;
            var trimmedModel = root.TryGetProperty("model", out var model)
                && model.ValueKind == JsonValueKind.String
                ? model.GetString()?.Trim()
                : null;

            if (string.IsNullOrWhiteSpace(message)
                || string.IsNullOrWhiteSpace(clientRequestId)
                || message.Length > 32768
                || clientRequestId.Length > 128
                || (trimmedAgentId is not null && trimmedAgentId.Length > 120)
                || (trimmedProviderId is not null && trimmedProviderId.Length > 120)
                || (trimmedModel is not null && trimmedModel.Length > 200))
            {
                errorPayload = new { type = "error", code = "INVALID_REQUEST", message = "Invalid request" };
                return false;
            }

            request = new SessionStreamRuntimeRequest(
                sessionId,
                userId,
                clientRequestId,
                message,
                trimmedDisplayMessage,
                trimmedAgentId,
                trimmedProviderId,
                trimmedModel,
                root.TryGetProperty("thinkingEnabled", out var thinkingEnabled) && thinkingEnabled.ValueKind is JsonValueKind.True or JsonValueKind.False ? thinkingEnabled.GetBoolean() : null,
                root.TryGetProperty("webSearchEnabled", out var webSearchEnabled) && webSearchEnabled.ValueKind is JsonValueKind.True or JsonValueKind.False ? webSearchEnabled.GetBoolean() : null,
                null);
            return true;
        }
        catch (JsonException)
        {
            errorPayload = new { type = "error", code = "INVALID_JSON", message = "Invalid JSON" };
            return false;
        }
    }

    private static async ValueTask SendJsonAsync(WebSocket socket, object payload, SemaphoreSlim sendLock, CancellationToken cancellationToken)
    {
        await sendLock.WaitAsync(cancellationToken);
        try
        {
            if (socket.State == WebSocketState.Open)
            {
                await socket.SendAsync(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload)), WebSocketMessageType.Text, true, cancellationToken);
            }
        }
        finally
        {
            sendLock.Release();
        }
    }

    private static bool TryParseAttachQuery(IQueryCollection query, out SessionStreamAttachQuery? attachQuery, out string? error)
    {
        attachQuery = null;
        error = null;

        var token = query["token"].ToString().Trim();
        var clientRequestId = query["clientRequestId"].ToString().Trim();
        var afterSeqRaw = query["afterSeq"].ToString();
        if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(clientRequestId) || clientRequestId.Length > 128)
        {
            error = "Invalid query";
            return false;
        }

        long afterSeq = 0;
        if (!string.IsNullOrWhiteSpace(afterSeqRaw) && (!long.TryParse(afterSeqRaw, out afterSeq) || afterSeq < 0))
        {
            error = "Invalid query";
            return false;
        }

        attachQuery = new SessionStreamAttachQuery(token, clientRequestId, afterSeq);
        return true;
    }

    private static SessionRunEventBookendDescriptor? ReadBookend(string payloadJson)
    {
        using var document = JsonDocument.Parse(payloadJson);
        return SessionRunEventEnvelopeSupport.DeriveBookend(document.RootElement);
    }

    private static long? ParseSseCursorFromLastEventId(string? lastEventId, string clientRequestId)
    {
        if (string.IsNullOrWhiteSpace(lastEventId))
        {
            return null;
        }

        var separatorIndex = lastEventId.LastIndexOf(':');
        if (separatorIndex < 0)
        {
            return null;
        }

        var rawRequestId = lastEventId[..separatorIndex];
        var rawSeq = lastEventId[(separatorIndex + 1)..];
        return string.Equals(rawRequestId, clientRequestId, StringComparison.Ordinal) && long.TryParse(rawSeq, out var parsedSeq) && parsedSeq >= 0
            ? parsedSeq
            : null;
    }

    private static void PrepareSseResponse(HttpResponse response, string? origin)
    {
        response.StatusCode = StatusCodes.Status200OK;
        response.ContentType = "text/event-stream";
        response.Headers["Cache-Control"] = "no-cache";
        response.Headers["Connection"] = "keep-alive";
        response.Headers.Append("X-Accel-Buffering", "no");
        response.Headers.Append("Access-Control-Allow-Origin", string.IsNullOrWhiteSpace(origin) ? "*" : origin);
        response.Headers.Append("Access-Control-Allow-Credentials", "true");
        response.Headers.Append("Vary", "Origin");
    }

    private static async Task WriteSseRunEnvelopeAsync(HttpResponse response, string clientRequestId, JsonElement eventPayload, long seq, CancellationToken cancellationToken)
    {
        var envelope = SessionRunEventEnvelopeSupport.BuildAttachEnvelope(clientRequestId, eventPayload, seq);
        await response.WriteAsync($"id: {clientRequestId}:{seq}\n", cancellationToken);
        await response.WriteAsync($"data: {JsonSerializer.Serialize(envelope)}\n\n", cancellationToken);
        await response.Body.FlushAsync(cancellationToken);
    }

    private static TaskCompletionSource<bool> CreateEventSignal()
        => new(TaskCreationOptions.RunContinuationsAsynchronously);

    private static async Task<BufferedAttachEvent?> WaitForNextAttachEventAsync(
        object stateLock,
        List<BufferedAttachEvent> pendingEvents,
        CancellationToken cancellationToken,
        Action<TaskCompletionSource<bool>> replaceSignal,
        long lastDeliveredSeq)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            Task waitTask;
            lock (stateLock)
            {
                pendingEvents.RemoveAll((item) => item.Seq <= lastDeliveredSeq);
                if (pendingEvents.Count > 0)
                {
                    var nextIndex = 0;
                    for (var index = 1; index < pendingEvents.Count; index += 1)
                    {
                        if (pendingEvents[index].Seq < pendingEvents[nextIndex].Seq)
                        {
                            nextIndex = index;
                        }
                    }

                    var nextEvent = pendingEvents[nextIndex];
                    pendingEvents.RemoveAt(nextIndex);
                    return nextEvent;
                }

                var nextSignal = CreateEventSignal();
                replaceSignal(nextSignal);
                waitTask = nextSignal.Task;
            }

            await waitTask.WaitAsync(cancellationToken);
        }

        return null;
    }

    private sealed record SessionStreamAttachQuery(
        string Token,
        string ClientRequestId,
        long AfterSeq);

    private sealed record BufferedAttachEvent(long Seq, JsonElement Event);
}
