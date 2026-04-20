using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class WorkflowsEndpointTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public WorkflowsEndpointTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task ListTemplates_ShouldReturnSeededWorkflowTemplates_ForCurrentUser()
    {
        const string userId = "user-workflows-list";
        await SeedUserWithDefaultsAsync(userId, "workflow-list@openawork.local");
        using var client = CreateAuthenticatedClient(userId, "workflow-list@openawork.local");

        var response = await client.GetAsync("/workflows/templates");
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        response.EnsureSuccessStatusCode();
        Assert.Equal(JsonValueKind.Array, payload.ValueKind);
        Assert.True(payload.GetArrayLength() >= 4);
        Assert.Contains(payload.EnumerateArray(), (item) =>
            item.GetProperty("category").GetString() == "team-playbook"
            && item.GetProperty("metadata").GetProperty("teamTemplate").GetProperty("requiredRoles").GetArrayLength() == 5);
    }

    [Fact]
    public async Task CreateTemplate_ShouldNormalizeMissingTeamBindings_AndPersistMetadata()
    {
        const string userId = "user-workflows-create";
        await SeedUserAsync(userId, "workflow-create@openawork.local");
        using var client = CreateAuthenticatedClient(userId, "workflow-create@openawork.local");

        var response = await client.PostAsJsonAsync("/workflows/templates", new
        {
            name = "缺失默认绑定模板",
            category = "team-playbook",
            metadata = new
            {
                teamTemplate = new
                {
                    defaultBindings = new
                    {
                        planner = new { agentId = "prometheus" },
                        researcher = new { agentId = "librarian" },
                        executor = new { agentId = "hephaestus" },
                    },
                    defaultProvider = "anthropic",
                    optionalAgentIds = new[] { "atlas" },
                },
            },
            nodes = Array.Empty<object>(),
            edges = Array.Empty<object>(),
        });
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        response.EnsureSuccessStatusCode();
        var teamTemplate = payload.GetProperty("metadata").GetProperty("teamTemplate");
        Assert.Equal("zeus", teamTemplate.GetProperty("defaultBindings").GetProperty("leader").GetProperty("agentId").GetString());
        Assert.Equal("momus", teamTemplate.GetProperty("defaultBindings").GetProperty("reviewer").GetProperty("agentId").GetString());
        Assert.Equal(5, teamTemplate.GetProperty("requiredRoles").GetArrayLength());

        await using var scope = _factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var record = await dbContext.WorkflowTemplates.SingleAsync((template) => template.UserId == userId && template.Name == "缺失默认绑定模板");
        using var metadataDocument = JsonDocument.Parse(record.MetadataJson);
        Assert.Equal("zeus", metadataDocument.RootElement.GetProperty("teamTemplate").GetProperty("defaultBindings").GetProperty("leader").GetProperty("agentId").GetString());
    }

    [Fact]
    public async Task DeleteTemplate_ShouldReturnNotFound_WhenTemplateBelongsToAnotherUser()
    {
        const string ownerId = "user-workflows-owner";
        const string otherUserId = "user-workflows-other";
        await SeedUserWithDefaultsAsync(ownerId, "workflow-owner@openawork.local");
        await SeedUserAsync(otherUserId, "workflow-other@openawork.local");

        string templateId;
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            templateId = await dbContext.WorkflowTemplates
                .Where((template) => template.UserId == ownerId)
                .Select((template) => template.Id)
                .FirstAsync();
        }

        using var client = CreateAuthenticatedClient(otherUserId, "workflow-other@openawork.local");
        var response = await client.DeleteAsync($"/workflows/templates/{templateId}");
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("Template not found", payload.GetProperty("error").GetString());
    }

    [Fact]
    public async Task OptimizePrompt_ShouldReturnStructuredCandidates()
    {
        const string userId = "user-workflows-optimize";
        await SeedUserAsync(userId, "workflow-optimize@openawork.local");

        const string llmResponse = "{" +
            "\"candidates\":[{" +
            "\"id\":\"candidate-1\",\"text\":\"优化后的提示词\",\"improvements\":[\"消除歧义\",\"增加输出格式约束\"]}]," +
            "\"recommended\":\"candidate-1\"," +
            "\"rationale\":\"它同时提升了清晰度与结构化程度\"}";

        using var factory = _factory.WithWebHostBuilder((builder) =>
        {
            builder.ConfigureServices((services) =>
            {
                services.RemoveAll<OpenAWork.Gateway.Application.Abstractions.Settings.IWorkflowLlmClient>();
                services.AddSingleton<OpenAWork.Gateway.Application.Abstractions.Settings.IWorkflowLlmClient>(new StubWorkflowLlmClient(llmResponse));
            });
        });
        using var client = CreateAuthenticatedClient(factory, userId, "workflow-optimize@openawork.local");

        var response = await client.PostAsJsonAsync("/workflows/optimize-prompt", new
        {
            originalPrompt = "帮我改写一个提示词",
            context = "用于复杂工程任务",
            candidateCount = 1,
        });
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        response.EnsureSuccessStatusCode();
        Assert.Equal("帮我改写一个提示词", payload.GetProperty("originalPrompt").GetString());
        Assert.Equal("candidate-1", payload.GetProperty("recommended").GetString());
        Assert.Equal("优化后的提示词", payload.GetProperty("candidates")[0].GetProperty("text").GetString());
    }

    [Fact]
    public async Task Translate_ShouldReturnBatchTranslationResults()
    {
        const string userId = "user-workflows-translate";
        await SeedUserAsync(userId, "workflow-translate@openawork.local");

        using var factory = _factory.WithWebHostBuilder((builder) =>
        {
            builder.ConfigureServices((services) =>
            {
                services.RemoveAll<OpenAWork.Gateway.Application.Abstractions.Settings.IWorkflowLlmClient>();
                services.AddSingleton<OpenAWork.Gateway.Application.Abstractions.Settings.IWorkflowLlmClient>(new StubWorkflowLlmClient("Translated content"));
            });
        });
        using var client = CreateAuthenticatedClient(factory, userId, "workflow-translate@openawork.local");

        var response = await client.PostAsJsonAsync("/workflows/translate", new
        {
            tasks = new[]
            {
                new { id = "task-1", content = "你好", fileName = "README.md", sourceLanguage = "zh", targetLanguage = "en" },
                new { id = "task-2", content = "世界", fileName = "CHANGELOG.md", sourceLanguage = "zh", targetLanguage = "en" },
            },
        });
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        response.EnsureSuccessStatusCode();
        Assert.Equal(2, payload.GetProperty("results").GetArrayLength());
        Assert.Equal("task-1", payload.GetProperty("results")[0].GetProperty("taskId").GetString());
        Assert.Equal("Translated content", payload.GetProperty("results")[0].GetProperty("translatedContent").GetString());
    }

    private async Task SeedUserAsync(string userId, string email)
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
            Email = email,
            PasswordHash = "seed",
            CreatedAtUtc = DateTimeOffset.UtcNow,
        });
        await dbContext.SaveChangesAsync();
    }

    private async Task SeedUserWithDefaultsAsync(string userId, string email)
    {
        await SeedUserAsync(userId, email);

        await using var scope = _factory.Services.CreateAsyncScope();
        var bootstrapper = scope.ServiceProvider.GetRequiredService<OpenAWork.Gateway.Application.Abstractions.Auth.IUserRegistrationBootstrapper>();
        await bootstrapper.EnsureDefaultsForUserAsync(userId, CancellationToken.None);
    }

    private HttpClient CreateAuthenticatedClient(string userId, string email)
    {
        return CreateAuthenticatedClient(_factory, userId, email);
    }

    private static HttpClient CreateAuthenticatedClient(WebApplicationFactory<OpenAWork.Gateway.Host.Program> factory, string userId, string email)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthTestTokenFactory.Create(userId, email));
        return client;
    }

    private sealed class StubWorkflowLlmClient(string responseText) : OpenAWork.Gateway.Application.Abstractions.Settings.IWorkflowLlmClient
    {
        public Task<string> CompleteAsync(string apiBaseUrl, string apiKey, string model, string prompt, double temperature, CancellationToken cancellationToken)
            => Task.FromResult(responseText);
    }
}
