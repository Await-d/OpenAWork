using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Contracts.Agents;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class AgentsEndpointTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public AgentsEndpointTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task List_ShouldIncludeBuiltinAgentsWithSystemPrompt()
    {
        const string userId = "user-agents-list";
        await SeedUserAsync(userId);
        using var client = CreateAuthenticatedClient(userId);

        var response = await client.GetAsync("/agents");
        var payload = await response.Content.ReadFromJsonAsync<ManagedAgentsResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.Contains(payload.Agents, (agent) =>
            agent.Id == "oracle"
            && agent.Origin == "builtin"
            && agent.Enabled
            && agent.CreatedAt == "1970-01-01T00:00:00.000Z"
            && agent.Color is null
            && agent.Description == "只读战略顾问 agent，用于复杂架构决策、困难调试和自我审查。不可修改任何文件。"
            && agent.SystemPrompt is not null
            && agent.SystemPrompt.StartsWith("<identity>\n你是 Oracle — 战略技术顾问。", StringComparison.Ordinal)
            && agent.SystemPrompt.Contains("<decision_framework>", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Create_ShouldPersistCustomAgentAndExposeItInList()
    {
        const string userId = "user-agents-create";
        await SeedUserAsync(userId);
        using var client = CreateAuthenticatedClient(userId);

        var createResponse = await client.PostAsJsonAsync("/agents", new
        {
            label = "自定义调试助手",
            description = "用于快速排查问题",
            aliases = new[] { "debug-pro" },
            canonicalRole = new { coreRole = "executor", preset = "debugger", confidence = "high" },
            systemPrompt = "请协助诊断并修复问题。",
        });
        var created = await createResponse.Content.ReadFromJsonAsync<ManagedAgentEnvelopeResponse>();

        createResponse.EnsureSuccessStatusCode();
        Assert.NotNull(created);
        Assert.Equal("custom", created.Agent.Origin);
        Assert.Equal("custom", created.Agent.Source);
        Assert.EndsWith("Z", created.Agent.CreatedAt, StringComparison.Ordinal);
        Assert.DoesNotContain("+00:00", created.Agent.CreatedAt, StringComparison.Ordinal);

        var listResponse = await client.GetAsync("/agents");
        var listed = await listResponse.Content.ReadFromJsonAsync<ManagedAgentsResponse>();

        listResponse.EnsureSuccessStatusCode();
        Assert.NotNull(listed);
        Assert.Contains(listed.Agents, (agent) => agent.Id == created.Agent.Id && agent.Label == "自定义调试助手");
    }

    [Fact]
    public async Task UpdateBuiltinAndReset_ShouldRoundTripModelOverrides()
    {
        const string userId = "user-agents-builtin-update";
        await SeedUserAsync(userId);
        using var client = CreateAuthenticatedClient(userId);

        var updateResponse = await client.PutAsJsonAsync("/agents/oracle", new
        {
            model = "openai/gpt-5.4-mini",
            variant = "high",
            fallbackModels = new[] { "claude-opus-4-6" },
        });
        var updated = await updateResponse.Content.ReadFromJsonAsync<ManagedAgentEnvelopeResponse>();

        updateResponse.EnsureSuccessStatusCode();
        Assert.NotNull(updated);
        Assert.Equal("oracle", updated.Agent.Id);
        Assert.True(updated.Agent.Resettable);
        Assert.Equal("openai/gpt-5.4-mini", updated.Agent.Model);
        Assert.Equal(new[] { "claude-opus-4-6" }, updated.Agent.FallbackModels);

        var resetResponse = await client.PostAsync("/agents/oracle/reset", content: null);
        var reset = await resetResponse.Content.ReadFromJsonAsync<ManagedAgentEnvelopeResponse>();

        resetResponse.EnsureSuccessStatusCode();
        Assert.NotNull(reset);
        Assert.False(reset.Agent.Resettable);
        Assert.Equal("oracle", reset.Agent.Id);
    }

    [Fact]
    public async Task ResetAllAndDelete_ShouldRestoreDefaultsAndRemoveCustomAgent()
    {
        const string userId = "user-agents-reset-all";
        await SeedUserAsync(userId);
        using var client = CreateAuthenticatedClient(userId);

        var createResponse = await client.PostAsJsonAsync("/agents", new
        {
            id = "custom-reviewer",
            label = "自定义评审员",
            description = "自定义评审 agent",
            note = "初始版本",
            systemPrompt = "请作为额外评审 agent 提供意见。",
        });
        createResponse.EnsureSuccessStatusCode();

        var customUpdateResponse = await client.PutAsJsonAsync("/agents/custom-reviewer", new
        {
            label = "修改后的评审员",
            enabled = false,
        });
        customUpdateResponse.EnsureSuccessStatusCode();

        var builtinUpdateResponse = await client.PutAsJsonAsync("/agents/explore", new
        {
            model = "openai/gpt-5.4-mini",
        });
        builtinUpdateResponse.EnsureSuccessStatusCode();

        var resetAllResponse = await client.PostAsync("/agents/reset-all", content: null);
        var resetAll = await resetAllResponse.Content.ReadFromJsonAsync<ManagedAgentsResponse>();

        resetAllResponse.EnsureSuccessStatusCode();
        Assert.NotNull(resetAll);
        Assert.Contains(resetAll.Agents, (agent) => agent.Id == "custom-reviewer" && agent.Label == "自定义评审员" && agent.Enabled);
        Assert.Contains(resetAll.Agents, (agent) => agent.Id == "explore" && agent.Label == "explore" && agent.Enabled);

        var deleteResponse = await client.DeleteAsync("/agents/custom-reviewer");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);
    }

    [Fact]
    public async Task InvalidRequests_ShouldReturnStableErrorCodes()
    {
        const string userId = "user-agents-invalid";
        await SeedUserAsync(userId);
        using var client = CreateAuthenticatedClient(userId);

        var firstCreate = await client.PostAsJsonAsync("/agents", new
        {
            id = "custom-debugger",
            label = "自定义调试助手",
            systemPrompt = "请帮助用户调试问题。",
        });
        firstCreate.EnsureSuccessStatusCode();

        var duplicateCreate = await client.PostAsJsonAsync("/agents", new
        {
            id = "custom-debugger",
            label = "另一个自定义调试助手",
            systemPrompt = "另一个调试提示词。",
        });
        Assert.Equal(HttpStatusCode.Conflict, duplicateCreate.StatusCode);

        var emptyIdCreate = await client.PostAsJsonAsync("/agents", new
        {
            id = "   ",
            label = "空 ID 自定义调试助手",
            systemPrompt = "请帮助用户调试问题。",
        });
        Assert.Equal(HttpStatusCode.BadRequest, emptyIdCreate.StatusCode);

        var emptyUpdate = await client.PutAsJsonAsync("/agents/oracle", new { });
        Assert.Equal(HttpStatusCode.BadRequest, emptyUpdate.StatusCode);

        var invalidBuiltinUpdate = await client.PutAsJsonAsync("/agents/oracle", new
        {
            label = "首席架构顾问",
        });
        Assert.Equal(HttpStatusCode.BadRequest, invalidBuiltinUpdate.StatusCode);

        var missingPromptCreate = await client.PostAsJsonAsync("/agents", new
        {
            label = "缺少提示词的自定义 Agent",
        });
        Assert.Equal(HttpStatusCode.BadRequest, missingPromptCreate.StatusCode);

        var removeBuiltin = await client.DeleteAsync("/agents/oracle");
        Assert.Equal(HttpStatusCode.Conflict, removeBuiltin.StatusCode);

        var invalidAgentId = await client.PutAsJsonAsync("/agents/%20", new
        {
            model = "openai/gpt-5.4-mini",
        });
        var invalidAgentIdBody = await invalidAgentId.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.BadRequest, invalidAgentId.StatusCode);
        Assert.Contains("issues", invalidAgentIdBody);
        Assert.Contains("too_small", invalidAgentIdBody);
        Assert.Contains("agentId", invalidAgentIdBody);
    }

    [Fact]
    public async Task List_ShouldApplyLegacyHiddenPreferenceFallback()
    {
        const string userId = "user-agents-legacy-preferences";
        await SeedUserAsync(userId);

        using (var scope = _factory.Services.CreateScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            dbContext.UserSettings.Add(new UserSettingRecord
            {
                UserId = userId,
                Key = "agent_preferences",
                Value = "{\"explore\":{\"hidden\":true,\"updatedAt\":\"2026-04-19T00:00:00.000Z\"}}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            await dbContext.SaveChangesAsync();
        }

        using var client = CreateAuthenticatedClient(userId);
        var response = await client.GetAsync("/agents");
        var payload = await response.Content.ReadFromJsonAsync<ManagedAgentsResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.Contains(payload.Agents, (agent) =>
            agent.Id == "explore"
            && agent.Origin == "builtin"
            && !agent.Enabled
            && agent.UpdatedAt == "2026-04-19T00:00:00.000Z");
    }

    [Fact]
    public async Task List_ShouldToleratePartialCatalogEntries()
    {
        const string userId = "user-agents-partial-catalog";
        await SeedUserAsync(userId);

        using (var scope = _factory.Services.CreateScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            dbContext.UserSettings.Add(new UserSettingRecord
            {
                UserId = userId,
                Key = "agent_catalog",
                Value = "{\"customAgents\":{\"custom-reviewer\":{\"current\":{\"label\":\"旧自定义评审员\",\"description\":\"旧描述\",\"aliases\":[\"review-bot\"],\"systemPrompt\":\"请评审\"}}}}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            await dbContext.SaveChangesAsync();
        }

        using var client = CreateAuthenticatedClient(userId);
        var response = await client.GetAsync("/agents");
        var payload = await response.Content.ReadFromJsonAsync<ManagedAgentsResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.Contains(payload.Agents, (agent) =>
            agent.Id == "custom-reviewer"
            && agent.Origin == "custom"
            && agent.Enabled
            && agent.Label == "旧自定义评审员"
            && agent.SystemPrompt == "请评审");
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
