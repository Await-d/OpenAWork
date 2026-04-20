using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Application.Abstractions.Streaming;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class SessionStreamAttachTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public SessionStreamAttachTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task ActiveRoute_ShouldReturnFreshRequestSnapshotWithLatestSeq()
    {
        const string userId = "user-stream-active";
        const string sessionId = "session-stream-active";
        const string clientRequestId = "req-stream-active";
        await SeedUserAndSessionAsync(userId, sessionId);
        await UpsertRuntimeThreadAsync(sessionId, userId, clientRequestId, startedAtMs: 100, heartbeatAtMs: 220);
        await PersistRunEventAsync(sessionId, userId, clientRequestId, seq: 4, payloadJson: "{\"type\":\"thinking_delta\",\"delta\":\"恢复中\",\"occurredAt\":104}", occurredAtMs: 104, eventType: "thinking_delta");

        using var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthTestTokenFactory.Create(userId));
        var response = await client.GetAsync($"/sessions/{sessionId}/stream/active");

        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(clientRequestId, payload.GetProperty("active").GetProperty("clientRequestId").GetString());
        Assert.Equal(220, payload.GetProperty("active").GetProperty("heartbeatAtMs").GetInt64());
        Assert.Equal(4, payload.GetProperty("active").GetProperty("lastSeq").GetInt64());
    }

    [Fact]
    public async Task AttachRoute_ShouldReplayInactiveTerminalRequestAndEnd()
    {
        const string userId = "user-stream-attach-terminal";
        const string sessionId = "session-stream-attach-terminal";
        const string clientRequestId = "req-stream-attach-terminal";
        await SeedUserAndSessionAsync(userId, sessionId);
        await PersistRunEventAsync(sessionId, userId, clientRequestId, seq: 3, payloadJson: "{\"type\":\"text_delta\",\"delta\":\"已恢复\",\"eventId\":\"run-terminal:evt:3\",\"runId\":\"run-terminal\",\"occurredAt\":103}", occurredAtMs: 103, eventType: "text_delta");
        await PersistRunEventAsync(sessionId, userId, clientRequestId, seq: 4, payloadJson: "{\"type\":\"done\",\"stopReason\":\"end_turn\",\"eventId\":\"run-terminal:evt:4\",\"runId\":\"run-terminal\",\"occurredAt\":104}", occurredAtMs: 104, eventType: "done");

        using var client = _factory.CreateClient();
        var token = Uri.EscapeDataString(AuthTestTokenFactory.Create(userId));
        var response = await client.GetAsync($"/sessions/{sessionId}/stream/attach?token={token}&clientRequestId={clientRequestId}&afterSeq=2");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("retry: 1000", body, StringComparison.Ordinal);
        Assert.Contains("\"delta\":\"已恢复\"", body, StringComparison.Ordinal);
        Assert.Contains("\"stopReason\":\"end_turn\"", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AttachRoute_ShouldReturnConflictWhenRequestedRequestIsNoLongerActiveAndNotTerminal()
    {
        const string userId = "user-stream-attach-conflict";
        const string sessionId = "session-stream-attach-conflict";
        const string clientRequestId = "req-stream-attach-conflict";
        await SeedUserAndSessionAsync(userId, sessionId);
        await PersistRunEventAsync(sessionId, userId, clientRequestId, seq: 2, payloadJson: "{\"type\":\"thinking_delta\",\"delta\":\"还未完成\",\"occurredAt\":102}", occurredAtMs: 102, eventType: "thinking_delta");

        using var client = _factory.CreateClient();
        var token = Uri.EscapeDataString(AuthTestTokenFactory.Create(userId));
        var response = await client.GetAsync($"/sessions/{sessionId}/stream/attach?token={token}&clientRequestId={clientRequestId}&afterSeq=0");

        Assert.Equal(System.Net.HttpStatusCode.Conflict, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Requested stream is no longer active", payload.GetProperty("error").GetString());
        Assert.Equal(JsonValueKind.Null, payload.GetProperty("activeClientRequestId").ValueKind);
    }

    [Fact]
    public async Task AttachRoute_ShouldPreferLastEventIdOverAfterSeqQuery()
    {
        const string userId = "user-stream-attach-last-event-id";
        const string sessionId = "session-stream-attach-last-event-id";
        const string clientRequestId = "req-stream-attach-last-event-id";
        await SeedUserAndSessionAsync(userId, sessionId);
        await PersistRunEventAsync(sessionId, userId, clientRequestId, seq: 4, payloadJson: "{\"type\":\"text_delta\",\"delta\":\"旧事件\",\"eventId\":\"run-last-id:evt:4\",\"runId\":\"run-last-id\",\"occurredAt\":104}", occurredAtMs: 104, eventType: "text_delta");
        await PersistRunEventAsync(sessionId, userId, clientRequestId, seq: 5, payloadJson: "{\"type\":\"done\",\"stopReason\":\"end_turn\",\"eventId\":\"run-last-id:evt:5\",\"runId\":\"run-last-id\",\"occurredAt\":105}", occurredAtMs: 105, eventType: "done");

        using var client = _factory.CreateClient();
        var token = Uri.EscapeDataString(AuthTestTokenFactory.Create(userId));
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/sessions/{sessionId}/stream/attach?token={token}&clientRequestId={clientRequestId}&afterSeq=0");
        request.Headers.Add("Last-Event-ID", $"{clientRequestId}:4");
        var response = await client.SendAsync(request);

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("\"delta\":\"旧事件\"", body, StringComparison.Ordinal);
        Assert.Contains("id: req-stream-attach-last-event-id:5", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AttachRoute_ShouldReplayDurableEventsThenContinueWithLiveBroadcastsInSeqOrder()
    {
        const string userId = "user-stream-attach-live";
        const string sessionId = "session-stream-attach-live";
        const string clientRequestId = "req-stream-attach-live";
        await SeedUserAndSessionAsync(userId, sessionId);
        await UpsertRuntimeThreadAsync(sessionId, userId, clientRequestId, startedAtMs: 100, heartbeatAtMs: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        await PersistRunEventAsync(sessionId, userId, clientRequestId, seq: 4, payloadJson: "{\"type\":\"thinking_delta\",\"delta\":\"先恢复上下文\",\"eventId\":\"run-live:evt:4\",\"runId\":\"run-live\",\"occurredAt\":104}", occurredAtMs: 104, eventType: "thinking_delta");

        using var client = _factory.CreateClient();
        var token = Uri.EscapeDataString(AuthTestTokenFactory.Create(userId));
        var responseTask = client.GetAsync(
            $"/sessions/{sessionId}/stream/attach?token={token}&clientRequestId={clientRequestId}&afterSeq=3",
            HttpCompletionOption.ResponseContentRead);

        var publishTask = Task.Run(async () =>
        {
            for (var attempt = 0; attempt < 20 && !responseTask.IsCompleted; attempt += 1)
            {
                await Task.Delay(25);
                await BroadcastLiveRunEventAsync(sessionId, clientRequestId, seq: 5, payloadJson: "{\"type\":\"tool_result\",\"toolCallId\":\"call-live-1\",\"toolName\":\"write\",\"output\":{\"ok\":true},\"isError\":false,\"eventId\":\"run-live:evt:5\",\"runId\":\"run-live\",\"occurredAt\":105}");
                await BroadcastLiveRunEventAsync(sessionId, clientRequestId, seq: 6, payloadJson: "{\"type\":\"done\",\"stopReason\":\"end_turn\",\"eventId\":\"run-live:evt:6\",\"runId\":\"run-live\",\"occurredAt\":106}");
            }
        });

        var response = await responseTask;
        await publishTask;
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        var thinkingIndex = body.IndexOf("\"delta\":\"先恢复上下文\"", StringComparison.Ordinal);
        var toolResultIndex = body.IndexOf("\"toolCallId\":\"call-live-1\"", StringComparison.Ordinal);
        var doneIndex = body.IndexOf("\"stopReason\":\"end_turn\"", StringComparison.Ordinal);
        Assert.True(thinkingIndex >= 0);
        Assert.True(toolResultIndex > thinkingIndex);
        Assert.True(doneIndex > toolResultIndex);
    }

    private async Task BroadcastLiveRunEventAsync(string sessionId, string clientRequestId, long seq, string payloadJson)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var broadcaster = scope.ServiceProvider.GetRequiredService<ISessionRunEventBroadcaster>();
        using var document = JsonDocument.Parse(payloadJson);
        broadcaster.Publish(sessionId, document.RootElement, new SessionRunEventBroadcastRecord(clientRequestId, seq));
    }

    private async Task PersistRunEventAsync(string sessionId, string userId, string clientRequestId, long seq, string payloadJson, long occurredAtMs, string eventType)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
        await store.PersistAsync(new SessionRunEventInfoRecord(
            0,
            sessionId,
            userId,
            clientRequestId,
            seq,
            eventType,
            null,
            null,
            occurredAtMs,
            payloadJson,
            "2026-04-20 10:00:00"), CancellationToken.None);
    }

    private async Task UpsertRuntimeThreadAsync(string sessionId, string userId, string clientRequestId, long startedAtMs, long heartbeatAtMs)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<ISessionRuntimeThreadStore>();
        await store.UpsertAsync(
            new SessionRuntimeThreadInfoRecord(
                sessionId,
                userId,
                clientRequestId,
                startedAtMs,
                heartbeatAtMs,
                "2026-04-20 10:00:00",
                "2026-04-20 10:00:00"),
            CancellationToken.None);
    }

    private async Task SeedUserAndSessionAsync(string userId, string sessionId)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        if (!await dbContext.Users.AnyAsync((user) => user.Id == userId))
        {
            dbContext.Users.Add(new UserRecord
            {
                Id = userId,
                Email = $"{userId}@openawork.local",
                PasswordHash = "seed",
                CreatedAtUtc = DateTimeOffset.UtcNow,
            });
        }

        if (!await dbContext.Sessions.AnyAsync((session) => session.Id == sessionId))
        {
            dbContext.Sessions.Add(new SessionRecord
            {
                Id = sessionId,
                UserId = userId,
                MessagesJson = "[]",
                StateStatus = "idle",
                MetadataJson = "{}",
                Title = "Attach Runtime Session",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
        }

        await dbContext.SaveChangesAsync();
    }
}
