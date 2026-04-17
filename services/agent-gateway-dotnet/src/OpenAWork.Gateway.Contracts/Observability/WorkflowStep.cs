namespace OpenAWork.Gateway.Contracts.Observability;

public sealed class WorkflowStep
{
    public required string Name { get; init; }

    public StepStatus Status { get; set; } = StepStatus.Pending;

    public string? Message { get; set; }

    public long? DurationMs { get; set; }

    public Dictionary<string, string>? Fields { get; set; }

    public List<WorkflowStep> Children { get; set; } = [];

    public DateTimeOffset? StartedAtUtc { get; set; }
}
