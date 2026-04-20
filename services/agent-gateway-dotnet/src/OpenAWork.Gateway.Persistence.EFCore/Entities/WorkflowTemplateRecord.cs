namespace OpenAWork.Gateway.Persistence.EFCore.Entities;

public sealed class WorkflowTemplateRecord
{
    public required string Id { get; set; }

    public required string UserId { get; set; }

    public required string Name { get; set; }

    public string? Description { get; set; }

    public required string Category { get; set; }

    public required string MetadataJson { get; set; }

    public required string NodesJson { get; set; }

    public required string EdgesJson { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public UserRecord? User { get; set; }
}
