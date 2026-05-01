using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Application.Abstractions.Settings;
using OpenAWork.Gateway.Application.Abstractions.Streaming;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class SessionRuntimeReconcilerTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public SessionRuntimeReconcilerTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task HandleChildSessionTerminalAsync_ShouldAutoResumeParentWhenChildCompletes()
    {
        const string userId = "user-run010-child-success";
        const string parentSessionId = "session-run010-parent-success";
        const string childSessionId = "session-run010-child-success";
        using var factory = CreateFactoryWithLlm(new StubWorkflowLlmClient("parent resumed reply"));
        await SeedUserAndSessionsAsync(factory, userId, parentSessionId, childSessionId, childMetadataJson: JsonSerializer.Serialize(new
        {
            parentSessionId,
        }));
        await SeedChildAssistantSummaryAsync(factory, userId, childSessionId, "child finished summary");
        await UpsertAutoResumeContextAsync(factory, childSessionId, parentSessionId, userId, "task-success", JsonSerializer.Serialize(new
        {
            message = "parent original",
            agentId = "orchestrator",
            model = "gpt-test",
            thinkingEnabled = true,
            webSearchEnabled = false,
        }));

        await using var scope = factory.Services.CreateAsyncScope();
        var reconciler = scope.ServiceProvider.GetRequiredService<ISessionRuntimeReconciler>();
        var handled = await reconciler.HandleChildSessionTerminalAsync(
            new TaskChildSessionTerminalInput(childSessionId, userId, StatusCodes.Status200OK, false, null),
            CancellationToken.None);

        Assert.True(handled);
        await WaitForConditionAsync(async () => await HasParentRequestWithPrefixAsync(factory, parentSessionId, userId, "task-auto-resume:"));
        await WaitForConditionAsync(async () => await HasParentAssistantTextAsync(factory, parentSessionId, userId, "parent resumed reply"));

        await using var verificationScope = factory.Services.CreateAsyncScope();
        var dbContext = verificationScope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var parentMessages = await dbContext.MessageV2
            .AsNoTracking()
            .Where((item) => item.SessionId == parentSessionId && item.UserId == userId)
            .OrderBy((item) => item.TimeCreated)
            .ToListAsync();
        Assert.Contains(parentMessages, (message) => message.DataJson.Contains("task-auto-resume:", StringComparison.Ordinal));
        Assert.False(await dbContext.TaskParentAutoResumeContexts.AnyAsync((item) => item.ChildSessionId == childSessionId && item.UserId == userId));
    }

    [Fact]
    public async Task HandleChildSessionTerminalAsync_ShouldLeaveContextWhenParentBusyAndRetryOnHeartbeat()
    {
        const string userId = "user-run010-parent-busy";
        const string parentSessionId = "session-run010-parent-busy";
        const string childSessionId = "session-run010-child-busy";
        using var factory = CreateFactoryWithLlm(new StubWorkflowLlmClient("parent resumed after retry"));
        await SeedUserAndSessionsAsync(factory, userId, parentSessionId, childSessionId, childMetadataJson: JsonSerializer.Serialize(new
        {
            parentSessionId,
        }), parentStateStatus: "running");
        await SeedChildAssistantSummaryAsync(factory, userId, childSessionId, "child summary for retry");
        await UpsertAutoResumeContextAsync(factory, childSessionId, parentSessionId, userId, "task-busy", JsonSerializer.Serialize(new
        {
            message = "resume later",
            agentId = "orchestrator",
        }));

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var threadStore = scope.ServiceProvider.GetRequiredService<ISessionRuntimeThreadStore>();
            var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            await threadStore.UpsertAsync(new SessionRuntimeThreadInfoRecord(
                parentSessionId,
                userId,
                "req-parent-busy",
                nowMs,
                nowMs,
                FormatTimestamp(nowMs),
                FormatTimestamp(nowMs)),
                CancellationToken.None);
        }

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var reconciler = scope.ServiceProvider.GetRequiredService<ISessionRuntimeReconciler>();
            var handled = await reconciler.HandleChildSessionTerminalAsync(
                new TaskChildSessionTerminalInput(childSessionId, userId, StatusCodes.Status200OK, false, null),
                CancellationToken.None);
            Assert.False(handled);
        }

        await using (var verificationScope = factory.Services.CreateAsyncScope())
        {
            var dbContext = verificationScope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            Assert.True(await dbContext.TaskParentAutoResumeContexts.AnyAsync((item) => item.ChildSessionId == childSessionId && item.UserId == userId));
        }

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            var threadStore = scope.ServiceProvider.GetRequiredService<ISessionRuntimeThreadStore>();
            var parentSession = await dbContext.Sessions.SingleAsync((item) => item.Id == parentSessionId && item.UserId == userId);
            parentSession.StateStatus = "idle";
            parentSession.UpdatedAtUtc = DateTimeOffset.UtcNow;
            await dbContext.SaveChangesAsync();
            await threadStore.ClearAsync(parentSessionId, userId, "req-parent-busy", CancellationToken.None);
        }

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var reconciler = scope.ServiceProvider.GetRequiredService<ISessionRuntimeReconciler>();
            var result = await reconciler.ReconcileAllAsync(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), CancellationToken.None);
            Assert.True(result.CandidateCount >= 1);
        }

        await WaitForConditionAsync(async () => await HasParentRequestWithPrefixAsync(factory, parentSessionId, userId, "task-auto-resume:"));
        await WaitForConditionAsync(async () => await HasParentAssistantTextAsync(factory, parentSessionId, userId, "parent resumed after retry"));
        await using var finalScope = factory.Services.CreateAsyncScope();
        var finalDbContext = finalScope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        Assert.False(await finalDbContext.TaskParentAutoResumeContexts.AnyAsync((item) => item.ChildSessionId == childSessionId && item.UserId == userId));
    }

    [Fact]
    public async Task ReconcileSessionRuntimeAsync_ShouldExpirePendingPermissionAndAutoResumeParentAsTimeout()
    {
        const string userId = "user-run010-timeout";
        const string parentSessionId = "session-run010-parent-timeout";
        const string childSessionId = "session-run010-child-timeout";
        using var factory = CreateFactoryWithLlm(new StubWorkflowLlmClient("parent resumed after timeout"));
        await SeedUserAndSessionsAsync(factory, userId, parentSessionId, childSessionId, childMetadataJson: JsonSerializer.Serialize(new
        {
            parentSessionId,
        }), childStateStatus: "paused");
        await UpsertAutoResumeContextAsync(factory, childSessionId, parentSessionId, userId, "task-timeout", JsonSerializer.Serialize(new
        {
            message = "resume after timeout",
            agentId = "orchestrator",
        }));

        const string permissionRequestId = "permission-run010-timeout";
        Task? cancelledChildTask = null;
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var permissionStore = scope.ServiceProvider.GetRequiredService<IPermissionRequestStore>();
            var requestRegistry = scope.ServiceProvider.GetRequiredService<ISessionStreamRequestRegistry>();
            var registration = requestRegistry.RegisterOrGetConflict(childSessionId, userId, "req-child-timeout", new CancellationTokenSource());
            Assert.Equal(SessionStreamRegistrationState.Registered, registration.State);
            cancelledChildTask = Task.Run(async () =>
            {
                var activeRequest = registration.ExistingRequest ?? requestRegistry.Get(childSessionId, "req-child-timeout");
                Assert.NotNull(activeRequest);
                try
                {
                    await Task.Delay(Timeout.InfiniteTimeSpan, activeRequest!.Cancellation.Token);
                }
                catch (OperationCanceledException)
                {
                    await using var childScope = factory.Services.CreateAsyncScope();
                    var childReconciler = childScope.ServiceProvider.GetRequiredService<ISessionRuntimeReconciler>();
                    await childReconciler.HandleChildSessionTerminalAsync(
                        new TaskChildSessionTerminalInput(childSessionId, userId, 499, false, "cancelled"),
                        CancellationToken.None);
                    requestRegistry.Complete(childSessionId, "req-child-timeout");
                }
            });
            await permissionStore.InsertAsync(new PermissionRequestInfoRecord(
                permissionRequestId,
                childSessionId,
                "bash",
                "/repo",
                "need shell",
                "high",
                null,
                "pending",
                null,
                JsonSerializer.Serialize(new { message = "continue" }),
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 1000,
                null,
                "2026-04-21 11:00:00",
                "2026-04-21 11:00:00"),
                CancellationToken.None);
        }

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var reconciler = scope.ServiceProvider.GetRequiredService<ISessionRuntimeReconciler>();
            var result = await reconciler.ReconcileSessionRuntimeAsync(childSessionId, userId, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), CancellationToken.None);
            Assert.True(result.PendingInteractionExpired);
            Assert.True(result.ReconciledAsTimeout);
        }

        Assert.NotNull(cancelledChildTask);
        await cancelledChildTask!;

        await WaitForConditionAsync(async () => await HasParentRequestWithPrefixAsync(factory, parentSessionId, userId, "task-auto-resume:"));
        await WaitForConditionAsync(async () => await HasParentAssistantTextAsync(factory, parentSessionId, userId, "parent resumed after timeout"));

        await using var verificationScope = factory.Services.CreateAsyncScope();
        var dbContext = verificationScope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var requestRegistryAfter = verificationScope.ServiceProvider.GetRequiredService<ISessionStreamRequestRegistry>();
        var permissionRecord = await dbContext.PermissionRequests.SingleAsync((item) => item.Id == permissionRequestId);
        var childSession = await dbContext.Sessions.SingleAsync((item) => item.Id == childSessionId && item.UserId == userId);
        Assert.Equal("rejected", permissionRecord.Status);
        Assert.Equal("idle", childSession.StateStatus);
        Assert.Contains("timeout", childSession.MetadataJson, StringComparison.Ordinal);
        Assert.False(await dbContext.TaskParentAutoResumeContexts.AnyAsync((item) => item.ChildSessionId == childSessionId && item.UserId == userId));
        Assert.Null(requestRegistryAfter.GetAnyForSession(childSessionId, userId));
    }

    private WebApplicationFactory<OpenAWork.Gateway.Host.Program> CreateFactoryWithLlm(IWorkflowLlmClient llmClient)
    {
        return _factory.WithWebHostBuilder((builder) =>
        {
            builder.ConfigureAppConfiguration((_, configurationBuilder) =>
            {
                configurationBuilder.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["WORKSPACE_ROOT"] = Path.GetTempPath(),
                });
            });
            builder.ConfigureTestServices((services) =>
            {
                services.RemoveAll<IWorkflowLlmClient>();
                services.AddSingleton(llmClient);
            });
        });
    }

    private static async Task SeedUserAndSessionsAsync(
        WebApplicationFactory<OpenAWork.Gateway.Host.Program> factory,
        string userId,
        string parentSessionId,
        string childSessionId,
        string childMetadataJson,
        string parentStateStatus = "idle",
        string childStateStatus = "idle")
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

        if (!await dbContext.Sessions.AnyAsync((session) => session.Id == parentSessionId))
        {
            dbContext.Sessions.Add(new SessionRecord
            {
                Id = parentSessionId,
                UserId = userId,
                MessagesJson = "[]",
                StateStatus = parentStateStatus,
                MetadataJson = "{}",
                Title = "Parent Session",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
        }

        if (!await dbContext.Sessions.AnyAsync((session) => session.Id == childSessionId))
        {
            dbContext.Sessions.Add(new SessionRecord
            {
                Id = childSessionId,
                UserId = userId,
                MessagesJson = "[]",
                StateStatus = childStateStatus,
                MetadataJson = childMetadataJson,
                Title = "Child Session",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
        }

        await dbContext.SaveChangesAsync();
    }

    private static async Task SeedChildAssistantSummaryAsync(
        WebApplicationFactory<OpenAWork.Gateway.Host.Program> factory,
        string userId,
        string childSessionId,
        string summary)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var messageStore = scope.ServiceProvider.GetRequiredService<IMessageV2Store>();
        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var createdAt = FormatTimestamp(nowMs);
        var messageId = $"message:{childSessionId}:assistant:summary";
        await messageStore.InsertMessageAsync(new MessageV2InfoRecord(
            messageId,
            childSessionId,
            userId,
            nowMs,
            JsonSerializer.Serialize(new
            {
                role = "assistant",
                clientRequestId = "req-child-summary",
                time = new { created = nowMs },
                status = "final",
            }),
            createdAt,
            createdAt),
            CancellationToken.None);
        await messageStore.InsertPartAsync(new PartV2InfoRecord(
            $"part:{messageId}:text",
            messageId,
            childSessionId,
            userId,
            nowMs,
            JsonSerializer.Serialize(new { type = "text", text = summary }),
            createdAt,
            createdAt),
            CancellationToken.None);
    }

    private static async Task UpsertAutoResumeContextAsync(
        WebApplicationFactory<OpenAWork.Gateway.Host.Program> factory,
        string childSessionId,
        string parentSessionId,
        string userId,
        string taskId,
        string requestDataJson)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<ITaskParentAutoResumeContextStore>();
        await store.UpsertAsync(new TaskParentAutoResumeContextInfoRecord(
            childSessionId,
            parentSessionId,
            userId,
            taskId,
            requestDataJson,
            "2026-04-21 12:00:00",
            "2026-04-21 12:00:00"),
            CancellationToken.None);
    }

    private static async Task<bool> HasParentRequestWithPrefixAsync(
        WebApplicationFactory<OpenAWork.Gateway.Host.Program> factory,
        string parentSessionId,
        string userId,
        string prefix)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var messages = await dbContext.MessageV2
            .AsNoTracking()
            .Where((item) => item.SessionId == parentSessionId && item.UserId == userId)
            .Select((item) => item.DataJson)
            .ToListAsync();
        return messages.Any((json) => json.Contains(prefix, StringComparison.Ordinal));
    }

    private static async Task<bool> HasParentAssistantTextAsync(
        WebApplicationFactory<OpenAWork.Gateway.Host.Program> factory,
        string parentSessionId,
        string userId,
        string expectedText)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var messageStore = scope.ServiceProvider.GetRequiredService<IMessageV2Store>();
        var messages = await messageStore.ListMessagesWithPartsAsync(parentSessionId, userId, 100, CancellationToken.None);
        return messages.Any((message) => message.Message.DataJson.Contains("\"role\":\"assistant\"", StringComparison.Ordinal)
            && message.Parts.Any((part) => part.DataJson.Contains(expectedText, StringComparison.Ordinal)));
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

    private static string FormatTimestamp(long epochMs)
        => DateTimeOffset.FromUnixTimeMilliseconds(epochMs).UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss");

    private sealed class StubWorkflowLlmClient(string responseText) : IWorkflowLlmClient
    {
        public Task<string> CompleteAsync(string apiBaseUrl, string apiKey, string model, string prompt, double temperature, CancellationToken cancellationToken)
            => Task.FromResult(responseText);
    }
}
