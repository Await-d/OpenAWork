using OpenAWork.Gateway.Contracts.Observability;

namespace OpenAWork.Gateway.Application.Abstractions.Observability;

public interface IRequestWorkflowTracker
{
    RequestContext? CurrentContext { get; }

    WorkflowStep? RootStep { get; }

    void Initialize(RequestContext context, WorkflowStep rootStep);

    WorkflowStep StartChild(WorkflowStep parent, string name, string? message = null, IReadOnlyDictionary<string, string>? fields = null);

    void Succeed(WorkflowStep step, string? message = null, IReadOnlyDictionary<string, string>? fields = null);

    void Fail(WorkflowStep step, string? message = null, IReadOnlyDictionary<string, string>? fields = null);

    void SettlePending(string? message, int statusCode);

    string Render(int statusCode, IReadOnlyDictionary<string, string>? extra = null);

    IReadOnlyCollection<WorkflowStep> Snapshot();

    void Clear();
}
