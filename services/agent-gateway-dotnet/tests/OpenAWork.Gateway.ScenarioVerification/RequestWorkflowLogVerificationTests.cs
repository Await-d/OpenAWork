using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Persistence.EFCore;

namespace OpenAWork.Gateway.ScenarioVerification;

public sealed class RequestWorkflowLogVerificationTests : IClassFixture<GatewayScenarioFactory>
{
    private readonly GatewayScenarioFactory _factory;

    public RequestWorkflowLogVerificationTests(GatewayScenarioFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task HealthRequest_ShouldPersistWorkflowLog()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync("/health");
        response.EnsureSuccessStatusCode();

        using var scope = _factory.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var logs = await dbContext.RequestWorkflowLogs.ToListAsync();
        var appliedMigrations = await dbContext.Database.GetAppliedMigrationsAsync();

        Assert.NotEmpty(logs);
        Assert.NotEmpty(appliedMigrations);
        var latest = logs.OrderBy((entry) => entry.Id).Last();
        Assert.Contains("request.handle", latest.WorkflowJson);
        Assert.Contains("status", latest.WorkflowJson);
    }
}
