using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Persistence.EFCore;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.ScenarioVerification;

public sealed class SessionStreamAttachReplayVerificationTests : IClassFixture<GatewayScenarioFactory>
{
    private readonly GatewayScenarioFactory _factory;

    public SessionStreamAttachReplayVerificationTests(GatewayScenarioFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task AttachRoute_ShouldReplayTerminalRequestFromDurableEvents()
    {
        const string userId = "user-scenario-stream-attach";
        const string sessionId = "session-scenario-stream-attach";
        const string clientRequestId = "req-scenario-stream-attach";
        await SeedUserAndSessionAsync(userId, sessionId);
        await PersistRunEventAsync(sessionId, userId, clientRequestId, seq: 3, payloadJson: "{\"type\":\"text_delta\",\"delta\":\"已恢复\",\"eventId\":\"run-terminal:evt:3\",\"runId\":\"run-terminal\",\"occurredAt\":103}", occurredAtMs: 103, eventType: "text_delta");
        await PersistRunEventAsync(sessionId, userId, clientRequestId, seq: 4, payloadJson: "{\"type\":\"done\",\"stopReason\":\"end_turn\",\"eventId\":\"run-terminal:evt:4\",\"runId\":\"run-terminal\",\"occurredAt\":104}", occurredAtMs: 104, eventType: "done");

        using var client = _factory.CreateClient();
        var token = Uri.EscapeDataString(CreateAuthToken(userId));
        var response = await client.GetAsync($"/sessions/{sessionId}/stream/attach?token={token}&clientRequestId={clientRequestId}&afterSeq=2");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("retry: 1000", body, StringComparison.Ordinal);
        Assert.Contains("\"delta\":\"已恢复\"", body, StringComparison.Ordinal);
        Assert.Contains("\"stopReason\":\"end_turn\"", body, StringComparison.Ordinal);
    }

    private async Task PersistRunEventAsync(string sessionId, string userId, string clientRequestId, long seq, string payloadJson, long occurredAtMs, string eventType)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<ISessionRunEventStore>();
        await store.PersistAsync(new SessionRunEventInfoRecord(
            0,
            sessionId,
            userId,
            clientRequestId,
            seq,
            eventType,
            null,
            null,
            occurredAtMs,
            payloadJson,
            "2026-04-20 10:00:00"), CancellationToken.None);
    }

    private async Task SeedUserAndSessionAsync(string userId, string sessionId)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
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
                Title = "Attach Scenario Session",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow,
            });
        }

        await dbContext.SaveChangesAsync();
    }

    private static string CreateAuthToken(string userId)
    {
        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes("change-me-in-production-min-32-chars")),
            SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: "OpenAWork.Gateway.DotNet",
            audience: "OpenAWork.Client",
            claims:
            [
                new Claim("sub", userId),
                new Claim("email", $"{userId}@openawork.local"),
            ],
            expires: DateTime.UtcNow.AddMinutes(30),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
