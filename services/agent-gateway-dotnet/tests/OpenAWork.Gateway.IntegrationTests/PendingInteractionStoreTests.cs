using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class PendingInteractionStoreTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public PendingInteractionStoreTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task PermissionRequestStore_ShouldRoundTripPendingLookupAndExpiry()
    {
        const string userId = "user-permission-request-store";
        const string sessionId = "session-permission-request-store";
        await SeedUserAndSessionAsync(userId, sessionId);

        await using var scope = _factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();

        await store.InsertAsync(new PermissionRequestInfoRecord(
            "perm-older",
            sessionId,
            "bash",
            "/repo",
            "need shell",
            "high",
            null,
            "pending",
            null,
            "{\"clientRequestId\":\"req-old\"}",
            2_000,
            "[\"*\"]",
            "2026-04-20 10:00:00",
            "2026-04-20 10:00:00"),
            CancellationToken.None);
        await store.InsertAsync(new PermissionRequestInfoRecord(
            "perm-newer",
            sessionId,
            "bash",
            "/repo",
            "need shell again",
            "medium",
            "pwd",
            "pending",
            null,
            null,
            6_000,
            "[\"src/**\"]",
            "2026-04-20 10:05:00",
            "2026-04-20 10:05:00"),
            CancellationToken.None);

        var fetched = await store.GetAsync(sessionId, "perm-older", CancellationToken.None);
        var pending = await store.ListPendingAsync(sessionId, CancellationToken.None);
        var latestPendingId = await store.FindLatestPendingIdAsync(sessionId, "bash", "/repo", CancellationToken.None);

        Assert.NotNull(fetched);
        Assert.Equal("high", fetched.RiskLevel);
        Assert.Equal(2_000, fetched.ExpiresAtMs);
        Assert.Equal("[\"*\"]", fetched.AlwaysJson);
        Assert.Equal(new[] { "perm-older", "perm-newer" }, pending.Select((item) => item.Id));
        Assert.Equal("perm-newer", latestPendingId);

        var payloadUpdated = await store.UpdatePendingPayloadAsync(
            "perm-newer",
            "{\"clientRequestId\":\"req-new\",\"toolCallId\":\"call-1\"}",
            "2026-04-20 10:06:00",
            CancellationToken.None);
        var resolved = await store.UpdateResolutionAsync(
            sessionId,
            "perm-newer",
            "approved",
            "once",
            "2026-04-20 10:07:00",
            CancellationToken.None);
        var consumed = await store.MarkConsumedAsync(
            "perm-newer",
            "2026-04-20 10:08:00",
            CancellationToken.None);
        var expired = await store.ExpirePendingAsync(
            sessionId,
            2_500,
            "2026-04-20 10:09:00",
            CancellationToken.None);

        Assert.True(payloadUpdated);
        Assert.True(resolved);
        Assert.True(consumed);
        Assert.Equal(new[] { "perm-older" }, expired.Select((item) => item.Id));
        Assert.All(expired, (item) =>
        {
            Assert.Equal("rejected", item.Status);
            Assert.Equal("reject", item.Decision);
        });

        var afterExpire = await store.GetAsync(sessionId, "perm-newer", CancellationToken.None);
        Assert.NotNull(afterExpire);
        Assert.Equal("consumed", afterExpire.Status);
        Assert.Equal("once", afterExpire.Decision);
        Assert.Contains("call-1", afterExpire.RequestPayloadJson);

        Assert.False(await store.UpdatePendingPayloadAsync(
            "perm-newer",
            "{\"clientRequestId\":\"should-fail\"}",
            "2026-04-20 10:10:00",
            CancellationToken.None));
        Assert.False(await store.UpdateResolutionAsync(
            sessionId,
            "perm-newer",
            "approved",
            "session",
            "2026-04-20 10:11:00",
            CancellationToken.None));
        Assert.Null(await store.FindLatestPendingIdAsync(sessionId, "bash", "/repo", CancellationToken.None));
    }

    [Fact]
    public async Task QuestionRequestStore_ShouldRoundTripPendingResolutionAndExpiry()
    {
        const string userId = "user-question-request-store";
        const string sessionId = "session-question-request-store";
        await SeedUserAndSessionAsync(userId, sessionId);

        await using var scope = _factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IQuestionRequestStore>();

        await store.InsertAsync(new QuestionRequestInfoRecord(
            "question-older",
            sessionId,
            userId,
            "question",
            "Need input",
            "[{\"question\":\"继续吗\",\"header\":\"确认\",\"multiple\":false,\"options\":[{\"label\":\"继续\",\"description\":\"继续\"}]}]",
            null,
            "{\"clientRequestId\":\"question-old\"}",
            2_000,
            "pending",
            "2026-04-20 11:00:00",
            "2026-04-20 11:00:00"),
            CancellationToken.None);
        await store.InsertAsync(new QuestionRequestInfoRecord(
            "question-newer",
            sessionId,
            userId,
            "ExitPlanMode",
            "Exit plan mode",
            "[{\"question\":\"批准计划吗\",\"header\":\"Plan approval\",\"multiple\":false,\"options\":[{\"label\":\"Start implementation\",\"description\":\"Approve\"}]}]",
            null,
            null,
            8_000,
            "pending",
            "2026-04-20 11:05:00",
            "2026-04-20 11:05:00"),
            CancellationToken.None);

        var fetched = await store.GetAsync(sessionId, "question-newer", CancellationToken.None);
        var pending = await store.ListPendingAsync(sessionId, CancellationToken.None);
        var latestPendingId = await store.FindLatestPendingIdAsync(sessionId, "Exit plan mode", CancellationToken.None);

        Assert.NotNull(fetched);
        Assert.Equal(userId, fetched.UserId);
        Assert.Equal(8_000, (await store.GetAsync(sessionId, "question-newer", CancellationToken.None))?.ExpiresAtMs);
        Assert.Equal(new[] { "question-older", "question-newer" }, pending.Select((item) => item.Id));
        Assert.Equal("question-newer", latestPendingId);

        var payloadUpdated = await store.UpdatePendingPayloadAsync(
            "question-newer",
            "{\"clientRequestId\":\"question-new\",\"toolCallId\":\"question-tool\"}",
            "2026-04-20 11:06:00",
            CancellationToken.None);
        var answered = await store.UpdateResolutionAsync(
            sessionId,
            "question-newer",
            "answered",
            "[[\"Start implementation\"]]",
            "2026-04-20 11:07:00",
            CancellationToken.None);
        var expired = await store.ExpirePendingAsync(
            sessionId,
            2_500,
            "2026-04-20 11:08:00",
            CancellationToken.None);

        Assert.True(payloadUpdated);
        Assert.True(answered);
        Assert.Equal(new[] { "question-older" }, expired.Select((item) => item.Id));
        Assert.All(expired, (item) =>
        {
            Assert.Equal("dismissed", item.Status);
            Assert.Null(item.AnswerJson);
        });

        var answeredRecord = await store.GetAsync(sessionId, "question-newer", CancellationToken.None);
        Assert.NotNull(answeredRecord);
        Assert.Equal("answered", answeredRecord.Status);
        Assert.Equal("[[\"Start implementation\"]]", answeredRecord.AnswerJson);
        Assert.Contains("question-tool", answeredRecord.RequestPayloadJson);

        Assert.False(await store.UpdatePendingPayloadAsync(
            "question-newer",
            "{\"clientRequestId\":\"should-fail\"}",
            "2026-04-20 11:09:00",
            CancellationToken.None));
        Assert.False(await store.UpdateResolutionAsync(
            sessionId,
            "question-newer",
            "dismissed",
            null,
            "2026-04-20 11:10:00",
            CancellationToken.None));
        Assert.Null(await store.FindLatestPendingIdAsync(sessionId, "Exit plan mode", CancellationToken.None));
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
                Title = "Pending Interaction Session",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
        }

        await dbContext.SaveChangesAsync();
    }
}
