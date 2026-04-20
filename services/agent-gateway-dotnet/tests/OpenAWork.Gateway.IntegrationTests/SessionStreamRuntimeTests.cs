using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using OpenAWork.Gateway.Application.Abstractions.Settings;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class SessionStreamRuntimeTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public SessionStreamRuntimeTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task WebSocketStream_ShouldEmitTextDeltaAndDone()
    {
        const string userId = "user-ws-stream-happy";
        const string sessionId = "session-ws-stream-happy";
        using var factory = CreateFactoryWithLlm(new StubWorkflowLlmClient("hello from ws"));
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        using var socket = await ConnectWebSocketAsync(factory, sessionId, userId);
        await SendJsonAsync(socket, new
        {
            message = "hi",
            clientRequestId = "req-1",
            model = "gpt-test",
        });

        var chunks = await ReceiveChunksUntilAsync(socket, (items) => items.Any((item) => item.GetProperty("type").GetString() == "done"));
        Assert.Contains(chunks, (chunk) => chunk.GetProperty("type").GetString() == "text_delta" && chunk.GetProperty("delta").GetString() == "hello from ws");
        Assert.Contains(chunks, (chunk) => chunk.GetProperty("type").GetString() == "done" && chunk.GetProperty("stopReason").GetString() == "end_turn");

        await using var scope = factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var session = await dbContext.Sessions.SingleAsync((item) => item.Id == sessionId);
        Assert.Equal("idle", session.StateStatus);
    }

    [Fact]
    public async Task WebSocketStream_ShouldRejectSecondRequest_WhenSameSessionAlreadyRunning()
    {
        const string userId = "user-ws-stream-conflict";
        const string sessionId = "session-ws-stream-conflict";
        using var factory = CreateFactoryWithLlm(new BlockingWorkflowLlmClient());
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        using var socket = await ConnectWebSocketAsync(factory, sessionId, userId);
        await SendJsonAsync(socket, new
        {
            message = "first",
            clientRequestId = "req-running",
            model = "gpt-test",
        });
        await Task.Delay(100);

        await SendJsonAsync(socket, new
        {
            message = "second",
            clientRequestId = "req-second",
            model = "gpt-test",
        });

        var chunks = await ReceiveChunksUntilAsync(socket, (items) => items.Any((item) => item.GetProperty("code").GetString() == "SESSION_ALREADY_RUNNING"));
        Assert.Contains(chunks, (chunk) => chunk.GetProperty("code").GetString() == "SESSION_ALREADY_RUNNING");
    }

    [Fact]
    public async Task StopRoute_ShouldCancelInFlightRequest()
    {
        const string userId = "user-ws-stream-stop";
        const string sessionId = "session-ws-stream-stop";
        using var factory = CreateFactoryWithLlm(new BlockingWorkflowLlmClient());
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        using var socket = await ConnectWebSocketAsync(factory, sessionId, userId);
        await SendJsonAsync(socket, new
        {
            message = "first",
            clientRequestId = "req-stop",
            model = "gpt-test",
        });
        await Task.Delay(100);

        using var httpClient = factory.CreateClient();
        httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthTestTokenFactory.Create(userId));
        var stopResponse = await httpClient.PostAsJsonAsync($"/sessions/{sessionId}/stream/stop", new
        {
            clientRequestId = "req-stop",
        });
        var stopPayload = await stopResponse.Content.ReadFromJsonAsync<JsonElement>();

        stopResponse.EnsureSuccessStatusCode();
        Assert.True(stopPayload.GetProperty("stopped").GetBoolean());

        var chunks = await ReceiveChunksUntilAsync(socket, (items) => items.Any((item) => item.GetProperty("type").GetString() == "done"));
        Assert.Contains(chunks, (chunk) => chunk.GetProperty("type").GetString() == "done" && chunk.GetProperty("stopReason").GetString() == "cancelled");
    }

    [Fact]
    public async Task StopRoute_ShouldAllowImmediateNewRequestAfterReturning()
    {
        const string userId = "user-ws-stream-stop-then-rerun";
        const string sessionId = "session-ws-stream-stop-then-rerun";
        using var factory = CreateFactoryWithLlm(new FirstCallBlocksThenReturnsWorkflowLlmClient("fresh after stop"));
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        using var socket = await ConnectWebSocketAsync(factory, sessionId, userId);
        await SendJsonAsync(socket, new
        {
            message = "first",
            clientRequestId = "req-stop-1",
            model = "gpt-test",
        });
        await Task.Delay(100);

        using var httpClient = factory.CreateClient();
        httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthTestTokenFactory.Create(userId));
        var stopResponse = await httpClient.PostAsJsonAsync($"/sessions/{sessionId}/stream/stop", new
        {
            clientRequestId = "req-stop-1",
        });
        var stopPayload = await stopResponse.Content.ReadFromJsonAsync<JsonElement>();

        stopResponse.EnsureSuccessStatusCode();
        Assert.True(stopPayload.GetProperty("stopped").GetBoolean());

        var cancelledChunks = await ReceiveChunksUntilAsync(socket, (items) => items.Any((item) => item.GetProperty("type").GetString() == "done"));
        Assert.Contains(cancelledChunks, (chunk) => chunk.GetProperty("type").GetString() == "done" && chunk.GetProperty("stopReason").GetString() == "cancelled");

        await SendJsonAsync(socket, new
        {
            message = "second",
            clientRequestId = "req-stop-2",
            model = "gpt-test",
        });

        var rerunChunks = await ReceiveChunksUntilAsync(socket, (items) => items.Any((item) => item.GetProperty("type").GetString() == "done"));
        Assert.Contains(rerunChunks, (chunk) => chunk.GetProperty("type").GetString() == "text_delta" && chunk.GetProperty("delta").GetString() == "fresh after stop");
    }

    [Fact]
    public async Task StopActiveRoute_ShouldCancelInFlightRequest()
    {
        const string userId = "user-ws-stream-stop-active";
        const string sessionId = "session-ws-stream-stop-active";
        using var factory = CreateFactoryWithLlm(new BlockingWorkflowLlmClient());
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        using var socket = await ConnectWebSocketAsync(factory, sessionId, userId);
        await SendJsonAsync(socket, new
        {
            message = "first",
            clientRequestId = "req-stop-active",
            model = "gpt-test",
        });
        await Task.Delay(100);

        using var httpClient = factory.CreateClient();
        httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthTestTokenFactory.Create(userId));
        var stopResponse = await httpClient.PostAsync($"/sessions/{sessionId}/stream/stop-active", content: null);
        var stopPayload = await stopResponse.Content.ReadFromJsonAsync<JsonElement>();

        stopResponse.EnsureSuccessStatusCode();
        Assert.True(stopPayload.GetProperty("stopped").GetBoolean());

        var chunks = await ReceiveChunksUntilAsync(socket, (items) => items.Any((item) => item.GetProperty("type").GetString() == "done"));
        Assert.Contains(chunks, (chunk) => chunk.GetProperty("type").GetString() == "done" && chunk.GetProperty("stopReason").GetString() == "cancelled");
    }

    [Fact]
    public async Task StopActiveRoute_ShouldReturnFalseWhenNoActiveRequestExists()
    {
        const string userId = "user-ws-stream-stop-active-none";
        const string sessionId = "session-ws-stream-stop-active-none";
        using var factory = CreateFactoryWithLlm(new StubWorkflowLlmClient("unused"));
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        using var httpClient = factory.CreateClient();
        httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthTestTokenFactory.Create(userId));
        var response = await httpClient.PostAsync($"/sessions/{sessionId}/stream/stop-active", content: null);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();

        response.EnsureSuccessStatusCode();
        Assert.False(payload.GetProperty("stopped").GetBoolean());
    }

    [Fact]
    public async Task StopActiveRoute_ShouldAllowImmediateNewRequestAfterReturning()
    {
        const string userId = "user-ws-stream-stop-active-rerun";
        const string sessionId = "session-ws-stream-stop-active-rerun";
        using var factory = CreateFactoryWithLlm(new FirstCallBlocksThenReturnsWorkflowLlmClient("fresh after stop-active"));
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        using var socket = await ConnectWebSocketAsync(factory, sessionId, userId);
        await SendJsonAsync(socket, new
        {
            message = "first",
            clientRequestId = "req-stop-active-1",
            model = "gpt-test",
        });
        await Task.Delay(100);

        using var httpClient = factory.CreateClient();
        httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthTestTokenFactory.Create(userId));
        var stopResponse = await httpClient.PostAsync($"/sessions/{sessionId}/stream/stop-active", content: null);
        var stopPayload = await stopResponse.Content.ReadFromJsonAsync<JsonElement>();

        stopResponse.EnsureSuccessStatusCode();
        Assert.True(stopPayload.GetProperty("stopped").GetBoolean());

        var cancelledChunks = await ReceiveChunksUntilAsync(socket, (items) => items.Any((item) => item.GetProperty("type").GetString() == "done"));
        Assert.Contains(cancelledChunks, (chunk) => chunk.GetProperty("type").GetString() == "done" && chunk.GetProperty("stopReason").GetString() == "cancelled");

        await SendJsonAsync(socket, new
        {
            message = "second",
            clientRequestId = "req-stop-active-2",
            model = "gpt-test",
        });

        var rerunChunks = await ReceiveChunksUntilAsync(socket, (items) => items.Any((item) => item.GetProperty("type").GetString() == "done"));
        Assert.Contains(rerunChunks, (chunk) => chunk.GetProperty("type").GetString() == "text_delta" && chunk.GetProperty("delta").GetString() == "fresh after stop-active");
    }

    [Fact]
    public async Task WebSocketStream_ShouldReturnInvalidJsonErrorChunk()
    {
        const string userId = "user-ws-stream-invalid-json";
        const string sessionId = "session-ws-stream-invalid-json";
        using var factory = CreateFactoryWithLlm(new StubWorkflowLlmClient("unused"));
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        using var socket = await ConnectWebSocketAsync(factory, sessionId, userId);
        await SendRawTextAsync(socket, "not-json");

        var chunks = await ReceiveChunksUntilAsync(socket, (items) => items.Any((item) => item.GetProperty("code").GetString() == "INVALID_JSON"));
        Assert.Contains(chunks, (chunk) => chunk.GetProperty("code").GetString() == "INVALID_JSON");
    }

    [Fact]
    public async Task WebSocketStream_ShouldReturnInvalidRequestErrorChunk_WhenSchemaMissingFields()
    {
        const string userId = "user-ws-stream-invalid-schema";
        const string sessionId = "session-ws-stream-invalid-schema";
        using var factory = CreateFactoryWithLlm(new StubWorkflowLlmClient("unused"));
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        using var socket = await ConnectWebSocketAsync(factory, sessionId, userId);
        await SendJsonAsync(socket, new { message = "hi only" });

        var chunks = await ReceiveChunksUntilAsync(socket, (items) => items.Any((item) => item.GetProperty("code").GetString() == "INVALID_REQUEST"));
        Assert.Contains(chunks, (chunk) => chunk.GetProperty("code").GetString() == "INVALID_REQUEST");
    }

    [Fact]
    public async Task StopRoute_ShouldReturnUnauthorizedWithoutBearerToken()
    {
        const string userId = "user-ws-stream-stop-noauth";
        const string sessionId = "session-ws-stream-stop-noauth";
        using var factory = CreateFactoryWithLlm(new StubWorkflowLlmClient("unused"));
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        using var httpClient = factory.CreateClient();
        var response = await httpClient.PostAsJsonAsync($"/sessions/{sessionId}/stream/stop", new
        {
            clientRequestId = "req-stop",
        });

        Assert.Equal(System.Net.HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task StopRoute_ShouldReturnNotFoundForNonOwner()
    {
        const string ownerUserId = "user-ws-stream-owner";
        const string otherUserId = "user-ws-stream-other";
        const string sessionId = "session-ws-stream-owner";
        using var factory = CreateFactoryWithLlm(new StubWorkflowLlmClient("unused"));
        await SeedUserAndSessionAsync(factory, ownerUserId, sessionId);
        await SeedUserAndSessionAsync(factory, otherUserId, "session-ws-stream-other");

        using var httpClient = factory.CreateClient();
        httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthTestTokenFactory.Create(otherUserId));
        var response = await httpClient.PostAsJsonAsync($"/sessions/{sessionId}/stream/stop", new
        {
            clientRequestId = "req-stop",
        });

        Assert.Equal(System.Net.HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task StopActiveRoute_ShouldReturnUnauthorizedWithoutBearerToken()
    {
        const string userId = "user-ws-stream-stop-active-noauth";
        const string sessionId = "session-ws-stream-stop-active-noauth";
        using var factory = CreateFactoryWithLlm(new StubWorkflowLlmClient("unused"));
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        using var httpClient = factory.CreateClient();
        var response = await httpClient.PostAsync($"/sessions/{sessionId}/stream/stop-active", content: null);

        Assert.Equal(System.Net.HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task StopActiveRoute_ShouldReturnNotFoundForNonOwner()
    {
        const string ownerUserId = "user-ws-stream-stop-active-owner";
        const string otherUserId = "user-ws-stream-stop-active-other";
        const string sessionId = "session-ws-stream-stop-active-owner";
        using var factory = CreateFactoryWithLlm(new StubWorkflowLlmClient("unused"));
        await SeedUserAndSessionAsync(factory, ownerUserId, sessionId);
        await SeedUserAndSessionAsync(factory, otherUserId, "session-ws-stream-stop-active-other");

        using var httpClient = factory.CreateClient();
        httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthTestTokenFactory.Create(otherUserId));
        var response = await httpClient.PostAsync($"/sessions/{sessionId}/stream/stop-active", content: null);

        Assert.Equal(System.Net.HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task WebSocketStream_ShouldRejectInvalidQueryToken()
    {
        const string userId = "user-ws-stream-invalid-token";
        const string sessionId = "session-ws-stream-invalid-token";
        using var factory = CreateFactoryWithLlm(new StubWorkflowLlmClient("unused"));
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        var client = factory.Server.CreateWebSocketClient();
        await Assert.ThrowsAnyAsync<Exception>(async () =>
        {
            using var _ = await client.ConnectAsync(new Uri($"ws://localhost/sessions/{sessionId}/stream?token=invalid-token"), CancellationToken.None);
        });
    }

    [Fact]
    public async Task WebSocketStream_ShouldRerunSameRequestAfterError()
    {
        const string userId = "user-ws-stream-retry-error";
        const string sessionId = "session-ws-stream-retry-error";
        var client = new SequencedWorkflowLlmClient(
        [
            WorkflowOutcome.Throw(new InvalidOperationException("first failure")),
            WorkflowOutcome.Return("fresh retry text"),
        ]);
        using var factory = CreateFactoryWithLlm(client);
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        using var socket = await ConnectWebSocketAsync(factory, sessionId, userId);
        await SendJsonAsync(socket, new
        {
            message = "retry me",
            clientRequestId = "req-retry-after-error",
            model = "gpt-test",
        });
        var firstChunks = await ReceiveChunksUntilAsync(socket, (items) => items.Any((item) => item.GetProperty("type").GetString() == "error"));
        Assert.Contains(firstChunks, (chunk) => chunk.GetProperty("type").GetString() == "error");

        await SendJsonAsync(socket, new
        {
            message = "retry me",
            clientRequestId = "req-retry-after-error",
            model = "gpt-test",
        });
        var secondChunks = await ReceiveChunksUntilAsync(socket, (items) => items.Any((item) => item.GetProperty("type").GetString() == "done"));
        Assert.Contains(secondChunks, (chunk) => chunk.GetProperty("type").GetString() == "text_delta" && chunk.GetProperty("delta").GetString() == "fresh retry text");
        Assert.Equal(2, client.CallCount);
    }

    [Fact]
    public async Task WebSocketStream_ShouldReplaySameRequestWithoutCallingUpstreamTwice()
    {
        const string userId = "user-ws-stream-replay";
        const string sessionId = "session-ws-stream-replay";
        var countingClient = new CountingWorkflowLlmClient("replayed text");
        using var factory = CreateFactoryWithLlm(countingClient);
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        using var socket = await ConnectWebSocketAsync(factory, sessionId, userId);
        await SendJsonAsync(socket, new
        {
            message = "first",
            clientRequestId = "req-replay",
            model = "gpt-test",
        });
        var firstChunks = await ReceiveChunksUntilAsync(socket, (items) => items.Any((item) => item.GetProperty("type").GetString() == "done"));
        Assert.Contains(firstChunks, (chunk) => chunk.GetProperty("type").GetString() == "text_delta" && chunk.GetProperty("delta").GetString() == "replayed text");

        await SendJsonAsync(socket, new
        {
            message = "first",
            clientRequestId = "req-replay",
            model = "gpt-test",
        });
        var replayChunks = await ReceiveChunksUntilAsync(socket, (items) => items.Any((item) => item.GetProperty("type").GetString() == "done"));
        Assert.Contains(replayChunks, (chunk) => chunk.GetProperty("type").GetString() == "text_delta" && chunk.GetProperty("delta").GetString() == "replayed text");
        Assert.Equal(1, countingClient.CallCount);
    }

    [Fact]
    public async Task WebSocketStream_ShouldWaitAndReplaySameRequestWhileFirstRunIsStillInFlight()
    {
        const string userId = "user-ws-stream-replay-inflight";
        const string sessionId = "session-ws-stream-replay-inflight";
        var client = new DelayedWorkflowLlmClient("inflight replay text", TimeSpan.FromMilliseconds(250));
        using var factory = CreateFactoryWithLlm(client);
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        using var socket = await ConnectWebSocketAsync(factory, sessionId, userId);
        await SendJsonAsync(socket, new
        {
            message = "first",
            clientRequestId = "req-replay-inflight",
            model = "gpt-test",
        });
        await Task.Delay(50);

        await SendJsonAsync(socket, new
        {
            message = "first",
            clientRequestId = "req-replay-inflight",
            model = "gpt-test",
        });

        var chunks = await ReceiveChunksUntilAsync(socket, (items) => items.Count((item) => item.GetProperty("type").GetString() == "done") >= 2);
        Assert.Equal(1, client.CallCount);
        Assert.Equal(2, chunks.Count((item) => item.GetProperty("type").GetString() == "text_delta" && item.GetProperty("delta").GetString() == "inflight replay text"));
        Assert.Equal(2, chunks.Count((item) => item.GetProperty("type").GetString() == "done"));
    }

    [Fact]
    public async Task WebSocketStream_ShouldReplayToolCallAndToolResultFromTranscript()
    {
        const string userId = "user-ws-stream-replay-tool";
        const string sessionId = "session-ws-stream-replay-tool";
        var countingClient = new CountingWorkflowLlmClient("should not run");
        using var factory = CreateFactoryWithLlm(countingClient);
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var messageStore = scope.ServiceProvider.GetRequiredService<OpenAWork.Gateway.Application.Abstractions.Persistence.IMessageV2Store>();
            var nowMs = 1000L;
            await messageStore.InsertMessageAsync(new OpenAWork.Gateway.Application.Abstractions.Persistence.MessageV2InfoRecord(
                "message:tool-replay",
                sessionId,
                userId,
                nowMs,
                "{\"role\":\"assistant\",\"clientRequestId\":\"req-replay-tool\",\"time\":{\"created\":1000},\"status\":\"final\",\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}",
                "2026-04-20 10:00:00",
                "2026-04-20 10:00:00"), CancellationToken.None);
            await messageStore.InsertPartAsync(new OpenAWork.Gateway.Application.Abstractions.Persistence.PartV2InfoRecord(
                "part:tool-replay",
                "message:tool-replay",
                sessionId,
                userId,
                nowMs,
                "{\"type\":\"tool\",\"tool\":\"bash\",\"callID\":\"call-tool-1\",\"state\":{\"status\":\"completed\",\"input\":{\"command\":\"pwd\"},\"raw\":\"{\\\"command\\\":\\\"pwd\\\"}\",\"metadata\":{\"toolResultContent\":{\"type\":\"tool_result\",\"toolCallId\":\"call-tool-1\",\"toolName\":\"bash\",\"output\":\"/workspace\",\"isError\":false}}}}",
                "2026-04-20 10:00:00",
                "2026-04-20 10:00:00"), CancellationToken.None);
        }

        using var socket = await ConnectWebSocketAsync(factory, sessionId, userId);
        await SendJsonAsync(socket, new
        {
            message = "ignored",
            clientRequestId = "req-replay-tool",
            model = "gpt-test",
        });

        var chunks = await ReceiveChunksUntilAsync(socket, (items) => items.Any((item) => item.GetProperty("type").GetString() == "done"));
        Assert.Contains(chunks, (chunk) => chunk.GetProperty("type").GetString() == "tool_call_delta" && chunk.GetProperty("toolName").GetString() == "bash");
        Assert.Contains(chunks, (chunk) => chunk.GetProperty("type").GetString() == "tool_result" && chunk.GetProperty("toolName").GetString() == "bash");
        Assert.Equal(0, countingClient.CallCount);
    }

    [Fact]
    public async Task WebSocketStream_ShouldReplayPendingPermissionToolResultAsPausedState()
    {
        const string userId = "user-ws-stream-replay-pending-tool";
        const string sessionId = "session-ws-stream-replay-pending-tool";
        var countingClient = new CountingWorkflowLlmClient("should not run");
        using var factory = CreateFactoryWithLlm(countingClient);
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var messageStore = scope.ServiceProvider.GetRequiredService<OpenAWork.Gateway.Application.Abstractions.Persistence.IMessageV2Store>();
            var nowMs = 1000L;
            await messageStore.InsertMessageAsync(new OpenAWork.Gateway.Application.Abstractions.Persistence.MessageV2InfoRecord(
                "message:tool-pending-replay",
                sessionId,
                userId,
                nowMs,
                "{\"role\":\"assistant\",\"clientRequestId\":\"req-replay-pending-tool\",\"time\":{\"created\":1000},\"status\":\"final\",\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}",
                "2026-04-20 10:05:00",
                "2026-04-20 10:05:00"), CancellationToken.None);
            await messageStore.InsertPartAsync(new OpenAWork.Gateway.Application.Abstractions.Persistence.PartV2InfoRecord(
                "part:tool-pending-replay",
                "message:tool-pending-replay",
                sessionId,
                userId,
                nowMs,
                "{\"type\":\"tool\",\"tool\":\"bash\",\"callID\":\"call-pending-tool-1\",\"state\":{\"status\":\"pending\",\"input\":{\"command\":\"pwd\"},\"raw\":\"{\\\"command\\\":\\\"pwd\\\"}\"}}",
                "2026-04-20 10:05:00",
                "2026-04-20 10:05:00"), CancellationToken.None);
        }

        using var socket = await ConnectWebSocketAsync(factory, sessionId, userId);
        await SendJsonAsync(socket, new
        {
            message = "ignored",
            clientRequestId = "req-replay-pending-tool",
            model = "gpt-test",
        });

        var chunks = await ReceiveChunksUntilAsync(socket, (items) => items.Any((item) => item.GetProperty("type").GetString() == "done"));
        Assert.Contains(chunks, (chunk) => chunk.GetProperty("type").GetString() == "tool_call_delta" && chunk.GetProperty("toolName").GetString() == "bash");
        Assert.Contains(chunks, (chunk) => chunk.GetProperty("type").GetString() == "tool_result"
            && chunk.GetProperty("toolName").GetString() == "bash"
            && chunk.GetProperty("pendingPermissionRequestId").GetString() == "call-pending-tool-1"
            && chunk.GetProperty("isError").GetBoolean() == false);
        Assert.Equal(0, countingClient.CallCount);
    }

    [Fact]
    public async Task WebSocketStream_ShouldDeduplicateAssistantPendingToolAndDedicatedToolResult()
    {
        const string userId = "user-ws-stream-replay-tool-dedup";
        const string sessionId = "session-ws-stream-replay-tool-dedup";
        var countingClient = new CountingWorkflowLlmClient("should not run");
        using var factory = CreateFactoryWithLlm(countingClient);
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var messageStore = scope.ServiceProvider.GetRequiredService<OpenAWork.Gateway.Application.Abstractions.Persistence.IMessageV2Store>();
            await messageStore.InsertMessageAsync(new OpenAWork.Gateway.Application.Abstractions.Persistence.MessageV2InfoRecord(
                "message:tool-dedup-assistant",
                sessionId,
                userId,
                1000,
                "{\"role\":\"assistant\",\"clientRequestId\":\"req-tool-dedup\",\"time\":{\"created\":1000},\"status\":\"final\",\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}",
                "2026-04-20 10:10:00",
                "2026-04-20 10:10:00"), CancellationToken.None);
            await messageStore.InsertPartAsync(new OpenAWork.Gateway.Application.Abstractions.Persistence.PartV2InfoRecord(
                "part:tool-dedup-assistant",
                "message:tool-dedup-assistant",
                sessionId,
                userId,
                1001,
                "{\"type\":\"tool\",\"tool\":\"bash\",\"callID\":\"call-dedup-1\",\"state\":{\"status\":\"pending\",\"input\":{\"command\":\"pwd\"},\"raw\":\"{\\\"command\\\":\\\"pwd\\\"}\"}}",
                "2026-04-20 10:10:00",
                "2026-04-20 10:10:00"), CancellationToken.None);
            await messageStore.InsertMessageAsync(new OpenAWork.Gateway.Application.Abstractions.Persistence.MessageV2InfoRecord(
                "message:tool-dedup-result",
                sessionId,
                userId,
                1002,
                "{\"role\":\"tool\",\"clientRequestId\":\"req-tool-dedup:tool_result:call-dedup-1\",\"time\":{\"created\":1002},\"status\":\"final\"}",
                "2026-04-20 10:10:00",
                "2026-04-20 10:10:00"), CancellationToken.None);
            await messageStore.InsertPartAsync(new OpenAWork.Gateway.Application.Abstractions.Persistence.PartV2InfoRecord(
                "part:tool-dedup-result",
                "message:tool-dedup-result",
                sessionId,
                userId,
                1003,
                "{\"type\":\"tool\",\"tool\":\"bash\",\"callID\":\"call-dedup-1\",\"state\":{\"status\":\"completed\",\"input\":{\"command\":\"pwd\"},\"raw\":\"{\\\"command\\\":\\\"pwd\\\"}\",\"metadata\":{\"toolResultContent\":{\"type\":\"tool_result\",\"toolCallId\":\"call-dedup-1\",\"toolName\":\"bash\",\"output\":\"/workspace\",\"isError\":false}}}}",
                "2026-04-20 10:10:00",
                "2026-04-20 10:10:00"), CancellationToken.None);
        }

        using var socket = await ConnectWebSocketAsync(factory, sessionId, userId);
        await SendJsonAsync(socket, new
        {
            message = "ignored",
            clientRequestId = "req-tool-dedup",
            model = "gpt-test",
        });

        var chunks = await ReceiveChunksUntilAsync(socket, (items) => items.Any((item) => item.GetProperty("type").GetString() == "done"));
        Assert.Equal(1, chunks.Count((chunk) => chunk.GetProperty("type").GetString() == "tool_call_delta" && chunk.GetProperty("toolCallId").GetString() == "call-dedup-1"));
        Assert.Equal(1, chunks.Count((chunk) => chunk.GetProperty("type").GetString() == "tool_result" && chunk.GetProperty("toolCallId").GetString() == "call-dedup-1"));
        Assert.DoesNotContain(chunks, (chunk) => chunk.GetProperty("type").GetString() == "tool_result"
            && chunk.GetProperty("toolCallId").GetString() == "call-dedup-1"
            && chunk.TryGetProperty("pendingPermissionRequestId", out _));
        Assert.Equal(0, countingClient.CallCount);
    }

    [Fact]
    public async Task WebSocketStream_ShouldReplayDurableRunEventsWithoutAssistantMessageFallback()
    {
        const string userId = "user-ws-stream-durable-replay";
        const string sessionId = "session-ws-stream-durable-replay";
        var countingClient = new CountingWorkflowLlmClient("should not run");
        using var factory = CreateFactoryWithLlm(countingClient);
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var runEventStore = scope.ServiceProvider.GetRequiredService<OpenAWork.Gateway.Application.Abstractions.Persistence.ISessionRunEventStore>();
            await runEventStore.PersistAsync(new OpenAWork.Gateway.Application.Abstractions.Persistence.SessionRunEventInfoRecord(
                0,
                sessionId,
                userId,
                "req-durable",
                null,
                "text_delta",
                null,
                null,
                1000,
                "{\"type\":\"text_delta\",\"delta\":\"durable text\"}",
                "2026-04-19 10:00:00"), CancellationToken.None);
            await runEventStore.PersistAsync(new OpenAWork.Gateway.Application.Abstractions.Persistence.SessionRunEventInfoRecord(
                0,
                sessionId,
                userId,
                "req-durable",
                null,
                "done",
                null,
                null,
                1001,
                "{\"type\":\"done\",\"stopReason\":\"end_turn\"}",
                "2026-04-19 10:00:01"), CancellationToken.None);
        }

        using var socket = await ConnectWebSocketAsync(factory, sessionId, userId);
        await SendJsonAsync(socket, new
        {
            message = "ignored",
            clientRequestId = "req-durable",
            model = "gpt-test",
        });

        var chunks = await ReceiveChunksUntilAsync(socket, (items) => items.Any((item) => item.GetProperty("type").GetString() == "done"));
        Assert.Contains(chunks, (chunk) => chunk.GetProperty("type").GetString() == "text_delta" && chunk.GetProperty("delta").GetString() == "durable text");
        Assert.Equal(0, countingClient.CallCount);
    }

    [Fact]
    public async Task WebSocketStream_ShouldReplayAssistantEventFromTranscript()
    {
        const string userId = "user-ws-stream-replay-assistant-event";
        const string sessionId = "session-ws-stream-replay-assistant-event";
        var countingClient = new CountingWorkflowLlmClient("should not run");
        using var factory = CreateFactoryWithLlm(countingClient);
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var messageStore = scope.ServiceProvider.GetRequiredService<OpenAWork.Gateway.Application.Abstractions.Persistence.IMessageV2Store>();
            var nowMs = 1000L;
            await messageStore.InsertMessageAsync(new OpenAWork.Gateway.Application.Abstractions.Persistence.MessageV2InfoRecord(
                "message:assistant-event",
                sessionId,
                userId,
                nowMs,
                "{\"role\":\"assistant\",\"clientRequestId\":\"req-replay-assistant-event\",\"time\":{\"created\":1000},\"status\":\"final\",\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}}}",
                "2026-04-20 10:00:00",
                "2026-04-20 10:00:00"), CancellationToken.None);
            await messageStore.InsertPartAsync(new OpenAWork.Gateway.Application.Abstractions.Persistence.PartV2InfoRecord(
                "part:assistant-event",
                "message:assistant-event",
                sessionId,
                userId,
                nowMs,
                "{\"type\":\"assistant_event\",\"payload\":{\"kind\":\"task\",\"title\":\"任务已完成\",\"message\":\"All good\",\"status\":\"success\"},\"source\":\"openawork_internal\"}",
                "2026-04-20 10:00:00",
                "2026-04-20 10:00:00"), CancellationToken.None);
        }

        using var socket = await ConnectWebSocketAsync(factory, sessionId, userId);
        await SendJsonAsync(socket, new
        {
            message = "ignored",
            clientRequestId = "req-replay-assistant-event",
            model = "gpt-test",
        });

        var chunks = await ReceiveChunksUntilAsync(socket, (items) => items.Any((item) => item.GetProperty("type").GetString() == "done"));
        Assert.Contains(chunks, (chunk) => chunk.GetProperty("type").GetString() == "assistant_event" && chunk.GetProperty("payload").GetProperty("title").GetString() == "任务已完成");
        Assert.Equal(0, countingClient.CallCount);
    }

    [Fact]
    public async Task WebSocketStream_ShouldFreshRerunSameRequestAfterCancelledRun()
    {
        const string userId = "user-ws-stream-retry-cancelled";
        const string sessionId = "session-ws-stream-retry-cancelled";
        var client = new CountingWorkflowLlmClient("fresh after cancel");
        using var factory = CreateFactoryWithLlm(client);
        await SeedUserAndSessionAsync(factory, userId, sessionId);

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var runEventStore = scope.ServiceProvider.GetRequiredService<OpenAWork.Gateway.Application.Abstractions.Persistence.ISessionRunEventStore>();
            await runEventStore.PersistAsync(new OpenAWork.Gateway.Application.Abstractions.Persistence.SessionRunEventInfoRecord(
                0,
                sessionId,
                userId,
                "req-cancelled",
                null,
                "done",
                null,
                null,
                1000,
                "{\"type\":\"done\",\"stopReason\":\"cancelled\"}",
                "2026-04-19 10:00:00"), CancellationToken.None);
        }

        using var socket = await ConnectWebSocketAsync(factory, sessionId, userId);
        await SendJsonAsync(socket, new
        {
            message = "rerun",
            clientRequestId = "req-cancelled",
            model = "gpt-test",
        });

        var chunks = await ReceiveChunksUntilAsync(socket, (items) => items.Any((item) => item.GetProperty("type").GetString() == "done"));
        Assert.Contains(chunks, (chunk) => chunk.GetProperty("type").GetString() == "text_delta" && chunk.GetProperty("delta").GetString() == "fresh after cancel");
        Assert.Equal(1, client.CallCount);
    }

    private WebApplicationFactory<OpenAWork.Gateway.Host.Program> CreateFactoryWithLlm(IWorkflowLlmClient llmClient)
    {
        return _factory.WithWebHostBuilder((builder) =>
        {
            builder.ConfigureServices((services) =>
            {
                services.RemoveAll<IWorkflowLlmClient>();
                services.AddSingleton(llmClient);
            });
        });
    }

    private static async Task<ClientWebSocket> ConnectWebSocketAsync(WebApplicationFactory<OpenAWork.Gateway.Host.Program> factory, string sessionId, string userId)
    {
        var client = factory.Server.CreateWebSocketClient();
        return await client.ConnectAsync(new Uri($"ws://localhost/sessions/{sessionId}/stream?token={Uri.EscapeDataString(AuthTestTokenFactory.Create(userId))}"), CancellationToken.None);
    }

    private static async Task SendJsonAsync(ClientWebSocket socket, object payload)
    {
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload));
        await socket.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
    }

    private static Task SendRawTextAsync(ClientWebSocket socket, string payload)
        => socket.SendAsync(Encoding.UTF8.GetBytes(payload), WebSocketMessageType.Text, true, CancellationToken.None);

    private static async Task<List<JsonElement>> ReceiveChunksUntilAsync(ClientWebSocket socket, Func<IReadOnlyList<JsonElement>, bool> predicate)
    {
        var chunks = new List<JsonElement>();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var buffer = new byte[16 * 1024];

        while (!predicate(chunks))
        {
            using var stream = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(buffer, timeout.Token);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    throw new InvalidOperationException("WebSocket closed before predicate was satisfied.");
                }

                stream.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            using var document = JsonDocument.Parse(Encoding.UTF8.GetString(stream.ToArray()));
            chunks.Add(document.RootElement.Clone());
        }

        return chunks;
    }

    private static async Task SeedUserAndSessionAsync(WebApplicationFactory<OpenAWork.Gateway.Host.Program> factory, string userId, string sessionId)
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
                StateStatus = "idle",
                MetadataJson = "{}",
                Title = "WS Runtime Session",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
        }

        await dbContext.SaveChangesAsync();
    }

    private sealed class StubWorkflowLlmClient(string response) : IWorkflowLlmClient
    {
        public Task<string> CompleteAsync(string apiBaseUrl, string apiKey, string model, string prompt, double temperature, CancellationToken cancellationToken)
            => Task.FromResult(response);
    }

    private sealed class BlockingWorkflowLlmClient : IWorkflowLlmClient
    {
        public async Task<string> CompleteAsync(string apiBaseUrl, string apiKey, string model, string prompt, double temperature, CancellationToken cancellationToken)
        {
            await Task.Delay(TimeSpan.FromSeconds(30), cancellationToken);
            return "should not complete";
        }
    }

    private sealed class FirstCallBlocksThenReturnsWorkflowLlmClient(string subsequentResponse) : IWorkflowLlmClient
    {
        private int _callCount;

        public async Task<string> CompleteAsync(string apiBaseUrl, string apiKey, string model, string prompt, double temperature, CancellationToken cancellationToken)
        {
            var callCount = Interlocked.Increment(ref _callCount);
            if (callCount == 1)
            {
                await Task.Delay(TimeSpan.FromSeconds(30), cancellationToken);
                return "should not complete";
            }

            return subsequentResponse;
        }
    }

    private sealed class CountingWorkflowLlmClient(string response) : IWorkflowLlmClient
    {
        public int CallCount { get; private set; }

        public Task<string> CompleteAsync(string apiBaseUrl, string apiKey, string model, string prompt, double temperature, CancellationToken cancellationToken)
        {
            CallCount += 1;
            return Task.FromResult(response);
        }
    }

    private sealed class DelayedWorkflowLlmClient(string response, TimeSpan delay) : IWorkflowLlmClient
    {
        public int CallCount { get; private set; }

        public async Task<string> CompleteAsync(string apiBaseUrl, string apiKey, string model, string prompt, double temperature, CancellationToken cancellationToken)
        {
            CallCount += 1;
            await Task.Delay(delay, cancellationToken);
            return response;
        }
    }

    private sealed class SequencedWorkflowLlmClient(IEnumerable<WorkflowOutcome> outcomes) : IWorkflowLlmClient
    {
        private readonly Queue<WorkflowOutcome> _outcomes = new(outcomes);

        public int CallCount { get; private set; }

        public Task<string> CompleteAsync(string apiBaseUrl, string apiKey, string model, string prompt, double temperature, CancellationToken cancellationToken)
        {
            CallCount += 1;
            if (_outcomes.Count == 0)
            {
                throw new InvalidOperationException("No workflow outcome configured.");
            }

            var outcome = _outcomes.Dequeue();
            return outcome.Exception is not null
                ? Task.FromException<string>(outcome.Exception)
                : Task.FromResult(outcome.Response ?? string.Empty);
        }
    }

    private sealed record WorkflowOutcome(string? Response, Exception? Exception)
    {
        public static WorkflowOutcome Return(string response) => new(response, null);

        public static WorkflowOutcome Throw(Exception exception) => new(null, exception);
    }
}
