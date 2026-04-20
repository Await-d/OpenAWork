using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class SessionsEndpointTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public SessionsEndpointTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task CreateListAndGet_ShouldRoundTripSessionShape()
    {
        const string userId = "user-sessions-roundtrip";

        var workspaceRoot = CreateWorkspaceRoot();
        await using var cleanup = new AsyncDirectoryCleanup(workspaceRoot);
        using var factory = CreateWorkspaceFactory(workspaceRoot);
        await SeedUserAsync(factory, userId);
        using var client = CreateAuthenticatedClient(factory, userId);

        var createResponse = await client.PostAsJsonAsync("/sessions", new
        {
            metadata = new
            {
                agentId = "hephaestus",
            },
            workingDirectory = Path.Combine(workspaceRoot, "apps", "web"),
        });
        var createPayload = await createResponse.Content.ReadFromJsonAsync<JsonElement>();

        createResponse.EnsureSuccessStatusCode();
        var sessionId = createPayload.GetProperty("sessionId").GetString();
        Assert.False(string.IsNullOrWhiteSpace(sessionId));

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            dbContext.MessageV2.Add(new MessageV2Record
            {
                Id = "msg-1",
                SessionId = sessionId!,
                UserId = userId,
                TimeCreated = 1000,
                DataJson = "{\"role\":\"assistant\",\"time\":{\"created\":1000},\"clientRequestId\":\"req-1\",\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            dbContext.PartV2.Add(new PartV2Record
            {
                Id = "part-1",
                MessageId = "msg-1",
                SessionId = sessionId!,
                UserId = userId,
                TimeCreated = 1001,
                DataJson = "{\"type\":\"text\",\"text\":\"Hello from V2\"}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            await dbContext.SaveChangesAsync();
        }

        var listResponse = await client.GetAsync("/sessions?limit=100");
        var listPayload = await listResponse.Content.ReadFromJsonAsync<JsonElement>();
        listResponse.EnsureSuccessStatusCode();

        var listedSession = listPayload.GetProperty("sessions").EnumerateArray().Single((item) => item.GetProperty("id").GetString() == sessionId);
        Assert.Equal("idle", listedSession.GetProperty("state_status").GetString());
        Assert.Equal(0, listedSession.GetProperty("fileChangesSummary").GetProperty("totalFileDiffs").GetInt32());

        var getResponse = await client.GetAsync($"/sessions/{sessionId}");
        var getPayload = await getResponse.Content.ReadFromJsonAsync<JsonElement>();
        getResponse.EnsureSuccessStatusCode();

        var session = getPayload.GetProperty("session");
        Assert.Equal(sessionId, session.GetProperty("id").GetString());
        Assert.Equal(1, session.GetProperty("messages").GetArrayLength());
        Assert.Equal("assistant", session.GetProperty("messages")[0].GetProperty("role").GetString());
        Assert.Equal("Hello from V2", session.GetProperty("messages")[0].GetProperty("content")[0].GetProperty("text").GetString());
        Assert.Equal(0, session.GetProperty("runEvents").GetArrayLength());
        Assert.Equal(0, session.GetProperty("todos").GetArrayLength());
        Assert.Contains(Path.Combine(workspaceRoot, "apps", "web"), session.GetProperty("metadata_json").GetString());
    }

    [Fact]
    public async Task Get_ShouldProjectToolPartsIntoV1CompatibleMessages()
    {
        const string userId = "user-sessions-tool-projection";
        await SeedUserAsync(_factory, userId);
        using var client = CreateAuthenticatedClient(_factory, userId);

        var createResponse = await client.PostAsJsonAsync("/sessions", new { });
        var createPayload = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var sessionId = createPayload.GetProperty("sessionId").GetString()!;

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            dbContext.MessageV2.Add(new MessageV2Record
            {
                Id = "msg-tool-1",
                SessionId = sessionId,
                UserId = userId,
                TimeCreated = 2000,
                DataJson = "{\"role\":\"assistant\",\"time\":{\"created\":2000},\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            dbContext.PartV2.Add(new PartV2Record
            {
                Id = "part-tool-1",
                MessageId = "msg-tool-1",
                SessionId = sessionId,
                UserId = userId,
                TimeCreated = 2001,
                DataJson = "{\"type\":\"tool\",\"tool\":\"write\",\"callID\":\"call-1\",\"state\":{\"status\":\"completed\",\"input\":{\"path\":\"/repo/a.ts\"},\"output\":\"ok\",\"title\":\"write\",\"metadata\":{\"toolResultContent\":{\"type\":\"tool_result\",\"toolCallId\":\"call-1\",\"toolName\":\"write\",\"output\":{\"ok\":true},\"isError\":false,\"fileDiffs\":[]}},\"time\":{\"start\":2000,\"end\":2001}}}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            await dbContext.SaveChangesAsync();
        }

        var getResponse = await client.GetAsync($"/sessions/{sessionId}");
        var getPayload = await getResponse.Content.ReadFromJsonAsync<JsonElement>();

        getResponse.EnsureSuccessStatusCode();
        var message = getPayload.GetProperty("session").GetProperty("messages")[0];
        var content = message.GetProperty("content");
        Assert.Equal(2, content.GetArrayLength());
        Assert.Equal("tool_call", content[0].GetProperty("type").GetString());
        Assert.Equal("call-1", content[0].GetProperty("toolCallId").GetString());
        Assert.Equal("tool_result", content[1].GetProperty("type").GetString());
        Assert.Equal("write", content[1].GetProperty("toolName").GetString());
        Assert.True(content[1].GetProperty("output").GetProperty("ok").GetBoolean());
    }

    [Fact]
    public async Task Get_ShouldProjectPendingToolPartsWithPermissionRequestId()
    {
        const string userId = "user-sessions-tool-pending";
        await SeedUserAsync(_factory, userId);
        using var client = CreateAuthenticatedClient(_factory, userId);

        var createResponse = await client.PostAsJsonAsync("/sessions", new { });
        var createPayload = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var sessionId = createPayload.GetProperty("sessionId").GetString()!;

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            dbContext.MessageV2.Add(new MessageV2Record
            {
                Id = "msg-tool-pending-1",
                SessionId = sessionId,
                UserId = userId,
                TimeCreated = 3000,
                DataJson = "{\"role\":\"assistant\",\"time\":{\"created\":3000},\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            dbContext.PartV2.Add(new PartV2Record
            {
                Id = "part-tool-pending-1",
                MessageId = "msg-tool-pending-1",
                SessionId = sessionId,
                UserId = userId,
                TimeCreated = 3001,
                DataJson = "{\"type\":\"tool\",\"tool\":\"bash\",\"callID\":\"call-pending-1\",\"state\":{\"status\":\"pending\",\"input\":{\"command\":\"pwd\"},\"raw\":\"{\\\"command\\\":\\\"pwd\\\"}\"}}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            await dbContext.SaveChangesAsync();
        }

        var getResponse = await client.GetAsync($"/sessions/{sessionId}");
        var getPayload = await getResponse.Content.ReadFromJsonAsync<JsonElement>();

        getResponse.EnsureSuccessStatusCode();
        var content = getPayload.GetProperty("session").GetProperty("messages")[0].GetProperty("content");
        Assert.Equal("tool_call", content[0].GetProperty("type").GetString());
        Assert.Equal("tool_result", content[1].GetProperty("type").GetString());
        Assert.False(content[1].GetProperty("isError").GetBoolean());
        Assert.Equal("call-pending-1", content[1].GetProperty("pendingPermissionRequestId").GetString());
    }

    [Fact]
    public async Task Get_ShouldPreferDedicatedToolResultOverAssistantPendingPlaceholder()
    {
        const string userId = "user-sessions-tool-dedup";
        await SeedUserAsync(_factory, userId);
        using var client = CreateAuthenticatedClient(_factory, userId);

        var createResponse = await client.PostAsJsonAsync("/sessions", new { });
        var createPayload = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var sessionId = createPayload.GetProperty("sessionId").GetString()!;

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            dbContext.MessageV2.Add(new MessageV2Record
            {
                Id = "msg-tool-dedup-assistant",
                SessionId = sessionId,
                UserId = userId,
                TimeCreated = 6000,
                DataJson = "{\"role\":\"assistant\",\"clientRequestId\":\"req-tool-dedup\",\"time\":{\"created\":6000},\"status\":\"final\",\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            dbContext.PartV2.Add(new PartV2Record
            {
                Id = "part-tool-dedup-assistant",
                MessageId = "msg-tool-dedup-assistant",
                SessionId = sessionId,
                UserId = userId,
                TimeCreated = 6001,
                DataJson = "{\"type\":\"tool\",\"tool\":\"bash\",\"callID\":\"call-dedup-1\",\"state\":{\"status\":\"pending\",\"input\":{\"command\":\"pwd\"},\"raw\":\"{\\\"command\\\":\\\"pwd\\\"}\"}}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            dbContext.MessageV2.Add(new MessageV2Record
            {
                Id = "msg-tool-dedup-result",
                SessionId = sessionId,
                UserId = userId,
                TimeCreated = 6002,
                DataJson = "{\"role\":\"tool\",\"clientRequestId\":\"req-tool-dedup:tool_result:call-dedup-1\",\"time\":{\"created\":6002},\"status\":\"final\"}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            dbContext.PartV2.Add(new PartV2Record
            {
                Id = "part-tool-dedup-result",
                MessageId = "msg-tool-dedup-result",
                SessionId = sessionId,
                UserId = userId,
                TimeCreated = 6003,
                DataJson = "{\"type\":\"tool\",\"tool\":\"bash\",\"callID\":\"call-dedup-1\",\"state\":{\"status\":\"completed\",\"input\":{\"command\":\"pwd\"},\"raw\":\"{\\\"command\\\":\\\"pwd\\\"}\",\"metadata\":{\"toolResultContent\":{\"type\":\"tool_result\",\"toolCallId\":\"call-dedup-1\",\"toolName\":\"bash\",\"output\":\"/workspace\",\"isError\":false}}}}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            await dbContext.SaveChangesAsync();
        }

        var getResponse = await client.GetAsync($"/sessions/{sessionId}");
        var getPayload = await getResponse.Content.ReadFromJsonAsync<JsonElement>();

        getResponse.EnsureSuccessStatusCode();
        var messages = getPayload.GetProperty("session").GetProperty("messages");
        Assert.Equal(2, messages.GetArrayLength());
        Assert.Single(messages[0].GetProperty("content").EnumerateArray());
        Assert.Equal("tool_call", messages[0].GetProperty("content")[0].GetProperty("type").GetString());
        Assert.Single(messages[1].GetProperty("content").EnumerateArray());
        Assert.Equal("tool_result", messages[1].GetProperty("content")[0].GetProperty("type").GetString());
        Assert.Equal("call-dedup-1", messages[1].GetProperty("content")[0].GetProperty("toolCallId").GetString());
    }

    [Fact]
    public async Task Get_ShouldSkipMessagesWithOnlySnapshotOrPatchParts()
    {
        const string userId = "user-sessions-nonv1-parts";
        await SeedUserAsync(_factory, userId);
        using var client = CreateAuthenticatedClient(_factory, userId);

        var createResponse = await client.PostAsJsonAsync("/sessions", new { });
        var createPayload = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var sessionId = createPayload.GetProperty("sessionId").GetString()!;

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            dbContext.MessageV2.Add(new MessageV2Record
            {
                Id = "msg-snapshot-only",
                SessionId = sessionId,
                UserId = userId,
                TimeCreated = 4000,
                DataJson = "{\"role\":\"assistant\",\"time\":{\"created\":4000},\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            dbContext.PartV2.Add(new PartV2Record
            {
                Id = "part-snapshot-only",
                MessageId = "msg-snapshot-only",
                SessionId = sessionId,
                UserId = userId,
                TimeCreated = 4001,
                DataJson = "{\"type\":\"snapshot\",\"snapshot\":\"snap-1\"}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            dbContext.MessageV2.Add(new MessageV2Record
            {
                Id = "msg-text-visible",
                SessionId = sessionId,
                UserId = userId,
                TimeCreated = 5000,
                DataJson = "{\"role\":\"assistant\",\"time\":{\"created\":5000},\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            dbContext.PartV2.Add(new PartV2Record
            {
                Id = "part-text-visible",
                MessageId = "msg-text-visible",
                SessionId = sessionId,
                UserId = userId,
                TimeCreated = 5001,
                DataJson = "{\"type\":\"text\",\"text\":\"Visible transcript\"}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            await dbContext.SaveChangesAsync();
        }

        var getResponse = await client.GetAsync($"/sessions/{sessionId}");
        var getPayload = await getResponse.Content.ReadFromJsonAsync<JsonElement>();

        getResponse.EnsureSuccessStatusCode();
        var messages = getPayload.GetProperty("session").GetProperty("messages");
        Assert.Equal(1, messages.GetArrayLength());
        Assert.Equal("msg-text-visible", messages[0].GetProperty("id").GetString());
    }

    [Fact]
    public async Task Get_ShouldProjectReasoningAndModifiedFilesSummaryParts()
    {
        const string userId = "user-sessions-rich-parts";
        await SeedUserAsync(_factory, userId);
        using var client = CreateAuthenticatedClient(_factory, userId);

        var createResponse = await client.PostAsJsonAsync("/sessions", new { });
        var createPayload = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var sessionId = createPayload.GetProperty("sessionId").GetString()!;

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            dbContext.MessageV2.Add(new MessageV2Record
            {
                Id = "msg-rich-1",
                SessionId = sessionId,
                UserId = userId,
                TimeCreated = 6000,
                DataJson = "{\"role\":\"assistant\",\"time\":{\"created\":6000},\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            dbContext.PartV2.Add(new PartV2Record
            {
                Id = "part-reasoning-1",
                MessageId = "msg-rich-1",
                SessionId = sessionId,
                UserId = userId,
                TimeCreated = 6001,
                DataJson = "{\"type\":\"reasoning\",\"text\":\"Deep reasoning\",\"metadata\":{\"encryptedContent\":\"enc-1\",\"summary\":\"Reasoning summary\"}}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            dbContext.PartV2.Add(new PartV2Record
            {
                Id = "part-modified-files-1",
                MessageId = "msg-rich-1",
                SessionId = sessionId,
                UserId = userId,
                TimeCreated = 6002,
                DataJson = "{\"type\":\"modified_files_summary\",\"title\":\"Modified files\",\"summary\":\"2 files changed\",\"files\":[{\"file\":\"src/a.ts\",\"before\":\"a\",\"after\":\"b\",\"additions\":1,\"deletions\":0}]}",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
            await dbContext.SaveChangesAsync();
        }

        var getResponse = await client.GetAsync($"/sessions/{sessionId}");
        var getPayload = await getResponse.Content.ReadFromJsonAsync<JsonElement>();

        getResponse.EnsureSuccessStatusCode();
        var content = getPayload.GetProperty("session").GetProperty("messages")[0].GetProperty("content");
        Assert.Equal("reasoning", content[0].GetProperty("type").GetString());
        Assert.Equal("enc-1", content[0].GetProperty("encryptedContent").GetString());
        Assert.Equal("Reasoning summary", content[0].GetProperty("summary").GetString());
        Assert.Equal("modified_files_summary", content[1].GetProperty("type").GetString());
        Assert.Equal("Modified files", content[1].GetProperty("title").GetString());
        Assert.Equal(1, content[1].GetProperty("files").GetArrayLength());
    }

    [Fact]
    public async Task Get_ShouldReturnPersistedRunEvents()
    {
        const string userId = "user-sessions-run-events";
        await SeedUserAsync(_factory, userId);
        using var client = CreateAuthenticatedClient(_factory, userId);

        var createResponse = await client.PostAsJsonAsync("/sessions", new { });
        var createPayload = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var sessionId = createPayload.GetProperty("sessionId").GetString()!;

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var runEventStore = scope.ServiceProvider.GetRequiredService<OpenAWork.Gateway.Application.Abstractions.Persistence.ISessionRunEventStore>();
            await runEventStore.PersistAsync(new OpenAWork.Gateway.Application.Abstractions.Persistence.SessionRunEventInfoRecord(
                0,
                sessionId,
                userId,
                "req-1",
                1,
                "tool_result",
                "evt-1",
                "run-1",
                7000,
                "{\"type\":\"tool_result\",\"toolCallId\":\"call-1\",\"output\":{\"ok\":true}}",
                "2026-04-19 10:00:00"), CancellationToken.None);
        }

        var getResponse = await client.GetAsync($"/sessions/{sessionId}");
        var getPayload = await getResponse.Content.ReadFromJsonAsync<JsonElement>();

        getResponse.EnsureSuccessStatusCode();
        var runEvents = getPayload.GetProperty("session").GetProperty("runEvents");
        Assert.Equal(1, runEvents.GetArrayLength());
        Assert.Equal("tool_result", runEvents[0].GetProperty("type").GetString());
        Assert.Equal("call-1", runEvents[0].GetProperty("toolCallId").GetString());
        Assert.True(runEvents[0].GetProperty("output").GetProperty("ok").GetBoolean());
    }

    [Fact]
    public async Task Create_ShouldRejectUnsupportedMetadataKeys()
    {
        const string userId = "user-sessions-invalid-metadata";
        await SeedUserAsync(_factory, userId);
        using var client = CreateAuthenticatedClient(_factory, userId);

        var response = await client.PostAsJsonAsync("/sessions", new
        {
            metadata = new
            {
                activeLoopKind = "ralph",
                unexpected = "value",
            },
        });
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Invalid metadata", payload.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Create_ShouldRejectRelativeWorkingDirectory()
    {
        const string userId = "user-sessions-relative-path";
        var workspaceRoot = CreateWorkspaceRoot();
        await using var cleanup = new AsyncDirectoryCleanup(workspaceRoot);
        using var factory = CreateWorkspaceFactory(workspaceRoot);
        await SeedUserAsync(factory, userId);
        using var client = CreateAuthenticatedClient(factory, userId);

        var response = await client.PostAsJsonAsync("/sessions", new
        {
            workingDirectory = "apps/web",
        });
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("Forbidden", payload.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Create_ShouldRejectIncompleteTeamDefinitionMetadata()
    {
        const string userId = "user-sessions-teamdefinition";
        await SeedUserAsync(_factory, userId);
        using var client = CreateAuthenticatedClient(_factory, userId);

        var response = await client.PostAsJsonAsync("/sessions", new
        {
            metadata = new
            {
                teamDefinition = new
                {
                    defaultProvider = "anthropic",
                },
            },
        });
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Invalid metadata", payload.GetProperty("error").GetString());
        Assert.Contains("requiredRoleBindings", payload.GetProperty("issues").ToString());
        Assert.Contains("source", payload.GetProperty("issues").ToString());
    }

    [Fact]
    public async Task Patch_ShouldRejectInvalidWorkspacePathWithoutWritingTitle()
    {
        const string userId = "user-sessions-invalid-path";

        var workspaceRoot = CreateWorkspaceRoot();
        await using var cleanup = new AsyncDirectoryCleanup(workspaceRoot);
        using var factory = CreateWorkspaceFactory(workspaceRoot);
        await SeedUserAsync(factory, userId);
        using var client = CreateAuthenticatedClient(factory, userId);

        var createResponse = await client.PostAsJsonAsync("/sessions", new { });
        var createPayload = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var sessionId = createPayload.GetProperty("sessionId").GetString()!;

        var patchResponse = await client.PatchAsJsonAsync($"/sessions/{sessionId}", new
        {
            title = "不应该写入",
            metadata = new
            {
                workingDirectory = Path.Combine(Path.GetTempPath(), "openawork-outside-root", "project"),
            },
        });

        Assert.Equal(HttpStatusCode.Forbidden, patchResponse.StatusCode);

        var getResponse = await client.GetAsync($"/sessions/{sessionId}");
        var getPayload = await getResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Null(getPayload.GetProperty("session").GetProperty("title").GetString());
        Assert.Equal("{}", getPayload.GetProperty("session").GetProperty("metadata_json").GetString());
    }

    [Fact]
    public async Task Delete_ShouldBlockNonIdleSessions_AndRemoveTreeWhenIdle()
    {
        const string userId = "user-sessions-delete";
        await SeedUserAsync(_factory, userId);
        using var client = CreateAuthenticatedClient(_factory, userId);

        var parentResponse = await client.PostAsJsonAsync("/sessions", new { });
        var parentPayload = await parentResponse.Content.ReadFromJsonAsync<JsonElement>();
        var parentSessionId = parentPayload.GetProperty("sessionId").GetString()!;

        var childResponse = await client.PostAsJsonAsync("/sessions", new
        {
            metadata = new
            {
                parentSessionId,
            },
        });
        var childPayload = await childResponse.Content.ReadFromJsonAsync<JsonElement>();
        var childSessionId = childPayload.GetProperty("sessionId").GetString()!;

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            var parent = await dbContext.Sessions.SingleAsync((session) => session.Id == parentSessionId);
            parent.StateStatus = "running";
            parent.UpdatedAtUtc = DateTimeOffset.UtcNow;
            await dbContext.SaveChangesAsync();
        }

        var blockedResponse = await client.DeleteAsync($"/sessions/{parentSessionId}");
        var blockedPayload = await blockedResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.Conflict, blockedResponse.StatusCode);
        Assert.Equal("state", blockedPayload.GetProperty("blockReason").GetString());

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            var parent = await dbContext.Sessions.SingleAsync((session) => session.Id == parentSessionId);
            parent.StateStatus = "idle";
            parent.UpdatedAtUtc = DateTimeOffset.UtcNow;
            await dbContext.SaveChangesAsync();
        }

        var deleteResponse = await client.DeleteAsync($"/sessions/{parentSessionId}");
        var deletePayload = await deleteResponse.Content.ReadFromJsonAsync<JsonElement>();
        deleteResponse.EnsureSuccessStatusCode();
        Assert.True(deletePayload.GetProperty("ok").GetBoolean());
        Assert.Contains(parentSessionId, deletePayload.GetProperty("deletedSessionIds").EnumerateArray().Select((item) => item.GetString()));
        Assert.Contains(childSessionId, deletePayload.GetProperty("deletedSessionIds").EnumerateArray().Select((item) => item.GetString()));
    }

    [Fact]
    public async Task Patch_StateStatusOnly_ShouldNotUpdateUpdatedAt()
    {
        const string userId = "user-sessions-state-noop";
        await SeedUserAsync(_factory, userId);
        using var client = CreateAuthenticatedClient(_factory, userId);

        var createResponse = await client.PostAsJsonAsync("/sessions", new { });
        var createPayload = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var sessionId = createPayload.GetProperty("sessionId").GetString()!;

        DateTimeOffset beforeUpdatedAt;
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            beforeUpdatedAt = (await dbContext.Sessions.SingleAsync((session) => session.Id == sessionId)).UpdatedAtUtc;
        }

        var patchResponse = await client.PatchAsJsonAsync($"/sessions/{sessionId}", new
        {
            state_status = "running",
        });

        patchResponse.EnsureSuccessStatusCode();

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            var afterRecord = await dbContext.Sessions.SingleAsync((session) => session.Id == sessionId);
            Assert.Equal(beforeUpdatedAt, afterRecord.UpdatedAtUtc);
            Assert.Equal("idle", afterRecord.StateStatus);
        }
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

    private static WebApplicationFactory<OpenAWork.Gateway.Host.Program> CreateWorkspaceFactory(string workspaceRoot)
    {
        return new GatewayWebApplicationFactory().WithWebHostBuilder((builder) =>
        {
            builder.ConfigureAppConfiguration((_, configurationBuilder) =>
            {
                configurationBuilder.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["WORKSPACE_ROOT"] = workspaceRoot,
                });
            });
        });
    }

    private static HttpClient CreateAuthenticatedClient(WebApplicationFactory<OpenAWork.Gateway.Host.Program> factory, string userId)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthTestTokenFactory.Create(userId));
        return client;
    }

    private static string CreateWorkspaceRoot()
    {
        var path = Path.Combine(Path.GetTempPath(), $"openawork-session-root-{Guid.NewGuid():N}");
        Directory.CreateDirectory(path);
        return path;
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
}
