using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class SessionRuntimeThreadStoreTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public SessionRuntimeThreadStoreTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task UpsertTouchClearAndFreshness_ShouldRoundTrip()
    {
        const string userId = "user-runtime-thread-roundtrip";
        const string sessionId = "session-runtime-thread-roundtrip";
        await SeedUserAndSessionAsync(userId, sessionId);

        await using var scope = _factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<ISessionRuntimeThreadStore>();

        await store.UpsertAsync(new SessionRuntimeThreadInfoRecord(
            sessionId,
            userId,
            "req-1",
            1_000,
            1_000,
            "2026-04-19 10:00:00",
            "2026-04-19 10:00:00"), CancellationToken.None);

        var fresh = await store.GetFreshAsync(sessionId, userId, 1_000 + SessionRuntimeThreadStore.StaleAfterMs - 1, CancellationToken.None);
        Assert.NotNull(fresh);
        Assert.Equal("req-1", fresh.ClientRequestId);
        Assert.True(await store.HasFreshAsync(sessionId, userId, 1_000 + SessionRuntimeThreadStore.StaleAfterMs - 1, CancellationToken.None));

        await store.TouchAsync(sessionId, userId, "req-1", 8_000, CancellationToken.None);
        var touched = await store.GetFreshAsync(sessionId, userId, 8_000 + SessionRuntimeThreadStore.StaleAfterMs - 1, CancellationToken.None);
        Assert.NotNull(touched);
        Assert.Equal(8_000, touched.HeartbeatAtMs);

        Assert.Null(await store.GetFreshAsync(sessionId, userId, 8_000 + SessionRuntimeThreadStore.StaleAfterMs + 1, CancellationToken.None));

        await store.UpsertAsync(new SessionRuntimeThreadInfoRecord(
            sessionId,
            userId,
            "req-2",
            9_000,
            9_000,
            "2026-04-19 10:00:09",
            "2026-04-19 10:00:09"), CancellationToken.None);
        var replaced = await store.GetFreshAsync(sessionId, userId, 9_000 + 1, CancellationToken.None);
        Assert.NotNull(replaced);
        Assert.Equal("req-2", replaced.ClientRequestId);

        await store.ClearAsync(sessionId, userId, "req-2", CancellationToken.None);
        Assert.False(await store.HasFreshAsync(sessionId, userId, 9_001, CancellationToken.None));
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
                Title = "Runtime Thread Session",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
        }

        await dbContext.SaveChangesAsync();
    }
}
