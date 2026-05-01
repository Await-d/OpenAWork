using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class SessionsSearchTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public SessionsSearchTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Search_ShouldRequireAuthAndValidateQueryParams()
    {
        using var anonymousClient = _factory.CreateClient();
        var unauthorizedResponse = await anonymousClient.GetAsync("/sessions/search?q=search");
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorizedResponse.StatusCode);

        const string userId = "user-sessions-search-validation";
        await SeedUserAsync(userId);
        using var client = CreateAuthenticatedClient(userId);

        var missingQueryResponse = await client.GetAsync("/sessions/search?limit=8");
        Assert.Equal(HttpStatusCode.BadRequest, missingQueryResponse.StatusCode);

        var invalidLimitResponse = await client.GetAsync("/sessions/search?q=search&limit=21");
        Assert.Equal(HttpStatusCode.BadRequest, invalidLimitResponse.StatusCode);
    }

    [Fact]
    public async Task Search_ShouldReturnCurrentUserMatchesFromTextAndModifiedFilesSummary()
    {
        const string userId = "user-sessions-search-results";
        const string otherUserId = "user-sessions-search-other";
        await SeedUserAsync(userId);
        await SeedUserAsync(otherUserId);
        using var client = CreateAuthenticatedClient(userId);

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            var now = DateTimeOffset.UtcNow;

            dbContext.Sessions.AddRange(
                new SessionRecord
                {
                    Id = "session-search-1",
                    UserId = userId,
                    MessagesJson = "[]",
                    StateStatus = "idle",
                    MetadataJson = "{}",
                    Title = "Search Session One",
                    CreatedAtUtc = now,
                    UpdatedAtUtc = now,
                },
                new SessionRecord
                {
                    Id = "session-search-2",
                    UserId = userId,
                    MessagesJson = "[]",
                    StateStatus = "idle",
                    MetadataJson = "{}",
                    Title = "Search Session Two",
                    CreatedAtUtc = now.AddMinutes(1),
                    UpdatedAtUtc = now.AddMinutes(1),
                },
                new SessionRecord
                {
                    Id = "session-search-other",
                    UserId = otherUserId,
                    MessagesJson = "[]",
                    StateStatus = "idle",
                    MetadataJson = "{}",
                    Title = "Other User Session",
                    CreatedAtUtc = now.AddMinutes(2),
                    UpdatedAtUtc = now.AddMinutes(2),
                });

            dbContext.MessageV2.AddRange(
                new MessageV2Record
                {
                    Id = "msg-search-1",
                    SessionId = "session-search-1",
                    UserId = userId,
                    TimeCreated = 1000,
                    DataJson = "{\"role\":\"assistant\",\"time\":{\"created\":1000}}",
                    CreatedAtUtc = now,
                    UpdatedAtUtc = now,
                },
                new MessageV2Record
                {
                    Id = "msg-search-2",
                    SessionId = "session-search-2",
                    UserId = userId,
                    TimeCreated = 2000,
                    DataJson = "{\"role\":\"assistant\",\"time\":{\"created\":2000}}",
                    CreatedAtUtc = now.AddMinutes(1),
                    UpdatedAtUtc = now.AddMinutes(1),
                },
                new MessageV2Record
                {
                    Id = "msg-search-other",
                    SessionId = "session-search-other",
                    UserId = otherUserId,
                    TimeCreated = 3000,
                    DataJson = "{\"role\":\"assistant\",\"time\":{\"created\":3000}}",
                    CreatedAtUtc = now.AddMinutes(2),
                    UpdatedAtUtc = now.AddMinutes(2),
                });

            dbContext.PartV2.AddRange(
                new PartV2Record
                {
                    Id = "part-search-1",
                    MessageId = "msg-search-1",
                    SessionId = "session-search-1",
                    UserId = userId,
                    TimeCreated = 1001,
                    DataJson = "{\"type\":\"text\",\"text\":\"这里有搜索正文\"}",
                    CreatedAtUtc = now,
                    UpdatedAtUtc = now,
                },
                new PartV2Record
                {
                    Id = "part-search-2",
                    MessageId = "msg-search-2",
                    SessionId = "session-search-2",
                    UserId = userId,
                    TimeCreated = 2001,
                    DataJson = "{\"type\":\"modified_files_summary\",\"title\":\"变更摘要\",\"summary\":\"新增搜索索引\"}",
                    CreatedAtUtc = now.AddMinutes(1),
                    UpdatedAtUtc = now.AddMinutes(1),
                },
                new PartV2Record
                {
                    Id = "part-search-other",
                    MessageId = "msg-search-other",
                    SessionId = "session-search-other",
                    UserId = otherUserId,
                    TimeCreated = 3001,
                    DataJson = "{\"type\":\"text\",\"text\":\"其他用户的搜索结果\"}",
                    CreatedAtUtc = now.AddMinutes(2),
                    UpdatedAtUtc = now.AddMinutes(2),
                });

            await dbContext.SaveChangesAsync();
        }

        var response = await client.GetAsync("/sessions/search?q=搜索");
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        response.EnsureSuccessStatusCode();

        var results = payload.GetProperty("results").EnumerateArray().ToArray();
        Assert.Equal(2, results.Length);
        Assert.Equal("msg-search-2", results[0].GetProperty("messageId").GetString());
        Assert.Equal("msg-search-1", results[1].GetProperty("messageId").GetString());
        Assert.Equal("Search Session Two", results[0].GetProperty("title").GetString());
        Assert.Equal("assistant", results[0].GetProperty("role").GetString());
        Assert.Contains("<mark>搜索</mark>", results[0].GetProperty("snippet").GetString() ?? string.Empty);
        Assert.Contains("<mark>搜索</mark>", results[1].GetProperty("snippet").GetString() ?? string.Empty);
        Assert.DoesNotContain(results, (item) => item.GetProperty("sessionId").GetString() == "session-search-other");
    }

    [Fact]
    public async Task Search_ShouldRespectLimit()
    {
        const string userId = "user-sessions-search-limit";
        await SeedUserAsync(userId);
        using var client = CreateAuthenticatedClient(userId);

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            var now = DateTimeOffset.UtcNow;

            dbContext.Sessions.AddRange(
                new SessionRecord
                {
                    Id = "session-search-limit-1",
                    UserId = userId,
                    MessagesJson = "[]",
                    StateStatus = "idle",
                    MetadataJson = "{}",
                    Title = "Search Limit One",
                    CreatedAtUtc = now,
                    UpdatedAtUtc = now,
                },
                new SessionRecord
                {
                    Id = "session-search-limit-2",
                    UserId = userId,
                    MessagesJson = "[]",
                    StateStatus = "idle",
                    MetadataJson = "{}",
                    Title = "Search Limit Two",
                    CreatedAtUtc = now.AddMinutes(1),
                    UpdatedAtUtc = now.AddMinutes(1),
                });

            dbContext.MessageV2.AddRange(
                new MessageV2Record
                {
                    Id = "msg-search-limit-1",
                    SessionId = "session-search-limit-1",
                    UserId = userId,
                    TimeCreated = 1000,
                    DataJson = "{\"role\":\"assistant\",\"time\":{\"created\":1000}}",
                    CreatedAtUtc = now,
                    UpdatedAtUtc = now,
                },
                new MessageV2Record
                {
                    Id = "msg-search-limit-2",
                    SessionId = "session-search-limit-2",
                    UserId = userId,
                    TimeCreated = 2000,
                    DataJson = "{\"role\":\"assistant\",\"time\":{\"created\":2000}}",
                    CreatedAtUtc = now.AddMinutes(1),
                    UpdatedAtUtc = now.AddMinutes(1),
                });

            dbContext.PartV2.AddRange(
                new PartV2Record
                {
                    Id = "part-search-limit-1",
                    MessageId = "msg-search-limit-1",
                    SessionId = "session-search-limit-1",
                    UserId = userId,
                    TimeCreated = 1001,
                    DataJson = "{\"type\":\"text\",\"text\":\"搜索一\"}",
                    CreatedAtUtc = now,
                    UpdatedAtUtc = now,
                },
                new PartV2Record
                {
                    Id = "part-search-limit-2",
                    MessageId = "msg-search-limit-2",
                    SessionId = "session-search-limit-2",
                    UserId = userId,
                    TimeCreated = 2001,
                    DataJson = "{\"type\":\"text\",\"text\":\"搜索二\"}",
                    CreatedAtUtc = now.AddMinutes(1),
                    UpdatedAtUtc = now.AddMinutes(1),
                });

            await dbContext.SaveChangesAsync();
        }

        var response = await client.GetAsync("/sessions/search?q=搜索&limit=1");
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        response.EnsureSuccessStatusCode();

        var results = payload.GetProperty("results").EnumerateArray().ToArray();
        Assert.Single(results);
        Assert.Equal("msg-search-limit-2", results[0].GetProperty("messageId").GetString());
    }

    private async Task SeedUserAsync(string userId)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        if (await dbContext.Users.AnyAsync((user) => user.Id == userId))
        {
            return;
        }

        dbContext.Users.Add(new UserRecord
        {
            Id = userId,
            Email = $"{userId}@openawork.local",
            PasswordHash = "seed",
            CreatedAtUtc = DateTimeOffset.UtcNow,
        });
        await dbContext.SaveChangesAsync();
    }

    private HttpClient CreateAuthenticatedClient(string userId)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthTestTokenFactory.Create(userId));
        return client;
    }
}
