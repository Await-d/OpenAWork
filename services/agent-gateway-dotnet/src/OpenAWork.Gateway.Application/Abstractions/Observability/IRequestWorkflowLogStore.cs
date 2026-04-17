using OpenAWork.Gateway.Contracts.Observability;

namespace OpenAWork.Gateway.Application.Abstractions.Observability;

public interface IRequestWorkflowLogStore
{
    Task PersistAsync(
        RequestContext context,
        IReadOnlyCollection<WorkflowStep> steps,
        int statusCode,
        string? userId,
        CancellationToken cancellationToken);
}
