namespace OpenAWork.Gateway.Application.Abstractions.Streaming;

public interface ISessionRuntimeReconciler
{
    Task<bool> HandleChildSessionTerminalAsync(TaskChildSessionTerminalInput input, CancellationToken cancellationToken);

    Task<SessionRuntimeReconciliationResult> ReconcileSessionRuntimeAsync(
        string sessionId,
        string userId,
        long? nowMs,
        CancellationToken cancellationToken);

    Task<SessionRuntimeBatchReconciliationResult> ReconcileAllAsync(long? nowMs, CancellationToken cancellationToken);
}

public sealed record TaskChildSessionTerminalInput(
    string SessionId,
    string UserId,
    int StatusCode,
    bool PendingInteraction,
    string? TerminalReason);

public sealed record SessionRuntimeReconciliationResult(
    string SessionId,
    string Status,
    string PreviousStatus,
    bool WasReset,
    bool ReconciledAsTimeout,
    bool PendingInteractionExpired,
    bool AutoResumeScheduled);

public sealed record SessionRuntimeBatchReconciliationResult(
    int CandidateCount,
    int ResetCount,
    int PausedCount,
    IReadOnlyList<string> FailedSessionIds);
