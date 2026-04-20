using System.Collections.Concurrent;
using OpenAWork.Gateway.Application.Abstractions.Streaming;

namespace OpenAWork.Gateway.Infrastructure.Streaming;

public sealed class InMemorySessionStreamRequestRegistry : ISessionStreamRequestRegistry
{
    private readonly ConcurrentDictionary<string, SessionStreamInFlightRequest> _requests = new(StringComparer.Ordinal);

    public SessionStreamInFlightRequest? Get(string sessionId, string clientRequestId)
        => _requests.GetValueOrDefault(BuildKey(sessionId, clientRequestId));

    public SessionStreamInFlightRequest? GetAnyForSession(string sessionId, string userId, string? excludeClientRequestId = null)
    {
        return _requests.Values.FirstOrDefault((request) =>
            request.SessionId == sessionId
            && request.UserId == userId
            && !string.Equals(request.ClientRequestId, excludeClientRequestId, StringComparison.Ordinal));
    }

    public SessionStreamRegistrationResult RegisterOrGetConflict(string sessionId, string userId, string clientRequestId, CancellationTokenSource cancellation)
    {
        var exactKey = BuildKey(sessionId, clientRequestId);
        if (_requests.TryGetValue(exactKey, out var existingExact))
        {
            return new SessionStreamRegistrationResult(SessionStreamRegistrationState.SameRequestInFlight, existingExact);
        }

        var anySessionConflict = GetAnyForSession(sessionId, userId, clientRequestId);
        if (anySessionConflict is not null)
        {
            return new SessionStreamRegistrationResult(SessionStreamRegistrationState.OtherRequestInFlight, anySessionConflict);
        }

        var request = new SessionStreamInFlightRequest(sessionId, userId, clientRequestId, cancellation);
        if (!_requests.TryAdd(exactKey, request))
        {
            var existing = _requests.GetValueOrDefault(exactKey);
            return new SessionStreamRegistrationResult(SessionStreamRegistrationState.SameRequestInFlight, existing);
        }

        return new SessionStreamRegistrationResult(SessionStreamRegistrationState.Registered, request);
    }

    public void Complete(string sessionId, string clientRequestId)
    {
        if (_requests.TryRemove(BuildKey(sessionId, clientRequestId), out var request))
        {
            request.Completion.TrySetResult(null);
        }
    }

    public async Task<bool> StopAsync(string sessionId, string userId, string clientRequestId, CancellationToken cancellationToken)
    {
        var request = Get(sessionId, clientRequestId);
        if (request is null || request.UserId != userId)
        {
            return false;
        }

        request.Cancellation.Cancel();
        await WaitForCompletionIgnoringFailuresAsync(request.Completion.Task, cancellationToken);
        return true;
    }

    public async Task<bool> StopAnyAsync(string sessionId, string userId, CancellationToken cancellationToken)
    {
        var request = GetAnyForSession(sessionId, userId);
        if (request is null)
        {
            return false;
        }

        request.Cancellation.Cancel();
        await WaitForCompletionIgnoringFailuresAsync(request.Completion.Task, cancellationToken);
        return true;
    }

    private static string BuildKey(string sessionId, string clientRequestId) => $"{sessionId}::{clientRequestId}";

    private static Task WaitForCompletionIgnoringFailuresAsync(Task completion, CancellationToken cancellationToken)
        => completion.ContinueWith(
                static _ => { },
                CancellationToken.None,
                TaskContinuationOptions.ExecuteSynchronously,
                TaskScheduler.Default)
            .WaitAsync(cancellationToken);
}
