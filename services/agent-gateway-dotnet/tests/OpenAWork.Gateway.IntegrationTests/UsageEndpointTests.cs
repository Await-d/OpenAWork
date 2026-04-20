using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Contracts.Usage;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class UsageEndpointTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public UsageEndpointTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task UsageRecords_ShouldReturnMonthlyUsageAndBudget()
    {
        const string userId = "user-usage-records";
        await SeedUserAsync(userId);

        using (var scope = _factory.Services.CreateScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            dbContext.UsageRecords.Add(new UsageRecord
            {
                UserId = userId,
                Month = "2026-03",
                InputTokens = 1200,
                OutputTokens = 3400,
                CostUsd = 8.5m,
            });
            dbContext.UserSettings.Add(new UserSettingRecord
            {
                UserId = userId,
                Key = "budget_usd",
                Value = "12.5",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            await dbContext.SaveChangesAsync();
        }

        using var client = CreateAuthenticatedClient(userId);

        var response = await client.GetAsync("/usage/records");
        var payload = await response.Content.ReadFromJsonAsync<UsageRecordsResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.Single(payload.Records);
        Assert.Equal("2026-03", payload.Records[0].Month);
        Assert.Equal(8.5m, payload.Records[0].TotalCostUsd);
        Assert.Equal(1200, payload.Records[0].TotalInputTokens);
        Assert.Equal(3400, payload.Records[0].TotalOutputTokens);
        Assert.Empty(payload.Records[0].ByProvider);
        Assert.Equal(12.5m, payload.BudgetUsd);
    }

    [Fact]
    public async Task UsageRecords_ShouldFallbackToDefaultBudgetWhenMissing()
    {
        const string userId = "user-usage-default-budget";
        await SeedUserAsync(userId);
        using var client = CreateAuthenticatedClient(userId);

        var response = await client.GetAsync("/usage/records");
        var payload = await response.Content.ReadFromJsonAsync<UsageRecordsResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.Empty(payload.Records);
        Assert.Equal(20m, payload.BudgetUsd);
    }

    [Fact]
    public async Task UsageBreakdown_ShouldReturnCurrentMonthTotalAndEmptyBreakdown()
    {
        const string userId = "user-usage-breakdown";
        await SeedUserAsync(userId);
        var currentMonth = DateTimeOffset.UtcNow.ToString("yyyy-MM");

        using (var scope = _factory.Services.CreateScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            dbContext.UsageRecords.Add(new UsageRecord
            {
                UserId = userId,
                Month = currentMonth,
                InputTokens = 640,
                OutputTokens = 1280,
                CostUsd = 3.75m,
            });
            await dbContext.SaveChangesAsync();
        }

        using var client = CreateAuthenticatedClient(userId);

        var response = await client.GetAsync("/usage/breakdown");
        var payload = await response.Content.ReadFromJsonAsync<UsageBreakdownResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.Equal(3.75m, payload.MonthlyCostUsd);
        Assert.Empty(payload.Breakdown);
    }

    private async Task SeedUserAsync(string userId)
    {
        using var scope = _factory.Services.CreateScope();
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
