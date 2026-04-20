using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class SessionRunEventStoreTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public SessionRunEventStoreTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task PersistAndQuery_ShouldRoundTripRequestScopedEvents()
    {
        const string userId = "user-run-events-roundtrip";
        const string sessionId = "session-run-events-roundtrip";
        await SeedUserAndSessionAsync(userId, sessionId);

        await using var scope = _factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();

        await store.PersistAsync(new SessionRunEventInfoRecord(0, sessionId, userId, "req-1", null, "tool_start", "evt-1", "run-1", 1000, "{\"type\":\"tool_start\"}", "2026-04-19 10:00:00"), CancellationToken.None);
        await store.PersistAsync(new SessionRunEventInfoRecord(0, sessionId, userId, "req-1", null, "tool_result", "evt-2", "run-1", 1001, "{\"type\":\"tool_result\"}", "2026-04-19 10:00:01"), CancellationToken.None);
        await store.PersistAsync(new SessionRunEventInfoRecord(0, sessionId, userId, "req-2", null, "tool_start", "evt-3", "run-2", 1002, "{\"type\":\"tool_start\"}", "2026-04-19 10:00:02"), CancellationToken.None);

        var all = await store.ListForSessionAsync(sessionId, CancellationToken.None);
        var req1 = await store.ListByRequestAsync(sessionId, "req-1", CancellationToken.None);
        var afterSeq = await store.ListByRequestAfterSeqAsync(sessionId, "req-1", 1, CancellationToken.None);
        var latestSeq = await store.GetLatestSeqByRequestAsync(sessionId, "req-1", CancellationToken.None);

        Assert.Equal(new[] { "tool_start", "tool_result", "tool_start" }, all.Select((item) => item.EventType));
        Assert.Equal(new long?[] { 1, 2 }, req1.Select((item) => item.Seq));
        Assert.Equal(new long[] { 2 }, afterSeq.Select((item) => item.Seq));
        Assert.Equal("tool_result", afterSeq[0].Event.GetProperty("type").GetString());
        Assert.Equal(2, latestSeq);

        await store.DeleteByRequestAsync(sessionId, "req-1", CancellationToken.None);
        var remaining = await store.ListForSessionAsync(sessionId, CancellationToken.None);
        Assert.Equal(new[] { "req-2" }, remaining.Select((item) => item.ClientRequestId));
    }

    [Fact]
    public async Task Persist_ShouldMirrorDisplayableRunEventsIntoAssistantEventMessages()
    {
        const string userId = "user-run-events-mirror";
        const string sessionId = "session-run-events-mirror";
        await SeedUserAndSessionAsync(userId, sessionId);

        await using var scope = _factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
        var messageStore = scope.ServiceProvider.GetRequiredService<IMessageV2Store>();

        await store.PersistAsync(new SessionRunEventInfoRecord(
            0,
            sessionId,
            userId,
            "req-compact",
            2,
            "compaction",
            "evt-compact-1",
            "run-compact-1",
            123,
            "{\"type\":\"compaction\",\"summary\":\"自动压缩完成\",\"trigger\":\"automatic\",\"phase\":\"completed\",\"strategy\":\"summary_only\",\"eventId\":\"evt-compact-1\",\"runId\":\"run-compact-1\",\"occurredAt\":123}",
            "2026-04-19 10:00:00"),
            CancellationToken.None);

        var mirrored = await messageStore.GetMessageByRequestIdAsync(sessionId, userId, "assistant_event:evt-compact-1", "assistant", CancellationToken.None);
        Assert.NotNull(mirrored);
        var messagesWithParts = await messageStore.ListMessagesWithPartsAsync(sessionId, userId, 100, CancellationToken.None);
        var mirroredMessage = messagesWithParts.Single((item) => item.Message.ClientRequestId == "assistant_event:evt-compact-1");
        Assert.Single(mirroredMessage.Parts);
        Assert.Contains("\"type\":\"assistant_event\"", mirroredMessage.Parts[0].DataJson);
        Assert.Contains("\"title\":\"会话已压缩\"", mirroredMessage.Parts[0].DataJson);
    }

    [Fact]
    public async Task Persist_ShouldNotMirrorNonDisplayablePermissionEvents()
    {
        const string userId = "user-run-events-no-mirror";
        const string sessionId = "session-run-events-no-mirror";
        await SeedUserAndSessionAsync(userId, sessionId);

        await using var scope = _factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
        var messageStore = scope.ServiceProvider.GetRequiredService<IMessageV2Store>();

        await store.PersistAsync(new SessionRunEventInfoRecord(
            0,
            sessionId,
            userId,
            "req-permission",
            1,
            "permission_asked",
            "evt-permission-1",
            null,
            456,
            "{\"type\":\"permission_asked\",\"requestId\":\"perm-1\",\"toolName\":\"bash\",\"scope\":\"workspace\",\"reason\":\"需要运行命令\",\"riskLevel\":\"medium\"}",
            "2026-04-19 10:00:01"),
            CancellationToken.None);

        var mirrored = await messageStore.GetMessageByRequestIdAsync(sessionId, userId, "assistant_event:evt-permission-1", "assistant", CancellationToken.None);
        Assert.Null(mirrored);
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
                Title = "Run Events Session",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
        }

        await dbContext.SaveChangesAsync();
    }
}
