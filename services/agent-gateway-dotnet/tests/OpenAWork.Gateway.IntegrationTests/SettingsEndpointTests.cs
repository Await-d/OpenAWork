using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Contracts.Settings;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class SettingsEndpointTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public SettingsEndpointTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task ModelPrices_ShouldRequireAuthentication()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync("/settings/model-prices");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ModelPrices_ShouldReturnBuiltins_ForAuthenticatedUser()
    {
        using var client = CreateAuthenticatedClient("user-model-prices");

        var response = await client.GetAsync("/settings/model-prices");
        var payload = await response.Content.ReadFromJsonAsync<ModelPricesResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.Contains(payload.Models, (model) => model.ModelName == "gpt-4o");
        Assert.Contains(payload.Models, (model) => model.ModelName == "claude-opus-4-5");
    }

    [Fact]
    public async Task Workers_ShouldReturnStoredWorkers_ForAuthenticatedUser()
    {
        const string userId = "user-workers";
        await SeedSettingAsync(userId, "workers", "[{\"id\":\"worker-1\",\"label\":\"Primary Worker\"}]");

        using var client = CreateAuthenticatedClient(userId);

        var response = await client.GetAsync("/settings/workers");
        var payload = await response.Content.ReadFromJsonAsync<WorkersResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.Single(payload.Workers);
        Assert.Equal("worker-1", payload.Workers[0].GetProperty("id").GetString());
    }

    [Fact]
    public async Task McpStatus_ShouldReturnNormalizedServers()
    {
        const string userId = "user-mcp";
        await SeedSettingAsync(userId, "mcp_servers", "[{\"id\":\"srv-1\",\"name\":\"Main\",\"type\":\"http\",\"enabled\":false}]");

        using var client = CreateAuthenticatedClient(userId);

        var response = await client.GetAsync("/settings/mcp-status");
        var payload = await response.Content.ReadFromJsonAsync<McpStatusResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.Single(payload.Servers);
        Assert.Equal("srv-1", payload.Servers[0].Id);
        Assert.Equal("Main", payload.Servers[0].Name);
        Assert.Equal("http", payload.Servers[0].Type);
        Assert.Equal("unknown", payload.Servers[0].Status);
        Assert.False(payload.Servers[0].Enabled);
    }

    [Fact]
    public async Task UpstreamRetry_ShouldReturnDefault_WhenMissing()
    {
        using var client = CreateAuthenticatedClient("user-upstream-default");

        var response = await client.GetAsync("/settings/upstream-retry");
        var payload = await response.Content.ReadFromJsonAsync<UpstreamRetrySettingsResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.Equal(3, payload.MaxRetries);
    }

    [Fact]
    public async Task Compaction_ShouldReturnStoredValues()
    {
        const string userId = "user-compaction";
        await SeedSettingAsync(userId, "compaction_policy_v1", "{\"auto\":false,\"prune\":true,\"recentMessagesKept\":9,\"reserved\":12}");

        using var client = CreateAuthenticatedClient(userId);

        var response = await client.GetAsync("/settings/compaction");
        var payload = await response.Content.ReadFromJsonAsync<CompactionSettingsResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.False(payload.Auto);
        Assert.True(payload.Prune);
        Assert.Equal(9, payload.RecentMessagesKept);
        Assert.Equal(12, payload.Reserved);
    }

    [Fact]
    public async Task FilePatterns_ShouldReturnStoredPatterns()
    {
        const string userId = "user-file-patterns";
        await SeedSettingAsync(userId, "file_patterns", "[\"*.md\",\"src/**/*.ts\"]");

        using var client = CreateAuthenticatedClient(userId);

        var response = await client.GetAsync("/settings/file-patterns");
        var payload = await response.Content.ReadFromJsonAsync<FilePatternsResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.Equal(2, payload.Patterns.Count);
        Assert.Contains("*.md", payload.Patterns);
        Assert.Contains("src/**/*.ts", payload.Patterns);
    }

    private HttpClient CreateAuthenticatedClient(string userId)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthTestTokenFactory.Create(userId));
        return client;
    }

    private async Task SeedSettingAsync(string userId, string key, string value)
    {
        using var scope = _factory.Services.CreateScope();
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

        var existingSetting = await dbContext.UserSettings.SingleOrDefaultAsync((setting) => setting.UserId == userId && setting.Key == key);
        if (existingSetting is null)
        {
            dbContext.UserSettings.Add(new UserSettingRecord
            {
                UserId = userId,
                Key = key,
                Value = value,
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
        }
        else
        {
            existingSetting.Value = value;
            existingSetting.UpdatedAtUtc = DateTimeOffset.UtcNow;
        }

        await dbContext.SaveChangesAsync();
    }
}
