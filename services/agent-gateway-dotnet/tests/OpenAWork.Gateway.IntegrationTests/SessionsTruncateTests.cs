using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class SessionsTruncateTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public SessionsTruncateTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Truncate_ShouldRequireAuthAndValidateInput()
    {
        const string sessionId = "session-truncate-validation";
        using var anonymousClient = _factory.CreateClient();
        var unauthorizedResponse = await anonymousClient.PostAsJsonAsync($"/sessions/{sessionId}/messages/truncate", new { messageId = "m1" });
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorizedResponse.StatusCode);

        const string userId = "user-truncate-validation";
        await SeedUserAndSessionAsync(userId, sessionId);
        using var client = CreateAuthenticatedClient(userId);

        var invalidResponse = await client.PostAsJsonAsync($"/sessions/{sessionId}/messages/truncate", new { messageId = 123 });
        Assert.Equal(HttpStatusCode.BadRequest, invalidResponse.StatusCode);
    }

    [Fact]
    public async Task Truncate_ShouldReturnNotFoundForMissingSession()
    {
        const string userId = "user-truncate-missing";
        await SeedUserAndSessionAsync(userId, "other-session");
        using var client = CreateAuthenticatedClient(userId);

        var response = await client.PostAsJsonAsync("/sessions/missing-session/messages/truncate", new { messageId = "m1" });
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Truncate_ShouldDeleteMessagesFromTargetWhenInclusive()
    {
        const string userId = "user-truncate-inclusive";
        const string sessionId = "session-truncate-inclusive";
        await SeedUserAndSessionAsync(userId, sessionId);
        await SeedTranscriptAsync(userId, sessionId,
            ("msg-1", 1000, "assistant", "保留一"),
            ("msg-2", 2000, "user", "删除起点"),
            ("msg-3", 3000, "assistant", "删除尾部"));
        using var client = CreateAuthenticatedClient(userId);

        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/messages/truncate", new
        {
            messageId = "msg-2",
            inclusive = true,
        });
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        response.EnsureSuccessStatusCode();
        var messages = payload.GetProperty("messages").EnumerateArray().ToArray();
        Assert.Single(messages);
        Assert.Equal("msg-1", messages[0].GetProperty("id").GetString());
    }

    [Fact]
    public async Task Truncate_ShouldFallbackToMessageTextForUserMessage()
    {
        const string userId = "user-truncate-text";
        const string sessionId = "session-truncate-text";
        await SeedUserAndSessionAsync(userId, sessionId);
        await SeedTranscriptAsync(userId, sessionId,
            ("msg-a", 1000, "assistant", "保留一"),
            ("msg-b", 2000, "user", "匹配文本"),
            ("msg-c", 3000, "assistant", "删除尾部"));
        using var client = CreateAuthenticatedClient(userId);

        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/messages/truncate", new
        {
            messageId = "frontend-mismatch-id",
            messageText = "匹配文本",
            inclusive = false,
        });
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        response.EnsureSuccessStatusCode();
        var messages = payload.GetProperty("messages").EnumerateArray().ToArray();
        Assert.Equal(2, messages.Length);
        Assert.Equal("msg-a", messages[0].GetProperty("id").GetString());
        Assert.Equal("msg-b", messages[1].GetProperty("id").GetString());
    }

    private async Task SeedTranscriptAsync(string userId, string sessionId, params (string MessageId, long CreatedAt, string Role, string Text)[] messages)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        foreach (var message in messages)
        {
            dbContext.MessageV2.Add(new MessageV2Record
            {
                Id = message.MessageId,
                SessionId = sessionId,
                UserId = userId,
                TimeCreated = message.CreatedAt,
                DataJson = $"{{\"role\":\"{message.Role}\",\"time\":{{\"created\":{message.CreatedAt}}},\"status\":\"final\"}}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            dbContext.PartV2.Add(new PartV2Record
            {
                Id = $"part-{message.MessageId}",
                MessageId = message.MessageId,
                SessionId = sessionId,
                UserId = userId,
                TimeCreated = message.CreatedAt + 1,
                DataJson = $"{{\"type\":\"text\",\"text\":\"{message.Text}\"}}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
        }

        await dbContext.SaveChangesAsync();
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
                Title = "Truncate Session",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
        }

        await dbContext.SaveChangesAsync();
    }

    private HttpClient CreateAuthenticatedClient(string userId)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthTestTokenFactory.Create(userId));
        return client;
    }
}
