using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class AutoResumeStoreTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public AutoResumeStoreTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task TaskParentAutoResumeContextStore_ShouldUpsertConsumeAndClear()
    {
        const string userId = "user-auto-resume-context-store";
        const string parentSessionId = "session-auto-resume-parent";
        const string childSessionId = "session-auto-resume-child";
        await SeedUserAndSessionsAsync(userId, parentSessionId, childSessionId);

        await using var scope = _factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<ITaskParentAutoResumeContextStore>();

        await store.UpsertAsync(new TaskParentAutoResumeContextInfoRecord(
            childSessionId,
            parentSessionId,
            userId,
            "task-older",
            "{\"agentId\":\"explore\",\"clientRequestId\":\"req-old\",\"message\":\"继续主任务\"}",
            "2026-04-21 09:00:00",
            "2026-04-21 09:00:00"),
            CancellationToken.None);

        await store.UpsertAsync(new TaskParentAutoResumeContextInfoRecord(
            childSessionId,
            parentSessionId,
            userId,
            "task-newer",
            "{\"agentId\":\"sisyphus-junior\",\"clientRequestId\":\"req-new\",\"message\":\"继续主任务\",\"upstreamRetryMaxRetries\":2}",
            "2026-04-21 09:00:01",
            "2026-04-21 09:00:02"),
            CancellationToken.None);

        var consumed = await store.ConsumeAsync(childSessionId, parentSessionId, userId, CancellationToken.None);
        Assert.NotNull(consumed);
        Assert.Equal("task-newer", consumed.TaskId);
        Assert.Contains("sisyphus-junior", consumed.RequestDataJson, StringComparison.Ordinal);
        Assert.Contains("upstreamRetryMaxRetries", consumed.RequestDataJson, StringComparison.Ordinal);

        Assert.Null(await store.ConsumeAsync(childSessionId, parentSessionId, userId, CancellationToken.None));

        await store.UpsertAsync(new TaskParentAutoResumeContextInfoRecord(
            childSessionId,
            parentSessionId,
            userId,
            "task-clear",
            "{\"clientRequestId\":\"req-clear\"}",
            "2026-04-21 09:00:03",
            "2026-04-21 09:00:03"),
            CancellationToken.None);

        Assert.Null(await store.ConsumeAsync(childSessionId, "wrong-parent", userId, CancellationToken.None));
        var stillPresentAfterWrongParent = await store.ConsumeAsync(childSessionId, parentSessionId, userId, CancellationToken.None);
        Assert.NotNull(stillPresentAfterWrongParent);
        Assert.Equal("task-clear", stillPresentAfterWrongParent.TaskId);

        await store.UpsertAsync(new TaskParentAutoResumeContextInfoRecord(
            childSessionId,
            parentSessionId,
            userId,
            "task-clear-guarded",
            "{\"clientRequestId\":\"req-guarded\",\"agentId\":\"explore\"}",
            "2026-04-21 09:00:04",
            "2026-04-21 09:00:04"),
            CancellationToken.None);

        await store.ClearAsync(childSessionId, "wrong-user", CancellationToken.None);
        var stillPresentAfterWrongUserClear = await store.ConsumeAsync(childSessionId, parentSessionId, userId, CancellationToken.None);
        Assert.NotNull(stillPresentAfterWrongUserClear);
        Assert.Equal("task-clear-guarded", stillPresentAfterWrongUserClear.TaskId);

        await store.UpsertAsync(new TaskParentAutoResumeContextInfoRecord(
            childSessionId,
            parentSessionId,
            userId,
            "task-clear-final",
            "{\"clientRequestId\":\"req-final\"}",
            "2026-04-21 09:00:05",
            "2026-04-21 09:00:05"),
            CancellationToken.None);

        await store.ClearAsync(childSessionId, userId, CancellationToken.None);
        Assert.Null(await store.ConsumeAsync(childSessionId, parentSessionId, userId, CancellationToken.None));
    }

    [Fact]
    public async Task TaskParentAutoResumeContextStore_ShouldAllowOnlyOneConcurrentConsume()
    {
        const string userId = "user-auto-resume-context-race";
        const string parentSessionId = "session-auto-resume-parent-race";
        const string childSessionId = "session-auto-resume-child-race";
        await SeedUserAndSessionsAsync(userId, parentSessionId, childSessionId);

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<ITaskParentAutoResumeContextStore>();
            await store.UpsertAsync(new TaskParentAutoResumeContextInfoRecord(
                childSessionId,
                parentSessionId,
                userId,
                "task-race",
                "{\"clientRequestId\":\"req-race\"}",
                "2026-04-21 09:10:00",
                "2026-04-21 09:10:00"),
                CancellationToken.None);
        }

        await using var scope1 = _factory.Services.CreateAsyncScope();
        await using var scope2 = _factory.Services.CreateAsyncScope();
        var store1 = scope1.ServiceProvider.GetRequiredService<ITaskParentAutoResumeContextStore>();
        var store2 = scope2.ServiceProvider.GetRequiredService<ITaskParentAutoResumeContextStore>();

        var consumeTasks = await Task.WhenAll(
            store1.ConsumeAsync(childSessionId, parentSessionId, userId, CancellationToken.None),
            store2.ConsumeAsync(childSessionId, parentSessionId, userId, CancellationToken.None));

        Assert.Equal(1, consumeTasks.Count((item) => item is not null));
        Assert.Contains(consumeTasks, (item) => item?.TaskId == "task-race");

        await using var verificationScope = _factory.Services.CreateAsyncScope();
        var verificationStore = verificationScope.ServiceProvider.GetRequiredService<ITaskParentAutoResumeContextStore>();
        Assert.Null(await verificationStore.ConsumeAsync(childSessionId, parentSessionId, userId, CancellationToken.None));
    }

    [Fact]
    public async Task TaskParentAutoResumeContextStore_ShouldRotateVersionTokenAcrossSameSecondRetry()
    {
        const string userId = "user-auto-resume-context-version";
        const string parentSessionId = "session-auto-resume-parent-version";
        const string childSessionId = "session-auto-resume-child-version";
        await SeedUserAndSessionsAsync(userId, parentSessionId, childSessionId);

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<ITaskParentAutoResumeContextStore>();
            await store.UpsertAsync(new TaskParentAutoResumeContextInfoRecord(
                childSessionId,
                parentSessionId,
                userId,
                "task-old-version",
                "{\"clientRequestId\":\"req-old-version\"}",
                "2026-04-21 09:20:00",
                "2026-04-21 09:20:00"),
                CancellationToken.None);
        }

        string oldVersionToken;
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            oldVersionToken = await dbContext.TaskParentAutoResumeContexts
                .Where((item) => item.ChildSessionId == childSessionId)
                .Select((item) => item.VersionToken)
                .SingleAsync();
        }

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<ITaskParentAutoResumeContextStore>();
            await store.UpsertAsync(new TaskParentAutoResumeContextInfoRecord(
                childSessionId,
                parentSessionId,
                userId,
                "task-new-version",
                "{\"clientRequestId\":\"req-new-version\"}",
                "2026-04-21 09:20:00",
                "2026-04-21 09:20:00"),
                CancellationToken.None);
        }

        await using var verificationScope = _factory.Services.CreateAsyncScope();
        var verificationDbContext = verificationScope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var currentRecord = await verificationDbContext.TaskParentAutoResumeContexts.SingleAsync((item) => item.ChildSessionId == childSessionId);
        Assert.NotEqual(oldVersionToken, currentRecord.VersionToken);

        var staleDeleteCount = await verificationDbContext.TaskParentAutoResumeContexts
            .Where((item) => item.ChildSessionId == childSessionId && item.VersionToken == oldVersionToken)
            .ExecuteDeleteAsync();
        Assert.Equal(0, staleDeleteCount);

        var freshRecord = await verificationDbContext.TaskParentAutoResumeContexts.SingleAsync((item) => item.ChildSessionId == childSessionId);
        Assert.Equal("task-new-version", freshRecord.TaskId);
        Assert.Equal("{\"clientRequestId\":\"req-new-version\"}", freshRecord.RequestDataJson);
    }

    private async Task SeedUserAndSessionsAsync(string userId, string parentSessionId, string childSessionId)
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

        if (!await dbContext.Sessions.AnyAsync((session) => session.Id == parentSessionId))
        {
            dbContext.Sessions.Add(new SessionRecord
            {
                Id = parentSessionId,
                UserId = userId,
                MessagesJson = "[]",
                StateStatus = "idle",
                MetadataJson = "{}",
                Title = "Auto Resume Parent Session",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
        }

        if (!await dbContext.Sessions.AnyAsync((session) => session.Id == childSessionId))
        {
            dbContext.Sessions.Add(new SessionRecord
            {
                Id = childSessionId,
                UserId = userId,
                MessagesJson = "[]",
                StateStatus = "idle",
                MetadataJson = "{}",
                Title = "Auto Resume Child Session",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
        }

        await dbContext.SaveChangesAsync();
    }
}
