using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class MessageV2StoreTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public MessageV2StoreTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task MessageAndPartCrud_ShouldRoundTripAndAggregateByMessage()
    {
        const string userId = "user-messagev2-roundtrip";
        const string sessionId = "session-messagev2-roundtrip";
        await SeedUserAndSessionAsync(userId, sessionId);

        await using var scope = _factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IMessageV2Store>();

        var message1 = new MessageV2InfoRecord(
            "msg-1",
            sessionId,
            userId,
            1000,
            "{\"role\":\"user\",\"time\":{\"created\":1000}}",
            "2026-04-19 10:00:00",
            "2026-04-19 10:00:00");
        var message2 = new MessageV2InfoRecord(
            "msg-2",
            sessionId,
            userId,
            2000,
            "{\"role\":\"assistant\",\"time\":{\"created\":2000},\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}",
            "2026-04-19 10:01:00",
            "2026-04-19 10:01:00");
        await store.InsertMessageAsync(message1, CancellationToken.None);
        await store.InsertMessageAsync(message2, CancellationToken.None);

        await store.InsertPartAsync(new PartV2InfoRecord(
            "part-1",
            "msg-2",
            sessionId,
            userId,
            2100,
            "{\"type\":\"text\",\"text\":\"Hello\"}",
            "2026-04-19 10:01:01",
            "2026-04-19 10:01:01"), CancellationToken.None);
        await store.InsertPartAsync(new PartV2InfoRecord(
            "part-2",
            "msg-2",
            sessionId,
            userId,
            2200,
            "{\"type\":\"tool\",\"tool\":\"write\",\"callID\":\"call-1\",\"state\":{\"status\":\"pending\",\"input\":{},\"raw\":\"{}\"}}",
            "2026-04-19 10:01:02",
            "2026-04-19 10:01:02"), CancellationToken.None);

        var listedMessages = await store.ListMessagesAsync(sessionId, userId, afterTime: null, limit: 100, CancellationToken.None);
        Assert.Equal(new[] { "msg-1", "msg-2" }, listedMessages.Select((message) => message.Id));

        var aggregated = await store.ListMessagesWithPartsAsync(sessionId, userId, 100, CancellationToken.None);
        Assert.Equal(2, aggregated.Count);
        Assert.Empty(aggregated[0].Parts);
        Assert.Equal(new[] { "part-1", "part-2" }, aggregated[1].Parts.Select((part) => part.Id));
    }

    [Fact]
    public async Task UpdatePartDelta_ShouldAppendToExistingField()
    {
        const string userId = "user-messagev2-delta";
        const string sessionId = "session-messagev2-delta";
        await SeedUserAndSessionAsync(userId, sessionId);

        await using var scope = _factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IMessageV2Store>();

        await store.InsertMessageAsync(new MessageV2InfoRecord(
            "msg-1",
            sessionId,
            userId,
            1000,
            "{\"role\":\"assistant\",\"time\":{\"created\":1000},\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}",
            "2026-04-19 10:00:00",
            "2026-04-19 10:00:00"), CancellationToken.None);

        await store.InsertPartAsync(new PartV2InfoRecord(
            "part-1",
            "msg-1",
            sessionId,
            userId,
            1001,
            "{\"type\":\"text\",\"text\":\"Hello\"}",
            "2026-04-19 10:00:01",
            "2026-04-19 10:00:01"), CancellationToken.None);

        await store.UpdatePartDeltaAsync(sessionId, "msg-1", "part-1", "text", " world", CancellationToken.None);
        var part = await store.GetPartAsync(sessionId, "msg-1", "part-1", CancellationToken.None);

        Assert.NotNull(part);
        Assert.Contains("Hello world", part.DataJson);
    }

    [Fact]
    public async Task UpdateMessageAndPart_ShouldPersistNewPayload_AndRespectAfterTimeFilters()
    {
        const string userId = "user-messagev2-update";
        const string sessionId = "session-messagev2-update";
        await SeedUserAndSessionAsync(userId, sessionId);

        await using var scope = _factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IMessageV2Store>();

        await store.InsertMessageAsync(new MessageV2InfoRecord(
            "msg-1",
            sessionId,
            userId,
            1000,
            "{\"role\":\"user\",\"time\":{\"created\":1000}}",
            "2026-04-19 10:00:00",
            "2026-04-19 10:00:00"), CancellationToken.None);

        await store.UpdateMessageAsync(new MessageV2InfoRecord(
            "msg-1",
            sessionId,
            userId,
            1000,
            "{\"role\":\"user\",\"time\":{\"created\":1000},\"agent\":\"hephaestus\"}",
            "2026-04-19 10:00:00",
            "2026-04-19 10:02:00"), CancellationToken.None);

        await store.InsertPartAsync(new PartV2InfoRecord(
            "part-1",
            "msg-1",
            sessionId,
            userId,
            1001,
            "{\"type\":\"text\",\"text\":\"Hello\"}",
            "2026-04-19 10:00:01",
            "2026-04-19 10:00:01"), CancellationToken.None);
        await store.UpdatePartAsync(new PartV2InfoRecord(
            "part-1",
            "msg-1",
            sessionId,
            userId,
            1001,
            "{\"type\":\"text\",\"text\":\"Hello updated\"}",
            "2026-04-19 10:00:01",
            "2026-04-19 10:03:00"), CancellationToken.None);
        await store.InsertPartAsync(new PartV2InfoRecord(
            "part-2",
            "msg-1",
            sessionId,
            userId,
            2001,
            "{\"type\":\"text\",\"text\":\"Second\"}",
            "2026-04-19 10:03:01",
            "2026-04-19 10:03:01"), CancellationToken.None);

        var updatedMessage = await store.GetMessageAsync(sessionId, "msg-1", CancellationToken.None);
        var partsAfter1000 = await store.ListPartsForSessionAsync(sessionId, 1000, CancellationToken.None);

        Assert.NotNull(updatedMessage);
        Assert.Contains("hephaestus", updatedMessage.DataJson);
        Assert.Equal(new[] { "part-1", "part-2" }, partsAfter1000.Select((part) => part.Id));
        Assert.Contains("Hello updated", partsAfter1000[0].DataJson);
    }

    [Fact]
    public async Task InsertMessageAndPart_ShouldBehaveAsIdempotentUpsert_OnDuplicateIds()
    {
        const string userId = "user-messagev2-upsert";
        const string sessionId = "session-messagev2-upsert";
        await SeedUserAndSessionAsync(userId, sessionId);

        await using var scope = _factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IMessageV2Store>();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();

        await store.InsertMessageAsync(new MessageV2InfoRecord(
            "msg-1",
            sessionId,
            userId,
            1000,
            "{\"role\":\"user\",\"time\":{\"created\":1000}}",
            "2026-04-19 10:00:00",
            "2026-04-19 10:00:00"), CancellationToken.None);
        await store.InsertMessageAsync(new MessageV2InfoRecord(
            "msg-1",
            sessionId,
            userId,
            1000,
            "{\"role\":\"user\",\"time\":{\"created\":1000},\"tools\":{\"bash\":true}}",
            "2026-04-19 10:00:00",
            "2026-04-19 10:05:00"), CancellationToken.None);

        await store.InsertPartAsync(new PartV2InfoRecord(
            "part-1",
            "msg-1",
            sessionId,
            userId,
            1001,
            "{\"type\":\"text\",\"text\":\"Hello\"}",
            "2026-04-19 10:00:01",
            "2026-04-19 10:00:01"), CancellationToken.None);
        await store.InsertPartAsync(new PartV2InfoRecord(
            "part-1",
            "msg-1",
            sessionId,
            userId,
            1001,
            "{\"type\":\"text\",\"text\":\"Hello upsert\"}",
            "2026-04-19 10:00:01",
            "2026-04-19 10:05:01"), CancellationToken.None);

        Assert.Equal(1, await dbContext.MessageV2.CountAsync((message) => message.Id == "msg-1"));
        Assert.Equal(1, await dbContext.PartV2.CountAsync((part) => part.Id == "part-1"));

        var message = await store.GetMessageAsync(sessionId, "msg-1", CancellationToken.None);
        var part = await store.GetPartAsync(sessionId, "msg-1", "part-1", CancellationToken.None);

        Assert.NotNull(message);
        Assert.Contains("bash", message.DataJson);
        Assert.NotNull(part);
        Assert.Contains("Hello upsert", part.DataJson);
    }

    [Fact]
    public async Task RequestScopeHelpers_ShouldQueryUpdateAndDeleteScopedMessages()
    {
        const string userId = "user-messagev2-request-scope";
        const string sessionId = "session-messagev2-request-scope";
        await SeedUserAndSessionAsync(userId, sessionId);

        await using var scope = _factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IMessageV2Store>();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();

        await store.InsertMessageAsync(new MessageV2InfoRecord(
            "msg-1",
            sessionId,
            userId,
            1000,
            "{\"role\":\"assistant\",\"clientRequestId\":\"req-1\",\"time\":{\"created\":1000},\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}",
            "2026-04-19 10:00:00",
            "2026-04-19 10:00:00"), CancellationToken.None);
        await store.InsertMessageAsync(new MessageV2InfoRecord(
            "msg-2",
            sessionId,
            userId,
            1001,
            "{\"role\":\"tool\",\"clientRequestId\":\"req-1:tool:call-1\",\"time\":{\"created\":1001}}",
            "2026-04-19 10:00:01",
            "2026-04-19 10:00:01"), CancellationToken.None);
        await store.InsertMessageAsync(new MessageV2InfoRecord(
            "msg-3",
            sessionId,
            userId,
            1002,
            "{\"role\":\"assistant\",\"clientRequestId\":\"other\",\"time\":{\"created\":1002},\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}",
            "2026-04-19 10:00:02",
            "2026-04-19 10:00:02"), CancellationToken.None);
        await store.InsertPartAsync(new PartV2InfoRecord(
            "part-1",
            "msg-2",
            sessionId,
            userId,
            1001,
            "{\"type\":\"tool\",\"tool\":\"write\",\"callID\":\"call-1\",\"state\":{\"status\":\"pending\",\"input\":{},\"raw\":\"{}\"}}",
            "2026-04-19 10:00:01",
            "2026-04-19 10:00:01"), CancellationToken.None);

        var scopedResult = await store.GetMessageByRequestIdAsync(sessionId, userId, "req-1", "assistant", CancellationToken.None);
        var scopedMessages = await store.ListMessagesByRequestScopeAsync(sessionId, userId, "req-1", CancellationToken.None);

        Assert.NotNull(scopedResult);
        Assert.Equal("msg-1", scopedResult.Message.Id);
        Assert.Equal("final", scopedResult.Status);
        Assert.Equal(new[] { "msg-1", "msg-2" }, scopedMessages.Select((message) => message.Id));

        await store.UpdateMessagesStatusByRequestScopeAsync(sessionId, userId, "req-1", "error", new[] { "assistant" }, CancellationToken.None);
        var updatedAssistant = await store.GetMessageAsync(sessionId, "msg-1", CancellationToken.None);
        var untouchedTool = await store.GetMessageAsync(sessionId, "msg-2", CancellationToken.None);
        Assert.NotNull(updatedAssistant);
        Assert.Contains("\"status\":\"error\"", updatedAssistant.DataJson);
        Assert.NotNull(untouchedTool);
        Assert.DoesNotContain("\"status\":\"error\"", untouchedTool.DataJson);

        await store.UpdateMessagesStatusByRequestScopeAsync(sessionId, userId, "req-1", "final", Array.Empty<string>(), CancellationToken.None);
        var unchangedWithEmptyRoles = await store.GetMessageAsync(sessionId, "msg-3", CancellationToken.None);
        Assert.NotNull(unchangedWithEmptyRoles);
        Assert.DoesNotContain("\"status\":\"final\"", unchangedWithEmptyRoles.DataJson);

        await store.DeleteMessagesByRequestScopeAsync(sessionId, userId, "req-1", null, CancellationToken.None);
        Assert.False(await dbContext.MessageV2.AnyAsync((message) => message.Id == "msg-1" || message.Id == "msg-2"));
        Assert.False(await dbContext.PartV2.AnyAsync((part) => part.Id == "part-1"));
        Assert.True(await dbContext.MessageV2.AnyAsync((message) => message.Id == "msg-3"));

        await store.DeleteMessagesByRequestScopeAsync(sessionId, userId, "other", Array.Empty<string>(), CancellationToken.None);
        Assert.True(await dbContext.MessageV2.AnyAsync((message) => message.Id == "msg-3"));
    }

    [Fact]
    public async Task RequestScopeHelpers_ShouldScanBeyondFirstHundredMessages()
    {
        const string userId = "user-messagev2-scan-all";
        const string sessionId = "session-messagev2-scan-all";
        await SeedUserAndSessionAsync(userId, sessionId);

        await using var scope = _factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IMessageV2Store>();

        for (var index = 0; index < 105; index += 1)
        {
            var requestId = index == 104 ? "req-tail" : $"req-{index}";
            await store.InsertMessageAsync(new MessageV2InfoRecord(
                $"msg-{index}",
                sessionId,
                userId,
                index,
                $"{{\"role\":\"assistant\",\"clientRequestId\":\"{requestId}\",\"time\":{{\"created\":{index}}},\"cost\":0,\"tokens\":{{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{{\"read\":0,\"write\":0}}}}}}",
                "2026-04-19 10:00:00",
                "2026-04-19 10:00:00"), CancellationToken.None);
        }

        var scoped = await store.GetMessageByRequestIdAsync(sessionId, userId, "req-tail", "assistant", CancellationToken.None);
        var scopedList = await store.ListMessagesByRequestScopeAsync(sessionId, userId, "req-tail", CancellationToken.None);

        Assert.NotNull(scoped);
        Assert.Equal("msg-104", scoped.Message.Id);
        Assert.Equal(new[] { "msg-104" }, scopedList.Select((message) => message.Id));
    }

    [Fact]
    public async Task DeleteMessage_ShouldCascadeDeleteParts()
    {
        const string userId = "user-messagev2-delete";
        const string sessionId = "session-messagev2-delete";
        await SeedUserAndSessionAsync(userId, sessionId);

        await using var scope = _factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IMessageV2Store>();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();

        await store.InsertMessageAsync(new MessageV2InfoRecord(
            "msg-1",
            sessionId,
            userId,
            1000,
            "{\"role\":\"user\",\"time\":{\"created\":1000}}",
            "2026-04-19 10:00:00",
            "2026-04-19 10:00:00"), CancellationToken.None);
        await store.InsertPartAsync(new PartV2InfoRecord(
            "part-1",
            "msg-1",
            sessionId,
            userId,
            1001,
            "{\"type\":\"text\",\"text\":\"Hello\"}",
            "2026-04-19 10:00:01",
            "2026-04-19 10:00:01"), CancellationToken.None);

        await store.DeleteMessageAsync(sessionId, userId, "msg-1", CancellationToken.None);

        Assert.False(await dbContext.MessageV2.AnyAsync((message) => message.Id == "msg-1"));
        Assert.False(await dbContext.PartV2.AnyAsync((part) => part.Id == "part-1"));
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
                Title = "Message V2 Session",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
        }

        await dbContext.SaveChangesAsync();
    }
}
