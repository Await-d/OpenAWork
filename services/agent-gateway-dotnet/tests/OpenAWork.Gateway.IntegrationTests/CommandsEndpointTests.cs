using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class CommandsEndpointTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public CommandsEndpointTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task GetCommands_ShouldListOnlyImplementedServerCommandsAndKeepClientDescriptors()
    {
        const string userId = "user-commands-list";
        await SeedUserAsync(_factory, userId);
        using var client = CreateAuthenticatedClient(_factory, userId);

        var response = await client.GetAsync("/commands");
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        response.EnsureSuccessStatusCode();

        var commands = payload.GetProperty("commands").EnumerateArray().ToArray();
        Assert.Contains(commands, (item) => item.GetProperty("id").GetString() == "slash-compact" && item.GetProperty("execution").GetString() == "server");
        Assert.Contains(commands, (item) => item.GetProperty("id").GetString() == "slash-handoff" && item.GetProperty("execution").GetString() == "server");
        Assert.Contains(commands, (item) => item.GetProperty("id").GetString() == "nav-chat" && item.GetProperty("execution").GetString() == "client");
        Assert.DoesNotContain(commands, (item) => item.GetProperty("id").GetString() == "slash-start-work");
    }

    [Fact]
    public async Task ExecuteRoute_ShouldReturnUnauthorizedWithoutBearerToken()
    {
        const string userId = "user-commands-noauth";
        const string sessionId = "session-commands-noauth";
        await SeedUserAndSessionAsync(_factory, userId, sessionId);

        using var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/commands/execute", new { commandId = "slash-handoff" });

        Assert.Equal(System.Net.HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ExecuteRoute_ShouldRejectNonObjectBodyWithIssues()
    {
        const string userId = "user-commands-invalid-body";
        const string sessionId = "session-commands-invalid-body";
        await SeedUserAndSessionAsync(_factory, userId, sessionId);

        using var client = CreateAuthenticatedClient(_factory, userId);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/sessions/{sessionId}/commands/execute")
        {
            Content = new StringContent("[]", Encoding.UTF8, "application/json"),
        };
        var response = await client.SendAsync(request);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(System.Net.HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Invalid input", payload.GetProperty("error").GetString());
        Assert.Equal("invalid_type", payload.GetProperty("issues")[0].GetProperty("code").GetString());
    }

    [Fact]
    public async Task ExecuteRoute_ShouldReturnNotFoundForUnknownSession()
    {
        const string userId = "user-commands-missing-session";
        await SeedUserAsync(_factory, userId);
        using var client = CreateAuthenticatedClient(_factory, userId);

        var response = await client.PostAsJsonAsync("/sessions/missing/commands/execute", new { commandId = "slash-handoff" });
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(System.Net.HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("Session not found", payload.GetProperty("error").GetString());
    }

    [Fact]
    public async Task ExecuteRoute_ShouldRejectClientOnlyCommandAsUnsupported()
    {
        const string userId = "user-commands-client-only";
        const string sessionId = "session-commands-client-only";
        await SeedUserAndSessionAsync(_factory, userId, sessionId);
        using var client = CreateAuthenticatedClient(_factory, userId);

        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/commands/execute", new { commandId = "nav-chat" });
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(System.Net.HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Unsupported command", payload.GetProperty("error").GetString());
    }

    [Fact]
    public async Task ExecuteRoute_ShouldRejectUnimplementedServerCommandAsUnsupported()
    {
        const string userId = "user-commands-unsupported-server";
        const string sessionId = "session-commands-unsupported-server";
        await SeedUserAndSessionAsync(_factory, userId, sessionId);

        using var client = CreateAuthenticatedClient(_factory, userId);
        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/commands/execute", new { commandId = "slash-start-work" });
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(System.Net.HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Unsupported command", payload.GetProperty("error").GetString());
    }

    [Fact]
    public async Task ExecuteCompact_ShouldReturnCompactionCardAndPersistMetadata()
    {
        const string userId = "user-commands-compact";
        const string sessionId = "session-commands-compact";
        await SeedUserAndSessionAsync(_factory, userId, sessionId);
        using var client = CreateAuthenticatedClient(_factory, userId);

        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/commands/execute", new
        {
            commandId = "slash-compact",
            messages = new object[]
            {
                new
                {
                    id = "m1",
                    role = "user",
                    content = new object[] { new { type = "text", text = "第一段上下文" } },
                    createdAt = 1000,
                },
                new
                {
                    id = "m2",
                    role = "assistant",
                    content = new object[] { new { type = "text", text = "第二段总结" } },
                    createdAt = 1001,
                },
            },
        });
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        response.EnsureSuccessStatusCode();
        Assert.Equal("compaction", payload.GetProperty("result").GetProperty("card").GetProperty("type").GetString());
        Assert.Contains(payload.GetProperty("result").GetProperty("events").EnumerateArray(), (item) => item.GetProperty("type").GetString() == "compaction");

        await using var scope = _factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var session = await dbContext.Sessions.SingleAsync((item) => item.Id == sessionId);
        using var metadata = JsonDocument.Parse(session.MetadataJson);
        Assert.Equal("manual", metadata.RootElement.GetProperty("lastCompactionTrigger").GetString());
        Assert.Contains("Durable session compaction memory", metadata.RootElement.GetProperty("lastCompactionSummary").GetString());
        Assert.Contains("compaction", session.MessagesJson, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ExecuteHandoff_ShouldReturnWarningCardWithoutContext()
    {
        const string userId = "user-commands-handoff-warning";
        const string sessionId = "session-commands-handoff-warning";
        await SeedUserAndSessionAsync(_factory, userId, sessionId);
        using var client = CreateAuthenticatedClient(_factory, userId);

        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/commands/execute", new { commandId = "slash-handoff" });
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        response.EnsureSuccessStatusCode();

        Assert.Equal("status", payload.GetProperty("result").GetProperty("card").GetProperty("type").GetString());
        Assert.Equal("Text handoff unavailable", payload.GetProperty("result").GetProperty("card").GetProperty("title").GetString());
        Assert.Contains("文本内容", payload.GetProperty("result").GetProperty("card").GetProperty("message").GetString(), StringComparison.Ordinal);
        Assert.Equal("warning", payload.GetProperty("result").GetProperty("card").GetProperty("tone").GetString());
    }

    [Fact]
    public async Task ExecuteHandoff_ShouldUseRequestMessagesWhenSessionHasNoStoredMessages()
    {
        const string userId = "user-commands-handoff-info";
        const string sessionId = "session-commands-handoff-info";
        await SeedUserAndSessionAsync(_factory, userId, sessionId);
        using var client = CreateAuthenticatedClient(_factory, userId);

        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/commands/execute", new
        {
            commandId = "slash-handoff",
            messages = new object[]
            {
                new
                {
                    id = "m1",
                    role = "user",
                    content = new object[] { new { type = "text", text = "请继续处理 commands execute 阻塞" } },
                    createdAt = 1000,
                },
            },
        });
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        response.EnsureSuccessStatusCode();

        Assert.Equal("status", payload.GetProperty("result").GetProperty("card").GetProperty("type").GetString());
        Assert.Equal("Text handoff ready（文本交接已生成）", payload.GetProperty("result").GetProperty("card").GetProperty("title").GetString());
        Assert.Contains("TEXT HANDOFF", payload.GetProperty("result").GetProperty("card").GetProperty("message").GetString(), StringComparison.Ordinal);
    }

    private static HttpClient CreateAuthenticatedClient(WebApplicationFactory<OpenAWork.Gateway.Host.Program> factory, string userId)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthTestTokenFactory.Create(userId));
        return client;
    }

    private static async Task SeedUserAsync(WebApplicationFactory<OpenAWork.Gateway.Host.Program> factory, string userId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
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
            await dbContext.SaveChangesAsync();
        }
    }

    private static async Task SeedUserAndSessionAsync(WebApplicationFactory<OpenAWork.Gateway.Host.Program> factory, string userId, string sessionId)
    {
        await SeedUserAsync(factory, userId);
        await using var scope = factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        if (!await dbContext.Sessions.AnyAsync((session) => session.Id == sessionId))
        {
            dbContext.Sessions.Add(new SessionRecord
            {
                Id = sessionId,
                UserId = userId,
                MessagesJson = "[]",
                StateStatus = "idle",
                MetadataJson = "{}",
                Title = "Commands Session",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            await dbContext.SaveChangesAsync();
        }
    }
}
