namespace OpenAWork.Gateway.Application.Abstractions.Streaming;

public interface ISessionStreamRequestRegistry
{
    SessionStreamInFlightRequest? Get(string sessionId, string clientRequestId);

    SessionStreamInFlightRequest? GetAnyForSession(string sessionId, string userId, string? excludeClientRequestId = null);

    SessionStreamRegistrationResult RegisterOrGetConflict(string sessionId, string userId, string clientRequestId, CancellationTokenSource cancellation);

    void Complete(string sessionId, string clientRequestId);

    Task<bool> StopAsync(string sessionId, string userId, string clientRequestId, CancellationToken cancellationToken);

    Task<bool> StopAnyAsync(string sessionId, string userId, CancellationToken cancellationToken);
}

public sealed class SessionStreamInFlightRequest
{
    public SessionStreamInFlightRequest(string sessionId, string userId, string clientRequestId, CancellationTokenSource cancellation)
    {
        SessionId = sessionId;
        UserId = userId;
        ClientRequestId = clientRequestId;
        Cancellation = cancellation;
    }

    public string SessionId { get; }

    public string UserId { get; }

    public string ClientRequestId { get; }

    public CancellationTokenSource Cancellation { get; }

    public TaskCompletionSource<object?> Completion { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
}

public sealed record SessionStreamRegistrationResult(
    SessionStreamRegistrationState State,
    SessionStreamInFlightRequest? ExistingRequest);

public enum SessionStreamRegistrationState
{
    Registered,
    SameRequestInFlight,
    OtherRequestInFlight,
}
