using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Application.Abstractions.Persistence;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class SyncEventStoreTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public SyncEventStoreTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task AppendAndReplay_ShouldAllocatePerAggregateSequencesInOrder()
    {
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<ISyncEventStore>();

            Assert.Equal(1, await store.PeekNextSequenceAsync("session-1", CancellationToken.None));

            var appended1 = await store.AppendEventAsync(new AppendSyncEventRecord(
                "evt-1",
                "session-1",
                "session.created",
                1,
                "{\"sessionID\":\"session-1\"}",
                1000), CancellationToken.None);
            var appended2 = await store.AppendEventAsync(new AppendSyncEventRecord(
                "evt-2",
                "session-1",
                "message.created",
                1,
                "{\"sessionID\":\"session-1\",\"messageID\":\"msg-1\"}",
                1001), CancellationToken.None);
            var otherAggregate = await store.AppendEventAsync(new AppendSyncEventRecord(
                "evt-3",
                "session-2",
                "session.created",
                1,
                "{\"sessionID\":\"session-2\"}",
                1002), CancellationToken.None);

            Assert.Equal(1, appended1.Seq);
            Assert.Equal(2, appended2.Seq);
            Assert.Equal(1, otherAggregate.Seq);
            Assert.Equal(3, await store.PeekNextSequenceAsync("session-1", CancellationToken.None));
        }

        await using var readScope = _factory.Services.CreateAsyncScope();
        var readStore = readScope.ServiceProvider.GetRequiredService<ISyncEventStore>();
        var replay = await readStore.ReplayEventsForAggregateAsync("session-1", CancellationToken.None);
        Assert.Equal(new[] { "evt-1", "evt-2" }, replay.Select((item) => item.Id));
        Assert.Equal(new long[] { 1, 2 }, replay.Select((item) => item.Seq));
        Assert.Equal(new[] { "session.created", "message.created" }, replay.Select((item) => item.Type));
        Assert.Equal(new[] { 1, 1 }, replay.Select((item) => item.Version));
        Assert.Equal(new[] { 1000L, 1001L }, replay.Select((item) => item.Timestamp));
        Assert.Equal(
            new[]
            {
                "{\"sessionID\":\"session-1\"}",
                "{\"sessionID\":\"session-1\",\"messageID\":\"msg-1\"}",
            },
            replay.Select((item) => item.DataJson));
    }

    [Fact]
    public async Task AppendEvent_ShouldTreatDuplicateEventIdAsNoOp()
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<ISyncEventStore>();

        var first = await store.AppendEventAsync(new AppendSyncEventRecord(
            "evt-dup-1",
            "session-dup",
            "session.created",
            1,
            "{\"sessionID\":\"session-dup\"}",
            2000), CancellationToken.None);
        var duplicate = await store.AppendEventAsync(new AppendSyncEventRecord(
            "evt-dup-1",
            "session-dup",
            "session.created",
            1,
            "{\"sessionID\":\"session-dup\"}",
            2000), CancellationToken.None);
        var next = await store.AppendEventAsync(new AppendSyncEventRecord(
            "evt-dup-2",
            "session-dup",
            "session.updated",
            1,
            "{\"sessionID\":\"session-dup\"}",
            2001), CancellationToken.None);

        Assert.True(first.Persisted);
        Assert.False(duplicate.Persisted);
        Assert.Equal(first.Seq, duplicate.Seq);
        Assert.Equal(2, next.Seq);

        var replay = await store.ReplayEventsForAggregateAsync("session-dup", CancellationToken.None);
        Assert.Equal(2, replay.Count);
        Assert.Equal(new[] { "evt-dup-1", "evt-dup-2" }, replay.Select((eventRow) => eventRow.Id));
    }
}
