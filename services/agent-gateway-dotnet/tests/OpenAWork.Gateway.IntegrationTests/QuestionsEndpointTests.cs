using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Application.Abstractions.Settings;
using OpenAWork.Gateway.Application.Abstractions.Streaming;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class QuestionsEndpointTests : IClassFixture<GatewayWebApplicationFactory>
{
    private readonly GatewayWebApplicationFactory _factory;

    public QuestionsEndpointTests(GatewayWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task GetPending_ShouldReturnPendingRequestsWithoutAutoExpiringThem()
    {
        const string userId = "user-questions-pending";
        const string sessionId = "session-questions-pending";
        await SeedUserAndSessionAsync(_factory, userId, sessionId);

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IQuestionRequestStore>();
            await store.InsertAsync(new QuestionRequestInfoRecord(
                "question-expired",
                sessionId,
                userId,
                "question",
                "Expired question",
                "[{\"question\":\"过期了吗\",\"header\":\"确认\",\"options\":[{\"label\":\"是\",\"description\":\"是\"}]}]",
                null,
                null,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 1000,
                "pending",
                "2026-04-21 16:00:00",
                "2026-04-21 16:00:00"),
                CancellationToken.None);
            await store.InsertAsync(new QuestionRequestInfoRecord(
                "question-active",
                sessionId,
                userId,
                "question",
                "Active question",
                "[{\"question\":\"继续吗\",\"header\":\"确认\",\"options\":[{\"label\":\"继续\",\"description\":\"继续\"}]}]",
                null,
                null,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 10_000,
                "pending",
                "2026-04-21 16:01:00",
                "2026-04-21 16:01:00"),
                CancellationToken.None);
        }

        using var client = CreateAuthenticatedClient(_factory, userId);
        var response = await client.GetAsync($"/sessions/{sessionId}/questions/pending");
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        response.EnsureSuccessStatusCode();

        var requests = payload.GetProperty("requests");
        Assert.Equal(2, requests.GetArrayLength());
        var expiredRequest = requests.EnumerateArray().Single((item) => item.GetProperty("requestId").GetString() == "question-expired");
        Assert.Equal("pending", expiredRequest.GetProperty("status").GetString());
        var activeRequest = requests.EnumerateArray().Single((item) => item.GetProperty("requestId").GetString() == "question-active");
        Assert.Equal("question", activeRequest.GetProperty("toolName").GetString());
        Assert.Equal("Active question", activeRequest.GetProperty("title").GetString());
        Assert.Equal("pending", activeRequest.GetProperty("status").GetString());
        Assert.Equal(1, activeRequest.GetProperty("questions").GetArrayLength());

        await using var verificationScope = _factory.Services.CreateAsyncScope();
        var verificationStore = verificationScope.ServiceProvider.GetRequiredService<IQuestionRequestStore>();
        var expired = await verificationStore.GetAsync(sessionId, "question-expired", CancellationToken.None);
        Assert.NotNull(expired);
        Assert.Equal("pending", expired.Status);
    }

    [Fact]
    public async Task ReplyAnswered_ShouldResumeOwnerSessionAndPersistAnsweredRecord()
    {
        const string userId = "user-questions-resume";
        const string sessionId = "session-questions-resume";
        using var factory = CreateFactoryWithLlm(new StubWorkflowLlmClient("question resumed reply"));
        await SeedUserAndSessionAsync(factory, userId, sessionId);
        await InsertQuestionRequestAsync(factory, new QuestionRequestInfoRecord(
            "question-reply-1",
            sessionId,
            userId,
            "question",
            "Need answer",
            "[{\"question\":\"请选择目录\",\"header\":\"目录\",\"options\":[{\"label\":\"workspace\",\"description\":\"查看工作目录\"}]}]",
            null,
            JsonSerializer.Serialize(new
            {
                clientRequestId = "question-reply-client-1",
                nextRound = 2,
                toolCallId = "question-tool-call-1",
                rawInput = new { questions = 1 },
                requestData = new
                {
                    message = "continue after question",
                    model = "gpt-test",
                },
            }),
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 10_000,
            "pending",
            "2026-04-21 16:10:00",
            "2026-04-21 16:10:00"));

        using var client = CreateAuthenticatedClient(factory, userId);
        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/questions/reply", new
        {
            requestId = "question-reply-1",
            status = "answered",
            answers = new[] { new[] { "workspace" } },
        });
        response.EnsureSuccessStatusCode();

        await WaitForConditionAsync(async () => await HasAssistantTextAsync(factory, sessionId, userId, "question resumed reply"));

        await using var verificationScope = factory.Services.CreateAsyncScope();
        var questionStore = verificationScope.ServiceProvider.GetRequiredService<IQuestionRequestStore>();
        var runEventStore = verificationScope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
        var answered = await questionStore.GetAsync(sessionId, "question-reply-1", CancellationToken.None);
        Assert.NotNull(answered);
        Assert.Equal("answered", answered.Status);
        Assert.Equal("[[\"workspace\"]]", answered.AnswerJson);

        var requestEvents = await runEventStore.ListByRequestAsync(sessionId, "question-reply-client-1", CancellationToken.None);
        Assert.Contains(requestEvents, (item) => item.EventType == "question_replied");
        Assert.Contains(requestEvents, (item) => item.EventType == "tool_result");
        Assert.Contains(requestEvents, (item) => item.EventType == "done");
    }

    [Fact]
    public async Task ReplyAnswered_ShouldPreserveResumePayloadAndBuildAnswerOutput()
    {
        const string userId = "user-questions-preserve";
        const string sessionId = "session-questions-preserve";
        var runtimeSpy = new CaptureRuntimeService();
        using var factory = CreateFactoryWithRuntimeSpy(runtimeSpy);
        await SeedUserAndSessionAsync(factory, userId, sessionId, metadataJson: JsonSerializer.Serialize(new { planMode = true }));
        await InsertQuestionRequestAsync(factory, new QuestionRequestInfoRecord(
            "question-reply-2",
            sessionId,
            userId,
            "ExitPlanMode",
            "Exit plan mode",
            "[{\"question\":\"Do you approve this plan?\",\"header\":\"Plan approval\",\"options\":[{\"label\":\"Start implementation\",\"description\":\"Approve\"}]}]",
            null,
            JsonSerializer.Serialize(new
            {
                clientRequestId = "question-reply-client-2",
                nextRound = 3,
                toolCallId = "question-tool-call-2",
                rawInput = new { plan = "1. do things" },
                observability = new
                {
                    source = "qa-test",
                    traceId = "trace-123",
                },
                requestData = new
                {
                    message = "continue after answer",
                    displayMessage = "display continue after answer",
                    agentId = "sisyphus-junior",
                    providerId = "openai",
                    model = "gpt-test",
                    thinkingEnabled = true,
                    webSearchEnabled = false,
                    dialogueMode = "clarify",
                    yoloMode = true,
                    upstreamRetryMaxRetries = 7,
                },
            }),
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 10_000,
            "pending",
            "2026-04-21 16:20:00",
            "2026-04-21 16:20:00"));

        using var client = CreateAuthenticatedClient(factory, userId);
        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/questions/reply", new
        {
            requestId = "question-reply-2",
            status = "answered",
            answers = new[] { new[] { "Start implementation" } },
        });
        response.EnsureSuccessStatusCode();

        var captured = await runtimeSpy.WaitForRequestAsync();
        Assert.Equal(sessionId, captured.SessionId);
        Assert.Equal(userId, captured.UserId);
        Assert.Equal("question-reply-client-2", captured.ClientRequestId);
        Assert.Equal("continue after answer", captured.Message);
        Assert.Equal("display continue after answer", captured.DisplayMessage);
        Assert.Equal("sisyphus-junior", captured.AgentId);
        Assert.Equal("openai", captured.ProviderId);
        Assert.Equal("gpt-test", captured.Model);
        Assert.True(captured.ThinkingEnabled);
        Assert.False(captured.WebSearchEnabled);
        Assert.Equal("{\"message\":\"continue after answer\",\"displayMessage\":\"display continue after answer\",\"agentId\":\"sisyphus-junior\",\"providerId\":\"openai\",\"model\":\"gpt-test\",\"thinkingEnabled\":true,\"webSearchEnabled\":false,\"dialogueMode\":\"clarify\",\"yoloMode\":true,\"upstreamRetryMaxRetries\":7}", captured.RequestDataJson);
        Assert.Equal("{\"presentedToolName\":\"unknown\",\"canonicalToolName\":\"unknown\",\"adapterVersion\":\"1.0.0\"}", captured.ObservabilityJson);
        Assert.NotNull(captured.InitialToolResult);
        Assert.Equal("question-tool-call-2", captured.InitialToolResult!.ToolCallId);
        Assert.Equal("ExitPlanMode", captured.InitialToolResult.ToolName);
        Assert.Equal("{\"plan\":\"1. do things\"}", captured.InitialToolResult.RawInputJson);
        Assert.False(captured.InitialToolResult.IsError);
        Assert.False(captured.InitialToolResult.ResumedAfterApproval);
        Assert.Equal(3, captured.InitialToolResult.NextRound);
        Assert.Equal(JsonSerializer.Serialize("Do you approve this plan?=\"Start implementation\""), captured.InitialToolResult.OutputJson);

        await using var verificationScope = factory.Services.CreateAsyncScope();
        var dbContext = verificationScope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var session = await dbContext.Sessions.SingleAsync((item) => item.Id == sessionId && item.UserId == userId);
        Assert.Contains("\"planMode\":false", session.MetadataJson, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Reply_ShouldReturn409WhenAlreadyResolved()
    {
        const string userId = "user-questions-resolved";
        const string sessionId = "session-questions-resolved";
        await SeedUserAndSessionAsync(_factory, userId, sessionId);
        await InsertQuestionRequestAsync(_factory, new QuestionRequestInfoRecord(
            "question-resolved",
            sessionId,
            userId,
            "question",
            "Resolved question",
            "[]",
            "[[\"answer\"]]",
            null,
            null,
            "answered",
            "2026-04-21 16:30:00",
            "2026-04-21 16:30:00"));

        using var client = CreateAuthenticatedClient(_factory, userId);
        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/questions/reply", new
        {
            requestId = "question-resolved",
            status = "answered",
            answers = new[] { new[] { "another" } },
        });
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(StatusCodes.Status409Conflict, (int)response.StatusCode);
        Assert.Equal("Question request already resolved", payload.GetProperty("error").GetString());
    }

    [Fact]
    public async Task ReplyDismissed_ShouldNotResumeAndShouldKeepAnswerJsonNull()
    {
        const string userId = "user-questions-dismissed";
        const string sessionId = "session-questions-dismissed";
        var runtimeSpy = new CaptureRuntimeService();
        using var factory = CreateFactoryWithRuntimeSpy(runtimeSpy);
        await SeedUserAndSessionAsync(factory, userId, sessionId, stateStatus: "paused");
        await InsertQuestionRequestAsync(factory, new QuestionRequestInfoRecord(
            "question-dismissed",
            sessionId,
            userId,
            "question",
            "Dismissed question",
            "[{\"question\":\"继续吗\",\"header\":\"确认\",\"options\":[{\"label\":\"继续\",\"description\":\"继续\"}]}]",
            null,
            JsonSerializer.Serialize(new
            {
                clientRequestId = "question-dismissed-client",
                nextRound = 2,
                toolCallId = "question-dismissed-tool",
                rawInput = new { questions = 1 },
                requestData = new { message = "continue" },
            }),
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 10_000,
            "pending",
            "2026-04-21 16:35:00",
            "2026-04-21 16:35:00"));

        using var client = CreateAuthenticatedClient(factory, userId);
        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/questions/reply", new
        {
            requestId = "question-dismissed",
            status = "dismissed",
            answers = new[] { new[] { "ignored" } },
        });
        response.EnsureSuccessStatusCode();

        Assert.False(await runtimeSpy.WaitForRequestAsync(TimeSpan.FromMilliseconds(200)));

        await using var verificationScope = factory.Services.CreateAsyncScope();
        var dbContext = verificationScope.ServiceProvider.GetRequiredService<GatewayDbContext>();
        var questionStore = verificationScope.ServiceProvider.GetRequiredService<IQuestionRequestStore>();
        var dismissed = await questionStore.GetAsync(sessionId, "question-dismissed", CancellationToken.None);
        Assert.NotNull(dismissed);
        Assert.Equal("dismissed", dismissed.Status);
        Assert.Null(dismissed.AnswerJson);
        var session = await dbContext.Sessions.SingleAsync((item) => item.Id == sessionId && item.UserId == userId);
        Assert.Equal("paused", session.StateStatus);
    }

    [Fact]
    public async Task ReplyAnswered_ShouldAllowExpiredPendingQuestionLikeTs()
    {
        const string userId = "user-questions-expired";
        const string sessionId = "session-questions-expired";
        using var factory = CreateFactoryWithLlm(new StubWorkflowLlmClient("expired pending resumed reply"));
        await SeedUserAndSessionAsync(factory, userId, sessionId, stateStatus: "paused");
        await InsertQuestionRequestAsync(factory, new QuestionRequestInfoRecord(
            "question-expired-reply",
            sessionId,
            userId,
            "question",
            "Expired reply",
            "[]",
            null,
            JsonSerializer.Serialize(new
            {
                clientRequestId = "question-expired-client",
                nextRound = 2,
                toolCallId = "question-expired-tool",
                rawInput = new { questions = 1 },
                requestData = new { message = "continue" },
            }),
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 1000,
            "pending",
            "2026-04-21 16:40:00",
            "2026-04-21 16:40:00"));

        using var client = CreateAuthenticatedClient(factory, userId);
        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/questions/reply", new
        {
            requestId = "question-expired-reply",
            status = "answered",
            answers = new[] { new[] { "late" } },
        });
        response.EnsureSuccessStatusCode();

        await WaitForConditionAsync(async () => await HasAssistantTextAsync(factory, sessionId, userId, "expired pending resumed reply"));

        await using var verificationScope = factory.Services.CreateAsyncScope();
        var runEventStore = verificationScope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
        var questionStore = verificationScope.ServiceProvider.GetRequiredService<IQuestionRequestStore>();
        var expired = await questionStore.GetAsync(sessionId, "question-expired-reply", CancellationToken.None);
        Assert.NotNull(expired);
        Assert.Equal("answered", expired.Status);

        var events = await runEventStore.ListByRequestAsync(sessionId, "question-expired-client", CancellationToken.None);
        var questionReplied = events.Single((item) => item.EventType == "question_replied");
        using var payloadDocument = JsonDocument.Parse(questionReplied.PayloadJson);
        Assert.Equal("question:question-expired-reply:replied", payloadDocument.RootElement.GetProperty("eventId").GetString());
        Assert.Equal("question:question-expired-reply", payloadDocument.RootElement.GetProperty("runId").GetString());
        Assert.Equal("answered", payloadDocument.RootElement.GetProperty("status").GetString());
    }

    [Fact]
    public async Task ReplyAnswered_ShouldNotResumeWhenNextRoundMissing()
    {
        const string userId = "user-questions-no-next-round";
        const string sessionId = "session-questions-no-next-round";
        var runtimeSpy = new CaptureRuntimeService();
        using var factory = CreateFactoryWithRuntimeSpy(runtimeSpy);
        await SeedUserAndSessionAsync(factory, userId, sessionId);
        await InsertQuestionRequestAsync(factory, new QuestionRequestInfoRecord(
            "question-no-next-round",
            sessionId,
            userId,
            "question",
            "No next round",
            "[{\"question\":\"继续吗\",\"header\":\"确认\",\"options\":[{\"label\":\"继续\",\"description\":\"继续\"}]}]",
            null,
            JsonSerializer.Serialize(new
            {
                clientRequestId = "question-no-next-round-client",
                toolCallId = "question-no-next-round-tool",
                rawInput = new { questions = 1 },
                requestData = new { message = "continue without next round" },
            }),
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 10_000,
            "pending",
            "2026-04-21 16:45:00",
            "2026-04-21 16:45:00"));

        using var client = CreateAuthenticatedClient(factory, userId);
        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/questions/reply", new
        {
            requestId = "question-no-next-round",
            status = "answered",
            answers = new[] { new[] { "继续" } },
        });
        response.EnsureSuccessStatusCode();

        Assert.False(await runtimeSpy.WaitForRequestAsync(TimeSpan.FromMilliseconds(200)));
    }

    [Fact]
    public async Task ReplyAnswered_ShouldNotResumeWhenNextRoundTypeIsInvalid()
    {
        const string userId = "user-questions-invalid-next-round";
        const string sessionId = "session-questions-invalid-next-round";
        var runtimeSpy = new CaptureRuntimeService();
        using var factory = CreateFactoryWithRuntimeSpy(runtimeSpy);
        await SeedUserAndSessionAsync(factory, userId, sessionId);
        await InsertQuestionRequestAsync(factory, new QuestionRequestInfoRecord(
            "question-invalid-next-round",
            sessionId,
            userId,
            "question",
            "Invalid next round",
            "[{\"question\":\"继续吗\",\"header\":\"确认\",\"options\":[{\"label\":\"继续\",\"description\":\"继续\"}]}]",
            null,
            "{\"clientRequestId\":\"question-invalid-next-round-client\",\"nextRound\":\"two\",\"toolCallId\":\"question-invalid-next-round-tool\",\"rawInput\":{\"questions\":1},\"requestData\":{\"message\":\"continue with invalid next round\"}}",
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 10_000,
            "pending",
            "2026-04-21 16:47:00",
            "2026-04-21 16:47:00"));

        using var client = CreateAuthenticatedClient(factory, userId);
        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/questions/reply", new
        {
            requestId = "question-invalid-next-round",
            status = "answered",
            answers = new[] { new[] { "继续" } },
        });
        response.EnsureSuccessStatusCode();

        Assert.False(await runtimeSpy.WaitForRequestAsync(TimeSpan.FromMilliseconds(200)));
    }

    [Fact]
    public async Task ReplyAnswered_ShouldReconcileSessionToIdleWhenResumeReturnsNonSuccess()
    {
        const string userId = "user-questions-reconcile-idle";
        const string sessionId = "session-questions-reconcile-idle";
        var runtimeSpy = new CaptureRuntimeService(statusCode: StatusCodes.Status409Conflict);
        using var factory = CreateFactoryWithRuntimeSpy(runtimeSpy);
        await SeedUserAndSessionAsync(factory, userId, sessionId, stateStatus: "paused");
        await InsertQuestionRequestAsync(factory, new QuestionRequestInfoRecord(
            "question-reconcile-idle",
            sessionId,
            userId,
            "question",
            "Resume non-success",
            "[{\"question\":\"继续吗\",\"header\":\"确认\",\"options\":[{\"label\":\"继续\",\"description\":\"继续\"}]}]",
            null,
            JsonSerializer.Serialize(new
            {
                clientRequestId = "question-reconcile-client",
                nextRound = 2,
                toolCallId = "question-reconcile-tool",
                rawInput = new { questions = 1 },
                requestData = new { message = "continue despite non-success" },
            }),
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 10_000,
            "pending",
            "2026-04-21 17:00:00",
            "2026-04-21 17:00:00"));

        using var client = CreateAuthenticatedClient(factory, userId);
        var response = await client.PostAsJsonAsync($"/sessions/{sessionId}/questions/reply", new
        {
            requestId = "question-reconcile-idle",
            status = "answered",
            answers = new[] { new[] { "继续" } },
        });
        response.EnsureSuccessStatusCode();

        await runtimeSpy.WaitForRequestAsync();
        await WaitForConditionAsync(async () =>
        {
            await using var scope = factory.Services.CreateAsyncScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<GatewayDbContext>();
            var session = await dbContext.Sessions.SingleAsync((item) => item.Id == sessionId && item.UserId == userId);
            return session.StateStatus == "idle";
        });
    }

    [Fact]
    public async Task Reconciler_ShouldNotExpireQuestionRequestsInBackground()
    {
        const string userId = "user-questions-background-expire";
        const string sessionId = "session-questions-background-expire";
        await SeedUserAndSessionAsync(_factory, userId, sessionId, stateStatus: "paused");
        await InsertQuestionRequestAsync(_factory, new QuestionRequestInfoRecord(
            "question-background-expire",
            sessionId,
            userId,
            "question",
            "Background expire",
            "[]",
            null,
            JsonSerializer.Serialize(new
            {
                clientRequestId = "question-background-expire-client",
                nextRound = 2,
                toolCallId = "question-background-expire-tool",
                rawInput = new { questions = 1 },
                requestData = new { message = "continue" },
            }),
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 1000,
            "pending",
            "2026-04-21 16:50:00",
            "2026-04-21 16:50:00"));

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var reconciler = scope.ServiceProvider.GetRequiredService<ISessionRuntimeReconciler>();
            await reconciler.ReconcileSessionRuntimeAsync(sessionId, userId, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), CancellationToken.None);
        }

        await using var verificationScope = _factory.Services.CreateAsyncScope();
        var questionStore = verificationScope.ServiceProvider.GetRequiredService<IQuestionRequestStore>();
        var expired = await questionStore.GetAsync(sessionId, "question-background-expire", CancellationToken.None);
        Assert.NotNull(expired);
        Assert.Equal("pending", expired.Status);
    }

    private WebApplicationFactory<OpenAWork.Gateway.Host.Program> CreateFactoryWithLlm(IWorkflowLlmClient llmClient)
    {
        return _factory.WithWebHostBuilder((builder) =>
        {
            builder.ConfigureTestServices((services) =>
            {
                services.RemoveAll<IWorkflowLlmClient>();
                services.AddSingleton(llmClient);
            });
        });
    }

    private WebApplicationFactory<OpenAWork.Gateway.Host.Program> CreateFactoryWithRuntimeSpy(CaptureRuntimeService runtimeService)
    {
        return _factory.WithWebHostBuilder((builder) =>
        {
            builder.ConfigureTestServices((services) =>
            {
                services.RemoveAll<ISessionStreamRuntimeService>();
                services.AddSingleton<ISessionStreamRuntimeService>(runtimeService);
            });
        });
    }

    private static HttpClient CreateAuthenticatedClient(WebApplicationFactory<OpenAWork.Gateway.Host.Program> factory, string userId)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthTestTokenFactory.Create(userId));
        return client;
    }

    private static async Task SeedUserAndSessionAsync(
        WebApplicationFactory<OpenAWork.Gateway.Host.Program> factory,
        string userId,
        string sessionId,
        string metadataJson = "{}",
        string stateStatus = "idle")
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

        if (!await dbContext.Sessions.AnyAsync((session) => session.Id == sessionId && session.UserId == userId))
        {
            dbContext.Sessions.Add(new SessionRecord
            {
                Id = sessionId,
                UserId = userId,
                MessagesJson = "[]",
                StateStatus = stateStatus,
                MetadataJson = metadataJson,
                Title = "Question Session",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
        }

        await dbContext.SaveChangesAsync();
    }

    private static async Task InsertQuestionRequestAsync(WebApplicationFactory<OpenAWork.Gateway.Host.Program> factory, QuestionRequestInfoRecord record)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IQuestionRequestStore>();
        await store.InsertAsync(record, CancellationToken.None);
    }

    private static async Task<bool> HasAssistantTextAsync(WebApplicationFactory<OpenAWork.Gateway.Host.Program> factory, string sessionId, string userId, string expectedText)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var messageStore = scope.ServiceProvider.GetRequiredService<IMessageV2Store>();
        var messages = await messageStore.ListMessagesWithPartsAsync(sessionId, userId, 100, CancellationToken.None);
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

    private sealed class StubWorkflowLlmClient(string responseText) : IWorkflowLlmClient
    {
        public Task<string> CompleteAsync(string apiBaseUrl, string apiKey, string model, string prompt, double temperature, CancellationToken cancellationToken)
            => Task.FromResult(responseText);
    }

    private sealed class CaptureRuntimeService : ISessionStreamRuntimeService
    {
        private readonly TaskCompletionSource<SessionStreamRuntimeRequest> _requestSource = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly int _statusCode;

        public CaptureRuntimeService(int statusCode = StatusCodes.Status200OK)
        {
            _statusCode = statusCode;
        }

        public Task<int> HandleAsync(SessionStreamRuntimeRequest request, Func<object, ValueTask> writeChunk, CancellationToken connectionCancellationToken)
        {
            _requestSource.TrySetResult(request);
            return Task.FromResult(_statusCode);
        }

        public async Task<SessionStreamRuntimeRequest> WaitForRequestAsync()
            => await _requestSource.Task.WaitAsync(TimeSpan.FromSeconds(5));

        public async Task<bool> WaitForRequestAsync(TimeSpan timeout)
        {
            try
            {
                await _requestSource.Task.WaitAsync(timeout);
                return true;
            }
            catch (TimeoutException)
            {
                return false;
            }
        }
    }
}
