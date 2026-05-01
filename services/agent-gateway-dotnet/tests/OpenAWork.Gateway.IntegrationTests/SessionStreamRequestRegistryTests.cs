using OpenAWork.Gateway.Application.Abstractions.Streaming;
using OpenAWork.Gateway.Infrastructure.Streaming;

namespace OpenAWork.Gateway.IntegrationTests;

public sealed class SessionStreamRequestRegistryTests
{
    [Fact]
    public async Task RegisterOrGetConflict_ShouldAllowOnlyOneActiveRequestPerSession()
    {
        const string sessionId = "session-registry-race";
        const string userId = "user-registry-race";

        for (var iteration = 0; iteration < 50; iteration += 1)
        {
            var registry = new InMemorySessionStreamRequestRegistry();
            using var barrier = new Barrier(8);
            var tasks = Enumerable.Range(0, 8)
                .Select((index) => Task.Run(() =>
                {
                    using var cts = new CancellationTokenSource();
                    barrier.SignalAndWait();
                    return registry.RegisterOrGetConflict(sessionId, userId, $"req-{index}", cts);
                }))
                .ToArray();

            var results = await Task.WhenAll(tasks);
            Assert.Equal(1, results.Count((result) => result.State == SessionStreamRegistrationState.Registered));
            Assert.Equal(7, results.Count((result) => result.State == SessionStreamRegistrationState.OtherRequestInFlight));

            var active = registry.GetAnyForSession(sessionId, userId);
            Assert.NotNull(active);
            registry.Complete(sessionId, active!.ClientRequestId);
            Assert.Null(registry.GetAnyForSession(sessionId, userId));
        }
    }
}
