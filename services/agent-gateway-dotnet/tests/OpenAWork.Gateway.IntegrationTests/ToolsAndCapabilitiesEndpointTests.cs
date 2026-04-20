using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Contracts.Capabilities;
using OpenAWork.Gateway.Contracts.Tools;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class ToolsAndCapabilitiesEndpointTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public ToolsAndCapabilitiesEndpointTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task ToolDefinitions_ShouldReturnCanonicalNamesByDefault()
    {
        using var client = CreateAuthenticatedClient("user-tools-default");

        var response = await client.GetAsync("/tools/definitions");
        var payload = await response.Content.ReadFromJsonAsync<ToolDefinitionsResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.Contains(payload.Tools, (tool) => tool.Name == "skill");
        Assert.Contains(payload.Tools, (tool) => tool.Name == "question");
        Assert.Contains(payload.Tools, (tool) => tool.Name == "call_omo_agent");
        Assert.DoesNotContain(payload.Tools, (tool) => tool.Name == "Skill");
        Assert.DoesNotContain(payload.Tools, (tool) => tool.Name == "AskUserQuestion");
        Assert.DoesNotContain(payload.Tools, (tool) => tool.Name == "Agent");
    }

    [Fact]
    public async Task ToolDefinitions_ShouldReturnPresentedNamesWhenSessionIdProvided()
    {
        using var client = CreateAuthenticatedClient("user-tools-session");

        var response = await client.GetAsync($"/tools/definitions?sessionId={Guid.NewGuid()}");
        var payload = await response.Content.ReadFromJsonAsync<ToolDefinitionsResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.Contains(payload.Tools, (tool) => tool.Name == "Skill");
        Assert.Contains(payload.Tools, (tool) => tool.Name == "AskUserQuestion");
        Assert.Contains(payload.Tools, (tool) => tool.Name == "Agent");
        Assert.DoesNotContain(payload.Tools, (tool) => tool.Name == "skill");
        Assert.DoesNotContain(payload.Tools, (tool) => tool.Name == "question");
        Assert.DoesNotContain(payload.Tools, (tool) => tool.Name == "call_omo_agent");
    }

    [Fact]
    public async Task Capabilities_ShouldReturnUnifiedCatalog()
    {
        const string userId = "user-capabilities";

        using (var scope = _factory.Services.CreateScope())
        {
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

            dbContext.InstalledSkills.Add(new InstalledSkillRecord
            {
                SkillId = "github:Await-d/agentdocs-orchestrator/agentdocs-orchestrator",
                UserId = userId,
                SourceId = "github:Await-d/agentdocs-orchestrator",
                ManifestJson = "{\"id\":\"github:Await-d/agentdocs-orchestrator/agentdocs-orchestrator\",\"displayName\":\"Agentdocs Orchestrator\",\"description\":\"任务编排技能\",\"capabilities\":[\"planning\"]}",
                GrantedPermissionsJson = "[]",
                Enabled = true,
                InstalledAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            });

            dbContext.UserSettings.Add(new UserSettingRecord
            {
                UserId = userId,
                Key = "mcp_servers",
                Value = "[{\"id\":\"playwright\",\"name\":\"playwright\",\"type\":\"stdio\",\"enabled\":true}]",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });

            await dbContext.SaveChangesAsync();
        }

        using var client = CreateAuthenticatedClient(userId);

        var response = await client.GetAsync("/capabilities");
        var payload = await response.Content.ReadFromJsonAsync<CapabilitiesResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.Contains(payload.Capabilities, (item) => item.Kind == "agent" && item.Label == "oracle");
        Assert.Contains(payload.Capabilities, (item) => item.Kind == "skill" && item.Label == "Agentdocs Orchestrator");
        Assert.Contains(payload.Capabilities, (item) => item.Kind == "mcp" && item.Label == "context7");
        Assert.Contains(payload.Capabilities, (item) => item.Kind == "mcp" && item.Label == "playwright");
        Assert.Contains(payload.Capabilities, (item) => item.Kind == "tool" && item.Label == "websearch");
        Assert.Contains(payload.Capabilities, (item) => item.Kind == "tool" && item.Label == "Skill");
        Assert.Contains(payload.Capabilities, (item) => item.Kind == "command" && item.Label == "/compact");
    }

    private HttpClient CreateAuthenticatedClient(string userId)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthTestTokenFactory.Create(userId));
        return client;
    }
}
