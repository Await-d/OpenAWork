using OpenAWork.Gateway.Application.Abstractions.Observability;
using OpenAWork.Gateway.Contracts.Observability;

namespace OpenAWork.Gateway.Infrastructure.Observability;

public sealed class RequestWorkflowTracker : IRequestWorkflowTracker
{
    private readonly WorkflowLogger _workflowLogger = new();

    public RequestContext? CurrentContext { get; private set; }

    public WorkflowStep? RootStep { get; private set; }

    public void Initialize(RequestContext context, WorkflowStep rootStep)
    {
        _workflowLogger.Reset();
        _workflowLogger.TrackRoot(rootStep);
        CurrentContext = context;
        RootStep = rootStep;
    }

    public WorkflowStep StartChild(WorkflowStep parent, string name, string? message = null, IReadOnlyDictionary<string, string>? fields = null)
        => _workflowLogger.StartChild(parent, name, message, fields);

    public void Succeed(WorkflowStep step, string? message = null, IReadOnlyDictionary<string, string>? fields = null)
        => _workflowLogger.Succeed(step, message, fields);

    public void Fail(WorkflowStep step, string? message = null, IReadOnlyDictionary<string, string>? fields = null)
        => _workflowLogger.Fail(step, message, fields);

    public void SettlePending(string? message, int statusCode)
    {
        if (RootStep is null)
        {
            return;
        }

        var finalStatus = statusCode >= 400 ? StepStatus.Error : StepStatus.Success;
        _workflowLogger.SettlePending(
            RootStep,
            finalStatus,
            message,
            new Dictionary<string, string>
            {
                ["statusCode"] = statusCode.ToString(),
            });
    }

    public string Render(int statusCode, IReadOnlyDictionary<string, string>? extra = null)
    {
        if (CurrentContext is null)
        {
            return string.Empty;
        }

        return _workflowLogger.Render(CurrentContext, statusCode, extra);
    }

    public IReadOnlyCollection<WorkflowStep> Snapshot() => _workflowLogger.Snapshot();

    public void Clear()
    {
        CurrentContext = null;
        RootStep = null;
        _workflowLogger.Reset();
    }
}
