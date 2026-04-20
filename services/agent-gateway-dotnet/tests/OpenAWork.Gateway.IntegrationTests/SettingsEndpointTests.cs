using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
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
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("Unauthorized", payload.GetProperty("error").GetString());
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
    public async Task Companion_ShouldReturnSafeDefaults_WhenMissing()
    {
        const string userId = "user-companion-default";
        await SeedSettingAsync(userId, "workers", "[]");
        using var client = CreateAuthenticatedClient(userId, $"{userId}@openawork.local");

        var response = await client.GetAsync("/settings/companion");
        var payload = await response.Content.ReadFromJsonAsync<CompanionSettingsResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.Empty(payload.Bindings);
        Assert.True(payload.Feature.Enabled);
        Assert.Equal("beta", payload.Feature.Mode);
        Assert.True(payload.Preferences.Enabled);
        Assert.Equal("mention_only", payload.Preferences.InjectionMode);
        Assert.False(string.IsNullOrWhiteSpace(payload.Profile.Name));
        Assert.False(string.IsNullOrWhiteSpace(payload.Profile.Species));
        Assert.False(string.IsNullOrWhiteSpace(payload.Profile.Sprite.Species));
    }

    [Fact]
    public async Task CompanionPut_ShouldMergeAndPersistSettings()
    {
        const string userId = "user-companion-put";
        await SeedSettingAsync(userId, "workers", "[]");
        await SeedSettingAsync(userId, "companion_preferences_v1", "{\"preferences\":{\"enabled\":true,\"muted\":false,\"reducedMotion\":false,\"verbosity\":\"normal\",\"injectionMode\":\"mention_only\",\"themeVariant\":\"default\",\"voiceOutputEnabled\":false,\"voiceOutputMode\":\"buddy_only\",\"voiceRate\":1.02,\"voiceVariant\":\"system\"},\"bindings\":{\"hephaestus\":{\"behaviorTone\":\"focused\",\"displayName\":\"Heph 小锤\",\"injectionMode\":\"always\",\"species\":\"robot\",\"themeVariant\":\"playful\",\"verbosity\":\"minimal\",\"voiceOutputMode\":\"important_only\",\"voiceRate\":1.15,\"voiceVariant\":\"bright\"}},\"profile\":null,\"updatedAt\":\"2026-04-01T00:00:00.000Z\"}");
        using var client = CreateAuthenticatedClient(userId, $"{userId}@openawork.local");

        var response = await client.PutAsJsonAsync("/settings/companion?agentId=hephaestus", new
        {
            bindings = new
            {
                hephaestus = new
                {
                    behaviorTone = "focused",
                    displayName = "Heph 小锤",
                    injectionMode = "always",
                    species = "robot",
                    themeVariant = "playful",
                    verbosity = "minimal",
                    voiceOutputMode = "important_only",
                    voiceRate = 1.15,
                    voiceVariant = "bright",
                },
            },
            preferences = new
            {
                voiceOutputEnabled = true,
                voiceOutputMode = "buddy_only",
                voiceRate = 1.02,
                voiceVariant = "system",
                muted = true,
                verbosity = "minimal",
            },
        });

        var payload = await response.Content.ReadFromJsonAsync<CompanionSettingsResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.True(payload.Preferences.VoiceOutputEnabled);
        Assert.True(payload.Preferences.Muted);
        Assert.Equal("minimal", payload.Preferences.Verbosity);
        Assert.Equal("Heph 小锤", payload.Profile.Name);
        Assert.Equal("机械体", payload.Profile.Species);

        using var scope = _factory.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var stored = await dbContext.UserSettings.SingleAsync((setting) => setting.UserId == userId && setting.Key == "companion_preferences_v1");
        Assert.Contains("voiceOutputEnabled", stored.Value, StringComparison.Ordinal);
        Assert.Contains("Heph 小锤", stored.Value, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Companion_ShouldResolveProfileForQueriedAgentBinding()
    {
        const string userId = "user-companion-agent";
        await SeedSettingAsync(userId, "workers", "[]");
        await SeedSettingAsync(userId, "companion_preferences_v1", "{\"bindings\":{\"hephaestus\":{\"behaviorTone\":\"focused\",\"displayName\":\"Heph 小锤\",\"injectionMode\":\"always\",\"species\":\"robot\",\"themeVariant\":\"playful\",\"verbosity\":\"minimal\",\"voiceOutputMode\":\"important_only\",\"voiceRate\":1.15,\"voiceVariant\":\"bright\"}},\"preferences\":{\"enabled\":true,\"muted\":false,\"reducedMotion\":false,\"verbosity\":\"normal\",\"injectionMode\":\"mention_only\",\"themeVariant\":\"default\",\"voiceOutputEnabled\":false,\"voiceOutputMode\":\"buddy_only\",\"voiceRate\":1.02,\"voiceVariant\":\"system\"}}");
        using var client = CreateAuthenticatedClient(userId, $"{userId}@openawork.local");

        var response = await client.GetAsync("/settings/companion?agentId=hephaestus");
        var payload = await response.Content.ReadFromJsonAsync<CompanionSettingsResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.NotNull(payload.ActiveBinding);
        Assert.Equal("Heph 小锤", payload.Profile.Name);
        Assert.Equal("机械体", payload.Profile.Species);
    }

    [Fact]
    public async Task CompanionChat_ShouldReturn503_WhenLlmConfigMissing()
    {
        const string userId = "user-companion-chat";
        await SeedSettingAsync(userId, "workers", "[]");
        using var client = CreateAuthenticatedClient(userId, $"{userId}@openawork.local");

        var response = await client.PostAsJsonAsync("/settings/companion/chat", new
        {
            message = "继续这个任务",
            agentId = "hephaestus",
        });
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("Companion chat LLM is not configured", payload.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Providers_ShouldReturnStoredProvidersActiveSelectionAndDefaultThinking()
    {
        const string userId = "user-providers";
        await SeedSettingAsync(userId, "providers", "[{\"id\":\"openai\",\"enabled\":true,\"defaultModels\":[{\"id\":\"gpt-4o\",\"enabled\":true},{\"id\":\"gpt-4.1\",\"enabled\":false}]},{\"id\":\"anthropic\",\"enabled\":false,\"defaultModels\":[{\"id\":\"claude-opus-4-5\",\"enabled\":true}]}]");
        await SeedSettingAsync(userId, "active_selection", "{\"chat\":{\"providerId\":\"openai\",\"modelId\":\"gpt-4o\"},\"fast\":{\"providerId\":\"openai\",\"modelId\":\"gpt-4o-mini\"}}");
        await SeedSettingAsync(userId, "default_thinking", "{\"chat\":{\"enabled\":true,\"effort\":\"high\"},\"fast\":{\"enabled\":false,\"effort\":\"medium\"}}");

        using var client = CreateAuthenticatedClient(userId);

        var response = await client.GetAsync("/settings/providers");
        var payload = await response.Content.ReadFromJsonAsync<ProvidersSettingsResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.True(payload.Providers.Count >= 8);
        var openAiProvider = payload.Providers.First((provider) => provider.GetProperty("id").GetString() == "openai");
        Assert.Equal("gpt-4o", openAiProvider.GetProperty("defaultModels").EnumerateArray().First((model) => model.GetProperty("id").GetString() == "gpt-4o").GetProperty("id").GetString());
        Assert.Equal("openai", payload.ActiveSelection.Chat.ProviderId);
        Assert.Equal("gpt-4o-mini", payload.ActiveSelection.Fast.ModelId);
        Assert.True(payload.DefaultThinking.GetProperty("chat").GetProperty("enabled").GetBoolean());
        Assert.Equal("high", payload.DefaultThinking.GetProperty("chat").GetProperty("effort").GetString());
    }

    [Fact]
    public async Task Providers_ShouldFilterDisabledProvidersAndModels_WhenEnabledOnlyRequested()
    {
        const string userId = "user-providers-enabled-only";
        await SeedSettingAsync(userId, "providers", "[{\"id\":\"openai\",\"enabled\":true,\"defaultModels\":[{\"id\":\"gpt-4o\",\"enabled\":true},{\"id\":\"gpt-4.1\",\"enabled\":false}]},{\"id\":\"anthropic\",\"enabled\":false,\"defaultModels\":[{\"id\":\"claude-opus-4-5\",\"enabled\":true}]},{\"id\":\"deepseek\",\"enabled\":true,\"defaultModels\":[{\"id\":\"deepseek-chat\",\"enabled\":false}]}]");
        await SeedSettingAsync(userId, "active_selection", "{\"chat\":{\"providerId\":\"openai\",\"modelId\":\"gpt-4o\"},\"fast\":{\"providerId\":\"anthropic\",\"modelId\":\"claude-opus-4-5\"}}");

        using var client = CreateAuthenticatedClient(userId);

        var response = await client.GetAsync("/settings/providers?enabledOnly=true");
        var payload = await response.Content.ReadFromJsonAsync<ProvidersSettingsResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        var openAiProvider = payload.Providers.First((provider) => provider.GetProperty("id").GetString() == "openai");
        Assert.Single(openAiProvider.GetProperty("defaultModels").EnumerateArray(), (model) => model.GetProperty("enabled").GetBoolean() && model.GetProperty("id").GetString() == "gpt-4o");
        Assert.Contains(payload.Providers, (provider) => provider.GetProperty("id").GetString() == "anthropic");
        Assert.Equal("openai", payload.ActiveSelection.Fast.ProviderId);
        Assert.Equal("gpt-4.1", payload.ActiveSelection.Fast.ModelId);
    }

    [Fact]
    public async Task ActiveSelection_ShouldReturnBuiltinFallback_WhenMissingOrInvalid()
    {
        const string userId = "user-active-selection-default";
        await SeedSettingAsync(userId, "active_selection", "{not-json}");

        using var client = CreateAuthenticatedClient(userId);

        var response = await client.GetAsync("/settings/active-selection");
        var payload = await response.Content.ReadFromJsonAsync<ActiveSelectionSettingsResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.Equal("anthropic", payload.ActiveSelection.Chat.ProviderId);
        Assert.Equal("claude-opus-4-0", payload.ActiveSelection.Chat.ModelId);
        Assert.Equal("openai", payload.ActiveSelection.Fast.ProviderId);
        Assert.Equal("gpt-4.1", payload.ActiveSelection.Fast.ModelId);
    }

    [Fact]
    public async Task ProvidersPut_ShouldPersistNormalizedProvidersSelectionAndThinking()
    {
        const string userId = "user-providers-put";
        await SeedSettingAsync(userId, "active_selection", "{\"chat\":{\"providerId\":\"openai\",\"modelId\":\"gpt-4o\"},\"fast\":{\"providerId\":\"openai\",\"modelId\":\"gpt-4o-mini\"}}");

        using var client = CreateAuthenticatedClient(userId);

        var response = await client.PutAsJsonAsync("/settings/providers", new
        {
            providers = new object[]
            {
                new
                {
                    id = "openai",
                    type = "openai",
                    name = "OpenAI",
                    enabled = true,
                    baseUrl = "https://api.openai.com/v1",
                    apiKeyEnv = "OPENAI_API_KEY",
                    defaultModels = new object[]
                    {
                        new
                        {
                            id = "gpt-4o",
                            label = "GPT-4o",
                            enabled = true,
                            contextWindow = 0,
                            maxOutputTokens = 0,
                        },
                    },
                },
            },
            defaultThinking = new
            {
                chat = new { enabled = true, effort = "high" },
                fast = new { enabled = false, effort = "medium" },
            },
        });

        var payload = await response.Content.ReadFromJsonAsync<ProvidersSettingsResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        var openAiProvider = payload.Providers.First((provider) => provider.GetProperty("id").GetString() == "openai");
        Assert.Equal("OPENAI_API_KEY", openAiProvider.GetProperty("apiKeyEnv").GetString());
        var gpt4o = openAiProvider.GetProperty("defaultModels").EnumerateArray().First((model) => model.GetProperty("id").GetString() == "gpt-4o");
        Assert.Equal(0, gpt4o.GetProperty("contextWindow").GetInt64());
        Assert.Equal(0, gpt4o.GetProperty("maxOutputTokens").GetInt64());
        Assert.Equal("openai", payload.ActiveSelection.Chat.ProviderId);
        Assert.Equal("gpt-4o", payload.ActiveSelection.Chat.ModelId);
        Assert.True(payload.DefaultThinking.GetProperty("chat").GetProperty("enabled").GetBoolean());

        using var scope = _factory.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var providersValue = await dbContext.UserSettings.SingleAsync((setting) => setting.UserId == userId && setting.Key == "providers");
        var activeSelectionValue = await dbContext.UserSettings.SingleAsync((setting) => setting.UserId == userId && setting.Key == "active_selection");
        var defaultThinkingValue = await dbContext.UserSettings.SingleAsync((setting) => setting.UserId == userId && setting.Key == "default_thinking");

        Assert.Contains("defaultModels", providersValue.Value, StringComparison.Ordinal);
        Assert.Contains("gpt-4o", activeSelectionValue.Value, StringComparison.Ordinal);
        Assert.Contains("high", defaultThinkingValue.Value, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ProvidersPut_ShouldReturnInvalidProviderConfig_WhenBodyIsInvalid()
    {
        const string userId = "user-providers-put-invalid";
        using var client = CreateAuthenticatedClient(userId);

        var response = await client.PutAsJsonAsync("/settings/providers", new
        {
            providers = new object[]
            {
                new
                {
                    id = "custom-1",
                    type = "custom",
                    name = "Custom",
                    enabled = true,
                    baseUrl = "",
                    defaultModels = new object[]
                    {
                        new
                        {
                            id = "model-a",
                            label = "Model A",
                            enabled = true,
                        },
                    },
                },
            },
        });

        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Invalid provider config", payload.GetProperty("error").GetString());
        Assert.NotEmpty(payload.GetProperty("issues").EnumerateArray());
    }

    [Fact]
    public async Task ActiveSelectionPut_ShouldPersistCompactionAndReturnOk()
    {
        const string userId = "user-active-selection-put";
        await SeedSettingAsync(userId, "providers", "[]");
        using var client = CreateAuthenticatedClient(userId);

        var response = await client.PutAsJsonAsync("/settings/active-selection", new
        {
            chat = new { providerId = "openai", modelId = "gpt-4o" },
            fast = new { providerId = "openai", modelId = "gpt-4o-mini" },
            compaction = new { providerId = "openai", modelId = "gpt-4o-mini" },
        });

        var payload = await response.Content.ReadFromJsonAsync<OkResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.True(payload.Ok);

        using var scope = _factory.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var storedSelection = await dbContext.UserSettings.SingleAsync((setting) => setting.UserId == userId && setting.Key == "active_selection");

        Assert.Contains("compaction", storedSelection.Value, StringComparison.Ordinal);
        Assert.Contains("gpt-4o-mini", storedSelection.Value, StringComparison.Ordinal);
    }

    [Fact]
    public async Task McpServers_ShouldReturnEmptyArray_WhenMissing()
    {
        using var client = CreateAuthenticatedClient("user-mcp-servers-missing");

        var response = await client.GetAsync("/settings/mcp-servers");
        var payload = await response.Content.ReadFromJsonAsync<McpServersResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.Equal(JsonValueKind.Array, payload.Servers.ValueKind);
        Assert.Empty(payload.Servers.EnumerateArray());
    }

    [Fact]
    public async Task McpServers_ShouldReturnEmptyArray_WhenStoredJsonIsInvalid()
    {
        const string userId = "user-mcp-servers-invalid";
        await SeedSettingAsync(userId, "mcp_servers", "{not-json}");

        using var client = CreateAuthenticatedClient(userId);

        var response = await client.GetAsync("/settings/mcp-servers");
        var payload = await response.Content.ReadFromJsonAsync<McpServersResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.Equal(JsonValueKind.Array, payload.Servers.ValueKind);
        Assert.Empty(payload.Servers.EnumerateArray());
    }

    [Fact]
    public async Task McpServersPut_ShouldPersistServersAndReturnOk()
    {
        const string userId = "user-mcp-servers-put";
        await SeedSettingAsync(userId, "workers", "[]");
        using var client = CreateAuthenticatedClient(userId);

        var response = await client.PutAsJsonAsync("/settings/mcp-servers", new
        {
            servers = new object[]
            {
                new
                {
                    id = "srv-1",
                    name = "Primary",
                    type = "http",
                    enabled = false,
                    url = "https://mcp.example.com",
                },
            },
        });

        var payload = await response.Content.ReadFromJsonAsync<OkResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.True(payload.Ok);

        using var scope = _factory.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var stored = await dbContext.UserSettings.SingleAsync((setting) => setting.UserId == userId && setting.Key == "mcp_servers");

        Assert.Contains("srv-1", stored.Value, StringComparison.Ordinal);
        Assert.Contains("Primary", stored.Value, StringComparison.Ordinal);
        Assert.Contains("https://mcp.example.com", stored.Value, StringComparison.Ordinal);
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
    public async Task DiagnosticsDelete_ShouldDeleteOnlyCurrentUsersErrorWorkflowLogs()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            dbContext.RequestWorkflowLogs.AddRange(
                new RequestWorkflowLogRecord
                {
                    RequestId = "wf-user-error",
                    UserId = "user-diag-delete",
                    SessionId = null,
                    Method = "GET",
                    Path = "/sessions/a/stream",
                    StatusCode = 500,
                    WorkflowJson = "[]",
                    CreatedAtUtc = DateTimeOffset.UtcNow,
                },
                new RequestWorkflowLogRecord
                {
                    RequestId = "wf-user-ok",
                    UserId = "user-diag-delete",
                    SessionId = null,
                    Method = "GET",
                    Path = "/sessions/a/stream",
                    StatusCode = 200,
                    WorkflowJson = "[]",
                    CreatedAtUtc = DateTimeOffset.UtcNow,
                },
                new RequestWorkflowLogRecord
                {
                    RequestId = "wf-other-error",
                    UserId = "user-other",
                    SessionId = null,
                    Method = "GET",
                    Path = "/sessions/b/stream",
                    StatusCode = 500,
                    WorkflowJson = "[]",
                    CreatedAtUtc = DateTimeOffset.UtcNow,
                });
            await dbContext.SaveChangesAsync();
        }

        using var client = CreateAuthenticatedClient("user-diag-delete");

        var response = await client.DeleteAsync("/settings/diagnostics");
        var payload = await response.Content.ReadFromJsonAsync<OkResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.True(payload.Ok);

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        Assert.DoesNotContain(await verifyDb.RequestWorkflowLogs.ToListAsync(), (row) => row.UserId == "user-diag-delete" && row.StatusCode >= 400);
        Assert.Contains(await verifyDb.RequestWorkflowLogs.ToListAsync(), (row) => row.UserId == "user-diag-delete" && row.StatusCode == 200);
        Assert.Contains(await verifyDb.RequestWorkflowLogs.ToListAsync(), (row) => row.UserId == "user-other" && row.StatusCode >= 400);
    }

    [Fact]
    public async Task DevLogs_ShouldReturnWorkflowLogs_ForCurrentUser()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            dbContext.RequestWorkflowLogs.AddRange(
                new RequestWorkflowLogRecord
                {
                    RequestId = "wf-a",
                    UserId = "user-dev-logs",
                    SessionId = "session-a",
                    Method = "GET",
                    Path = "/sessions/session-a/stream",
                    StatusCode = 500,
                    WorkflowJson = "[{\"name\":\"request.handle\",\"status\":\"error\"}]",
                    CreatedAtUtc = DateTimeOffset.UtcNow,
                },
                new RequestWorkflowLogRecord
                {
                    RequestId = "wf-b",
                    UserId = "user-other-dev-logs",
                    SessionId = "session-b",
                    Method = "GET",
                    Path = "/sessions/session-b/stream",
                    StatusCode = 200,
                    WorkflowJson = "[]",
                    CreatedAtUtc = DateTimeOffset.UtcNow,
                });
            await dbContext.SaveChangesAsync();
        }

        using var client = CreateAuthenticatedClient("user-dev-logs");

        var response = await client.GetAsync("/settings/dev-logs");
        var payload = await response.Content.ReadFromJsonAsync<DevLogsResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.Single(payload.Logs);
        Assert.Equal("request_workflow", payload.Logs[0].ToolName);
        Assert.Equal("workflow", payload.Logs[0].Source);
        Assert.True(payload.Logs[0].IsError);
        Assert.Equal("wf-a", payload.Logs[0].RequestId);
        Assert.NotNull(payload.Logs[0].Output);
    }

    [Fact]
    public async Task Version_ShouldReturnVersionShape()
    {
        using var client = CreateAuthenticatedClient("user-version");

        var response = await client.GetAsync("/settings/version");
        var payload = await response.Content.ReadFromJsonAsync<VersionResponse>();

        response.EnsureSuccessStatusCode();
        Assert.NotNull(payload);
        Assert.False(string.IsNullOrWhiteSpace(payload.CurrentVersion));
        Assert.False(string.IsNullOrWhiteSpace(payload.CheckedAt));
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

    private HttpClient CreateAuthenticatedClient(string userId, string? email = null)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthTestTokenFactory.Create(userId, email ?? "test@openawork.local"));
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
