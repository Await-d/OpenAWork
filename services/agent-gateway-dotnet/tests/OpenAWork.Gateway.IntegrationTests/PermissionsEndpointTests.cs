using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Application.Abstractions.Settings;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;
using OpenAWork.Gateway.Persistence.EFCore.Stores;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class PermissionsEndpointTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public PermissionsEndpointTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task CreateAndListPendingPermissions_ShouldPersistRequestPublishEventAndPauseSession()
    {
        const string userId = "user-permissions-create";
        const string sessionId = "session-permissions-create";
        await SeedUserAndSessionAsync(_factory, userId, sessionId);

        using var client = CreateAuthenticatedClient(_factory, userId);
        var createResponse = await client.PostAsJsonAsync($"/sessions/{sessionId}/permissions/requests", new
        {
            toolName = "bash",
            scope = "/repo",
            reason = "need shell",
            riskLevel = "high",
            clientRequestId = "req-permission-1",
        });
        var createPayload = await createResponse.Content.ReadFromJsonAsync<JsonElement>();

        createResponse.EnsureSuccessStatusCode();
        var requestId = createPayload.GetProperty("request").GetProperty("requestId").GetString();
        Assert.Equal("pending", createPayload.GetProperty("request").GetProperty("status").GetString());
        Assert.False(createPayload.GetProperty("request").TryGetProperty("previewAction", out _));
        Assert.False(createPayload.GetProperty("request").TryGetProperty("decision", out _));

        var listResponse = await client.GetAsync($"/sessions/{sessionId}/permissions/pending");
        var listPayload = await listResponse.Content.ReadFromJsonAsync<JsonElement>();
        listResponse.EnsureSuccessStatusCode();
        Assert.Single(listPayload.GetProperty("requests").EnumerateArray());
        Assert.False(listPayload.GetProperty("requests")[0].TryGetProperty("previewAction", out _));
        Assert.False(listPayload.GetProperty("requests")[0].TryGetProperty("decision", out _));

        await using var scope = _factory.Services.CreateAsyncScope();
        var permissionStore = scope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
        var runEventStore = scope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();

        var persisted = await permissionStore.GetAsync(sessionId, requestId!, CancellationToken.None);
        Assert.NotNull(persisted);
        Assert.Equal("req-permission-1", JsonDocument.Parse(persisted.RequestPayloadJson!).RootElement.GetProperty("clientRequestId").GetString());
        Assert.Equal("[\"/repo\"]", persisted.AlwaysJson);

        var runEvents = await runEventStore.ListByRequestAsync(sessionId, "req-permission-1", CancellationToken.None);
        Assert.Contains(runEvents, (eventRecord) => eventRecord.EventType == "permission_asked");
        var permissionAskedPayload = JsonDocument.Parse(runEvents.Single((eventRecord) => eventRecord.EventType == "permission_asked").PayloadJson).RootElement;
        Assert.False(permissionAskedPayload.TryGetProperty("previewAction", out _));

        var session = await dbContext.Sessions.SingleAsync((item) => item.Id == sessionId);
        Assert.Equal("paused", session.StateStatus);
    }

    [Fact]
    public async Task CreateRoute_ShouldReturnUnauthorizedWithoutBearerToken()
    {
        const string userId = "user-permissions-create-noauth";
        const string sessionId = "session-permissions-create-noauth";
        await SeedUserAndSessionAsync(_factory, userId, sessionId);

        using var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/permissions/requests", new
        {
            toolName = "bash",
            scope = "/repo",
            reason = "need shell",
            riskLevel = "high",
        });

        Assert.Equal(System.Net.HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task CreateRoute_ShouldRejectInvalidPreviewActionType()
    {
        const string userId = "user-permissions-create-invalid";
        const string sessionId = "session-permissions-create-invalid";
        await SeedUserAndSessionAsync(_factory, userId, sessionId);

        using var client = CreateAuthenticatedClient(_factory, userId);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/sessions/{sessionId}/permissions/requests")
        {
            Content = JsonContent.Create(new
            {
                toolName = "bash",
                scope = "/repo",
                reason = "need shell",
                riskLevel = "high",
                previewAction = new { invalid = true },
            }),
        };
        var response = await client.SendAsync(request);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(System.Net.HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Invalid input", payload.GetProperty("error").GetString());
        Assert.True(payload.GetProperty("issues").GetArrayLength() > 0);
    }

    [Fact]
    public async Task CreateRoute_ShouldRejectNonObjectJsonBodyWithIssues()
    {
        const string userId = "user-permissions-create-array";
        const string sessionId = "session-permissions-create-array";
        await SeedUserAndSessionAsync(_factory, userId, sessionId);

        using var client = CreateAuthenticatedClient(_factory, userId);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/sessions/{sessionId}/permissions/requests")
        {
            Content = new StringContent("[]", Encoding.UTF8, "application/json"),
        };
        var response = await client.SendAsync(request);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(System.Net.HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Invalid input", payload.GetProperty("error").GetString());
        Assert.Equal("invalid_type", payload.GetProperty("issues")[0].GetProperty("code").GetString());
        Assert.Equal("object", payload.GetProperty("issues")[0].GetProperty("expected").GetString());
    }

    [Fact]
    public async Task CreateRoute_ShouldRejectNullClientRequestIdWithIssues()
    {
        const string userId = "user-permissions-create-null-client-request";
        const string sessionId = "session-permissions-create-null-client-request";
        await SeedUserAndSessionAsync(_factory, userId, sessionId);

        using var client = CreateAuthenticatedClient(_factory, userId);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/sessions/{sessionId}/permissions/requests")
        {
            Content = new StringContent("{\"toolName\":\"bash\",\"scope\":\"/repo\",\"reason\":\"need shell\",\"riskLevel\":\"high\",\"clientRequestId\":null}", Encoding.UTF8, "application/json"),
        };
        var response = await client.SendAsync(request);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(System.Net.HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Invalid input", payload.GetProperty("error").GetString());
        Assert.Equal("null", payload.GetProperty("issues")[0].GetProperty("received").GetString());
    }

    [Fact]
    public async Task Reply_ShouldRejectExpiredPermissionRequestsBeforeApprovalContinues()
    {
        const string userId = "user-permissions-expired";
        const string sessionId = "session-permissions-expired";
        await SeedUserAndSessionAsync(_factory, userId, sessionId, stateStatus: "paused");

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var permissionStore = scope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
            await permissionStore.InsertAsync(new PermissionRequestInfoRecord(
                "permission-expired",
                sessionId,
                "bash",
                "/repo",
                "need shell",
                "high",
                null,
                "pending",
                null,
                "{\"clientRequestId\":\"expired-req-1\"}",
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 1_000,
                null,
                "2026-04-20 12:00:00",
                "2026-04-20 12:00:00"),
                CancellationToken.None);
        }

        using var client = CreateAuthenticatedClient(_factory, userId);
        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/permissions/reply", new
        {
            requestId = "permission-expired",
            decision = "once",
        });
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(System.Net.HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("Permission request expired", payload.GetProperty("error").GetString());

        await using var verificationScope = _factory.Services.CreateAsyncScope();
        var permissionStoreAfter = verificationScope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
        var runEventStore = verificationScope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
        var dbContext = verificationScope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var expired = await permissionStoreAfter.GetAsync(sessionId, "permission-expired", CancellationToken.None);
        Assert.NotNull(expired);
        Assert.Equal("rejected", expired.Status);
        Assert.Equal("reject", expired.Decision);

        var runEvents = await runEventStore.ListByRequestAsync(sessionId, "expired-req-1", CancellationToken.None);
        Assert.Contains(runEvents, (eventRecord) => eventRecord.EventType == "permission_replied");
        var repliedPayload = JsonDocument.Parse(runEvents.Single((eventRecord) => eventRecord.EventType == "permission_replied").PayloadJson).RootElement;
        Assert.False(repliedPayload.TryGetProperty("feedback", out _));

        var session = await dbContext.Sessions.SingleAsync((item) => item.Id == sessionId);
        Assert.Equal("idle", session.StateStatus);
    }

    [Fact]
    public async Task ReplyRoute_ShouldRejectNonObjectJsonBodyWithIssues()
    {
        const string userId = "user-permissions-reply-array";
        const string sessionId = "session-permissions-reply-array";
        await SeedUserAndSessionAsync(_factory, userId, sessionId, stateStatus: "paused");

        using var client = CreateAuthenticatedClient(_factory, userId);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/sessions/{sessionId}/permissions/reply")
        {
            Content = new StringContent("\"oops\"", Encoding.UTF8, "application/json"),
        };
        var response = await client.SendAsync(request);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(System.Net.HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Invalid input", payload.GetProperty("error").GetString());
        Assert.Equal("invalid_type", payload.GetProperty("issues")[0].GetProperty("code").GetString());
        Assert.Equal("object", payload.GetProperty("issues")[0].GetProperty("expected").GetString());
    }

    [Fact]
    public async Task ReplyRoute_ShouldReturnNotFoundForNonOwner()
    {
        const string ownerUserId = "user-permissions-owner";
        const string otherUserId = "user-permissions-other";
        const string sessionId = "session-permissions-owner";
        await SeedUserAndSessionAsync(_factory, ownerUserId, sessionId, stateStatus: "paused");
        await SeedUserAndSessionAsync(_factory, otherUserId, "session-permissions-other");

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var permissionStore = scope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
            await permissionStore.InsertAsync(new PermissionRequestInfoRecord(
                "permission-owner-only",
                sessionId,
                "bash",
                "/repo",
                "need shell",
                "high",
                null,
                "pending",
                null,
                "{\"clientRequestId\":\"owner-req-1\"}",
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 10_000,
                null,
                "2026-04-20 12:01:00",
                "2026-04-20 12:01:00"),
                CancellationToken.None);
        }

        using var client = CreateAuthenticatedClient(_factory, otherUserId);
        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/permissions/reply", new
        {
            requestId = "permission-owner-only",
            decision = "once",
        });

        Assert.Equal(System.Net.HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Reply_ShouldApproveAndResumeStoredRequestPayload()
    {
        const string userId = "user-permissions-approve-resume";
        const string sessionId = "session-permissions-approve-resume";
        var workspaceRoot = CreateWorkspaceRoot();
        using var factory = CreateFactoryWithLlm(
            new StubWorkflowLlmClient("resumed after approval"),
            new Dictionary<string, string?>
            {
                ["WORKSPACE_ROOT"] = workspaceRoot,
            });
        await SeedUserAndSessionAsync(factory, userId, sessionId, stateStatus: "paused");

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var permissionStore = scope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
            await permissionStore.InsertAsync(new PermissionRequestInfoRecord(
                "permission-approve",
                sessionId,
                "bash",
                "/repo",
                "need shell",
                "high",
                null,
                "pending",
                null,
                JsonSerializer.Serialize(new
                {
                    clientRequestId = "resume-req-1",
                    nextRound = 2,
                    requestData = new
                    {
                        message = "继续实现",
                        agentId = "hephaestus",
                        model = "gpt-test",
                        thinkingEnabled = true,
                        webSearchEnabled = false,
                    },
                    toolCallId = "tool-1",
                    rawInput = new { command = "pwd" },
                }),
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 10_000,
                null,
                "2026-04-20 12:05:00",
                "2026-04-20 12:05:00"),
                CancellationToken.None);
        }

        using var client = CreateAuthenticatedClient(factory, userId);
        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/permissions/reply", new
        {
            requestId = "permission-approve",
            decision = "once",
        });
        response.EnsureSuccessStatusCode();

        await WaitForConditionAsync(async () =>
        {
            await using var scope = factory.Services.CreateAsyncScope();
            var runEventStore = scope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
            var runEvents = await runEventStore.ListByRequestAsync(sessionId, "resume-req-1", CancellationToken.None);
            return runEvents.Any((item) => item.EventType == "done");
        });

        await using var verificationScope = factory.Services.CreateAsyncScope();
        var permissionStoreAfter = verificationScope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
        var runEventStoreAfter = verificationScope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
        var dbContext = verificationScope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var decisionLogs = dbContext.Set<PermissionDecisionLogRecord>();
        var resolved = await permissionStoreAfter.GetAsync(sessionId, "permission-approve", CancellationToken.None);
        Assert.NotNull(resolved);
        Assert.Equal("approved", resolved.Status);
        Assert.Equal("once", resolved.Decision);
        Assert.Contains(await decisionLogs.Where((item) => item.RequestId == "permission-approve").ToListAsync(), (item) => item.Decision == "once");

        var runEvents = await runEventStoreAfter.ListByRequestAsync(sessionId, "resume-req-1", CancellationToken.None);
        Assert.Contains(runEvents, (eventRecord) => eventRecord.EventType == "permission_replied");
        Assert.Contains(runEvents, (eventRecord) => eventRecord.EventType == "tool_result");
        Assert.Contains(runEvents, (eventRecord) => eventRecord.EventType == "text_delta");
        Assert.Contains(runEvents, (eventRecord) => eventRecord.EventType == "done");

        var toolResultPayload = JsonDocument.Parse(runEvents.Single((eventRecord) => eventRecord.EventType == "tool_result").PayloadJson).RootElement;
        Assert.Equal("tool-1", toolResultPayload.GetProperty("toolCallId").GetString());
        Assert.Equal("bash", toolResultPayload.GetProperty("toolName").GetString());
        Assert.False(toolResultPayload.GetProperty("isError").GetBoolean());
        Assert.Equal(workspaceRoot, toolResultPayload.GetProperty("output").GetString());

        var session = await dbContext.Sessions.SingleAsync((item) => item.Id == sessionId);
        Assert.Equal("idle", session.StateStatus);
    }

    [Fact]
    public async Task Reply_ShouldPersistPermanentDecisionForWorkspaceRoot()
    {
        const string userId = "user-permissions-permanent";
        const string sessionId = "session-permissions-permanent";
        var workspaceRoot = CreateWorkspaceRoot();
        await using var cleanup = new AsyncDirectoryCleanup(workspaceRoot);
        using var factory = CreateFactoryWithLlm(
            new StubWorkflowLlmClient("permission permanent resumed"),
            new Dictionary<string, string?>
            {
                ["WORKSPACE_ROOT"] = workspaceRoot,
            });
        await SeedUserAndSessionAsync(
            factory,
            userId,
            sessionId,
            stateStatus: "paused",
            metadataJson: JsonSerializer.Serialize(new
            {
                workingDirectory = Path.Combine(workspaceRoot, "apps", "web"),
            }));

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var permissionStore = scope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
            await permissionStore.InsertAsync(new PermissionRequestInfoRecord(
                "permission-permanent",
                sessionId,
                "bash",
                "/repo",
                "need shell",
                "high",
                null,
                "pending",
                null,
                JsonSerializer.Serialize(new
                {
                    clientRequestId = "req-permission-permanent",
                    nextRound = 2,
                    requestData = new
                    {
                        message = "继续实现",
                        model = "gpt-test",
                    },
                    toolCallId = "tool-permission-permanent",
                    rawInput = new { command = "pwd" },
                }),
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 10_000,
                null,
                "2026-04-21 18:00:00",
                "2026-04-21 18:00:00"),
                CancellationToken.None);
        }

        using var client = CreateAuthenticatedClient(factory, userId);
        var replyResponse = await client.PostAsJsonAsync($"/sessions/{sessionId}/permissions/reply", new
        {
            requestId = "permission-permanent",
            decision = "permanent",
        });
        replyResponse.EnsureSuccessStatusCode();

        await WaitForConditionAsync(async () =>
        {
            await using var scope = factory.Services.CreateAsyncScope();
            var runEventStore = scope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
            var runEvents = await runEventStore.ListByRequestAsync(sessionId, "req-permission-permanent", CancellationToken.None);
            return runEvents.Any((item) => item.EventType == "done");
        });

        await using var verificationScope = factory.Services.CreateAsyncScope();
        var permissionStore = verificationScope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
        var dbContext = verificationScope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var stored = await permissionStore.GetAsync(sessionId, "permission-permanent", CancellationToken.None);
        Assert.NotNull(stored);
        Assert.Equal("approved", stored.Status);
        Assert.Equal("permanent", stored.Decision);

        var decisionLog = await dbContext.Set<PermissionDecisionLogRecord>().SingleAsync((item) => item.RequestId == "permission-permanent");
        Assert.Equal(workspaceRoot, decisionLog.WorkspaceRoot);

        var permissionConfigPath = Path.Combine(workspaceRoot, ".openawork.permissions.json");
        Assert.True(File.Exists(permissionConfigPath));
        using var configDocument = JsonDocument.Parse(await File.ReadAllTextAsync(permissionConfigPath));
        var permanentGrants = configDocument.RootElement.GetProperty("permanentGrants");
        Assert.Contains(permanentGrants.EnumerateArray(), (grant) =>
            grant.GetProperty("toolName").GetString() == "bash"
            && grant.GetProperty("scope").GetString() == "/repo");
        var rules = configDocument.RootElement.GetProperty("rules");
        Assert.Contains(rules.EnumerateArray(), (rule) =>
            rule.GetProperty("permission").GetString() == "bash"
            && rule.GetProperty("pattern").GetString() == "/repo"
            && rule.GetProperty("action").GetString() == "allow");

        var session = await dbContext.Sessions.SingleAsync((item) => item.Id == sessionId);
        Assert.Equal("idle", session.StateStatus);
    }

    [Fact]
    public async Task Reply_ShouldPersistPermanentDecisionForMatchedWorkspaceRootFromWorkspaceRoots()
    {
        const string userId = "user-permissions-permanent-multiroot";
        var firstWorkspaceRoot = CreateWorkspaceRoot();
        var secondWorkspaceRoot = CreateWorkspaceRoot();
        await using var firstCleanup = new AsyncDirectoryCleanup(firstWorkspaceRoot);
        await using var secondCleanup = new AsyncDirectoryCleanup(secondWorkspaceRoot);
        Directory.CreateDirectory(Path.Combine(secondWorkspaceRoot, "apps", "web"));
        using var factory = CreateFactoryWithLlm(
            new StubWorkflowLlmClient("permission permanent resumed on second root"),
            new Dictionary<string, string?>
            {
                ["WORKSPACE_ROOTS"] = JsonSerializer.Serialize(new[] { firstWorkspaceRoot, secondWorkspaceRoot }),
            });
        await SeedUserAsync(factory, userId);
        using var client = CreateAuthenticatedClient(factory, userId);
        var workingDirectory = Path.Combine(secondWorkspaceRoot, "apps", "web");
        var createResponse = await client.PostAsJsonAsync("/sessions", new
        {
            workingDirectory,
        });
        var createPayload = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        createResponse.EnsureSuccessStatusCode();
        var sessionId = createPayload.GetProperty("sessionId").GetString()!;

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            var permissionStore = scope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
            var session = await dbContext.Sessions.SingleAsync((item) => item.Id == sessionId);
            session.StateStatus = "paused";
            session.UpdatedAtUtc = DateTimeOffset.UtcNow;
            await permissionStore.InsertAsync(new PermissionRequestInfoRecord(
                "permission-permanent-multiroot",
                sessionId,
                "bash",
                "/repo",
                "need shell",
                "high",
                null,
                "pending",
                null,
                JsonSerializer.Serialize(new
                {
                    clientRequestId = "req-permission-permanent-multiroot",
                    nextRound = 2,
                    requestData = new
                    {
                        message = "继续实现",
                        model = "gpt-test",
                    },
                    toolCallId = "tool-permission-permanent-multiroot",
                    rawInput = new { command = "pwd", workdir = workingDirectory },
                }),
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 10_000,
                JsonSerializer.Serialize(new[] { "/repo" }),
                "2026-04-21 18:05:00",
                "2026-04-21 18:05:00"),
                CancellationToken.None);
            await dbContext.SaveChangesAsync();
        }

        var replyResponse = await client.PostAsJsonAsync($"/sessions/{sessionId}/permissions/reply", new
        {
            requestId = "permission-permanent-multiroot",
            decision = "permanent",
        });
        replyResponse.EnsureSuccessStatusCode();

        await WaitForConditionAsync(async () =>
        {
            await using var scope = factory.Services.CreateAsyncScope();
            var runEventStore = scope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
            var runEvents = await runEventStore.ListByRequestAsync(sessionId, "req-permission-permanent-multiroot", CancellationToken.None);
            return runEvents.Any((item) => item.EventType == "done");
        });

        await using var verificationScope = factory.Services.CreateAsyncScope();
        var dbContext = verificationScope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var runEventStore = verificationScope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
        var decisionLog = await dbContext.Set<PermissionDecisionLogRecord>().SingleAsync((item) => item.RequestId == "permission-permanent-multiroot");
        Assert.Equal(secondWorkspaceRoot, decisionLog.WorkspaceRoot);
        Assert.False(File.Exists(Path.Combine(firstWorkspaceRoot, ".openawork.permissions.json")));
        Assert.True(File.Exists(Path.Combine(secondWorkspaceRoot, ".openawork.permissions.json")));
        var runEvents = await runEventStore.ListByRequestAsync(sessionId, "req-permission-permanent-multiroot", CancellationToken.None);
        var toolResultPayload = JsonDocument.Parse(runEvents.Single((eventRecord) => eventRecord.EventType == "tool_result").PayloadJson).RootElement;
        Assert.False(toolResultPayload.GetProperty("isError").GetBoolean());
        Assert.Equal(workingDirectory, toolResultPayload.GetProperty("output").GetString());
    }

    [Fact]
    public async Task Reply_ShouldRecoverFromMalformedExistingPermissionConfig()
    {
        const string userId = "user-permissions-malformed-config";
        const string sessionId = "session-permissions-malformed-config";
        var workspaceRoot = CreateWorkspaceRoot();
        await using var cleanup = new AsyncDirectoryCleanup(workspaceRoot);
        Directory.CreateDirectory(Path.Combine(workspaceRoot, "apps", "web"));
        var permissionConfigPath = Path.Combine(workspaceRoot, ".openawork.permissions.json");
        await File.WriteAllTextAsync(permissionConfigPath, "{not valid json");

        using var factory = CreateFactoryWithLlm(
            new StubWorkflowLlmClient("permission permanent resumed after malformed config"),
            new Dictionary<string, string?>
            {
                ["WORKSPACE_ROOT"] = workspaceRoot,
            });
        await SeedUserAndSessionAsync(
            factory,
            userId,
            sessionId,
            stateStatus: "paused",
            metadataJson: JsonSerializer.Serialize(new
            {
                workingDirectory = Path.Combine(workspaceRoot, "apps", "web"),
            }));

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var permissionStore = scope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
            await permissionStore.InsertAsync(new PermissionRequestInfoRecord(
                "permission-permanent-malformed-config",
                sessionId,
                "bash",
                "/repo",
                "need shell",
                "high",
                null,
                "pending",
                null,
                JsonSerializer.Serialize(new
                {
                    clientRequestId = "req-permission-permanent-malformed-config",
                    nextRound = 2,
                    requestData = new
                    {
                        message = "继续实现",
                        model = "gpt-test",
                    },
                    toolCallId = "tool-permission-permanent-malformed-config",
                    rawInput = new { command = "pwd" },
                }),
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 10_000,
                JsonSerializer.Serialize(new[] { "/repo" }),
                "2026-04-21 18:06:00",
                "2026-04-21 18:06:00"),
                CancellationToken.None);
        }

        using var client = CreateAuthenticatedClient(factory, userId);
        var replyResponse = await client.PostAsJsonAsync($"/sessions/{sessionId}/permissions/reply", new
        {
            requestId = "permission-permanent-malformed-config",
            decision = "permanent",
        });
        replyResponse.EnsureSuccessStatusCode();

        await using var verificationScope = factory.Services.CreateAsyncScope();
        var permissionStore = verificationScope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
        var stored = await permissionStore.GetAsync(sessionId, "permission-permanent-malformed-config", CancellationToken.None);
        Assert.NotNull(stored);
        Assert.Equal("approved", stored.Status);
        using var configDocument = JsonDocument.Parse(await File.ReadAllTextAsync(permissionConfigPath));
        Assert.Contains(configDocument.RootElement.GetProperty("rules").EnumerateArray(), (rule) =>
            rule.GetProperty("pattern").GetString() == "/repo"
            && rule.GetProperty("permission").GetString() == "bash");
    }

    [Fact]
    public async Task Reply_ShouldRollbackPermissionFileWhenCompletePermanentMaterializationFails()
    {
        const string userId = "user-permissions-permanent-complete-failure";
        const string sessionId = "session-permissions-permanent-complete-failure";
        const string requestId = "permission-permanent-complete-failure";
        const string clientRequestId = "req-permission-permanent-complete-failure";
        const string originalPermissionConfig = "{\"rules\":[{\"permission\":\"read\",\"pattern\":\"/existing\",\"action\":\"allow\"}],\"permanentGrants\":[]}";

        var workspaceRoot = CreateWorkspaceRoot();
        await using var cleanup = new AsyncDirectoryCleanup(workspaceRoot);
        Directory.CreateDirectory(Path.Combine(workspaceRoot, "apps", "web"));
        var permissionConfigPath = Path.Combine(workspaceRoot, ".openawork.permissions.json");
        await File.WriteAllTextAsync(permissionConfigPath, originalPermissionConfig);

        using var factory = CreateFactoryWithLlm(
            new StubWorkflowLlmClient("should not run when permanent complete fails"),
            new Dictionary<string, string?>
            {
                ["WORKSPACE_ROOT"] = workspaceRoot,
            },
            (services) =>
            {
                services.RemoveAll<IPermissionRequestStore>();
                services.AddScoped<IPermissionRequestStore>((serviceProvider) =>
                    new ThrowOnCompletePermissionRequestStore(
                        new PermissionRequestStore(serviceProvider.GetRequiredService<GatewayDbContext>())));
            });

        await SeedUserAndSessionAsync(
            factory,
            userId,
            sessionId,
            stateStatus: "paused",
            metadataJson: JsonSerializer.Serialize(new
            {
                workingDirectory = Path.Combine(workspaceRoot, "apps", "web"),
            }));

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var permissionStore = scope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
            await permissionStore.InsertAsync(new PermissionRequestInfoRecord(
                requestId,
                sessionId,
                "bash",
                "/repo",
                "need shell",
                "high",
                null,
                "pending",
                null,
                JsonSerializer.Serialize(new
                {
                    clientRequestId,
                    nextRound = 2,
                    requestData = new
                    {
                        message = "继续实现",
                        model = "gpt-test",
                    },
                    toolCallId = "tool-permission-permanent-complete-failure",
                    rawInput = new { command = "pwd" },
                }),
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 10_000,
                JsonSerializer.Serialize(new[] { "/repo" }),
                "2026-04-21 18:06:30",
                "2026-04-21 18:06:30"),
                CancellationToken.None);
        }

        using var client = CreateAuthenticatedClient(factory, userId);
        var replyResponse = await client.PostAsJsonAsync($"/sessions/{sessionId}/permissions/reply", new
        {
            requestId,
            decision = "permanent",
        });
        var payload = await replyResponse.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(System.Net.HttpStatusCode.InternalServerError, replyResponse.StatusCode);
        Assert.Equal("Gateway request failed.", payload.GetProperty("title").GetString());
        Assert.Equal(500, payload.GetProperty("status").GetInt32());

        await using var verificationScope = factory.Services.CreateAsyncScope();
        var permissionStoreAfter = verificationScope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
        var runEventStore = verificationScope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
        var dbContext = verificationScope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var stored = await permissionStoreAfter.GetAsync(sessionId, requestId, CancellationToken.None);
        Assert.NotNull(stored);
        Assert.Equal("pending", stored.Status);
        Assert.Null(stored.Decision);
        Assert.Empty(await dbContext.Set<PermissionDecisionLogRecord>().Where((item) => item.RequestId == requestId).ToListAsync());
        Assert.Equal(originalPermissionConfig, await File.ReadAllTextAsync(permissionConfigPath));
        Assert.Empty(await runEventStore.ListByRequestAsync(sessionId, clientRequestId, CancellationToken.None));

        var session = await dbContext.Sessions.SingleAsync((item) => item.Id == sessionId);
        Assert.Equal("paused", session.StateStatus);
    }

    [Fact]
    public async Task Reply_ShouldReturn409WhenWorkspaceRootCannotBeResolvedForPermanentDecision()
    {
        const string userId = "user-permissions-permanent-no-root";
        const string sessionId = "session-permissions-permanent-no-root";
        using var factory = CreateFactoryWithLlm(
            new StubWorkflowLlmClient("should not run when permanent root missing"),
            new Dictionary<string, string?>
            {
                ["WORKSPACE_ROOTS"] = JsonSerializer.Serialize(new[] { CreateWorkspaceRoot() }),
            });
        await SeedUserAndSessionAsync(
            factory,
            userId,
            sessionId,
            stateStatus: "paused",
            metadataJson: JsonSerializer.Serialize(new
            {
                workingDirectory = "/outside/of/configured/root",
            }));

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var permissionStore = scope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
            await permissionStore.InsertAsync(new PermissionRequestInfoRecord(
                "permission-permanent-no-root",
                sessionId,
                "bash",
                "/repo",
                "need shell",
                "high",
                null,
                "pending",
                null,
                JsonSerializer.Serialize(new
                {
                    clientRequestId = "req-permission-permanent-no-root",
                    nextRound = 2,
                    requestData = new
                    {
                        message = "继续实现",
                        model = "gpt-test",
                    },
                    toolCallId = "tool-permission-permanent-no-root",
                    rawInput = new { command = "pwd" },
                }),
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 10_000,
                JsonSerializer.Serialize(new[] { "/repo" }),
                "2026-04-21 18:07:00",
                "2026-04-21 18:07:00"),
                CancellationToken.None);
        }

        using var client = CreateAuthenticatedClient(factory, userId);
        var replyResponse = await client.PostAsJsonAsync($"/sessions/{sessionId}/permissions/reply", new
        {
            requestId = "permission-permanent-no-root",
            decision = "permanent",
        });
        var payload = await replyResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(System.Net.HttpStatusCode.Conflict, replyResponse.StatusCode);
        Assert.Equal("Workspace root unavailable for permanent permission", payload.GetProperty("error").GetString());

        await using var verificationScope = factory.Services.CreateAsyncScope();
        var permissionStore = verificationScope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
        var dbContext = verificationScope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var stored = await permissionStore.GetAsync(sessionId, "permission-permanent-no-root", CancellationToken.None);
        Assert.NotNull(stored);
        Assert.Equal("pending", stored.Status);
        Assert.Null(stored.Decision);
        Assert.Empty(await dbContext.Set<PermissionDecisionLogRecord>().Where((item) => item.RequestId == "permission-permanent-no-root").ToListAsync());
    }

    [Fact]
    public async Task Reply_ShouldReturnToolResultErrorForInvalidApprovedBashWorkdir()
    {
        const string userId = "user-permissions-invalid-workdir";
        const string sessionId = "session-permissions-invalid-workdir";
        var workspaceRoot = CreateWorkspaceRoot();
        using var factory = CreateFactoryWithLlm(
            new StubWorkflowLlmClient("should not run after invalid workdir"),
            new Dictionary<string, string?>
            {
                ["WORKSPACE_ROOT"] = workspaceRoot,
            });
        await SeedUserAndSessionAsync(factory, userId, sessionId, stateStatus: "paused");

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var permissionStore = scope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
            await permissionStore.InsertAsync(new PermissionRequestInfoRecord(
                "permission-invalid-workdir",
                sessionId,
                "bash",
                "/repo",
                "need shell",
                "high",
                null,
                "pending",
                null,
                JsonSerializer.Serialize(new
                {
                    clientRequestId = "invalid-workdir-req-1",
                    nextRound = 2,
                    requestData = new
                    {
                        message = "继续实现",
                        model = "gpt-test",
                    },
                    toolCallId = "tool-invalid-workdir-1",
                    rawInput = new { command = "pwd", workdir = Path.GetTempPath() },
                }),
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 10_000,
                null,
                "2026-04-20 12:06:00",
                "2026-04-20 12:06:00"),
                CancellationToken.None);
        }

        using var client = CreateAuthenticatedClient(factory, userId);
        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/permissions/reply", new
        {
            requestId = "permission-invalid-workdir",
            decision = "once",
        });
        response.EnsureSuccessStatusCode();

        await WaitForConditionAsync(async () =>
        {
            await using var scope = factory.Services.CreateAsyncScope();
            var runEventStore = scope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
            var runEvents = await runEventStore.ListByRequestAsync(sessionId, "invalid-workdir-req-1", CancellationToken.None);
            return runEvents.Any((item) => item.EventType == "done");
        });

        await using var verificationScope = factory.Services.CreateAsyncScope();
        var runEventStoreAfter = verificationScope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
        var runEvents = await runEventStoreAfter.ListByRequestAsync(sessionId, "invalid-workdir-req-1", CancellationToken.None);
        var toolResultPayload = JsonDocument.Parse(runEvents.Single((eventRecord) => eventRecord.EventType == "tool_result").PayloadJson).RootElement;
        Assert.True(toolResultPayload.GetProperty("isError").GetBoolean());
        Assert.Equal("invalid_workdir", toolResultPayload.GetProperty("reason").GetString());
        Assert.Contains("WORKSPACE_ROOT", toolResultPayload.GetProperty("output").GetString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Reply_ShouldReturnToolResultErrorForUnsafeApprovedBashCommand()
    {
        const string userId = "user-permissions-invalid-command";
        const string sessionId = "session-permissions-invalid-command";
        var workspaceRoot = CreateWorkspaceRoot();
        using var factory = CreateFactoryWithLlm(
            new StubWorkflowLlmClient("should not run after invalid command"),
            new Dictionary<string, string?>
            {
                ["WORKSPACE_ROOT"] = workspaceRoot,
            });
        await SeedUserAndSessionAsync(factory, userId, sessionId, stateStatus: "paused");

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var permissionStore = scope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
            await permissionStore.InsertAsync(new PermissionRequestInfoRecord(
                "permission-invalid-command",
                sessionId,
                "bash",
                "/repo",
                "need shell",
                "high",
                null,
                "pending",
                null,
                JsonSerializer.Serialize(new
                {
                    clientRequestId = "invalid-command-req-1",
                    nextRound = 2,
                    requestData = new
                    {
                        message = "继续实现",
                        model = "gpt-test",
                    },
                    toolCallId = "tool-invalid-command-1",
                    rawInput = new { command = "pwd; whoami" },
                }),
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 10_000,
                null,
                "2026-04-20 12:06:30",
                "2026-04-20 12:06:30"),
                CancellationToken.None);
        }

        using var client = CreateAuthenticatedClient(factory, userId);
        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/permissions/reply", new
        {
            requestId = "permission-invalid-command",
            decision = "once",
        });
        response.EnsureSuccessStatusCode();

        await WaitForConditionAsync(async () =>
        {
            await using var scope = factory.Services.CreateAsyncScope();
            var runEventStore = scope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
            var runEvents = await runEventStore.ListByRequestAsync(sessionId, "invalid-command-req-1", CancellationToken.None);
            return runEvents.Any((item) => item.EventType == "done");
        });

        await using var verificationScope = factory.Services.CreateAsyncScope();
        var runEventStoreAfter = verificationScope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
        var runEvents = await runEventStoreAfter.ListByRequestAsync(sessionId, "invalid-command-req-1", CancellationToken.None);
        var toolResultPayload = JsonDocument.Parse(runEvents.Single((eventRecord) => eventRecord.EventType == "tool_result").PayloadJson).RootElement;
        Assert.True(toolResultPayload.GetProperty("isError").GetBoolean());
        Assert.Equal("invalid_command", toolResultPayload.GetProperty("reason").GetString());
        Assert.Contains("shell chaining", toolResultPayload.GetProperty("output").GetString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Reply_ShouldReturnToolResultErrorForSymlinkedApprovedBashWorkdir()
    {
        if (OperatingSystem.IsWindows())
        {
            return;
        }

        const string userId = "user-permissions-symlink-workdir";
        const string sessionId = "session-permissions-symlink-workdir";
        var workspaceRoot = CreateWorkspaceRoot();
        var externalDirectory = Path.Combine(Path.GetTempPath(), $"openawork-permissions-external-{Guid.NewGuid():N}");
        Directory.CreateDirectory(externalDirectory);
        var symlinkPath = Path.Combine(workspaceRoot, "linked-workdir");
        Directory.CreateSymbolicLink(symlinkPath, externalDirectory);

        using var factory = CreateFactoryWithLlm(
            new StubWorkflowLlmClient("should not run after symlink workdir"),
            new Dictionary<string, string?>
            {
                ["WORKSPACE_ROOT"] = workspaceRoot,
            });
        await SeedUserAndSessionAsync(factory, userId, sessionId, stateStatus: "paused");

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var permissionStore = scope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
            await permissionStore.InsertAsync(new PermissionRequestInfoRecord(
                "permission-symlink-workdir",
                sessionId,
                "bash",
                "/repo",
                "need shell",
                "high",
                null,
                "pending",
                null,
                JsonSerializer.Serialize(new
                {
                    clientRequestId = "symlink-workdir-req-1",
                    nextRound = 2,
                    requestData = new
                    {
                        message = "继续实现",
                        model = "gpt-test",
                    },
                    toolCallId = "tool-symlink-workdir-1",
                    rawInput = new { command = "pwd", workdir = symlinkPath },
                }),
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 10_000,
                null,
                "2026-04-20 12:06:45",
                "2026-04-20 12:06:45"),
                CancellationToken.None);
        }

        using var client = CreateAuthenticatedClient(factory, userId);
        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/permissions/reply", new
        {
            requestId = "permission-symlink-workdir",
            decision = "once",
        });
        response.EnsureSuccessStatusCode();

        await WaitForConditionAsync(async () =>
        {
            await using var scope = factory.Services.CreateAsyncScope();
            var runEventStore = scope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
            var runEvents = await runEventStore.ListByRequestAsync(sessionId, "symlink-workdir-req-1", CancellationToken.None);
            return runEvents.Any((item) => item.EventType == "done");
        });

        await using var verificationScope = factory.Services.CreateAsyncScope();
        var runEventStoreAfter = verificationScope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
        var runEvents = await runEventStoreAfter.ListByRequestAsync(sessionId, "symlink-workdir-req-1", CancellationToken.None);
        var toolResultPayload = JsonDocument.Parse(runEvents.Single((eventRecord) => eventRecord.EventType == "tool_result").PayloadJson).RootElement;
        Assert.True(toolResultPayload.GetProperty("isError").GetBoolean());
        Assert.Equal("invalid_workdir", toolResultPayload.GetProperty("reason").GetString());
        Assert.Contains("symbolic links", toolResultPayload.GetProperty("output").GetString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Reply_ShouldRejectCurrentRequestAndCascadeOtherPendingRequests()
    {
        const string userId = "user-permissions-reject-cascade";
        const string sessionId = "session-permissions-reject-cascade";
        await SeedUserAndSessionAsync(_factory, userId, sessionId, stateStatus: "paused");

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var permissionStore = scope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
            await permissionStore.InsertAsync(new PermissionRequestInfoRecord(
                "permission-primary",
                sessionId,
                "bash",
                "/repo",
                "need shell",
                "high",
                null,
                "pending",
                null,
                "{\"clientRequestId\":\"reject-req-1\"}",
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 5_000,
                null,
                "2026-04-20 12:10:00",
                "2026-04-20 12:10:00"),
                CancellationToken.None);
            await permissionStore.InsertAsync(new PermissionRequestInfoRecord(
                "permission-secondary",
                sessionId,
                "write",
                "/repo/a.ts",
                "need write",
                "medium",
                null,
                "pending",
                null,
                "{\"clientRequestId\":\"reject-req-2\"}",
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 5_000,
                null,
                "2026-04-20 12:10:01",
                "2026-04-20 12:10:01"),
                CancellationToken.None);
        }

        using var client = CreateAuthenticatedClient(_factory, userId);
        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/permissions/reply", new
        {
            requestId = "permission-primary",
            decision = "reject",
            feedback = "不要执行 bash",
        });
        response.EnsureSuccessStatusCode();

        await using var verificationScope = _factory.Services.CreateAsyncScope();
        var permissionStoreAfter = verificationScope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
        var runEventStoreAfter = verificationScope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
        var dbContext = verificationScope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var decisionLogs = dbContext.Set<PermissionDecisionLogRecord>();
        var primary = await permissionStoreAfter.GetAsync(sessionId, "permission-primary", CancellationToken.None);
        var secondary = await permissionStoreAfter.GetAsync(sessionId, "permission-secondary", CancellationToken.None);
        Assert.Equal("rejected", primary?.Status);
        Assert.Equal("reject", primary?.Decision);
        Assert.Equal("rejected", secondary?.Status);
        Assert.Equal("reject", secondary?.Decision);

        var primaryEvents = await runEventStoreAfter.ListByRequestAsync(sessionId, "reject-req-1", CancellationToken.None);
        var secondaryEvents = await runEventStoreAfter.ListByRequestAsync(sessionId, "reject-req-2", CancellationToken.None);
        Assert.Contains(primaryEvents, (eventRecord) => eventRecord.EventType == "permission_replied");
        Assert.Contains(secondaryEvents, (eventRecord) => eventRecord.EventType == "permission_replied");

        var session = await dbContext.Sessions.SingleAsync((item) => item.Id == sessionId);
        Assert.Equal("idle", session.StateStatus);
        Assert.Contains(await decisionLogs.Where((item) => item.RequestId == "permission-primary").ToListAsync(), (item) => item.Decision == "reject");
    }

    [Fact]
    public async Task Reply_ShouldSetRunningStateForSessionDecisionWithoutResumePayload()
    {
        const string userId = "user-permissions-session-decision";
        const string sessionId = "session-permissions-session-decision";
        await SeedUserAndSessionAsync(_factory, userId, sessionId, stateStatus: "paused");

        using var client = CreateAuthenticatedClient(_factory, userId);
        var createResponse = await client.PostAsJsonAsync($"/sessions/{sessionId}/permissions/requests", new
        {
            toolName = "bash",
            scope = "/repo",
            reason = "need shell",
            riskLevel = "high",
            clientRequestId = "req-permission-session",
        });
        var createPayload = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        createResponse.EnsureSuccessStatusCode();

        var requestId = createPayload.GetProperty("request").GetProperty("requestId").GetString();
        var replyResponse = await client.PostAsJsonAsync($"/sessions/{sessionId}/permissions/reply", new
        {
            requestId,
            decision = "session",
        });
        replyResponse.EnsureSuccessStatusCode();

        await using var verificationScope = _factory.Services.CreateAsyncScope();
        var dbContext = verificationScope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var session = await dbContext.Sessions.SingleAsync((item) => item.Id == sessionId);
        Assert.Equal("running", session.StateStatus);
        Assert.Contains(await dbContext.Set<PermissionDecisionLogRecord>().Where((item) => item.RequestId == requestId).ToListAsync(), (item) => item.Decision == "session");
    }

    [Fact]
    public async Task Reply_ShouldResumeRejectedPermissionWhenContinueOnDenyEnabled()
    {
        const string userId = "user-permissions-continue-on-deny";
        const string sessionId = "session-permissions-continue-on-deny";
        using var factory = CreateFactoryWithLlm(
            new StubWorkflowLlmClient("fallback after denial"),
            new Dictionary<string, string?>
            {
                ["OPENAWORK_CONTINUE_ON_DENY"] = "true",
            });
        await SeedUserAndSessionAsync(factory, userId, sessionId, stateStatus: "paused");

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var permissionStore = scope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
            await permissionStore.InsertAsync(new PermissionRequestInfoRecord(
                "permission-deny-resume",
                sessionId,
                "bash",
                "/repo",
                "need shell",
                "high",
                null,
                "pending",
                null,
                JsonSerializer.Serialize(new
                {
                    clientRequestId = "deny-resume-req-1",
                    nextRound = 2,
                    requestData = new
                    {
                        message = "继续实现",
                        model = "gpt-test",
                    },
                    toolCallId = "tool-deny-1",
                    rawInput = new { command = "pwd" },
                }),
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 10_000,
                null,
                "2026-04-20 12:15:00",
                "2026-04-20 12:15:00"),
                CancellationToken.None);
        }

        using var client = CreateAuthenticatedClient(factory, userId);
        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/permissions/reply", new
        {
            requestId = "permission-deny-resume",
            decision = "reject",
            feedback = "换个办法",
        });
        response.EnsureSuccessStatusCode();

        await WaitForConditionAsync(async () =>
        {
            await using var scope = factory.Services.CreateAsyncScope();
            var runEventStore = scope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
            var runEvents = await runEventStore.ListByRequestAsync(sessionId, "deny-resume-req-1", CancellationToken.None);
            return runEvents.Any((item) => item.EventType == "done");
        });

        await using var verificationScope = factory.Services.CreateAsyncScope();
        var runEventStoreAfter = verificationScope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
        var dbContext = verificationScope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var runEvents = await runEventStoreAfter.ListByRequestAsync(sessionId, "deny-resume-req-1", CancellationToken.None);
        Assert.Contains(runEvents, (eventRecord) => eventRecord.EventType == "permission_replied");
        Assert.Contains(runEvents, (eventRecord) => eventRecord.EventType == "tool_result");
        Assert.Contains(runEvents, (eventRecord) => eventRecord.EventType == "text_delta");

        var toolResultPayload = JsonDocument.Parse(runEvents.Single((eventRecord) => eventRecord.EventType == "tool_result").PayloadJson).RootElement;
        Assert.Equal("tool-deny-1", toolResultPayload.GetProperty("toolCallId").GetString());
        Assert.True(toolResultPayload.GetProperty("isError").GetBoolean());
        Assert.False(toolResultPayload.TryGetProperty("resumedAfterApproval", out _));

        var session = await dbContext.Sessions.SingleAsync((item) => item.Id == sessionId);
        Assert.Equal("idle", session.StateStatus);
    }

    private static HttpClient CreateAuthenticatedClient(WebApplicationFactory<OpenAWork.Gateway.Host.Program> factory, string userId)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthTestTokenFactory.Create(userId));
        return client;
    }

    private static WebApplicationFactory<OpenAWork.Gateway.Host.Program> CreateFactoryWithLlm(
        IWorkflowLlmClient llmClient,
        IReadOnlyDictionary<string, string?>? configurationOverrides = null,
        Action<IServiceCollection>? configureServices = null)
    {
        return new GatewayWebApplicationFactory().WithWebHostBuilder((builder) =>
        {
            if (configurationOverrides is not null)
            {
                builder.ConfigureAppConfiguration((_, configurationBuilder) =>
                {
                    configurationBuilder.AddInMemoryCollection(configurationOverrides);
                });
            }

            builder.ConfigureTestServices((services) =>
            {
                services.RemoveAll<IWorkflowLlmClient>();
                services.AddSingleton(llmClient);
                configureServices?.Invoke(services);
            });
        });
    }

    private static async Task SeedUserAsync(WebApplicationFactory<OpenAWork.Gateway.Host.Program> factory, string userId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
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

    private static string CreateWorkspaceRoot()
    {
        var path = Path.Combine(Path.GetTempPath(), $"openawork-permissions-root-{Guid.NewGuid():N}");
        Directory.CreateDirectory(path);
        return path;
    }

    private static async Task SeedUserAndSessionAsync(WebApplicationFactory<OpenAWork.Gateway.Host.Program> factory, string userId, string sessionId, string stateStatus = "idle", string metadataJson = "{}")
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
        }

        if (!await dbContext.Sessions.AnyAsync((session) => session.Id == sessionId))
        {
            dbContext.Sessions.Add(new SessionRecord
            {
                Id = sessionId,
                UserId = userId,
                MessagesJson = "[]",
                StateStatus = stateStatus,
                MetadataJson = metadataJson,
                Title = "Permissions Session",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
        }

        await dbContext.SaveChangesAsync();
    }

    private static async Task WaitForConditionAsync(Func<Task<bool>> condition, int attempts = 40, int delayMs = 50)
    {
        for (var attempt = 0; attempt < attempts; attempt += 1)
        {
            if (await condition())
            {
                return;
            }

            await Task.Delay(delayMs);
        }

        throw new TimeoutException("Condition was not satisfied in time.");
    }

    private sealed class ThrowOnCompletePermissionRequestStore(IPermissionRequestStore inner) : IPermissionRequestStore
    {
        public Task InsertAsync(PermissionRequestInfoRecord record, CancellationToken cancellationToken)
            => inner.InsertAsync(record, cancellationToken);

        public Task<PermissionRequestInfoRecord?> GetAsync(string sessionId, string requestId, CancellationToken cancellationToken)
            => inner.GetAsync(sessionId, requestId, cancellationToken);

        public Task<IReadOnlyList<PermissionRequestInfoRecord>> ListPendingAsync(string sessionId, CancellationToken cancellationToken)
            => inner.ListPendingAsync(sessionId, cancellationToken);

        public Task<string?> FindLatestPendingIdAsync(string sessionId, string toolName, string scope, CancellationToken cancellationToken)
            => inner.FindLatestPendingIdAsync(sessionId, toolName, scope, cancellationToken);

        public Task<bool> UpdatePendingPayloadAsync(string requestId, string payloadJson, string updatedAt, CancellationToken cancellationToken)
            => inner.UpdatePendingPayloadAsync(requestId, payloadJson, updatedAt, cancellationToken);

        public Task<bool> BeginPermanentMaterializationAsync(string sessionId, string requestId, string updatedAt, CancellationToken cancellationToken)
            => inner.BeginPermanentMaterializationAsync(sessionId, requestId, updatedAt, cancellationToken);

        public Task<bool> CompletePermanentMaterializationAsync(string sessionId, string requestId, string updatedAt, CancellationToken cancellationToken)
            => throw new InvalidOperationException("Simulated permanent materialization completion failure.");

        public Task<bool> RevertPermanentMaterializationAsync(string sessionId, string requestId, string updatedAt, CancellationToken cancellationToken)
            => inner.RevertPermanentMaterializationAsync(sessionId, requestId, updatedAt, cancellationToken);

        public Task<bool> UpdateResolutionAsync(string sessionId, string requestId, string status, string? decision, string updatedAt, CancellationToken cancellationToken)
            => inner.UpdateResolutionAsync(sessionId, requestId, status, decision, updatedAt, cancellationToken);

        public Task<IReadOnlyList<PermissionRequestInfoRecord>> ExpirePendingAsync(string sessionId, long nowMs, string updatedAt, CancellationToken cancellationToken)
            => inner.ExpirePendingAsync(sessionId, nowMs, updatedAt, cancellationToken);

        public Task<bool> MarkConsumedAsync(string requestId, string updatedAt, CancellationToken cancellationToken)
            => inner.MarkConsumedAsync(requestId, updatedAt, cancellationToken);
    }

    private sealed class AsyncDirectoryCleanup : IAsyncDisposable
    {
        private readonly string _path;

        public AsyncDirectoryCleanup(string path)
        {
            _path = path;
        }

        public ValueTask DisposeAsync()
        {
            if (Directory.Exists(_path))
            {
                Directory.Delete(_path, recursive: true);
            }

            return ValueTask.CompletedTask;
        }
    }

    private sealed class StubWorkflowLlmClient(string responseText) : IWorkflowLlmClient
    {
        public Task<string> CompleteAsync(string apiBaseUrl, string apiKey, string model, string prompt, double temperature, CancellationToken cancellationToken)
            => Task.FromResult(responseText);
    }
}
